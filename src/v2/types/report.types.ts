/**
 * Report Generation Types for Yama V2
 * Structured output for report mode instead of posting comments
 */

// ============================================================================
// Report Format Types
// ============================================================================

export type ReportFormat = "md" | "json";

// ============================================================================
// Issue Types
// ============================================================================

export type IssueSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";
export type LineType = "ADDED" | "REMOVED" | "CONTEXT";

export interface ReviewIssue {
  severity: IssueSeverity;
  filePath: string;
  lineNumber: number;
  lineType: LineType;
  title: string;
  description: string;
  impact: string;
  codeSnippet?: string;
  suggestion?: string;
}

// ============================================================================
// Report Types
// ============================================================================

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "BLOCKED";

export interface IssueStatistics {
  critical: number;
  major: number;
  minor: number;
  suggestions: number;
}

export interface ReviewReportStatistics {
  filesReviewed: number;
  issuesBySeverity: IssueStatistics;
  duration: number;
}

export interface ReviewReport {
  prId: number;
  prTitle: string;
  repository: string;
  workspace: string;
  reviewedAt: string;
  decision: ReviewDecision;
  summary: string;
  issues: ReviewIssue[];
  statistics: ReviewReportStatistics;
}

// ============================================================================
// AI Output Types (for parsing AI response)
// ============================================================================

export interface AIReportOutput {
  decision: ReviewDecision;
  summary: string;
  issues: ReviewIssue[];
}
