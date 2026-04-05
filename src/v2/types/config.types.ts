/**
 * Yama V2 Configuration Type Definitions
 */

import { FocusArea, BlockingCriteria } from "./v2.types.js";

// ============================================================================
// Main Configuration Type
// ============================================================================

export interface YamaV2Config {
  version: number;
  configType: string;
  display: DisplayConfig;
  ai: AIConfig;
  mcpServers: MCPServersConfig;
  review: ReviewConfig;
  descriptionEnhancement: DescriptionEnhancementConfig;
  memoryBank: MemoryBankConfig;
  knowledgeBase: KnowledgeBaseConfig;
  projectStandards?: ProjectStandardsConfig;
  monitoring: MonitoringConfig;
  performance: PerformanceConfig;
}

// ============================================================================
// Display Configuration
// ============================================================================

export interface DisplayConfig {
  showBanner: boolean;
  streamingMode: boolean;
  verboseToolCalls: boolean;
  showAIThinking: boolean;
}

// ============================================================================
// AI Configuration
// ============================================================================

export interface AIConfig {
  provider: "auto" | "google-ai" | "anthropic" | "openai" | "bedrock" | "azure";
  model: string;
  temperature: number;
  maxTokens: number;
  enableAnalytics: boolean;
  enableEvaluation: boolean;
  timeout: string;
  retryAttempts: number;
  conversationMemory: ConversationMemoryConfig;
}

export interface ConversationMemoryConfig {
  enabled: boolean;
  store: "memory" | "redis";
  maxSessions?: number;
  /** Enable automatic context summarization/compaction */
  enableSummarization?: boolean;
  /** Token threshold to trigger compaction (defaults to 80% of model context) */
  tokenThreshold?: number;
  /** Provider for summarization (defaults to vertex) */
  summarizationProvider?: string;
  /** Model for summarization (defaults to gemini-2.5-flash) */
  summarizationModel?: string;
  redis?: RedisConfig;
  /** Context compaction configuration */
  contextCompaction?: ContextCompactionConfig;
  /** File content summarization for large files */
  fileSummarization?: FileSummarizationConfig;
}

export interface ContextCompactionConfig {
  /** Enable auto-compaction (default: true when summarization enabled) */
  enabled?: boolean;
  /** Compaction trigger threshold (0.0-1.0, default: 0.80) */
  threshold?: number;
  /** Enable tool output pruning - replace old tool outputs with placeholder (default: true) */
  enablePruning?: boolean;
  /** Enable file read deduplication (default: true) */
  enableDeduplication?: boolean;
  /** Enable sliding window truncation as fallback (default: true) */
  enableSlidingWindow?: boolean;
  /** Max tool output size in bytes (default: 51200 = 50KB) */
  maxToolOutputBytes?: number;
  /** Max tool output lines (default: 2000) */
  maxToolOutputLines?: number;
  /** Return preview instead of full output; AI can retrieve full via retrieve_context tool (default: false) */
  sendToolPreview?: boolean;
  /** File read budget as fraction of remaining context (default: 0.60) */
  fileReadBudgetPercent?: number;
}

export interface FileSummarizationConfig {
  /** Enable automatic file content summarization */
  enabled?: boolean;
  /** Provider for file summarization */
  provider?: string;
  /** Model for file summarization */
  model?: string;
  /** Token threshold per file to trigger summarization */
  threshold?: number;
  /** Minimum tokens per file after summarization */
  minTokensPerFile?: number;
  /** Maximum tokens per file after summarization */
  maxTokensPerFile?: number;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  keyPrefix?: string;
  ttl?: number;
}

// ============================================================================
// MCP Servers Configuration
// ============================================================================

export interface MCPServersConfig {
  bitbucket?: {
    /** List of tool names to block from Bitbucket MCP server */
    blockedTools?: string[];
  };
  jira: {
    enabled: boolean;
    /** List of tool names to block from Jira MCP server */
    blockedTools?: string[];
  };
}

// ============================================================================
// Review Configuration
// ============================================================================

export interface ReviewConfig {
  enabled: boolean;
  workflowInstructions: string;
  focusAreas: FocusArea[];
  blockingCriteria?: BlockingCriteria[];
  excludePatterns: string[];
  contextLines: number;
  maxFilesPerReview: number;
  fileAnalysisTimeout: string;
  toolPreferences: ToolPreferencesConfig;
}

export interface ToolPreferencesConfig {
  lazyLoading: boolean;
  cacheToolResults: boolean;
  parallelToolCalls: boolean;
  maxToolCallsPerFile: number;
  enableCodeSearch: boolean;
  enableDirectoryListing: boolean;
}

// ============================================================================
// Description Enhancement Configuration
// ============================================================================

export interface DescriptionEnhancementConfig {
  enabled: boolean;
  instructions: string;
  requiredSections: RequiredSection[];
  preserveContent: boolean;
  autoFormat: boolean;
}

export interface RequiredSection {
  key: string;
  name: string;
  required: boolean;
  description: string;
}

// ============================================================================
// Memory Bank Configuration
// ============================================================================

export interface MemoryBankConfig {
  enabled: boolean;
  path: string;
  fallbackPaths: string[];
  standardFiles?: string[];
}

// ============================================================================
// Knowledge Base Configuration (Reinforcement Learning)
// ============================================================================

export interface KnowledgeBaseConfig {
  /** Enable knowledge base feature */
  enabled: boolean;
  /** Path to knowledge base file (relative to project root) */
  path: string;
  /** Patterns to identify AI comment authors (case-insensitive) */
  aiAuthorPatterns: string[];
  /** Number of learnings before auto-summarization triggers */
  maxEntriesBeforeSummarization: number;
  /** Number of entries to retain after summarization */
  summaryRetentionCount: number;
  /** Auto-commit knowledge base changes (default for --commit flag) */
  autoCommit: boolean;
}

// ============================================================================
// Project Standards Configuration
// ============================================================================

export interface ProjectStandardsConfig {
  customPromptsPath: string;
  additionalFocusAreas: FocusArea[];
  customBlockingRules: BlockingCriteria[];
  severityOverrides: Record<string, string>;
}

// ============================================================================
// Monitoring Configuration
// ============================================================================

export interface MonitoringConfig {
  enabled: boolean;
  logToolCalls: boolean;
  logAIDecisions: boolean;
  logTokenUsage: boolean;
  exportFormat: "json" | "csv";
  exportPath: string;
}

// ============================================================================
// Performance Configuration
// ============================================================================

export interface PerformanceConfig {
  maxReviewDuration: string;
  tokenBudget: TokenBudgetConfig;
  costControls: CostControlsConfig;
}

export interface TokenBudgetConfig {
  maxTokensPerReview: number;
  warningThreshold: number;
}

export interface CostControlsConfig {
  maxCostPerReview: number;
  warningThreshold: number;
}
