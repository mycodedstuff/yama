/**
 * Explicit Loop Architecture Type Definitions
 * Types for file-by-file review with bounded context
 */

import { DiffFile, Comment } from "./mcp.types.js";
import { TokenUsage } from "./v2.types.js";

// ============================================================================
// File Target Types
// ============================================================================

/**
 * File target for explicit loop review
 * Represents a single file to be reviewed
 */
export interface FileReviewTarget {
  /** File path in the repository */
  path: string;
  /** Status of the file in the PR */
  status: "added" | "modified" | "deleted" | "renamed";
  /** Original path for renamed files */
  oldPath?: string;
}

// ============================================================================
// File Review Context Types
// ============================================================================

/**
 * Context passed to each file review
 * All the information needed to review a single file
 */
export interface FileReviewContext {
  /** Workspace slug */
  workspace: string;
  /** Repository slug */
  repository: string;
  /** Pull request ID */
  pullRequestId: number;
  /** Path to the file being reviewed */
  filePath: string;
  /** Status of the file (added, modified, etc.) */
  fileStatus: FileReviewTarget["status"];
  /** Pre-fetched diff for this file */
  diff: DiffFile;
  /** Existing comments on this file (for duplicate detection) */
  existingComments: Comment[];
  /** PR title for context */
  prTitle: string;
  /** PR description for context */
  prDescription: string;
  /** Source branch name */
  sourceBranch: string;
  /** Target branch name */
  targetBranch: string;
}

// ============================================================================
// Review Issue Types
// ============================================================================

/**
 * Single issue found during review
 * Returned by the AI for each file
 */
export interface ReviewIssue {
  /** Line number where the issue was found */
  lineNumber: number;
  /** Type of line (ADDED, REMOVED, CONTEXT) */
  lineType: "ADDED" | "REMOVED" | "CONTEXT";
  /** Severity level of the issue */
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";
  /** Short title for the issue */
  title: string;
  /** Detailed description of the issue */
  description: string;
  /** Impact of the issue if not fixed */
  impact: string;
  /** Suggested fix (code block) */
  suggestion?: string;
  /** Reference to documentation or standards */
  reference?: string;
  /** File path (added during aggregation) */
  filePath?: string;
  /** Other files where this same issue was found (for deduplication) */
  affectedFiles?: string[];
}

// ============================================================================
// File Review Result Types
// ============================================================================

/**
 * Result from reviewing a single file
 * Contains issues found and metadata
 */
export interface FileReviewResult {
  /** Path to the file that was reviewed */
  filePath: string;
  /** Issues found in this file */
  issues: ReviewIssue[];
  /** Number of tool calls made during review */
  toolCallsMade: number;
  /** Token usage for this file review */
  tokensUsed: TokenUsage;
  /** Duration of the review in milliseconds */
  duration: number;
  /** Error message if review failed */
  error?: string;
  /** Whether this file was reviewed in multiple chunks */
  chunked?: boolean;
  /** Total number of chunks if file was chunked */
  totalChunks?: number;
}

// ============================================================================
// Aggregated Review Types
// ============================================================================

/**
 * Aggregated findings from all file reviews
 * Used for decision making and reporting
 */
export interface AggregatedFindings {
  /** All issues from all files */
  issues: ReviewIssue[];
  /** Files that were reviewed */
  filesReviewed: FileReviewTarget[];
  /** Files that had errors */
  filesWithErrors: string[];
  /** Total tokens used across all files */
  totalTokensUsed: number;
  /** Total duration in milliseconds */
  totalDuration: number;
}

// ============================================================================
// Decision Types
// ============================================================================

/**
 * Final decision on the PR
 */
export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED";

/**
 * Decision context with reasoning
 */
export interface DecisionContext {
  /** Final decision */
  decision: ReviewDecision;
  /** Reasoning for the decision */
  reasoning: string;
  /** Issues that influenced the decision */
  blockingIssues: ReviewIssue[];
  /** Statistics used for decision */
  statistics: {
    criticalCount: number;
    majorCount: number;
    minorCount: number;
    suggestionCount: number;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for explicit loop mode
 */
export interface ExplicitLoopConfig {
  /** Enable explicit loop mode */
  enabled: boolean;
  /** Auto-enable when files exceed this threshold */
  fileThreshold: number;
  /** Maximum tokens per file review */
  maxTokensPerFile: number;
  /** Timeout per file review in milliseconds */
  fileTimeoutMs: number;
}

// ============================================================================
// PR Data Types
// ============================================================================

/**
 * Pre-fetched PR data for explicit loop
 * Fetched once before the review loop starts
 */
export interface PrefetchedPRData {
  /** PR details from get_pull_request */
  prDetails: {
    id: number;
    title: string;
    description: string;
    author: {
      name: string;
      displayName: string;
    };
    state: "OPEN" | "MERGED" | "DECLINED";
    source: {
      branch: { name: string };
      commit: { id: string };
    };
    destination: {
      branch: { name: string };
      commit: { id: string };
    };
    createdDate: string;
    updatedDate: string;
  };
  /** List of files to review */
  files: FileReviewTarget[];
  /** Existing comments grouped by file path */
  existingComments: Map<string, Comment[]>;
}

// ============================================================================
// Enhancement Context Types
// ============================================================================

/**
 * Context for description enhancement phase
 * Contains aggregated findings from review
 */
export interface EnhancementContext {
  /** PR details */
  prDetails: PrefetchedPRData["prDetails"];
  /** Files that were reviewed */
  filesReviewed: FileReviewTarget[];
  /** Issues found during review */
  issuesFound: ReviewIssue[];
  /** Configuration */
  config: {
    instructions: string;
    requiredSections: Array<{
      key: string;
      name: string;
      required: boolean;
      description: string;
    }>;
    preserveContent: boolean;
    autoFormat: boolean;
  };
}

// ============================================================================
// Feature Context Types
// ============================================================================

/**
 * Feature context built BEFORE reviewing any files
 * Gives AI a "mental model" of the PR's purpose
 */
export interface FeatureContext {
  /** What this PR is trying to accomplish */
  purpose: string;

  /** Key business concepts involved (e.g., "entity locking", "eligibility checks") */
  domainConcepts: string[];

  /** Technical approach being used (e.g., "Redis distributed locking", "Sea-ORM entities") */
  technicalApproach: string;

  /** Files and their roles in the feature */
  fileRoles: Map<string, string>; // file path -> role description
}

// ============================================================================
// Session Knowledge Base Types
// ============================================================================

/**
 * Lightweight fingerprint of an issue for deduplication
 * Used to track what issues have already been reported
 */
export interface IssueFingerprint {
  /** Hash of title + description for quick comparison */
  hash: string;

  /** Severity for quick reference */
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";

  /** Short title for display in prompt */
  title: string;

  /** File where first reported */
  sourceFile: string;

  /** Key terms extracted from the issue for similarity matching */
  keyTerms: string[];
}

/**
 * In-memory knowledge base for a single explicit loop review session
 * Bounded size to prevent token explosion in prompts
 */
export interface SessionKnowledgeBase {
  /** Issues already reported (to avoid duplicates) */
  reportedIssues: IssueFingerprint[];

  /** Business logic patterns observed (e.g., "entity locking prevents concurrent access") */
  businessContext: string[];

  /** Implementation details observed (e.g., "uses Redis distributed locking", "Sea-ORM entities") */
  implementationContext: string[];

  /** Schema definitions seen (to attribute schema issues correctly) */
  schemasSeen: Map<string, string>; // schema_name -> file_path

  /** Estimated token count for bounding */
  estimatedTokens: number;

  /** Maximum allowed tokens */
  maxTokens: number;

  /** Whether context has been condensed */
  condensed: boolean;
}

/**
 * Context extracted from a file review for the knowledge base
 */
export interface ExtractedContext {
  /** Business logic patterns identified */
  business: string[];

  /** Implementation details identified */
  implementation: string[];

  /** Schema definitions found */
  schemas: Map<string, string>;
}
