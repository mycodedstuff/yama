/**
 * Prompt Builder for Yama V2
 * Builds comprehensive AI instructions from multiple layers:
 * - Base System Prompt (tool usage, format standards)
 * - Config Instructions (workflow, focus areas, blocking criteria)
 * - Project Standards (repository-specific rules)
 */

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { YamaV2Config } from "../types/config.types.js";
import { ReviewRequest } from "../types/v2.types.js";
import { LangfusePromptManager } from "./LangfusePromptManager.js";
import { KnowledgeBaseManager } from "../learning/KnowledgeBaseManager.js";
import {
  getReportModeSystemPrompt,
  getReportModeEnhancementPrompt,
} from "./ReportModeSystemPrompt.js";
import { getFileReviewSystemPrompt } from "./FileReviewSystemPrompt.js";
import {
  FileReviewContext,
  ReviewIssue,
  FileReviewTarget,
  FeatureContext,
} from "../types/explicit-loop.types.js";
import { DiffHunk, DiffLine } from "../types/mcp.types.js";

export class PromptBuilder {
  private langfuseManager: LangfusePromptManager;

  constructor() {
    this.langfuseManager = new LangfusePromptManager();
  }

  /**
   * Build complete review instructions for AI
   * Combines generic base prompt + project-specific config
   * In report mode, uses a dedicated system prompt that outputs a report instead of posting comments
   */
  async buildReviewInstructions(
    request: ReviewRequest,
    config: YamaV2Config,
  ): Promise<string> {
    // Use dedicated report mode system prompt when in report mode
    // This replaces the base prompt entirely to avoid conflicting instructions
    const basePrompt = request.reportMode
      ? getReportModeSystemPrompt(request.reportFormat)
      : await this.langfuseManager.getReviewPrompt();

    // Project-specific configuration in XML format
    const projectConfig = this.buildProjectConfigXML(config, request);

    // Project-specific standards (if available)
    const projectStandards = await this.loadProjectStandards(config);

    // Knowledge base learnings (reinforcement learning)
    const knowledgeBase = await this.loadKnowledgeBase(config);

    // Combine all parts
    const instructions = `
${basePrompt}

<project-configuration>
${projectConfig}
</project-configuration>

${projectStandards ? `<project-standards>\n${projectStandards}\n</project-standards>` : ""}

${knowledgeBase ? `<learned-knowledge>\n${knowledgeBase}\n</learned-knowledge>` : ""}

<review-task>
  <workspace>${this.escapeXML(request.workspace)}</workspace>
  <repository>${this.escapeXML(request.repository)}</repository>
  <pull_request_id>${request.pullRequestId || "find-by-branch"}</pull_request_id>
  <branch>${this.escapeXML(request.branch || "N/A")}</branch>
  <mode>${request.dryRun ? "dry-run" : "live"}</mode>

  <instructions>
    ${this.buildTaskInstructions(request)}
  </instructions>
</review-task>
    `.trim();

    return instructions;
  }

  /**
   * Build project configuration in XML format
   * Injects project-specific rules into base system prompt
   */
  private buildProjectConfigXML(
    config: YamaV2Config,
    _request: ReviewRequest,
  ): string {
    const focusAreasXML = config.review.focusAreas
      .map(
        (area) => `
    <focus-area priority="${area.priority}">
      <name>${this.escapeXML(area.name)}</name>
      <description>${this.escapeXML(area.description)}</description>
    </focus-area>`,
      )
      .join("\n");

    const blockingCriteriaXML = (config.review.blockingCriteria || [])
      .map(
        (criteria) => `
    <criterion>
      <condition>${this.escapeXML(criteria.condition)}</condition>
      <action>${criteria.action}</action>
      <reason>${this.escapeXML(criteria.reason)}</reason>
    </criterion>`,
      )
      .join("\n");

    const excludePatternsXML = config.review.excludePatterns
      .map((pattern) => `    <pattern>${this.escapeXML(pattern)}</pattern>`)
      .join("\n");

    return `
  <workflow-instructions>
${this.escapeXML(config.review.workflowInstructions)}
  </workflow-instructions>

  <focus-areas>
${focusAreasXML}
  </focus-areas>

  <blocking-criteria>
${blockingCriteriaXML}
  </blocking-criteria>

  <file-exclusions>
${excludePatternsXML}
  </file-exclusions>

  <tool-preferences>
    <lazy-loading>${config.review.toolPreferences.lazyLoading}</lazy-loading>
    <cache-results>${config.review.toolPreferences.cacheToolResults}</cache-results>
    <enable-code-search>${config.review.toolPreferences.enableCodeSearch}</enable-code-search>
    <enable-directory-listing>${config.review.toolPreferences.enableDirectoryListing}</enable-directory-listing>
    <max-tool-calls-per-file>${config.review.toolPreferences.maxToolCallsPerFile}</max-tool-calls-per-file>
  </tool-preferences>

  <context-settings>
    <context-lines>${config.review.contextLines}</context-lines>
    <max-files-per-review>${config.review.maxFilesPerReview}</max-files-per-review>
  </context-settings>
    `.trim();
  }

  /**
   * Build task instructions based on mode
   */
  private buildTaskInstructions(request: ReviewRequest): string {
    if (request.reportMode) {
      // Report mode: analyze and output report, don't post comments
      return `
Begin your autonomous code review now.

1. Call get_pull_request() to read PR details
2. Analyze files one by one using get_pull_request_diff()
3. Use search_code() to understand context when needed
4. Track all issues found during analysis
5. After ALL files analyzed, output the complete report following the format in your system instructions

${request.dryRun ? "DRY RUN MODE: Simulate actions only, do not post real comments." : "LIVE MODE: Analyze files and generate report."}
      `.trim();
    }

    // Normal mode: post comments and make decisions
    return `
Begin your autonomous code review now.

1. Call get_pull_request() to read PR details and existing comments
2. Analyze files one by one using get_pull_request_diff()
3. Use search_code() BEFORE commenting on unfamiliar code
4. Post comments immediately with add_comment() using line_number and line_type from diff
5. Apply blocking criteria to make final decision
6. Call approve_pull_request() or request_changes()
7. Post summary comment with statistics

${request.dryRun ? "DRY RUN MODE: Simulate actions only, do not post real comments." : "LIVE MODE: Post real comments and make real decisions."}
    `.trim();
  }

  /**
   * Escape XML special characters
   */
  private escapeXML(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Load project-specific standards from repository
   */
  private async loadProjectStandards(
    config: YamaV2Config,
  ): Promise<string | null> {
    if (!config.projectStandards?.customPromptsPath) {
      return null;
    }

    const promptsPath = config.projectStandards.customPromptsPath;
    const standardFiles = [
      "review-standards.md",
      "security-guidelines.md",
      "coding-conventions.md",
    ];

    const loadedStandards: string[] = [];

    for (const file of standardFiles) {
      const filePath = join(process.cwd(), promptsPath, file);
      if (existsSync(filePath)) {
        try {
          const content = await readFile(filePath, "utf-8");
          loadedStandards.push(`## From ${file}\n\n${content}`);
        } catch (error) {
          // Silently skip files that can't be read
          continue;
        }
      }
    }

    if (loadedStandards.length === 0) {
      return null;
    }

    return `
These are project-specific standards from the repository configuration.
Follow these in addition to the general focus areas:

${loadedStandards.join("\n\n---\n\n")}
    `.trim();
  }

  /**
   * Load knowledge base for AI prompt injection
   * Contains learned patterns from previous PR feedback
   */
  private async loadKnowledgeBase(
    config: YamaV2Config,
  ): Promise<string | null> {
    if (!config.knowledgeBase?.enabled) {
      return null;
    }

    try {
      const kbManager = new KnowledgeBaseManager(config.knowledgeBase);
      const content = await kbManager.getForPrompt();

      if (content) {
        console.log("   📚 Knowledge base loaded for AI context");
      }

      return content;
    } catch (error) {
      // Silently fail - knowledge base is optional enhancement
      return null;
    }
  }

  /**
   * Build description enhancement prompt separately (for description-only operations)
   * In report mode, uses a dedicated prompt that outputs description directly
   * instead of calling update_pull_request (which is blocked)
   */
  async buildDescriptionEnhancementInstructions(
    request: ReviewRequest,
    config: YamaV2Config,
  ): Promise<string> {
    // Use report-mode enhancement prompt when in report mode
    // This avoids instructing the AI to call update_pull_request (which is blocked)
    const basePrompt = request.reportMode
      ? getReportModeEnhancementPrompt()
      : await this.langfuseManager.getEnhancementPrompt();

    // Project-specific enhancement configuration
    const enhancementConfigXML = this.buildEnhancementConfigXML(config);

    // Build task instructions based on mode
    const taskInstructions = request.reportMode
      ? this.buildReportModeEnhancementTaskInstructions(request)
      : this.buildNormalModeEnhancementTaskInstructions(request);

    return `
${basePrompt}

<project-configuration>
${enhancementConfigXML}
</project-configuration>

<enhancement-task>
  <workspace>${this.escapeXML(request.workspace)}</workspace>
  <repository>${this.escapeXML(request.repository)}</repository>
  <pull_request_id>${request.pullRequestId || "find-by-branch"}</pull_request_id>
  <branch>${this.escapeXML(request.branch || "N/A")}</branch>
  <mode>${request.dryRun ? "dry-run" : "live"}</mode>

  <instructions>
${taskInstructions}
  </instructions>
</enhancement-task>
    `.trim();
  }

  /**
   * Build task instructions for normal mode enhancement
   * AI will call update_pull_request() to update the PR
   */
  private buildNormalModeEnhancementTaskInstructions(
    request: ReviewRequest,
  ): string {
    return `
    Enhance the PR description now.

    1. Call get_pull_request() to read current PR and description
    2. Call get_pull_request_diff() to analyze code changes
    3. Use search_code() to find configuration patterns, API changes
    4. Extract information for each required section
    5. Build enhanced description following section structure
    6. Call update_pull_request() with enhanced description

    CRITICAL: Return ONLY the enhanced description markdown.
    Do NOT include meta-commentary or explanations.
    Start directly with section content.

    ${request.dryRun ? "DRY RUN MODE: Simulate only, do not actually update PR." : "LIVE MODE: Update the actual PR description."}
    `.trim();
  }

  /**
   * Build task instructions for report mode enhancement
   * AI outputs description directly (update_pull_request is blocked)
   */
  private buildReportModeEnhancementTaskInstructions(
    request: ReviewRequest,
  ): string {
    return `
    Enhance the PR description now.

    1. Call get_pull_request() to read current PR and description
    2. Call get_pull_request_diff() to analyze code changes
    3. Use search_code() to find configuration patterns, API changes
    4. Extract information for each required section
    5. Build enhanced description following section structure
    6. OUTPUT THE DESCRIPTION DIRECTLY - DO NOT call update_pull_request()

    CRITICAL: Output the enhanced description as plain markdown.
    DO NOT wrap in code blocks.
    DO NOT call update_pull_request() - it is BLOCKED in report mode.
    The description will be captured and appended to the review report.

    ${request.dryRun ? "DRY RUN MODE: Simulate only." : "LIVE MODE: Description will be added to report file."}
    `.trim();
  }

  /**
   * Build enhancement configuration in XML format
   */
  private buildEnhancementConfigXML(config: YamaV2Config): string {
    const requiredSectionsXML = config.descriptionEnhancement.requiredSections
      .map(
        (section) => `
    <section key="${section.key}" required="${section.required}">
      <name>${this.escapeXML(section.name)}</name>
      <description>${this.escapeXML(section.description)}</description>
    </section>`,
      )
      .join("\n");

    return `
  <enhancement-instructions>
${this.escapeXML(config.descriptionEnhancement.instructions)}
  </enhancement-instructions>

  <required-sections>
${requiredSectionsXML}
  </required-sections>

  <settings>
    <preserve-content>${config.descriptionEnhancement.preserveContent}</preserve-content>
    <auto-format>${config.descriptionEnhancement.autoFormat}</auto-format>
  </settings>
    `.trim();
  }

  // ============================================================================
  // Explicit Loop Architecture Methods
  // ============================================================================

  /**
   * Build focused prompt for single file review
   * Much smaller than full review prompt - bounded context per file
   */
  buildFileReviewPrompt(
    context: FileReviewContext,
    config: YamaV2Config,
    options?: {
      chunkInfo?: { current: number; total: number };
      /** Session knowledge base context for deduplication */
      sessionKnowledge?: string;
      /** Feature context - what the PR is trying to accomplish */
      featureContext?: string;
    },
  ): string {
    const basePrompt = getFileReviewSystemPrompt();

    // Build chunk notice if this is part of a chunked review
    let chunkNotice = "";
    if (options?.chunkInfo) {
      chunkNotice = `
<chunk-context>
  This is chunk ${options.chunkInfo.current} of ${options.chunkInfo.total} for this file.
  Focus on issues in this portion of the diff. All chunks will be reviewed to cover the entire file.

  <surrounding-context-tool>
    Since you only see a portion of the file, you may need context from other parts.
    Use search_code to briefly gather information about surrounding code when needed:

    - Search for function/method definitions referenced in this chunk
    - Search for variable declarations or type definitions used here
    - Search for related code patterns that provide context

    IMPORTANT: Keep searches brief and focused. Only gather what's necessary for
    understanding the code in this chunk. Avoid redundant searches.
  </surrounding-context-tool>
</chunk-context>`;
    }

    // Session knowledge base context (for deduplication and cross-file awareness)
    const knowledgeSection = options?.sessionKnowledge
      ? `\n${options.sessionKnowledge}\n`
      : "";

    // Feature context section (purpose, domain concepts, technical approach)
    const featureContextSection = options?.featureContext
      ? `\n${options.featureContext}\n`
      : "";

    return `
${basePrompt}

${featureContextSection}<pr-context>
  <workspace>${this.escapeXML(context.workspace)}</workspace>
  <repository>${this.escapeXML(context.repository)}</repository>
  <id>${context.pullRequestId}</id>
  <title>${this.escapeXML(context.prTitle)}</title>
  <source>${this.escapeXML(context.sourceBranch)}</source>
  <target>${this.escapeXML(context.targetBranch)}</target>
</pr-context>

<file>
  <path>${this.escapeXML(context.filePath)}</path>
  <status>${context.fileStatus}</status>
  <diff>
${this.formatDiffForPrompt(context.diff)}
  </diff>
</file>

<existing-comments>
${this.formatExistingComments(context.existingComments)}
</existing-comments>
${knowledgeSection}
<project-config>
  ${this.buildFocusAreasXML(config)}
  ${this.buildBlockingCriteriaXML(config)}
</project-config>
${chunkNotice}

<instructions>
  Analyze this file and return findings in JSON format.
  Use search_code if you need to understand context.
  DO NOT post comments - return findings only.

  IMPORTANT: Before reporting an issue, check if it's already been reported
  in the <already-reported> section above. Only report NEW issues that haven't
  been found in previous files.
</instructions>
    `.trim();
  }

  /**
   * Format diff for prompt inclusion
   * Presents the diff in a readable format for the AI
   */
  private formatDiffForPrompt(diff: { hunks: DiffHunk[] }): string {
    if (!diff || !diff.hunks || diff.hunks.length === 0) {
      return "    (No diff content available)";
    }

    const lines: string[] = [];

    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        const lineNum =
          line.type === "REMOVED" ? line.source_line : line.destination_line;
        const prefix =
          line.type === "ADDED" ? "+" : line.type === "REMOVED" ? "-" : " ";
        lines.push(
          `    ${(lineNum ?? 0).toString().padStart(4)} ${prefix} ${line.content}`,
        );
      }
      lines.push("    " + "─".repeat(60));
    }

    return lines.join("\n");
  }

  /**
   * Format existing comments for duplicate detection
   */
  private formatExistingComments(
    comments: {
      text: string;
      anchor?: { filePath: string; lineFrom: number };
    }[],
  ): string {
    if (!comments || comments.length === 0) {
      return "    (No existing comments on this file)";
    }

    return comments
      .map(
        (c) =>
          `    Line ${c.anchor?.lineFrom || "?"}: ${this.escapeXML(c.text.substring(0, 100))}${c.text.length > 100 ? "..." : ""}`,
      )
      .join("\n");
  }

  /**
   * Build focus areas XML for file review
   */
  private buildFocusAreasXML(config: YamaV2Config): string {
    const focusAreasXML = config.review.focusAreas
      .map(
        (area) => `
    <focus-area priority="${area.priority}">
      <name>${this.escapeXML(area.name)}</name>
      <description>${this.escapeXML(area.description)}</description>
    </focus-area>`,
      )
      .join("\n");

    return `
  <focus-areas>
${focusAreasXML}
  </focus-areas>`;
  }

  /**
   * Build blocking criteria XML for file review
   */
  private buildBlockingCriteriaXML(config: YamaV2Config): string {
    if (
      !config.review.blockingCriteria ||
      config.review.blockingCriteria.length === 0
    ) {
      return "";
    }

    const blockingCriteriaXML = config.review.blockingCriteria
      .map(
        (criteria) => `
    <criterion>
      <condition>${this.escapeXML(criteria.condition)}</condition>
      <action>${criteria.action}</action>
      <reason>${this.escapeXML(criteria.reason)}</reason>
    </criterion>`,
      )
      .join("\n");

    return `
  <blocking-criteria>
${blockingCriteriaXML}
  </blocking-criteria>`;
  }

  /**
   * Build enhancement prompt with aggregated review findings
   * Replaces context that would have been in shared session
   */
  buildEnhancementPromptWithFindings(params: {
    prDetails: {
      id: number;
      title: string;
      description: string;
      source: { branch: { name: string } };
      destination: { branch: { name: string } };
    };
    filesReviewed: FileReviewTarget[];
    issuesFound: ReviewIssue[];
    config: YamaV2Config;
  }): string {
    const basePrompt = `You are an expert at writing clear, comprehensive PR descriptions.

Your task is to enhance the PR description based on the code changes and review findings.
Follow the required sections and maintain a professional tone.`;

    // Summarize files changed
    const filesSummary = params.filesReviewed
      .map((f) => `- ${f.path} (${f.status})`)
      .join("\n");

    // Summarize key issues (limit to avoid token bloat)
    const keyIssues = params.issuesFound
      .filter((i) => i.severity === "CRITICAL" || i.severity === "MAJOR")
      .slice(0, 10)
      .map((i) => `- ${i.title} in ${i.filePath}`)
      .join("\n");

    const requiredSectionsXML =
      params.config.descriptionEnhancement.requiredSections
        .map(
          (section) => `
    <section key="${section.key}" required="${section.required}">
      <name>${this.escapeXML(section.name)}</name>
      <description>${this.escapeXML(section.description)}</description>
    </section>`,
        )
        .join("\n");

    return `
${basePrompt}

<pr-context>
  <title>${this.escapeXML(params.prDetails.title)}</title>
  <original-description>
${this.escapeXML(params.prDetails.description)}
  </original-description>
  <source>${this.escapeXML(params.prDetails.source.branch.name)}</source>
  <target>${this.escapeXML(params.prDetails.destination.branch.name)}</target>
</pr-context>

<review-summary>
  <files-changed>
${filesSummary}
  </files-changed>

  <key-issues-found>
${keyIssues || "No major issues found"}
  </key-issues-found>
</review-summary>

<required-sections>
${requiredSectionsXML}
</required-sections>

<enhancement-instructions>
  ${this.escapeXML(params.config.descriptionEnhancement.instructions)}
</enhancement-instructions>

<output-instructions>
  Return ONLY the enhanced description as markdown.
  Do NOT wrap in code blocks.
  Do NOT include meta-commentary.
  Start directly with the first section.
</output-instructions>
    `.trim();
  }
}
