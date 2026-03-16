/**
 * Feature Context Builder
 * Pre-analyzes PR details to build context BEFORE reviewing files
 * This gives the AI a "mental model" of the feature's purpose
 */

import {
  FeatureContext,
  FileReviewTarget,
} from "../types/explicit-loop.types.js";
import { DiffFile } from "../types/mcp.types.js";

/**
 * Builds feature context from PR details and file list
 * Called BEFORE any file reviews to establish understanding
 */
export class FeatureContextBuilder {
  // Business domain keywords for context extraction
  private readonly DOMAIN_KEYWORDS = [
    "lock",
    "unlock",
    "eligibility",
    "payment",
    "transaction",
    "balance",
    "account",
    "user",
    "order",
    "inventory",
    "reservation",
    "booking",
    "checkout",
    "refund",
    "validation",
    "authorization",
    "authentication",
    "permission",
    "role",
    "access",
    "quota",
    "limit",
    "threshold",
    "constraint",
    "rule",
    "policy",
    "workflow",
    "state",
    "status",
    "transition",
    "entity",
    "customer",
    "merchant",
    "product",
    "subscription",
    "invoice",
    "receipt",
  ];

  // Technical approach keywords
  private readonly TECHNICAL_KEYWORDS = [
    "redis",
    "database",
    "orm",
    "sea-orm",
    "sql",
    "postgres",
    "mysql",
    "mongodb",
    "cache",
    "async",
    "await",
    "promise",
    "concurrent",
    "parallel",
    "mutex",
    "semaphore",
    "queue",
    "event",
    "listener",
    "hook",
    "middleware",
    "interceptor",
    "retry",
    "timeout",
    "circuit",
    "bulkhead",
    "rate",
    "throttle",
    "graphql",
    "rest",
    "grpc",
    "websocket",
    "kafka",
    "rabbitmq",
  ];

  /**
   * Build feature context from PR details and file list
   * Called once before the review loop starts
   */
  buildContext(
    prTitle: string,
    prDescription: string,
    files: FileReviewTarget[],
    diffs: Map<string, DiffFile>,
  ): FeatureContext {
    // 1. Extract purpose from PR title/description
    const purpose = this.extractPurpose(prTitle, prDescription);

    // 2. Identify domain concepts from file names and function names
    const domainConcepts = this.extractDomainConcepts(files, diffs);

    // 3. Identify technical approach (e.g., "uses Redis distributed locking")
    const technicalApproach = this.extractTechnicalApproach(files, diffs);

    // 4. Infer file roles
    const fileRoles = this.inferFileRoles(files, diffs);

    return { purpose, domainConcepts, technicalApproach, fileRoles };
  }

  /**
   * Extract the purpose/intent of the PR from title and description
   */
  private extractPurpose(title: string, description: string): string {
    const parts: string[] = [];

    // Clean and analyze title
    const cleanTitle = this.cleanBranchOrTitle(title);
    if (cleanTitle) {
      parts.push(cleanTitle);
    }

    // Extract key sentences from description
    const keySentences = this.extractKeySentences(description);
    if (keySentences.length > 0) {
      parts.push(...keySentences.slice(0, 2)); // Limit to 2 key sentences
    }

    if (parts.length === 0) {
      return "No clear purpose identified from PR metadata";
    }

    return parts.join(". ");
  }

  /**
   * Clean branch name or title to extract meaningful words
   */
  private cleanBranchOrTitle(text: string): string {
    if (!text) {
      return "";
    }

    // Remove common prefixes
    let cleaned = text
      .replace(
        /^(feature|feat|fix|bugfix|chore|refactor|docs|test|ci|perf)\s*[/:_-]?\s*/i,
        "",
      )
      .replace(/^PR-\d+:/i, "")
      .trim();

    // Convert kebab/snake case to spaces
    cleaned = cleaned
      .replace(/[-_]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase to spaces
      .toLowerCase()
      .trim();

    // Capitalize first letter
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }

    return cleaned;
  }

  /**
   * Extract key sentences from description
   */
  private extractKeySentences(description: string): string[] {
    if (!description) {
      return [];
    }

    // Split into sentences
    const sentences = description
      .replace(/\n+/g, " ")
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    // Prioritize sentences with action verbs
    const actionVerbs = [
      "implement",
      "add",
      "create",
      "update",
      "fix",
      "change",
      "refactor",
      "remove",
      "enable",
      "disable",
      "support",
      "introduce",
    ];

    const prioritized: string[] = [];
    const others: string[] = [];

    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      if (actionVerbs.some((verb) => lowerSentence.includes(verb))) {
        prioritized.push(sentence);
      } else {
        others.push(sentence);
      }
    }

    return [...prioritized, ...others].slice(0, 3);
  }

  /**
   * Extract domain concepts from file names and diff content
   */
  private extractDomainConcepts(
    files: FileReviewTarget[],
    diffs: Map<string, DiffFile>,
  ): string[] {
    const concepts = new Set<string>();

    // Extract from file names
    for (const file of files) {
      const fileName = this.getFileName(file.path);
      const extracted = this.extractDomainFromFileName(fileName);
      extracted.forEach((c) => concepts.add(c));
    }

    // Extract from diff content (function names, type names)
    for (const [filePath, diff] of diffs) {
      const fromDiff = this.extractDomainFromDiff(diff);
      fromDiff.forEach((c) => concepts.add(c));
    }

    return Array.from(concepts).slice(0, 5); // Limit to 5 concepts
  }

  /**
   * Get file name from path
   */
  private getFileName(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  }

  /**
   * Extract domain concepts from file name
   */
  private extractDomainFromFileName(fileName: string): string[] {
    const concepts: string[] = [];
    const lowerName = fileName.toLowerCase();

    // Split on common separators
    const words = lowerName
      .replace(/\.[^.]+$/, "") // Remove extension
      .split(/[-_]/);

    for (const word of words) {
      if (this.DOMAIN_KEYWORDS.includes(word)) {
        concepts.push(this.toTitleCase(word));
      }
    }

    return concepts;
  }

  /**
   * Extract domain concepts from diff content
   */
  private extractDomainFromDiff(diff: DiffFile): string[] {
    const concepts = new Set<string>();

    if (!diff.hunks) {
      return [];
    }

    // Look for function names and type definitions
    const patterns = [
      /(?:fn|function|def|pub\s+fn)\s+(\w+)/g,
      /(?:struct|class|interface|type|enum)\s+(\w+)/g,
    ];

    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "REMOVED") {
          continue;
        }

        for (const pattern of patterns) {
          const matches = line.content.matchAll(pattern);
          for (const match of matches) {
            const name = match[1];
            // Check if the name contains domain keywords
            const lowerName = name.toLowerCase();
            for (const keyword of this.DOMAIN_KEYWORDS) {
              if (lowerName.includes(keyword)) {
                concepts.add(this.toTitleCase(keyword));
              }
            }
          }
        }
      }
    }

    return Array.from(concepts);
  }

  /**
   * Extract technical approach from diffs
   */
  private extractTechnicalApproach(
    files: FileReviewTarget[],
    diffs: Map<string, DiffFile>,
  ): string {
    const approaches = new Set<string>();

    // Check file paths for tech clues (even without diffs)
    for (const file of files) {
      const pathLower = file.path.toLowerCase();

      if (pathLower.includes("redis")) {
        approaches.add("Redis for distributed state/caching");
      }
      if (pathLower.includes("grpc") || pathLower.includes("proto")) {
        approaches.add("gRPC for service communication");
      }
      if (pathLower.includes("graphql")) {
        approaches.add("GraphQL API");
      }
      if (pathLower.includes("kafka") || pathLower.includes("queue")) {
        approaches.add("Message queue for async processing");
      }
    }

    // Check diffs for additional tech clues
    for (const [filePath, diff] of diffs) {
      // Check diff content for tech clues
      if (diff.hunks) {
        const content = this.getDiffContent(diff);
        const lowerContent = content.toLowerCase();

        if (
          lowerContent.includes("sea_orm") ||
          lowerContent.includes("sea-orm")
        ) {
          approaches.add("Sea-ORM for database operations");
        }
        if (lowerContent.includes("async") && lowerContent.includes("await")) {
          approaches.add("Async/await patterns");
        }
        if (lowerContent.includes("redis")) {
          approaches.add("Redis integration");
        }
        if (lowerContent.includes("tokio")) {
          approaches.add("Tokio async runtime");
        }
        if (lowerContent.includes("serde")) {
          approaches.add("Serde for serialization");
        }
      }
    }

    if (approaches.size === 0) {
      return "Standard implementation patterns";
    }

    return Array.from(approaches).join("; ");
  }

  /**
   * Get text content from diff for analysis
   */
  private getDiffContent(diff: DiffFile): string {
    if (!diff.hunks) {
      return "";
    }

    return diff.hunks
      .flatMap((hunk) => hunk.lines.map((line) => line.content))
      .join(" ")
      .substring(0, 5000); // Limit content size
  }

  /**
   * Infer the role of each file in the feature
   */
  private inferFileRoles(
    files: FileReviewTarget[],
    diffs: Map<string, DiffFile>,
  ): Map<string, string> {
    const roles = new Map<string, string>();

    for (const file of files) {
      const role = this.inferFileRole(file, diffs.get(file.path));
      roles.set(file.path, role);
    }

    return roles;
  }

  /**
   * Infer the role of a single file
   */
  private inferFileRole(file: FileReviewTarget, diff?: DiffFile): string {
    const path = file.path.toLowerCase();
    const fileName = this.getFileName(file.path).toLowerCase();

    // Test files
    if (
      fileName.includes("test") ||
      fileName.includes("_test") ||
      fileName.includes(".test.")
    ) {
      return "Test coverage for the feature";
    }

    // Migration files
    if (path.includes("migration")) {
      return "Database migration for schema changes";
    }

    // Query/repository files
    if (
      fileName.includes("query") ||
      fileName.includes("repo") ||
      fileName.includes("dao")
    ) {
      return "Data access layer for persistence";
    }

    // Handler/controller files
    if (
      fileName.includes("handler") ||
      fileName.includes("controller") ||
      fileName.includes("route")
    ) {
      return "Request handler for API endpoints";
    }

    // Service files
    if (fileName.includes("service")) {
      return "Business logic service layer";
    }

    // Model/entity files
    if (
      fileName.includes("model") ||
      fileName.includes("entity") ||
      fileName.includes("types") ||
      fileName.includes("schema")
    ) {
      return "Data model/entity definitions";
    }

    // Config files
    if (fileName.includes("config") || fileName.includes("setting")) {
      return "Configuration settings";
    }

    // Utility files
    if (fileName.includes("util") || fileName.includes("helper")) {
      return "Utility functions";
    }

    // Try to infer from diff content
    if (diff?.hunks) {
      const content = this.getDiffContent(diff);

      if (content.includes("impl ") || content.includes("fn ")) {
        return "Core implementation logic";
      }

      if (content.includes("struct ") || content.includes("interface ")) {
        return "Type definitions";
      }
    }

    // Fallback based on file extension
    const ext = fileName.split(".").pop();
    switch (ext) {
      case "rs":
        return "Rust source code";
      case "ts":
      case "js":
        return "TypeScript/JavaScript code";
      case "sql":
        return "SQL database operations";
      case "proto":
        return "Protocol buffer definitions";
      default:
        return "Supporting file";
    }
  }

  /**
   * Convert string to title case
   */
  private toTitleCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  /**
   * Format feature context for injection into prompts
   */
  formatForPrompt(context: FeatureContext, currentFilePath?: string): string {
    const sections: string[] = [];

    // Purpose section
    sections.push(`<feature-purpose>
${context.purpose}
</feature-purpose>`);

    // Domain concepts
    if (context.domainConcepts.length > 0) {
      sections.push(`<domain-concepts>
Key business concepts: ${context.domainConcepts.join(", ")}
</domain-concepts>`);
    }

    // Technical approach
    sections.push(`<technical-approach>
${context.technicalApproach}
</technical-approach>`);

    // Current file's role (if specified)
    if (currentFilePath && context.fileRoles.has(currentFilePath)) {
      const role = context.fileRoles.get(currentFilePath);
      sections.push(`<file-role>
This file's role: ${role}
</file-role>`);
    }

    return sections.join("\n\n");
  }
}
