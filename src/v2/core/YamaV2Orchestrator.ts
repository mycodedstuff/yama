/**
 * Yama V2 Orchestrator
 * Main entry point for AI-native autonomous code review
 */

import { NeuroLink } from "@juspay/neurolink";
import { MCPServerManager } from "./MCPServerManager.js";
import { ConfigLoader } from "../config/ConfigLoader.js";
import { PromptBuilder } from "../prompts/PromptBuilder.js";
import { SessionManager } from "./SessionManager.js";
import {
  ReportGenerator,
  createReportGenerator,
} from "../report/ReportGenerator.js";
import { getReportModeBlockedTools } from "../prompts/ReportModeSystemPrompt.js";
import {
  ReviewRequest,
  ReviewResult,
  ReviewUpdate,
  YamaV2Error,
  ReviewStatistics,
  IssuesBySeverity,
  PRDisplayInfo,
} from "../types/v2.types.js";
import { GetPullRequestResponse } from "../types/mcp.types.js";
import { YamaV2Config } from "../types/config.types.js";
import {
  buildObservabilityConfigFromEnv,
  validateObservabilityConfig,
} from "../utils/ObservabilityConfig.js";
import { writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

export class YamaV2Orchestrator {
  private neurolink!: NeuroLink;
  private mcpManager: MCPServerManager;
  private configLoader: ConfigLoader;
  private promptBuilder: PromptBuilder;
  private sessionManager: SessionManager;
  private reportGenerator: ReportGenerator;
  private config!: YamaV2Config;
  private initialized = false;
  private reportModeRequest?: boolean;

  constructor() {
    this.configLoader = new ConfigLoader();
    this.mcpManager = new MCPServerManager();
    this.promptBuilder = new PromptBuilder();
    this.sessionManager = new SessionManager();
    this.reportGenerator = createReportGenerator();
  }

  /**
   * Initialize Yama V2 with configuration and MCP servers
   * @param configPath - Path to configuration file
   * @param options - Optional initialization options including report mode
   */
  async initialize(
    configPath?: string,
    options?: { reportMode?: boolean },
  ): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Store report mode for MCP server setup
    this.reportModeRequest = options?.reportMode;

    this.showBanner();
    console.log("🚀 Initializing Yama V2...\n");

    if (this.reportModeRequest) {
      console.log(
        "📋 Report mode enabled - comments will be written to file\n",
      );
    }

    try {
      // Step 1: Load configuration
      this.config = await this.configLoader.loadConfig(configPath);

      // Step 2: Initialize NeuroLink with observability
      console.log("🧠 Initializing NeuroLink AI engine...");
      this.neurolink = this.initializeNeurolink();
      console.log("✅ NeuroLink initialized\n");

      // Step 3: Setup MCP servers with optional tool blocking for report mode
      const additionalBlockedTools = this.reportModeRequest
        ? getReportModeBlockedTools()
        : [];

      await this.mcpManager.setupMCPServers(
        this.neurolink,
        this.config.mcpServers,
        { additionalBlockedTools },
      );
      console.log("✅ MCP servers ready (tools managed by NeuroLink)\n");

      // Step 4: Validate configuration
      await this.configLoader.validate();

      this.initialized = true;
      console.log("✅ Yama V2 initialized successfully\n");
      console.log("═".repeat(60) + "\n");
    } catch (error) {
      console.error("\n❌ Initialization failed:", (error as Error).message);
      throw error;
    }
  }

  /**
   * Start autonomous AI review
   */
  async startReview(request: ReviewRequest): Promise<ReviewResult> {
    await this.ensureInitialized(request.reportMode);

    // Fetch and display PR info before review starts
    const prInfo = await this.fetchPRInfo(request);
    if (prInfo) {
      this.displayPRInfo(prInfo);
      // Update request with resolved PR ID if it was found from branch
      if (!request.pullRequestId && prInfo.id) {
        request.pullRequestId = prInfo.id;
      }
    } else {
      // Inform user that PR info couldn't be fetched
      console.log("⚠️  Could not fetch PR information before review starts.");
      console.log(
        "   The AI will attempt to resolve PR details during the review.\n",
      );
    }

    const startTime = Date.now();
    const sessionId = this.sessionManager.createSession(request);

    this.logReviewStart(request, sessionId);

    try {
      // Build comprehensive AI instructions
      const instructions = await this.promptBuilder.buildReviewInstructions(
        request,
        this.config,
      );

      if (this.config.display.verboseToolCalls) {
        console.log("\n📝 AI Instructions built:");
        console.log(
          `   Instruction length: ${instructions.length} characters\n`,
        );
      }

      // Create tool context for AI
      const toolContext = this.createToolContext(sessionId, request);

      // Set tool context in NeuroLink (using type assertion as setToolContext is documented but may not be in type definitions)
      (this.neurolink as any).setToolContext(toolContext);

      // Update session metadata
      this.sessionManager.updateMetadata(sessionId, {
        aiProvider: this.config.ai.provider,
        aiModel: this.config.ai.model,
      });

      // Execute autonomous AI review
      const modeMessage = request.reportMode
        ? "   AI will analyze code and generate a report\n"
        : "   AI will now make decisions and execute actions autonomously\n";
      console.log("🤖 Starting autonomous AI review...");
      console.log(modeMessage);

      const aiResponse = await this.neurolink.generate({
        input: { text: instructions },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        temperature: this.config.ai.temperature,
        maxTokens: this.config.ai.maxTokens,
        timeout: this.config.ai.timeout,
        context: {
          sessionId,
          userId: this.generateUserId(request),
          operation: "code-review",
          metadata: toolContext.metadata,
        },
        enableAnalytics: this.config.ai.enableAnalytics,
        enableEvaluation: this.config.ai.enableEvaluation,
      });

      // Extract and parse results
      const result = this.parseReviewResult(aiResponse, startTime, sessionId);

      // Handle report mode: generate and write report
      if (request.reportMode) {
        const reportPath = await this.generateAndWriteReport(
          aiResponse,
          sessionId,
          request,
        );
        result.reportPath = reportPath;
      }

      // Update session with results
      this.sessionManager.completeSession(sessionId, result);

      this.logReviewComplete(result);

      return result;
    } catch (error) {
      this.sessionManager.failSession(sessionId, error as Error);
      console.error("\n❌ Review failed:", (error as Error).message);
      throw error;
    }
  }

  /**
   * Stream review with real-time updates (for verbose mode)
   */
  async *streamReview(
    request: ReviewRequest,
  ): AsyncIterableIterator<ReviewUpdate> {
    await this.ensureInitialized(request.reportMode);

    const sessionId = this.sessionManager.createSession(request);

    try {
      // Build instructions
      const instructions = await this.promptBuilder.buildReviewInstructions(
        request,
        this.config,
      );

      // Create tool context
      const toolContext = this.createToolContext(sessionId, request);
      (this.neurolink as any).setToolContext(toolContext);

      // Stream AI execution
      yield {
        type: "progress",
        timestamp: new Date().toISOString(),
        sessionId,
        data: {
          phase: "context_gathering",
          progress: 0,
          message: "Starting review...",
        },
      };

      // Note: NeuroLink streaming implementation depends on version
      // This is a placeholder for streaming functionality
      const aiResponse = await this.neurolink.generate({
        input: { text: instructions },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        context: {
          sessionId,
          userId: this.generateUserId(request),
        },
        enableAnalytics: true,
      });

      yield {
        type: "progress",
        timestamp: new Date().toISOString(),
        sessionId,
        data: {
          phase: "decision_making",
          progress: 100,
          message: "Review complete",
        },
      };
    } catch (error) {
      this.sessionManager.failSession(sessionId, error as Error);
      throw error;
    }
  }

  /**
   * Start review and then enhance description in the same session
   * This allows the AI to use knowledge gained during review to write better descriptions
   */
  async startReviewAndEnhance(request: ReviewRequest): Promise<ReviewResult> {
    await this.ensureInitialized(request.reportMode);

    // Fetch and display PR info before review starts
    const prInfo = await this.fetchPRInfo(request);
    if (prInfo) {
      this.displayPRInfo(prInfo);
      // Update request with resolved PR ID if it was found from branch
      if (!request.pullRequestId && prInfo.id) {
        request.pullRequestId = prInfo.id;
      }
    } else {
      // Inform user that PR info couldn't be fetched
      console.log("⚠️  Could not fetch PR information before review starts.");
      console.log(
        "   The AI will attempt to resolve PR details during the review.\n",
      );
    }

    const startTime = Date.now();
    const sessionId = this.sessionManager.createSession(request);

    this.logReviewStart(request, sessionId);

    try {
      // ========================================================================
      // PHASE 1: Code Review
      // ========================================================================

      // Build review instructions
      const reviewInstructions =
        await this.promptBuilder.buildReviewInstructions(request, this.config);

      if (this.config.display.verboseToolCalls) {
        console.log("\n📝 Review instructions built:");
        console.log(
          `   Instruction length: ${reviewInstructions.length} characters\n`,
        );
      }

      // Create tool context
      const toolContext = this.createToolContext(sessionId, request);
      (this.neurolink as any).setToolContext(toolContext);

      // Update session metadata
      this.sessionManager.updateMetadata(sessionId, {
        aiProvider: this.config.ai.provider,
        aiModel: this.config.ai.model,
      });

      // Execute review
      const modeMessage = request.reportMode
        ? "   AI will analyze code and generate a report\n"
        : "   AI will analyze files and post comments\n";
      console.log("🤖 Phase 1: Starting autonomous AI code review...");
      console.log(modeMessage);

      const reviewResponse = await this.neurolink.generate({
        input: { text: reviewInstructions },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        temperature: this.config.ai.temperature,
        maxTokens: this.config.ai.maxTokens,
        timeout: this.config.ai.timeout,
        context: {
          sessionId,
          userId: this.generateUserId(request),
          operation: "code-review",
          metadata: toolContext.metadata,
        },
        enableAnalytics: this.config.ai.enableAnalytics,
        enableEvaluation: this.config.ai.enableEvaluation,
      });

      // Parse review results
      const reviewResult = this.parseReviewResult(
        reviewResponse,
        startTime,
        sessionId,
      );

      // Handle report mode: generate and write report
      if (request.reportMode) {
        const reportPath = await this.generateAndWriteReport(
          reviewResponse,
          sessionId,
          request,
        );
        reviewResult.reportPath = reportPath;
      }

      console.log("\n✅ Phase 1 complete: Code review finished");
      console.log(`   Decision: ${reviewResult.decision}`);
      if (request.reportMode) {
        console.log(`   Report: ${reviewResult.reportPath}`);
      } else {
        console.log(`   Comments: ${reviewResult.statistics.totalComments}`);
      }
      console.log("");

      // ========================================================================
      // PHASE 2: Description Enhancement (using same session)
      // Decision logic:
      // - reviewOnly: Skip enhancement entirely
      // - reportMode without reviewOnly: Run enhancement, capture for report
      // - Normal mode: Run enhancement, save fallback, update PR
      // ========================================================================

      if (request.reviewOnly) {
        // Review-only mode: skip enhancement entirely
        console.log(
          "⏭️  Skipping description enhancement (review-only mode)\n",
        );
        reviewResult.descriptionEnhanced = false;
      } else if (this.config.descriptionEnhancement.enabled) {
        console.log("📝 Phase 2: Enhancing PR description...");
        console.log("   AI will use review insights to write description\n");

        // For normal mode: save original description to fallback file before enhancement
        // The AI will call update_pull_request which overwrites the description
        if (!request.reportMode) {
          await this.saveOriginalDescriptionFallback(sessionId, request);
        }

        const enhanceInstructions =
          await this.promptBuilder.buildDescriptionEnhancementInstructions(
            request,
            this.config,
          );

        // Continue the SAME session - AI remembers everything from review
        const enhanceResponse = await this.neurolink.generate({
          input: { text: enhanceInstructions },
          provider: this.config.ai.provider,
          model: this.config.ai.model,
          temperature: this.config.ai.temperature,
          maxTokens: this.config.ai.maxTokens,
          timeout: this.config.ai.timeout,
          context: {
            sessionId, // SAME sessionId = AI remembers review context
            userId: this.generateUserId(request),
            operation: "description-enhancement",
            metadata: toolContext.metadata,
          },
          enableAnalytics: this.config.ai.enableAnalytics,
          enableEvaluation: this.config.ai.enableEvaluation,
        });

        // For report mode: capture enhanced description from AI response
        if (request.reportMode) {
          const enhancedDescription =
            this.extractEnhancedDescription(enhanceResponse);
          reviewResult.enhancedDescription = enhancedDescription;

          // Append enhanced description to the report file
          if (reviewResult.reportPath && enhancedDescription) {
            await this.appendEnhancedDescriptionToReport(
              reviewResult.reportPath,
              enhancedDescription,
            );
          }
        }

        console.log("✅ Phase 2 complete: Description enhanced\n");

        // Add enhancement status to result
        reviewResult.descriptionEnhanced = true;
      } else {
        console.log(
          "⏭️  Skipping description enhancement (disabled in config)\n",
        );
        reviewResult.descriptionEnhanced = false;
      }

      // Update session with final results
      this.sessionManager.completeSession(sessionId, reviewResult);

      this.logReviewComplete(reviewResult);

      return reviewResult;
    } catch (error) {
      this.sessionManager.failSession(sessionId, error as Error);
      console.error("\n❌ Review failed:", (error as Error).message);
      throw error;
    }
  }

  /**
   * Enhance PR description only (without full review)
   */
  async enhanceDescription(request: ReviewRequest): Promise<any> {
    await this.ensureInitialized(false);

    const sessionId = this.sessionManager.createSession(request);

    try {
      console.log("\n📝 Enhancing PR description...\n");

      const instructions =
        await this.promptBuilder.buildDescriptionEnhancementInstructions(
          request,
          this.config,
        );

      const toolContext = this.createToolContext(sessionId, request);
      (this.neurolink as any).setToolContext(toolContext);

      const aiResponse = await this.neurolink.generate({
        input: { text: instructions },
        provider: this.config.ai.provider,
        model: this.config.ai.model,
        context: {
          sessionId,
          userId: this.generateUserId(request),
          operation: "description-enhancement",
        },
        enableAnalytics: true,
      });

      console.log("✅ Description enhanced successfully\n");

      return {
        success: true,
        enhanced: true,
        sessionId,
      };
    } catch (error) {
      this.sessionManager.failSession(sessionId, error as Error);
      throw error;
    }
  }

  /**
   * Get session information
   */
  getSession(sessionId: string) {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string) {
    return this.sessionManager.getSessionStats(sessionId);
  }

  /**
   * Export session data
   */
  exportSession(sessionId: string) {
    return this.sessionManager.exportSession(sessionId);
  }

  /**
   * Create tool context for AI
   */
  private createToolContext(sessionId: string, request: ReviewRequest): any {
    return {
      sessionId,
      workspace: request.workspace,
      repository: request.repository,
      pullRequestId: request.pullRequestId,
      branch: request.branch,
      dryRun: request.dryRun || false,
      metadata: {
        yamaVersion: "2.0.0",
        startTime: new Date().toISOString(),
      },
    };
  }

  /**
   * Parse AI response into structured review result
   */
  private parseReviewResult(
    aiResponse: any,
    startTime: number,
    sessionId: string,
  ): ReviewResult {
    const session = this.sessionManager.getSession(sessionId);
    const duration = Math.round((Date.now() - startTime) / 1000);

    // Extract decision from AI response or tool calls
    const decision = this.extractDecision(aiResponse, session);

    // Pass response text for statistics extraction (works for all modes)
    const responseText = aiResponse.content || aiResponse.text || "";
    const statistics = this.calculateStatistics(session, responseText);

    return {
      prId: session.request.pullRequestId || 0,
      decision,
      statistics,
      summary: this.extractSummary(aiResponse),
      duration,
      tokenUsage: {
        input:
          aiResponse.usage?.inputTokens || aiResponse.usage?.input_tokens || 0,
        output:
          aiResponse.usage?.outputTokens ||
          aiResponse.usage?.output_tokens ||
          0,
        total:
          aiResponse.usage?.totalTokens || aiResponse.usage?.total_tokens || 0,
      },
      costEstimate: this.calculateCost(aiResponse.usage),
      sessionId,
    };
  }

  /**
   * Extract decision from AI response
   */
  private extractDecision(
    aiResponse: any,
    session: any,
  ): "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED" {
    const toolCalls = session.toolCalls || [];
    const request = session.request as ReviewRequest;

    // In report mode, the AI doesn't call decision tools
    // Extract decision from the response text
    if (request?.reportMode) {
      const responseText = aiResponse.content || aiResponse.text || "";
      const upperResponse = responseText.toUpperCase();

      // Look for decision in the response - handle "**Decision**: VALUE" format
      if (
        upperResponse.includes("DECISION") ||
        upperResponse.includes("**DECISION**")
      ) {
        // Regex handles: "Decision:", "**Decision**:", or variations with whitespace
        const decisionMatch = responseText.match(
          /\*?\*?\s*Decision\s*\*?\*?\s*:\s*(\w+)/i,
        );
        if (decisionMatch) {
          const decision = decisionMatch[1].toUpperCase();
          if (decision === "APPROVED" || decision === "APPROVE") {
            return "APPROVED";
          }
          if (decision === "BLOCKED" || decision === "BLOCK") {
            return "BLOCKED";
          }
          if (decision === "CHANGES_REQUESTED" || decision === "CHANGES") {
            return "CHANGES_REQUESTED";
          }
        }
      }

      // Look for decision patterns in JSON format
      if (upperResponse.includes('"DECISION"')) {
        const jsonDecisionMatch = responseText.match(
          /"decision"\s*:\s*"(\w+)"/i,
        );
        if (jsonDecisionMatch) {
          const decision = jsonDecisionMatch[1].toUpperCase();
          if (decision === "APPROVED") {
            return "APPROVED";
          }
          if (decision === "BLOCKED") {
            return "BLOCKED";
          }
          if (decision === "CHANGES_REQUESTED") {
            return "CHANGES_REQUESTED";
          }
        }
      }

      // Default for report mode
      return "CHANGES_REQUESTED";
    }

    // Normal mode: Check if AI called approve_pull_request or request_changes
    const approveCall = toolCalls.find(
      (tc: any) => tc.toolName === "approve_pull_request",
    );
    const requestChangesCall = toolCalls.find(
      (tc: any) => tc.toolName === "request_changes",
    );

    if (approveCall) {
      return "APPROVED";
    }
    if (requestChangesCall) {
      return "BLOCKED";
    }

    // Default to changes requested if unclear
    return "CHANGES_REQUESTED";
  }

  /**
   * Calculate statistics from session and AI response
   * Uses dual sources: tool-based stats from session + AI-reported stats from response
   */
  private calculateStatistics(
    session: any,
    responseText: string,
  ): ReviewStatistics {
    const toolCalls = session.toolCalls || [];

    // Tool-based statistics (what actually happened)
    const diffCalls = toolCalls.filter(
      (tc: any) => tc.toolName === "get_pull_request_diff",
    ).length;
    const commentCalls = toolCalls.filter(
      (tc: any) => tc.toolName === "add_comment",
    ).length;
    const toolCallsMade = toolCalls.length;

    // AI-reported statistics from response text (AI's analysis summary)
    const aiStats = this.extractStatisticsFromResponse(responseText);

    // Merge both sources: AI stats for analysis results, tool stats for what was done
    return {
      filesReviewed: aiStats.filesReviewed || diffCalls, // Prefer AI stats, fallback to tool count
      issuesFound: aiStats.issuesFound, // From AI analysis
      requirementCoverage: 0,
      codeQualityScore: 0,
      toolCallsMade, // From actual tool calls
      cacheHits: 0,
      totalComments: aiStats.totalComments || commentCalls, // Prefer AI stats, fallback to tool count
    };
  }

  /**
   * Extract statistics from AI response text
   * Parses the Statistics section from the response
   * Works for both normal mode (AI summary) and report mode (full report)
   */
  private extractStatisticsFromResponse(
    responseText: string,
  ): ReviewStatistics {
    const stats: ReviewStatistics = {
      filesReviewed: 0,
      issuesFound: { critical: 0, major: 0, minor: 0, suggestions: 0 },
      requirementCoverage: 0,
      codeQualityScore: 0,
      toolCallsMade: 0,
      cacheHits: 0,
      totalComments: 0,
    };

    // Extract files reviewed: - **Files Reviewed**: 19
    const filesMatch = responseText.match(/\*\*Files Reviewed\*\*:\s*(\d+)/);
    if (filesMatch) {
      stats.filesReviewed = parseInt(filesMatch[1], 10);
    }

    // Extract issues: - **Issues Found**: 🔒 0 | ⚠️ 0 | 💡 2 | 💬 2
    const issuesMatch = responseText.match(
      /\*\*Issues Found\*\*:\s*🔒\s*(\d+)\s*\|\s*⚠️\s*(\d+)\s*\|\s*💡\s*(\d+)\s*\|\s*💬\s*(\d+)/,
    );
    if (issuesMatch) {
      stats.issuesFound = {
        critical: parseInt(issuesMatch[1], 10),
        major: parseInt(issuesMatch[2], 10),
        minor: parseInt(issuesMatch[3], 10),
        suggestions: parseInt(issuesMatch[4], 10),
      };
    }

    // Also extract total comments for backward compatibility with tool call counting
    const totalComments =
      stats.issuesFound.critical +
      stats.issuesFound.major +
      stats.issuesFound.minor +
      stats.issuesFound.suggestions;
    stats.totalComments = totalComments;

    return stats;
  }

  /**
   * Extract summary from AI response
   */
  private extractSummary(aiResponse: any): string {
    return aiResponse.content || aiResponse.text || "Review completed";
  }

  /**
   * Generate and write report in report mode
   * The AI directly generates the report content, we just write it to a file
   */
  private async generateAndWriteReport(
    aiResponse: any,
    _sessionId: string,
    request: ReviewRequest,
  ): Promise<string> {
    const responseText = aiResponse.content || aiResponse.text || "";

    // Determine output path
    const format = request.reportFormat || "md";
    let reportPath = request.reportPath;

    if (!reportPath) {
      reportPath = this.reportGenerator.generateDefaultPath(
        request.pullRequestId || "unknown",
        format,
        undefined, // timestamp (use current time)
        request.repository, // repository name for filename prefix
      );
    }

    // Write the AI's output directly to file
    await this.reportGenerator.writeReportFromAIResponse(
      responseText,
      format,
      reportPath,
    );

    console.log(`\n📄 Report generated: ${reportPath}`);

    return reportPath;
  }

  /**
   * Calculate cost estimate from token usage
   */
  private calculateCost(usage: any): number {
    if (!usage) {
      return 0;
    }

    // Handle different AI provider property names
    const inputTokens = usage.inputTokens || usage.input_tokens || 0;
    const outputTokens = usage.outputTokens || usage.output_tokens || 0;

    // Return 0 if no tokens were used (prevents NaN from division)
    if (inputTokens === 0 && outputTokens === 0) {
      return 0;
    }

    // Rough estimates (update with actual pricing)
    const inputCostPer1M = 0.25; // $0.25 per 1M input tokens (Gemini 2.0 Flash)
    const outputCostPer1M = 1.0; // $1.00 per 1M output tokens

    const inputCost = (inputTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * outputCostPer1M;

    return Number((inputCost + outputCost).toFixed(4));
  }

  /**
   * Generate userId for NeuroLink context from repository and branch/PR
   */
  private generateUserId(request: ReviewRequest): string {
    const repo = request.repository;
    const identifier = request.branch || `pr-${request.pullRequestId}`;
    return `${repo}-${identifier}`;
  }

  /**
   * Initialize NeuroLink with observability configuration
   */
  private initializeNeurolink(): NeuroLink {
    try {
      const observabilityConfig = buildObservabilityConfigFromEnv();

      const neurolinkConfig: any = {
        conversationMemory: this.config.ai.conversationMemory,
      };

      if (observabilityConfig) {
        // Validate observability config
        if (!validateObservabilityConfig(observabilityConfig)) {
          throw new Error("Invalid observability configuration");
        }

        neurolinkConfig.observability = observabilityConfig;
        console.log("   📊 Observability enabled (Langfuse tracing active)");
      } else {
        console.log(
          "   📊 Observability not configured (set LANGFUSE_* env vars to enable)",
        );
      }

      const neurolink = new NeuroLink(neurolinkConfig);
      return neurolink;
    } catch (error) {
      console.error(
        "❌ Failed to initialize NeuroLink:",
        (error as Error).message,
      );
      throw new Error(`NeuroLink initialization failed: ${error}`);
    }
  }

  /**
   * Ensure orchestrator is initialized
   */
  private async ensureInitialized(reportMode?: boolean): Promise<void> {
    if (!this.initialized) {
      await this.initialize(undefined, { reportMode });
    }
  }

  /**
   * Show Yama V2 banner
   */
  private showBanner(): void {
    if (!this.config?.display?.showBanner) {
      return;
    }

    console.log("\n" + "═".repeat(60));
    console.log(`
    ⚔️  YAMA V2 - AI-Native Code Review Guardian

    Version: 2.0.0
    Mode: Autonomous AI-Powered Review
    Powered by: NeuroLink + MCP Tools
    `);
    console.log("═".repeat(60) + "\n");
  }

  /**
   * Log review start
   */
  private logReviewStart(request: ReviewRequest, sessionId: string): void {
    console.log("\n" + "─".repeat(60));
    console.log(`📋 Review Session Started`);
    console.log("─".repeat(60));
    console.log(`   Session ID: ${sessionId}`);
    console.log(`   Workspace: ${request.workspace}`);
    console.log(`   Repository: ${request.repository}`);
    console.log(`   PR: ${request.pullRequestId || request.branch}`);
    const modeParts: string[] = [];
    if (request.dryRun) {
      modeParts.push("🔵 DRY RUN");
    }
    if (request.reportMode) {
      modeParts.push("📄 REPORT");
    }
    if (request.reviewOnly) {
      modeParts.push("🔍 REVIEW-ONLY");
    }
    if (modeParts.length === 0) {
      modeParts.push("🔴 LIVE");
    }
    console.log(`   Mode: ${modeParts.join(" | ")}`);
    console.log("─".repeat(60) + "\n");
  }

  /**
   * Log review completion
   */
  private logReviewComplete(result: ReviewResult): void {
    console.log("\n" + "═".repeat(60));
    console.log(`✅ Review Completed Successfully`);
    console.log("═".repeat(60));
    console.log(`   Decision: ${this.formatDecision(result.decision)}`);
    console.log(`   Duration: ${result.duration}s`);
    console.log("");
    console.log("   📊 AI Analysis:");
    console.log(`      Files Reviewed: ${result.statistics.filesReviewed}`);
    console.log(`      Issues Found:`);
    console.log(
      `        🔒 CRITICAL: ${result.statistics.issuesFound.critical}`,
    );
    console.log(`        ⚠️  MAJOR: ${result.statistics.issuesFound.major}`);
    console.log(`        💡 MINOR: ${result.statistics.issuesFound.minor}`);
    console.log(
      `        💬 SUGGESTIONS: ${result.statistics.issuesFound.suggestions}`,
    );
    console.log("");
    console.log("   🔧 Tool Calls:");
    console.log(`      Total: ${result.statistics.toolCallsMade}`);
    console.log(`      Comments Posted: ${result.statistics.totalComments}`);
    if (result.reportPath) {
      console.log(`   Report: ${result.reportPath}`);
    }
    if (result.enhancedDescription) {
      console.log(`   Enhanced Description: ✅ Added to report`);
    }
    console.log("");
    console.log(
      `   💰 Token Usage: ${result.tokenUsage.total.toLocaleString()}`,
    );
    console.log(`   Cost Estimate: $${result.costEstimate.toFixed(4)}`);
    console.log("═".repeat(60) + "\n");
  }

  /**
   * Format decision for display
   */
  private formatDecision(decision: string): string {
    switch (decision) {
      case "APPROVED":
        return "✅ APPROVED";
      case "BLOCKED":
        return "🚫 BLOCKED";
      case "CHANGES_REQUESTED":
        return "⚠️  CHANGES REQUESTED";
      default:
        return decision;
    }
  }

  /**
   * Save original PR description to fallback file before enhancement
   * This allows recovery if the enhanced description has issues
   */
  private async saveOriginalDescriptionFallback(
    sessionId: string,
    request: ReviewRequest,
  ): Promise<void> {
    try {
      const session = this.sessionManager.getSession(sessionId);

      // Find the get_pull_request tool call to get the original description
      const getPRCall = session.toolCalls.find(
        (tc: any) => tc.toolName === "get_pull_request",
      );

      if (!getPRCall || !getPRCall.result) {
        console.log("   ⚠️  Could not find original PR description for backup");
        return;
      }

      // Extract description from the tool result
      // The result structure depends on the Bitbucket MCP server response
      const prData = getPRCall.result;
      const originalDescription =
        prData.description || prData.data?.description || "";

      if (!originalDescription) {
        console.log("   ⚠️  Original PR description is empty, skipping backup");
        return;
      }

      // Generate fallback file path
      const prId = request.pullRequestId || "unknown";
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const fallbackPath = `.yama/backups/pr-${prId}-description-${timestamp}.md`;

      // Ensure directory exists and write file
      await mkdir(dirname(fallbackPath), { recursive: true });
      await writeFile(fallbackPath, originalDescription, "utf-8");

      console.log(`   💾 Original description backed up to: ${fallbackPath}`);
    } catch (error) {
      // Don't fail the review if backup fails - just warn
      console.log(
        `   ⚠️  Failed to backup original description: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Extract enhanced description from AI response
   * The AI should output the enhanced description in markdown format
   * In report mode, the AI outputs directly without calling update_pull_request
   */
  private extractEnhancedDescription(aiResponse: any): string {
    const responseText = aiResponse.content || aiResponse.text || "";

    // For report mode, the AI should output the description directly
    // Try to find the main content by looking for section headers

    // First, check if response starts with a heading (likely a description)
    const trimmed = responseText.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("##")) {
      return trimmed;
    }

    // Try to extract from markdown code block (but avoid bash/json blocks)
    // Look for markdown blocks that start with headings
    const mdBlockMatch = responseText.match(
      /```(?:markdown|md)?\s*\n([\s\S]*?)\n```/,
    );
    if (mdBlockMatch) {
      const content = mdBlockMatch[1].trim();
      if (content.startsWith("#") || content.startsWith("##")) {
        return content;
      }
    }

    // Try to find content that starts with a section header
    // This handles cases where AI adds preamble text before the description
    const sectionHeaderMatch = responseText.match(/(^|\n)(##\s+.*)/);
    if (sectionHeaderMatch) {
      // Return everything from the section header onwards
      return responseText
        .slice(responseText.indexOf(sectionHeaderMatch[2]))
        .trim();
    }

    // Fallback: return full response, but strip any non-description prefixes
    return trimmed;
  }

  /**
   * Append enhanced description section to the report file
   */
  private async appendEnhancedDescriptionToReport(
    reportPath: string,
    enhancedDescription: string,
  ): Promise<void> {
    try {
      await this.reportGenerator.appendEnhancedDescription(
        reportPath,
        enhancedDescription,
      );
      console.log(`   📝 Enhanced description appended to report`);
    } catch (error) {
      console.log(
        `   ⚠️  Failed to append enhanced description to report: ${(error as Error).message}`,
      );
    }
  }

  // ============================================================================
  // PR Info Fetching & Display Methods
  // ============================================================================

  /**
   * Fetch PR information before AI review starts
   * Uses MCP tools directly via NeuroLink's executeTool method
   *
   * TODO: Replace MCP server calls with direct Bitbucket API integration
   * The MCP server adds unnecessary overhead (protocol wrapping, subprocess spawning)
   * Direct integration would use axios to call Bitbucket REST API endpoints directly:
   * - GET /rest/api/1.0/projects/{workspace}/repos/{repo}/pull-requests/{id}
   * - GET /rest/api/1.0/projects/{workspace}/repos/{repo}/pull-requests (for branch lookup)
   * This would eliminate the need for unwrapMCPResponse() and mapToPRDisplayInfo() format handling.
   */
  private async fetchPRInfo(
    request: ReviewRequest,
  ): Promise<PRDisplayInfo | null> {
    try {
      if (request.pullRequestId) {
        // Direct PR ID - use get_pull_request MCP tool
        const result = await this.neurolink.executeTool<any>(
          "get_pull_request",
          {
            workspace: request.workspace,
            repository: request.repository,
            pull_request_id: request.pullRequestId,
          },
        );

        // Unwrap MCP response format: { content: [{ type: "text", text: "...json..." }] }
        const prData = this.unwrapMCPResponse(result);
        if (!prData) {
          console.log("   ⚠️  Could not parse MCP response for PR info");
          return null;
        }

        return this.mapToPRDisplayInfo(prData);
      }

      if (request.branch) {
        // Branch name - use list_pull_requests MCP tool and filter
        return await this.fetchPRByBranch(request);
      }

      return null;
    } catch (error) {
      console.log(
        `   ⚠️  Could not fetch PR info: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Unwrap MCP protocol response format
   * MCP returns: { content: [{ type: "text", text: "...json..." }] }
   * This extracts and parses the JSON from the text field
   *
   * TODO: Remove this method when migrating to direct Bitbucket API integration.
   * Direct REST API calls will return JSON directly without MCP protocol wrapping.
   */
  private unwrapMCPResponse(response: any): any | null {
    // Check if response is in MCP format
    if (
      response?.content &&
      Array.isArray(response.content) &&
      response.content.length > 0
    ) {
      const contentItem = response.content[0];
      if (
        contentItem?.type === "text" &&
        typeof contentItem.text === "string"
      ) {
        try {
          return JSON.parse(contentItem.text);
        } catch {
          // If parsing fails, return the text as-is
          return contentItem.text;
        }
      }
    }

    // If not in MCP format, return as-is (backward compatibility)
    return response;
  }

  /**
   * Fetch PR by branch name using list_pull_requests MCP tool
   * Handles pagination to search through all open PRs
   */
  private async fetchPRByBranch(
    request: ReviewRequest,
  ): Promise<PRDisplayInfo | null> {
    console.log(`🔍 Searching for PR from branch: ${request.branch}`);

    const pageSize = 50;
    let start = 0;
    let totalSearched = 0;
    let pageCount = 0;

    while (true) {
      pageCount++;

      // Show pagination progress for subsequent pages
      if (pageCount > 1) {
        console.log(
          `   📄 Fetching page ${pageCount} (searched ${totalSearched} PRs so far)...`,
        );
      }

      // Use list_pull_requests MCP tool with pagination
      const rawResult = await this.neurolink.executeTool<any>(
        "list_pull_requests",
        {
          workspace: request.workspace,
          repository: request.repository,
          state: "OPEN",
          limit: pageSize,
          start: start,
        },
      );

      // Unwrap MCP response format
      const result = this.unwrapMCPResponse(rawResult) as {
        values: any[];
        isLastPage?: boolean;
      } | null;

      if (!result?.values || result.values.length === 0) {
        // No more PRs to search
        break;
      }

      totalSearched += result.values.length;

      // Find PR with matching source branch
      // Note: Branch name could be displayId (feature/auth) or id (refs/heads/feature/auth)
      // Also handle MCP flattened format (source_branch) vs raw API (fromRef.displayId)
      const matchingPR = result.values.find((pr: any) => {
        const sourceBranch =
          pr.source_branch ||
          pr.fromRef?.displayId ||
          pr.fromRef?.id ||
          pr.source?.branch?.name ||
          "";
        const branchName = request.branch || "";
        // Match either displayId or full ref path
        return (
          sourceBranch === branchName ||
          sourceBranch === `refs/heads/${branchName}` ||
          `refs/heads/${sourceBranch}` === branchName
        );
      });

      if (matchingPR) {
        console.log(
          `   ✅ Found PR #${matchingPR.id} after searching ${totalSearched} PRs\n`,
        );
        // Use mapToPRDisplayInfo for consistent handling of MCP format
        return this.mapToPRDisplayInfo(matchingPR);
      }

      // Check if there are more pages
      if (result.isLastPage === false || result.values.length === pageSize) {
        start += pageSize;
      } else {
        // No more pages
        break;
      }
    }

    throw new Error(
      `No open PR found for branch: ${request.branch} (searched ${totalSearched} PRs)`,
    );
  }

  /**
   * Map MCP server response to PRDisplayInfo
   * MCP server returns a flattened format with different field names than raw Bitbucket API
   */
  private mapToPRDisplayInfo(pr: any): PRDisplayInfo {
    // MCP server returns flattened structure: source_branch, destination_branch
    // Also handle raw API formats for backward compatibility
    const sourceBranch =
      pr.source_branch ||
      pr.fromRef?.displayId ||
      pr.source?.branch?.name ||
      "unknown";
    const destinationBranch =
      pr.destination_branch ||
      pr.toRef?.displayId ||
      pr.destination?.branch?.name ||
      "unknown";

    // Author can be string (MCP formatted) or object (raw API)
    let authorName = "Unknown";
    let authorUsername = "unknown";

    if (typeof pr.author === "string") {
      // MCP formatted response
      authorName = pr.author;
      authorUsername = pr.author_username || pr.author;
    } else if (pr.author) {
      // Raw API format (Server or Cloud)
      const authorObj = pr.author.user || pr.author;
      authorName = authorObj.displayName || authorObj.display_name || "Unknown";
      authorUsername = authorObj.name || "unknown";
    }

    return {
      id: pr.id,
      title: pr.title,
      author: {
        name: authorUsername,
        displayName: authorName,
      },
      state: pr.state,
      sourceBranch,
      destinationBranch,
      createdDate: pr.created_on || pr.createdDate,
      updatedDate: pr.updated_on || pr.updatedDate,
    };
  }

  /**
   * Display PR information to the console
   */
  private displayPRInfo(prInfo: PRDisplayInfo): void {
    console.log("\n" + "─".repeat(60));
    console.log(`📋 Pull Request Information`);
    console.log("─".repeat(60));
    console.log(`   PR #${prInfo.id}: ${prInfo.title}`);
    console.log(
      `   Author: ${prInfo.author.displayName} (@${prInfo.author.name})`,
    );
    console.log(`   State: ${this.formatPRState(prInfo.state)}`);
    console.log(
      `   Branch: ${prInfo.sourceBranch} → ${prInfo.destinationBranch}`,
    );
    console.log(`   Created: ${this.formatDate(prInfo.createdDate)}`);
    console.log(`   Updated: ${this.formatDate(prInfo.updatedDate)}`);
    console.log("─".repeat(60) + "\n");
  }

  /**
   * Format PR state with emoji
   */
  private formatPRState(state: string): string {
    switch (state) {
      case "OPEN":
        return "🟢 OPEN";
      case "MERGED":
        return "🟣 MERGED";
      case "DECLINED":
        return "🔴 DECLINED";
      default:
        return state;
    }
  }

  /**
   * Format date string to human-readable format
   */
  private formatDate(dateString: string): string {
    try {
      let date: Date;

      // Check if date is in MCP format: "22/01/2026, 12:16:32" (DD/MM/YYYY, HH:mm:ss)
      const mcpDateMatch = dateString.match(
        /^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/,
      );
      if (mcpDateMatch) {
        const [, day, month, year, hour, minute, second] = mcpDateMatch;
        // Parse as DD/MM/YYYY
        date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
      } else {
        // Try standard ISO format
        date = new Date(dateString);
      }

      // Check for invalid date
      if (isNaN(date.getTime())) {
        return dateString;
      }

      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return dateString;
    }
  }
}

// Export factory function
export function createYamaV2(): YamaV2Orchestrator {
  return new YamaV2Orchestrator();
}
