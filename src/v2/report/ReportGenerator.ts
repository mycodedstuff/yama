/**
 * Report Generator for Yama V2
 * Writes AI-generated reports to files
 *
 * In report mode, the AI directly generates the report content.
 * This class handles writing that content to a file.
 */

import { writeFile, mkdir, readFile } from "fs/promises";
import { dirname } from "path";
import { ReportFormat } from "../types/report.types.js";
import {
  ReviewIssue,
  FileReviewTarget,
  ReviewDecision,
} from "../types/explicit-loop.types.js";

export class ReportGenerator {
  /**
   * Write AI response directly to file
   * For markdown format: write the response as-is
   * For JSON format: extract JSON from code block if present
   */
  async writeReportFromAIResponse(
    response: string,
    format: ReportFormat,
    path: string,
  ): Promise<void> {
    let content = response;

    // For JSON format, extract JSON from markdown code block if present
    if (format === "json") {
      content = this.extractJSONContent(response);
    }

    // Handle stdout
    if (path === "-") {
      console.log(content);
      return;
    }

    // Ensure directory exists
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    // Write file (trim to remove leading/trailing whitespace from AI output)
    await writeFile(path, content.trim(), "utf-8");
  }

  /**
   * Extract JSON content from AI response
   * If the response contains a ```json code block, extract just the JSON
   * Otherwise, return the response as-is (assuming it's already JSON)
   */
  private extractJSONContent(response: string): string {
    // Try to find JSON in code block
    const jsonBlockMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      return jsonBlockMatch[1].trim();
    }

    // Check if response is already valid JSON
    try {
      JSON.parse(response);
      return response;
    } catch {
      // Not valid JSON, return as-is and let the caller handle it
      return response;
    }
  }

  /**
   * Generate default report path
   * @param prId - Pull request ID
   * @param format - Output format (md or json)
   * @param timestamp - Optional timestamp (defaults to now)
   * @param repository - Optional repository name for filename prefix
   */
  generateDefaultPath(
    prId: number | string,
    format: ReportFormat,
    timestamp?: Date,
    repository?: string,
  ): string {
    const ts = timestamp || new Date();

    // Use local time instead of UTC for user-friendly filenames
    const year = ts.getFullYear();
    const month = String(ts.getMonth() + 1).padStart(2, "0");
    const day = String(ts.getDate()).padStart(2, "0");
    const hour = String(ts.getHours()).padStart(2, "0");
    const minute = String(ts.getMinutes()).padStart(2, "0");
    const second = String(ts.getSeconds()).padStart(2, "0");
    const tsStr = `${year}-${month}-${day}T${hour}-${minute}-${second}`;

    const ext = format === "json" ? "json" : "md";
    const repoPrefix = repository ? `${repository}-` : "";
    return `.yama/reports/${repoPrefix}pr-${prId}-${tsStr}.${ext}`;
  }

  /**
   * Append enhanced description section to an existing report file
   * Used in report mode when description enhancement is enabled
   */
  async appendEnhancedDescription(
    reportPath: string,
    enhancedDescription: string,
  ): Promise<void> {
    // Read existing report
    const existingReport = await readFile(reportPath, "utf-8");

    // Build the enhanced description section
    const enhancedSection = `

---

## Enhanced Description

The following is an AI-generated enhanced PR description based on the code changes:

${enhancedDescription}
`;

    // Append to the report
    await writeFile(reportPath, existingReport + enhancedSection, "utf-8");
  }

  /**
   * Build enhanced description section content
   * Returns the formatted section without modifying the file
   */
  buildEnhancedDescriptionSection(enhancedDescription: string): string {
    return `

---

## Enhanced Description

The following is an AI-generated enhanced PR description based on the code changes:

${enhancedDescription}
`;
  }

  // ============================================================================
  // Explicit Loop Architecture Methods
  // ============================================================================

  /**
   * Build report content from aggregated file review findings
   * Used by explicit loop mode to generate report without AI generating it
   */
  buildReportFromFindings(params: {
    prDetails: {
      id: number;
      title: string;
      description: string;
      author: { name: string; displayName: string };
      state: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
      createdDate: string;
      updatedDate: string;
    };
    filesReviewed: FileReviewTarget[];
    allIssues: ReviewIssue[];
    decision: ReviewDecision;
    format: "md" | "json";
    workspace: string;
    repository: string;
    duration: number;
    totalTokens: number;
  }): string {
    const { prDetails, filesReviewed, allIssues, decision, format } = params;

    if (format === "json") {
      return this.buildJSONReport(params);
    }
    return this.buildMarkdownReport(params);
  }

  /**
   * Build markdown report from findings
   */
  private buildMarkdownReport(params: {
    prDetails: {
      id: number;
      title: string;
      description: string;
      author: { name: string; displayName: string };
      state: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
      createdDate: string;
      updatedDate: string;
    };
    filesReviewed: FileReviewTarget[];
    allIssues: ReviewIssue[];
    decision: ReviewDecision;
    workspace: string;
    repository: string;
    duration: number;
    totalTokens: number;
  }): string {
    const {
      prDetails,
      filesReviewed,
      allIssues,
      decision,
      workspace,
      repository,
      duration,
      totalTokens,
    } = params;

    const criticalIssues = allIssues.filter((i) => i.severity === "CRITICAL");
    const majorIssues = allIssues.filter((i) => i.severity === "MAJOR");
    const minorIssues = allIssues.filter((i) => i.severity === "MINOR");
    const suggestions = allIssues.filter((i) => i.severity === "SUGGESTION");

    const decisionEmoji =
      decision === "APPROVED"
        ? "✅"
        : decision === "CHANGES_REQUESTED"
          ? "⚠️"
          : "🚫";

    const durationSeconds = Math.round(duration / 1000);
    const durationStr =
      durationSeconds >= 60
        ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`
        : `${durationSeconds}s`;

    return `# Code Review Report

**PR**: #${prDetails.id} - ${prDetails.title}
**Repository**: ${workspace}/${repository}
**Author**: ${prDetails.author.displayName} (@${prDetails.author.name})
**Branches**: ${prDetails.source.branch.name} → ${prDetails.destination.branch.name}
**Reviewed**: ${new Date().toISOString().slice(0, 16).replace("T", " ")}
**Decision**: ${decisionEmoji} ${decision}

## Summary

This PR modifies ${filesReviewed.length} files. ${this.generateSummaryText(allIssues, decision)}

## Issues Found

${
  criticalIssues.length > 0
    ? `### 🔒 CRITICAL (${criticalIssues.length})
${this.formatIssuesSection(criticalIssues)}
`
    : ""
}

${
  majorIssues.length > 0
    ? `### ⚠️ MAJOR (${majorIssues.length})
${this.formatIssuesSection(majorIssues)}
`
    : ""
}

${
  minorIssues.length > 0
    ? `### 💡 MINOR (${minorIssues.length})
${this.formatIssuesSection(minorIssues)}
`
    : ""
}

${
  suggestions.length > 0
    ? `### 💬 SUGGESTIONS (${suggestions.length})
${this.formatIssuesSection(suggestions)}
`
    : ""
}

${
  allIssues.length === 0
    ? `### ✅ No Issues Found

All files reviewed with no significant issues detected.
`
    : ""
}

## Statistics

| Metric | Value |
|--------|-------|
| Files Reviewed | ${filesReviewed.length} |
| 🔒 Critical | ${criticalIssues.length} |
| ⚠️ Major | ${majorIssues.length} |
| 💡 Minor | ${minorIssues.length} |
| 💬 Suggestions | ${suggestions.length} |
| Duration | ${durationStr} |
| Tokens Used | ${totalTokens.toLocaleString()} |

## Files Changed

${this.formatFilesList(filesReviewed)}

---
*Review powered by Yama V2 (Explicit Loop Architecture)*
`;
  }

  /**
   * Build JSON report from findings
   */
  private buildJSONReport(params: {
    prDetails: {
      id: number;
      title: string;
      description: string;
      author: { name: string; displayName: string };
      state: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
      createdDate: string;
      updatedDate: string;
    };
    filesReviewed: FileReviewTarget[];
    allIssues: ReviewIssue[];
    decision: ReviewDecision;
    workspace: string;
    repository: string;
    duration: number;
    totalTokens: number;
  }): string {
    const {
      prDetails,
      filesReviewed,
      allIssues,
      decision,
      workspace,
      repository,
      duration,
      totalTokens,
    } = params;

    const criticalIssues = allIssues.filter((i) => i.severity === "CRITICAL");
    const majorIssues = allIssues.filter((i) => i.severity === "MAJOR");
    const minorIssues = allIssues.filter((i) => i.severity === "MINOR");
    const suggestions = allIssues.filter((i) => i.severity === "SUGGESTION");

    const report = {
      pr: {
        id: prDetails.id,
        title: prDetails.title,
        description: prDetails.description,
        author: prDetails.author,
        state: prDetails.state,
        sourceBranch: prDetails.source.branch.name,
        targetBranch: prDetails.destination.branch.name,
        createdDate: prDetails.createdDate,
        updatedDate: prDetails.updatedDate,
      },
      repository: {
        workspace,
        name: repository,
        fullName: `${workspace}/${repository}`,
      },
      review: {
        decision,
        reviewedAt: new Date().toISOString(),
        duration: {
          milliseconds: duration,
          formatted: this.formatDuration(duration),
        },
        tokensUsed: totalTokens,
      },
      statistics: {
        filesReviewed: filesReviewed.length,
        issues: {
          critical: criticalIssues.length,
          major: majorIssues.length,
          minor: minorIssues.length,
          suggestions: suggestions.length,
          total: allIssues.length,
        },
      },
      issues: {
        critical: criticalIssues,
        major: majorIssues,
        minor: minorIssues,
        suggestions: suggestions,
      },
      files: filesReviewed,
    };

    return JSON.stringify(report, null, 2);
  }

  /**
   * Generate summary text based on issues and decision
   */
  private generateSummaryText(
    issues: ReviewIssue[],
    decision: ReviewDecision,
  ): string {
    const critical = issues.filter((i) => i.severity === "CRITICAL").length;
    const major = issues.filter((i) => i.severity === "MAJOR").length;
    const minor = issues.filter((i) => i.severity === "MINOR").length;

    if (decision === "BLOCKED") {
      return `The PR is **BLOCKED** due to ${critical} critical issue${critical > 1 ? "s" : ""} that must be addressed before merging.`;
    }

    if (decision === "CHANGES_REQUESTED") {
      if (critical > 0) {
        return `Changes requested due to ${critical} critical and ${major} major issue${major !== 1 ? "s" : ""}.`;
      }
      return `Changes requested due to ${major} major issue${major > 1 ? "s" : ""} and ${minor} minor issue${minor !== 1 ? "s" : ""}.`;
    }

    if (issues.length === 0) {
      return "No issues found. The PR is ready to merge.";
    }

    return `Found ${minor} minor issue${minor !== 1 ? "s" : ""} and ${issues.filter((i) => i.severity === "SUGGESTION").length} suggestion${issues.filter((i) => i.severity === "SUGGESTION").length !== 1 ? "s" : ""}. The PR is approved.`;
  }

  /**
   * Format issues section for markdown report
   */
  private formatIssuesSection(issues: ReviewIssue[]): string {
    return issues
      .map((issue, idx) => {
        const filePath = issue.filePath || "unknown";
        return `
#### ${idx + 1}. \`${filePath}:${issue.lineNumber}\`

**${issue.severity}**: ${issue.title}

**Issue**: ${issue.description}

**Impact**: ${issue.impact}

${
  issue.suggestion
    ? `**Fix**:
\`\`\`
${issue.suggestion}
\`\`\`
`
    : ""
}

${issue.reference ? `**Reference**: ${issue.reference}` : ""}
`;
      })
      .join("\n");
  }

  /**
   * Format files list for markdown report
   */
  private formatFilesList(files: FileReviewTarget[]): string {
    const statusEmoji: Record<string, string> = {
      added: "➕",
      modified: "📝",
      deleted: "➖",
      renamed: "📦",
    };

    return files
      .map(
        (f) => `- ${statusEmoji[f.status] || "📄"} \`${f.path}\` (${f.status})`,
      )
      .join("\n");
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds >= 60) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }
}

export function createReportGenerator(): ReportGenerator {
  return new ReportGenerator();
}
