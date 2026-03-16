/**
 * File List Fetcher for Explicit Loop Architecture
 * Fetches PR details and file list before starting the review loop
 * Uses NeuroLink tool execution directly (not generate)
 */

import { NeuroLink } from "@juspay/neurolink";
import {
  GetPullRequestResponse,
  DiffFile,
  Comment,
  FileChange,
  GetPullRequestDiffResponse,
} from "../types/mcp.types.js";
import {
  FileReviewTarget,
  PrefetchedPRData,
} from "../types/explicit-loop.types.js";
import { ReviewRequest } from "../types/v2.types.js";

/**
 * FileListFetcher handles pre-fetching PR data before the review loop
 * This separates data fetching from AI analysis
 */
export class FileListFetcher {
  /**
   * Fetch PR details and file list BEFORE starting review loop
   * Uses NeuroLink tool execution directly
   */
  async fetchPRDetails(
    neurolink: NeuroLink,
    request: ReviewRequest,
  ): Promise<PrefetchedPRData> {
    // Execute get_pull_request tool directly
    const rawResponse = await neurolink.executeTool("get_pull_request", {
      workspace: request.workspace,
      repository: request.repository,
      pull_request_id: request.pullRequestId,
      branch: request.branch,
    });

    // Unwrap MCP response format: { content: [{ type: "text", text: "...json..." }] }
    const prData = this.unwrapMCPResponse(
      rawResponse,
    ) as GetPullRequestResponse | null;

    if (!prData) {
      throw new Error("Could not parse MCP response for PR details");
    }

    // Extract file list from PR response
    const files = this.extractFiles(prData.file_changes || []);

    // Build comments map grouped by file path
    const existingComments = this.groupCommentsByFile(
      prData.active_comments || [],
    );

    return {
      prDetails: this.mapToPRDetails(prData),
      files,
      existingComments,
    };
  }

  /**
   * Map MCP server response to PrefetchedPRData.prDetails format
   * MCP server returns flattened fields: source_branch, destination_branch, author (string)
   * Also handles nested API format for compatibility
   */
  private mapToPRDetails(pr: any): PrefetchedPRData["prDetails"] {
    // Handle source branch - MCP returns flattened, API returns nested
    const sourceBranch =
      pr.source_branch ||
      pr.fromRef?.displayId ||
      pr.source?.branch?.name ||
      "unknown";

    // Handle destination branch
    const destinationBranch =
      pr.destination_branch ||
      pr.toRef?.displayId ||
      pr.destination?.branch?.name ||
      "unknown";

    // Handle author - MCP returns string, API returns object
    let authorName = "Unknown";
    let authorUsername = "unknown";

    if (typeof pr.author === "string") {
      authorName = pr.author;
      authorUsername = pr.author_username || pr.author;
    } else if (pr.author) {
      const authorObj = pr.author.user || pr.author;
      authorName = authorObj.displayName || authorObj.display_name || "Unknown";
      authorUsername = authorObj.name || "unknown";
    }

    return {
      id: pr.id,
      title: pr.title,
      description: pr.description || "",
      author: {
        name: authorUsername,
        displayName: authorName,
      },
      state: pr.state,
      source: {
        branch: { name: sourceBranch },
        commit: { id: pr.source_commit || pr.fromRef?.latestCommit || "" },
      },
      destination: {
        branch: { name: destinationBranch },
        commit: { id: pr.destination_commit || pr.toRef?.latestCommit || "" },
      },
      createdDate: pr.created_on || pr.createdDate,
      updatedDate: pr.updated_on || pr.updatedDate,
    };
  }

  /**
   * Fetch diff for a single file
   * Called during the review loop for each file
   */
  async fetchFileDiff(
    neurolink: NeuroLink,
    workspace: string,
    repository: string,
    prId: number,
    filePath: string,
  ): Promise<DiffFile | null> {
    try {
      const rawResponse = await neurolink.executeTool("get_pull_request_diff", {
        workspace,
        repository,
        pull_request_id: prId,
        path: filePath,
      });

      // Unwrap MCP response format: { content: [{ type: "text", text: "...json..." }] }
      const diffResponse = this.unwrapMCPResponse(
        rawResponse,
      ) as GetPullRequestDiffResponse | null;

      // The diff response contains a files array
      if (diffResponse && diffResponse.files && diffResponse.files.length > 0) {
        return diffResponse.files[0];
      }

      return null;
    } catch (error) {
      console.error(`   ⚠️  Error fetching diff for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract file targets from PR file changes
   * Maps Bitbucket file change format to our FileReviewTarget format
   */
  private extractFiles(fileChanges: FileChange[]): FileReviewTarget[] {
    return fileChanges.map((change) => ({
      path: change.path || change.file || "",
      status: this.mapFileStatus(change.type),
      oldPath: change.type === "RENAME" ? change.path : undefined,
    }));
  }

  /**
   * Map Bitbucket file status to our internal status
   */
  private mapFileStatus(
    type: "ADD" | "MODIFY" | "DELETE" | "RENAME",
  ): FileReviewTarget["status"] {
    const statusMap: Record<string, FileReviewTarget["status"]> = {
      ADD: "added",
      MODIFY: "modified",
      DELETE: "deleted",
      RENAME: "renamed",
    };
    return statusMap[type] || "modified";
  }

  /**
   * Group existing comments by file path
   * Used for duplicate detection during review
   */
  private groupCommentsByFile(comments: Comment[]): Map<string, Comment[]> {
    const grouped = new Map<string, Comment[]>();

    for (const comment of comments) {
      const filePath = comment.anchor?.filePath;
      if (filePath) {
        if (!grouped.has(filePath)) {
          grouped.set(filePath, []);
        }
        grouped.get(filePath)!.push(comment);
      }
    }

    return grouped;
  }

  /**
   * Unwrap MCP tool response format
   * MCP returns: { content: [{ type: "text", text: "...json..." }] }
   * This extracts and parses the JSON from the text field
   */
  private unwrapMCPResponse(response: unknown): unknown {
    const typedResponse = response as {
      content?: Array<{ type?: string; text?: string }>;
    };

    if (
      typedResponse?.content &&
      Array.isArray(typedResponse.content) &&
      typedResponse.content.length > 0
    ) {
      const contentItem = typedResponse.content[0];
      if (
        contentItem?.type === "text" &&
        typeof contentItem.text === "string"
      ) {
        try {
          return JSON.parse(contentItem.text);
        } catch {
          // If it's not valid JSON, return the text as-is
          return contentItem.text;
        }
      }
    }
    // If not in expected format, return as-is (might already be unwrapped)
    return response;
  }

  /**
   * Filter out excluded files based on patterns
   * Matches against the exclude patterns from config
   */
  filterExcludedFiles(
    files: FileReviewTarget[],
    excludePatterns: string[],
  ): FileReviewTarget[] {
    return files.filter((file) => {
      for (const pattern of excludePatterns) {
        if (this.matchesPattern(file.path, pattern)) {
          return false; // Exclude this file
        }
      }
      return true; // Include this file
    });
  }

  /**
   * Check if a file path matches a glob-like pattern
   * Supports simple wildcards: * and **
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, "<<<DOUBLE_STAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<DOUBLE_STAR>>>/g, ".*")
      .replace(/\./g, "\\.")
      .replace(/\?/g, ".");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath) || regex.test(filePath.split("/").pop() || "");
  }
}
