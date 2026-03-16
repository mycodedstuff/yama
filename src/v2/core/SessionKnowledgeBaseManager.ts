/**
 * Session Knowledge Base Manager
 * Manages in-memory context for explicit loop review sessions
 * Prevents duplicate issues and enables cross-file understanding
 */

import { createHash } from "crypto";
import {
  SessionKnowledgeBase,
  IssueFingerprint,
  ExtractedContext,
  FileReviewResult,
  ReviewIssue,
} from "../types/explicit-loop.types.js";
import { DiffFile, DiffHunk } from "../types/mcp.types.js";

/**
 * Manages the session knowledge base for explicit loop reviews
 * Accumulates context after each file review and injects it into subsequent reviews
 */
export class SessionKnowledgeBaseManager {
  private kb: SessionKnowledgeBase;
  private readonly MAX_TOKENS = 2000;
  private readonly CONDENSE_THRESHOLD = 1500; // Condense when 75% full

  // Business logic keywords for context extraction
  private readonly BUSINESS_KEYWORDS = [
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
  ];

  // Implementation detail keywords for context extraction
  private readonly IMPLEMENTATION_KEYWORDS = [
    "redis",
    "database",
    "orm",
    "sea-orm",
    "sql",
    "query",
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
  ];

  constructor() {
    this.kb = {
      reportedIssues: [],
      businessContext: [],
      implementationContext: [],
      schemasSeen: new Map(),
      estimatedTokens: 0,
      maxTokens: this.MAX_TOKENS,
      condensed: false,
    };
  }

  /**
   * Update knowledge base after reviewing a file
   * Extracts learnings and adds them to the KB
   */
  updateFromFileReview(result: FileReviewResult, diffContent?: DiffFile): void {
    // 1. Add issue fingerprints
    for (const issue of result.issues) {
      const fingerprint = this.createFingerprint(issue, result.filePath);
      if (!this.isDuplicate(fingerprint)) {
        this.kb.reportedIssues.push(fingerprint);
        this.kb.estimatedTokens += this.estimateFingerprintTokens(fingerprint);
      }
    }

    // 2. Extract schema definitions from diff
    if (diffContent) {
      const schemas = this.extractSchemas(result.filePath, diffContent);
      for (const [name, path] of schemas) {
        if (!this.kb.schemasSeen.has(name)) {
          this.kb.schemasSeen.set(name, path);
          this.kb.estimatedTokens += name.length + path.length + 20; // overhead
        }
      }
    }

    // 3. Extract business/implementation context
    const context = this.extractContext(result);
    for (const item of context.business) {
      if (!this.kb.businessContext.includes(item)) {
        this.kb.businessContext.push(item);
        this.kb.estimatedTokens += item.length + 5;
      }
    }
    for (const item of context.implementation) {
      if (!this.kb.implementationContext.includes(item)) {
        this.kb.implementationContext.push(item);
        this.kb.estimatedTokens += item.length + 5;
      }
    }

    // 4. Condense if approaching threshold
    if (
      this.kb.estimatedTokens >= this.CONDENSE_THRESHOLD &&
      !this.kb.condensed
    ) {
      this.condense();
    }

    // 5. Hard trim if still over budget
    this.trimIfNeeded();
  }

  /**
   * Get formatted context for injection into next file's prompt
   * Returns null if KB is empty
   */
  getPromptContext(): string | null {
    if (this.isEmpty()) {
      return null;
    }

    const sections: string[] = [];

    // Issues already reported
    if (this.kb.reportedIssues.length > 0) {
      sections.push(`<already-reported>
The following issues have already been found in previous files.
DO NOT report similar issues - focus on NEW findings only:

${this.kb.reportedIssues
  .map((i) => `- [${i.severity}] ${i.title} (in ${i.sourceFile})`)
  .join("\n")}
</already-reported>`);
    }

    // Business/Implementation context (condensed or raw)
    if (
      this.kb.businessContext.length > 0 ||
      this.kb.implementationContext.length > 0
    ) {
      const contextLabel = this.kb.condensed
        ? "Feature Context (Condensed)"
        : "Context from Previous Files";
      sections.push(`<feature-context>
${contextLabel}:

${this.formatContextSection()}
</feature-context>`);
    }

    // Schemas already seen
    if (this.kb.schemasSeen.size > 0) {
      sections.push(`<schemas-seen>
Schema definitions already reviewed in previous files.
Attribute schema-related issues to the original defining file:

${Array.from(this.kb.schemasSeen.entries())
  .map(([name, path]) => `- ${name}: defined in ${path}`)
  .join("\n")}
</schemas-seen>`);
    }

    return sections.join("\n\n");
  }

  /**
   * Check if an issue is similar to already reported ones
   */
  isSimilarToReported(issue: ReviewIssue): boolean {
    const fingerprint = this.createFingerprint(issue, "");
    return this.isDuplicate(fingerprint);
  }

  /**
   * Check if the knowledge base is empty
   */
  isEmpty(): boolean {
    return (
      this.kb.reportedIssues.length === 0 &&
      this.kb.businessContext.length === 0 &&
      this.kb.implementationContext.length === 0 &&
      this.kb.schemasSeen.size === 0
    );
  }

  /**
   * Get current statistics for logging
   */
  getStats(): {
    issuesReported: number;
    businessContexts: number;
    implementationContexts: number;
    schemasSeen: number;
    estimatedTokens: number;
    condensed: boolean;
  } {
    return {
      issuesReported: this.kb.reportedIssues.length,
      businessContexts: this.kb.businessContext.length,
      implementationContexts: this.kb.implementationContext.length,
      schemasSeen: this.kb.schemasSeen.size,
      estimatedTokens: this.kb.estimatedTokens,
      condensed: this.kb.condensed,
    };
  }

  /**
   * Post-aggregation deduplication safety net
   * Removes duplicate issues and tracks affected files
   * This is a SAFETY NET that doesn't rely on AI following instructions
   */
  deduplicateIssues(issues: ReviewIssue[]): ReviewIssue[] {
    const seen = new Map<string, ReviewIssue>();
    let duplicatesRemoved = 0;

    for (const issue of issues) {
      const fingerprint = this.createFingerprint(issue, issue.filePath || "");

      if (!seen.has(fingerprint.hash)) {
        // First occurrence - store it
        seen.set(fingerprint.hash, { ...issue });
      } else {
        // Duplicate found - merge affected files
        const existing = seen.get(fingerprint.hash)!;

        // Track all files where this issue appears
        if (!existing.affectedFiles) {
          existing.affectedFiles = [existing.filePath || ""];
        }

        const newFile = issue.filePath || "";
        if (!existing.affectedFiles.includes(newFile)) {
          existing.affectedFiles.push(newFile);
        }

        duplicatesRemoved++;
      }
    }

    // Log deduplication stats
    if (duplicatesRemoved > 0) {
      console.log(
        `      🔧 Deduplication: removed ${duplicatesRemoved} duplicate issues`,
      );
    }

    return Array.from(seen.values());
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Create a fingerprint from an issue for deduplication
   */
  private createFingerprint(
    issue: ReviewIssue,
    sourceFile: string,
  ): IssueFingerprint {
    const hash = createHash("md5")
      .update(issue.title.toLowerCase().trim())
      .update(issue.description.toLowerCase().trim().substring(0, 200))
      .digest("hex")
      .substring(0, 12);

    const keyTerms = this.extractKeyTerms(
      issue.title + " " + issue.description,
    );

    return {
      hash,
      severity: issue.severity,
      title: issue.title,
      sourceFile,
      keyTerms,
    };
  }

  /**
   * Check if a fingerprint is a duplicate of an existing one
   */
  private isDuplicate(fingerprint: IssueFingerprint): boolean {
    // Exact hash match
    if (this.kb.reportedIssues.some((i) => i.hash === fingerprint.hash)) {
      return true;
    }

    // Similarity check based on key terms
    const similarityThreshold = 0.6; // 60% overlap
    for (const existing of this.kb.reportedIssues) {
      const similarity = this.calculateSimilarity(
        fingerprint.keyTerms,
        existing.keyTerms,
      );
      if (similarity >= similarityThreshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract key terms from text for similarity matching
   */
  private extractKeyTerms(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Remove common words
    const stopWords = new Set([
      "this",
      "that",
      "these",
      "those",
      "with",
      "from",
      "have",
      "been",
      "were",
      "they",
      "their",
      "what",
      "when",
      "where",
      "which",
      "while",
      "should",
      "would",
      "could",
      "might",
      "must",
      "shall",
    ]);

    return [...new Set(words.filter((w) => !stopWords.has(w)))].slice(0, 10);
  }

  /**
   * Calculate Jaccard similarity between two term sets
   */
  private calculateSimilarity(terms1: string[], terms2: string[]): number {
    if (terms1.length === 0 || terms2.length === 0) {
      return 0;
    }

    const set1 = new Set(terms1);
    const set2 = new Set(terms2);

    let intersection = 0;
    for (const term of set1) {
      if (set2.has(term)) {
        intersection++;
      }
    }

    const union = set1.size + set2.size - intersection;
    return intersection / union;
  }

  /**
   * Estimate token count for a fingerprint
   */
  private estimateFingerprintTokens(fingerprint: IssueFingerprint): number {
    // Rough estimate: severity (10) + title + source file + overhead
    return fingerprint.title.length + fingerprint.sourceFile.length + 20;
  }

  /**
   * Extract schema definitions from diff content
   */
  private extractSchemas(
    filePath: string,
    diff: DiffFile,
  ): Map<string, string> {
    const schemas = new Map<string, string>();

    if (!diff.hunks) {
      return schemas;
    }

    // Pattern to match schema/struct/entity definitions
    const schemaPatterns = [
      // Rust structs
      /struct\s+(\w+)/g,
      // TypeScript interfaces
      /interface\s+(\w+)/g,
      // Type aliases
      /type\s+(\w+)\s*=/g,
      // Enum definitions
      /enum\s+(\w+)/g,
      // Class definitions (for ORM entities)
      /class\s+(\w+)(?:\s+extends|\s+implements|\s*\{)/g,
      // GraphQL types
      /type\s+(\w+)\s*\{/g,
      // Protobuf messages
      /message\s+(\w+)/g,
    ];

    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === "REMOVED") {
          continue;
        }

        for (const pattern of schemaPatterns) {
          const matches = line.content.matchAll(pattern);
          for (const match of matches) {
            const schemaName = match[1];
            // Skip common non-schema identifiers
            if (
              ![
                "Error",
                "Result",
                "Option",
                "Some",
                "None",
                "Ok",
                "Err",
              ].includes(schemaName)
            ) {
              schemas.set(schemaName, filePath);
            }
          }
        }
      }
    }

    return schemas;
  }

  /**
   * Extract business and implementation context from file review
   */
  private extractContext(result: FileReviewResult): ExtractedContext {
    const business: string[] = [];
    const implementation: string[] = [];
    const schemas = new Map<string, string>();

    // Analyze file path for context clues
    const pathLower = result.filePath.toLowerCase();

    // Check for business domain in path
    if (pathLower.includes("payment") || pathLower.includes("transaction")) {
      business.push("Payment/transaction processing");
    }
    if (pathLower.includes("auth")) {
      business.push("Authentication/authorization");
    }
    if (pathLower.includes("lock") || pathLower.includes("concurrent")) {
      business.push("Concurrency control with locking");
    }
    if (pathLower.includes("inventory") || pathLower.includes("stock")) {
      business.push("Inventory management");
    }
    if (pathLower.includes("user") || pathLower.includes("account")) {
      business.push("User/account management");
    }

    // Check for implementation patterns in path
    if (pathLower.includes("redis")) {
      implementation.push("Redis caching/distributed state");
    }
    if (pathLower.includes("database") || pathLower.includes("db")) {
      implementation.push("Database operations");
    }
    if (pathLower.includes("queue") || pathLower.includes("worker")) {
      implementation.push("Background job processing");
    }

    // Analyze issues for context clues
    for (const issue of result.issues) {
      const textLower = (issue.title + " " + issue.description).toLowerCase();

      // Check for business logic patterns
      if (this.isBusinessLogic(textLower)) {
        const contextItem = this.summarizeBusinessContext(issue);
        if (contextItem && !business.includes(contextItem)) {
          business.push(contextItem);
        }
      }

      // Check for implementation patterns
      if (this.isImplementationDetail(textLower)) {
        const contextItem = this.summarizeImplementationContext(issue);
        if (contextItem && !implementation.includes(contextItem)) {
          implementation.push(contextItem);
        }
      }
    }

    return { business, implementation, schemas };
  }

  /**
   * Check if text contains business logic keywords
   */
  private isBusinessLogic(text: string): boolean {
    return this.BUSINESS_KEYWORDS.some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
  }

  /**
   * Check if text contains implementation detail keywords
   */
  private isImplementationDetail(text: string): boolean {
    return this.IMPLEMENTATION_KEYWORDS.some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
  }

  /**
   * Summarize business context from an issue
   */
  private summarizeBusinessContext(issue: ReviewIssue): string | null {
    const text = (issue.title + " " + issue.description).toLowerCase();

    // Map keywords to context summaries
    if (text.includes("lock") && text.includes("concurrent")) {
      return "Entity locking for concurrent access control";
    }
    if (text.includes("eligibility")) {
      return "Eligibility checking logic";
    }
    if (text.includes("payment") || text.includes("transaction")) {
      return "Payment/transaction processing";
    }
    if (text.includes("balance")) {
      return "Balance tracking and updates";
    }
    if (text.includes("state") || text.includes("status")) {
      return "State machine transitions";
    }
    if (text.includes("validat")) {
      return "Input validation logic";
    }

    return null;
  }

  /**
   * Summarize implementation context from an issue
   */
  private summarizeImplementationContext(issue: ReviewIssue): string | null {
    const text = (issue.title + " " + issue.description).toLowerCase();

    if (text.includes("redis")) {
      return "Redis distributed caching/locking";
    }
    if (text.includes("sea-orm") || text.includes("orm")) {
      return "Sea-ORM database operations";
    }
    if (text.includes("async") || text.includes("concurrent")) {
      return "Async/concurrent processing";
    }
    if (text.includes("cache")) {
      return "Caching layer";
    }
    if (text.includes("retry")) {
      return "Retry logic for resilience";
    }

    return null;
  }

  /**
   * Condense the knowledge base into a summary
   * Called when approaching token threshold
   */
  private condense(): void {
    // Combine business and implementation context into summaries
    const businessSummary = this.summarizeContextArray(
      this.kb.businessContext,
      "Business Logic",
    );
    const implSummary = this.summarizeContextArray(
      this.kb.implementationContext,
      "Implementation",
    );

    // Replace detailed context with summaries
    this.kb.businessContext = businessSummary ? [businessSummary] : [];
    this.kb.implementationContext = implSummary ? [implSummary] : [];
    this.kb.condensed = true;

    // Recalculate tokens
    this.recalculateTokens();
  }

  /**
   * Summarize a context array into a single coherent summary
   */
  private summarizeContextArray(items: string[], label: string): string | null {
    if (items.length === 0) {
      return null;
    }
    if (items.length === 1) {
      return items[0];
    }

    // Deduplicate and combine
    const unique = [...new Set(items)];
    return `[${label}] ${unique.join("; ")}`;
  }

  /**
   * Recalculate token estimate from current state
   */
  private recalculateTokens(): void {
    let tokens = 0;

    // Issues
    for (const issue of this.kb.reportedIssues) {
      tokens += this.estimateFingerprintTokens(issue);
    }

    // Context strings
    for (const item of this.kb.businessContext) {
      tokens += item.length + 5;
    }
    for (const item of this.kb.implementationContext) {
      tokens += item.length + 5;
    }

    // Schemas
    for (const [name, path] of this.kb.schemasSeen) {
      tokens += name.length + path.length + 20;
    }

    this.kb.estimatedTokens = tokens;
  }

  /**
   * Hard trim if still over budget after condensing
   */
  private trimIfNeeded(): void {
    if (this.kb.estimatedTokens <= this.MAX_TOKENS) {
      return;
    }

    // Trim oldest issues first (keep most recent)
    while (
      this.kb.reportedIssues.length > 5 &&
      this.kb.estimatedTokens > this.MAX_TOKENS
    ) {
      const removed = this.kb.reportedIssues.shift();
      if (removed) {
        this.kb.estimatedTokens -= this.estimateFingerprintTokens(removed);
      }
    }

    // Trim context if still over
    while (
      this.kb.businessContext.length > 2 &&
      this.kb.estimatedTokens > this.MAX_TOKENS
    ) {
      const removed = this.kb.businessContext.shift();
      if (removed) {
        this.kb.estimatedTokens -= removed.length + 5;
      }
    }

    while (
      this.kb.implementationContext.length > 2 &&
      this.kb.estimatedTokens > this.MAX_TOKENS
    ) {
      const removed = this.kb.implementationContext.shift();
      if (removed) {
        this.kb.estimatedTokens -= removed.length + 5;
      }
    }
  }

  /**
   * Format context section for prompt
   */
  private formatContextSection(): string {
    const parts: string[] = [];

    if (this.kb.businessContext.length > 0) {
      parts.push(`Business Logic: ${this.kb.businessContext.join("; ")}`);
    }

    if (this.kb.implementationContext.length > 0) {
      parts.push(`Implementation: ${this.kb.implementationContext.join("; ")}`);
    }

    return parts.join("\n");
  }
}
