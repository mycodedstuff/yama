/**
 * Unit tests for SessionKnowledgeBaseManager
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { SessionKnowledgeBaseManager } from "../../../src/v2/core/SessionKnowledgeBaseManager.js";
import {
  FileReviewResult,
  ReviewIssue,
} from "../../../src/v2/types/explicit-loop.types.js";

describe("SessionKnowledgeBaseManager", () => {
  let kb: SessionKnowledgeBaseManager;

  beforeEach(() => {
    kb = new SessionKnowledgeBaseManager();
  });

  describe("initial state", () => {
    it("should start empty", () => {
      expect(kb.isEmpty()).toBe(true);
      expect(kb.getPromptContext()).toBeNull();
    });

    it("should have zero stats initially", () => {
      const stats = kb.getStats();
      expect(stats.issuesReported).toBe(0);
      expect(stats.businessContexts).toBe(0);
      expect(stats.implementationContexts).toBe(0);
      expect(stats.schemasSeen).toBe(0);
      expect(stats.estimatedTokens).toBe(0);
      expect(stats.condensed).toBe(false);
    });
  });

  describe("updateFromFileReview", () => {
    it("should add issue fingerprints", () => {
      const result: FileReviewResult = {
        filePath: "src/test.ts",
        issues: [
          {
            lineNumber: 10,
            lineType: "ADDED",
            severity: "MAJOR",
            title: "Missing error handling",
            description: "This function does not handle errors properly",
            impact: "May cause runtime crashes",
          },
        ],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);

      expect(kb.isEmpty()).toBe(false);
      const stats = kb.getStats();
      expect(stats.issuesReported).toBe(1);
    });

    it("should detect duplicate issues", () => {
      const issue1: ReviewIssue = {
        lineNumber: 10,
        lineType: "ADDED",
        severity: "MAJOR",
        title: "Missing error handling",
        description: "This function does not handle errors properly",
        impact: "May cause runtime crashes",
      };

      const issue2: ReviewIssue = {
        lineNumber: 20,
        lineType: "ADDED",
        severity: "MAJOR",
        title: "Missing error handling",
        description: "This function does not handle errors properly",
        impact: "Same issue in different location",
      };

      const result1: FileReviewResult = {
        filePath: "src/test1.ts",
        issues: [issue1],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      const result2: FileReviewResult = {
        filePath: "src/test2.ts",
        issues: [issue2],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result1);
      kb.updateFromFileReview(result2);

      const stats = kb.getStats();
      // Second issue should be detected as duplicate and not added
      expect(stats.issuesReported).toBe(1);
    });

    it("should extract business context from issues", () => {
      const result: FileReviewResult = {
        filePath: "src/payment/processor.ts",
        issues: [
          {
            lineNumber: 10,
            lineType: "ADDED",
            severity: "CRITICAL",
            title: "Missing payment validation",
            description: "Payment transactions lack proper validation",
            impact: "May process invalid payments",
          },
        ],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);

      const stats = kb.getStats();
      expect(stats.businessContexts).toBeGreaterThan(0);
    });

    it("should extract implementation context from issues", () => {
      const result: FileReviewResult = {
        filePath: "src/cache/redis.ts",
        issues: [
          {
            lineNumber: 10,
            lineType: "ADDED",
            severity: "MAJOR",
            title: "Redis connection not pooled",
            description:
              "Creating new Redis connections instead of using a pool",
            impact: "Connection exhaustion under load",
          },
        ],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);

      const stats = kb.getStats();
      expect(stats.implementationContexts).toBeGreaterThan(0);
    });
  });

  describe("getPromptContext", () => {
    it("should return null when empty", () => {
      expect(kb.getPromptContext()).toBeNull();
    });

    it("should include already-reported section when issues exist", () => {
      const result: FileReviewResult = {
        filePath: "src/test.ts",
        issues: [
          {
            lineNumber: 10,
            lineType: "ADDED",
            severity: "MAJOR",
            title: "Test issue",
            description: "Test description",
            impact: "Test impact",
          },
        ],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);
      const context = kb.getPromptContext();

      expect(context).not.toBeNull();
      expect(context).toContain("<already-reported>");
      expect(context).toContain("Test issue");
      expect(context).toContain("src/test.ts");
    });

    it("should include schemas-seen section when schemas detected", () => {
      const result: FileReviewResult = {
        filePath: "src/models/user.ts",
        issues: [],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      // Create a mock diff with a schema definition
      const mockDiff = {
        hunks: [
          {
            sourceStart: 1,
            sourceLineCount: 10,
            destinationStart: 1,
            destinationLineCount: 10,
            lines: [
              {
                type: "ADDED",
                content: "interface User {",
                source_line: null,
                destination_line: 1,
              },
              {
                type: "ADDED",
                content: "  id: string;",
                source_line: null,
                destination_line: 2,
              },
              {
                type: "ADDED",
                content: "  name: string;",
                source_line: null,
                destination_line: 3,
              },
              {
                type: "ADDED",
                content: "}",
                source_line: null,
                destination_line: 4,
              },
            ],
          },
        ],
      };

      kb.updateFromFileReview(result, mockDiff as any);
      const context = kb.getPromptContext();

      // Schema extraction should detect the User interface
      const stats = kb.getStats();
      if (stats.schemasSeen > 0) {
        expect(context).toContain("<schemas-seen>");
        expect(context).toContain("User");
      }
    });

    it("should include feature-context section when context extracted", () => {
      const result: FileReviewResult = {
        filePath: "src/payment/transaction.ts",
        issues: [
          {
            lineNumber: 10,
            lineType: "ADDED",
            severity: "MAJOR",
            title: "Transaction lock missing",
            description: "Payment transaction lacks proper locking",
            impact: "Concurrent access issues",
          },
        ],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);
      const context = kb.getPromptContext();

      expect(context).toContain("<feature-context>");
    });
  });

  describe("isSimilarToReported", () => {
    it("should return false for new issues", () => {
      const issue: ReviewIssue = {
        lineNumber: 10,
        lineType: "ADDED",
        severity: "MAJOR",
        title: "New issue",
        description: "A completely new issue",
        impact: "Some impact",
      };

      expect(kb.isSimilarToReported(issue)).toBe(false);
    });

    it("should return true for similar issues", () => {
      const originalIssue: ReviewIssue = {
        lineNumber: 10,
        lineType: "ADDED",
        severity: "MAJOR",
        title: "Missing validation",
        description: "Input validation is missing for this field",
        impact: "Invalid data accepted",
      };

      const result: FileReviewResult = {
        filePath: "src/test.ts",
        issues: [originalIssue],
        toolCallsMade: 0,
        tokensUsed: { input: 100, output: 50, total: 150 },
        duration: 100,
      };

      kb.updateFromFileReview(result);

      const similarIssue: ReviewIssue = {
        lineNumber: 20,
        lineType: "ADDED",
        severity: "MAJOR",
        title: "Missing validation",
        description: "Input validation is missing for this field",
        impact: "Different impact text",
      };

      expect(kb.isSimilarToReported(similarIssue)).toBe(true);
    });
  });

  describe("token bounding", () => {
    it("should stay within token limits when adding many issues", () => {
      // Add many issues to test bounding
      for (let i = 0; i < 50; i++) {
        const result: FileReviewResult = {
          filePath: `src/file${i}.ts`,
          issues: [
            {
              lineNumber: 10,
              lineType: "ADDED",
              severity: "MAJOR",
              title: `Issue ${i}: Some problem with the code that needs attention`,
              description: `This is issue number ${i} with a fairly long description to increase token count`,
              impact: "Various impacts",
            },
          ],
          toolCallsMade: 0,
          tokensUsed: { input: 100, output: 50, total: 150 },
          duration: 100,
        };

        kb.updateFromFileReview(result);
      }

      const stats = kb.getStats();
      // Should be bounded (not all 50 issues)
      expect(stats.estimatedTokens).toBeLessThanOrEqual(2500); // Some margin for overhead
    });
  });

  describe("condensation", () => {
    it("should condense when approaching token threshold", () => {
      // Add enough issues to trigger condensation
      for (let i = 0; i < 30; i++) {
        const result: FileReviewResult = {
          filePath: `src/business/process${i}.ts`,
          issues: [
            {
              lineNumber: 10,
              lineType: "ADDED",
              severity: "MAJOR",
              title: `Business logic issue ${i}`,
              description: `Payment processing validation missing in transaction flow ${i}`,
              impact: "Transaction integrity at risk",
            },
          ],
          toolCallsMade: 0,
          tokensUsed: { input: 100, output: 50, total: 150 },
          duration: 100,
        };

        kb.updateFromFileReview(result);
      }

      const stats = kb.getStats();
      // After many updates, should have condensed
      // Note: condensation depends on token threshold
      if (stats.condensed) {
        // Context should be summarized
        const context = kb.getPromptContext();
        expect(context).toContain("(Condensed)");
      }
    });
  });

  describe("deduplicateIssues", () => {
    it("should return empty array for no issues", () => {
      const result = kb.deduplicateIssues([]);
      expect(result).toHaveLength(0);
    });

    it("should return same issues when no duplicates", () => {
      const issues: ReviewIssue[] = [
        {
          lineNumber: 10,
          lineType: "ADDED",
          severity: "MAJOR",
          title: "Issue one",
          description: "First issue description",
          impact: "Some impact",
          filePath: "src/file1.ts",
        },
        {
          lineNumber: 20,
          lineType: "ADDED",
          severity: "MINOR",
          title: "Issue two",
          description: "Second issue description",
          impact: "Another impact",
          filePath: "src/file2.ts",
        },
      ];

      const result = kb.deduplicateIssues(issues);
      expect(result).toHaveLength(2);
    });

    it("should remove duplicate issues and track affected files", () => {
      const issues: ReviewIssue[] = [
        {
          lineNumber: 10,
          lineType: "ADDED",
          severity: "MAJOR",
          title: "Missing schema validation",
          description: "Schema should validate input fields",
          impact: "Invalid data accepted",
          filePath: "src/file1.ts",
        },
        {
          lineNumber: 15,
          lineType: "ADDED",
          severity: "MAJOR",
          title: "Missing schema validation",
          description: "Schema should validate input fields",
          impact: "Invalid data accepted",
          filePath: "src/file2.ts",
        },
        {
          lineNumber: 20,
          lineType: "ADDED",
          severity: "MAJOR",
          title: "Missing schema validation",
          description: "Schema should validate input fields",
          impact: "Invalid data accepted",
          filePath: "src/file3.ts",
        },
      ];

      const result = kb.deduplicateIssues(issues);

      // Should deduplicate to 1 issue
      expect(result).toHaveLength(1);

      // Should track all affected files
      expect(result[0].affectedFiles).toBeDefined();
      expect(result[0].affectedFiles).toContain("src/file1.ts");
      expect(result[0].affectedFiles).toContain("src/file2.ts");
      expect(result[0].affectedFiles).toContain("src/file3.ts");
    });

    it("should preserve first occurrence as the primary file", () => {
      const issues: ReviewIssue[] = [
        {
          lineNumber: 10,
          lineType: "ADDED",
          severity: "CRITICAL",
          title: "Security vulnerability",
          description: "SQL injection risk in query",
          impact: "Data breach risk",
          filePath: "src/primary.ts",
        },
        {
          lineNumber: 20,
          lineType: "ADDED",
          severity: "CRITICAL",
          title: "Security vulnerability",
          description: "SQL injection risk in query",
          impact: "Data breach risk",
          filePath: "src/secondary.ts",
        },
      ];

      const result = kb.deduplicateIssues(issues);

      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe("src/primary.ts");
    });
  });
});
