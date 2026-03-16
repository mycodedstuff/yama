/**
 * Unit tests for FeatureContextBuilder
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { FeatureContextBuilder } from "../../../src/v2/core/FeatureContextBuilder.js";
import { FileReviewTarget } from "../../../src/v2/types/explicit-loop.types.js";

describe("FeatureContextBuilder", () => {
  let builder: FeatureContextBuilder;

  beforeEach(() => {
    builder = new FeatureContextBuilder();
  });

  describe("buildContext", () => {
    it("should extract purpose from PR title", () => {
      const context = builder.buildContext(
        "Feature/entity-locking",
        "This PR implements entity locking for concurrent access control",
        [],
        new Map(),
      );

      expect(context.purpose).toContain("entity");
      expect(context.purpose).toContain("locking");
    });

    it("should extract domain concepts from file names", () => {
      const files: FileReviewTarget[] = [
        { path: "src/entity_locked.rs", status: "added" },
        { path: "src/payment_processor.rs", status: "modified" },
        { path: "src/user_authentication.ts", status: "added" },
      ];

      const context = builder.buildContext(
        "Add new features",
        "",
        files,
        new Map(),
      );

      expect(context.domainConcepts.length).toBeGreaterThan(0);
    });

    it("should identify technical approach from file paths", () => {
      const files: FileReviewTarget[] = [
        { path: "src/redis_cache.rs", status: "added" },
        { path: "src/database/queries.ts", status: "modified" },
      ];

      const context = builder.buildContext("Add caching", "", files, new Map());

      expect(context.technicalApproach).toContain("Redis");
    });

    it("should infer file roles from file names", () => {
      const files: FileReviewTarget[] = [
        { path: "src/entity_locked_tests.rs", status: "added" },
        { path: "src/migrations/add_lock_table.sql", status: "added" },
        { path: "src/handlers/lock_handler.rs", status: "modified" },
        { path: "src/models/lock_entity.ts", status: "added" },
      ];

      const context = builder.buildContext(
        "Add entity locking",
        "",
        files,
        new Map(),
      );

      expect(context.fileRoles.get("src/entity_locked_tests.rs")).toContain(
        "Test",
      );
      expect(
        context.fileRoles.get("src/migrations/add_lock_table.sql"),
      ).toContain("migration");
      expect(context.fileRoles.get("src/handlers/lock_handler.rs")).toContain(
        "handler",
      );
      expect(context.fileRoles.get("src/models/lock_entity.ts")).toContain(
        "model",
      );
    });

    it("should extract purpose from description when title is minimal", () => {
      const context = builder.buildContext(
        "PR-123",
        "This PR implements a new payment processing workflow with proper validation and error handling.",
        [],
        new Map(),
      );

      expect(context.purpose).toContain("payment");
    });
  });

  describe("formatForPrompt", () => {
    it("should format context into prompt sections", () => {
      const files: FileReviewTarget[] = [
        { path: "src/payment.ts", status: "added" },
      ];

      const context = builder.buildContext(
        "Add payment processing",
        "Implements payment workflow",
        files,
        new Map(),
      );

      const formatted = builder.formatForPrompt(context);

      expect(formatted).toContain("<feature-purpose>");
      expect(formatted).toContain("<technical-approach>");
    });

    it("should include file role when current file is specified", () => {
      const files: FileReviewTarget[] = [
        { path: "src/handlers/payment_handler.ts", status: "added" },
      ];

      const context = builder.buildContext(
        "Add payment handler",
        "",
        files,
        new Map(),
      );

      const formatted = builder.formatForPrompt(
        context,
        "src/handlers/payment_handler.ts",
      );

      expect(formatted).toContain("<file-role>");
      expect(formatted).toContain("handler");
    });

    it("should include domain concepts when found", () => {
      const files: FileReviewTarget[] = [
        { path: "src/payment_transaction.rs", status: "added" },
      ];

      const context = builder.buildContext(
        "Payment feature",
        "",
        files,
        new Map(),
      );

      const formatted = builder.formatForPrompt(context);

      if (context.domainConcepts.length > 0) {
        expect(formatted).toContain("<domain-concepts>");
      }
    });
  });

  describe("technical approach extraction", () => {
    it("should detect Redis from file path", () => {
      const files: FileReviewTarget[] = [
        { path: "src/redis/lock_manager.rs", status: "added" },
      ];

      const context = builder.buildContext(
        "Add Redis locking",
        "",
        files,
        new Map(),
      );

      expect(context.technicalApproach).toContain("Redis");
    });

    it("should detect async patterns from diff content", () => {
      const mockDiff = {
        hunks: [
          {
            sourceStart: 1,
            sourceLineCount: 5,
            destinationStart: 1,
            destinationLineCount: 5,
            lines: [
              {
                type: "ADDED",
                content: "async fn process_payment() {",
                source_line: null,
                destination_line: 1,
              },
              {
                type: "ADDED",
                content: "  let result = await fetch_data();",
                source_line: null,
                destination_line: 2,
              },
            ],
          },
        ],
      };

      const diffs = new Map([["src/payment.rs", mockDiff as any]]);

      const context = builder.buildContext("Add payment", "", [], diffs);

      expect(context.technicalApproach).toContain("Async");
    });
  });

  describe("file role inference", () => {
    it("should identify test files", () => {
      const files: FileReviewTarget[] = [
        { path: "src/entity_test.rs", status: "added" },
        { path: "tests/integration_test.ts", status: "modified" },
      ];

      const context = builder.buildContext("Tests", "", files, new Map());

      expect(context.fileRoles.get("src/entity_test.rs")).toContain("Test");
    });

    it("should identify query/repository files", () => {
      const files: FileReviewTarget[] = [
        { path: "src/queries/user_query.rs", status: "added" },
        { path: "src/repositories/payment_repo.ts", status: "modified" },
      ];

      const context = builder.buildContext("Add queries", "", files, new Map());

      // Query files should be identified as data access
      expect(context.fileRoles.get("src/queries/user_query.rs")).toContain(
        "Data access",
      );
      // Repo files should be identified as data access
      expect(
        context.fileRoles.get("src/repositories/payment_repo.ts"),
      ).toContain("Data access");
    });

    it("should identify service files", () => {
      const files: FileReviewTarget[] = [
        { path: "src/services/payment_service.ts", status: "added" },
      ];

      const context = builder.buildContext("Add service", "", files, new Map());

      expect(
        context.fileRoles.get("src/services/payment_service.ts"),
      ).toContain("Business logic");
    });
  });

  describe("edge cases", () => {
    it("should handle empty inputs gracefully", () => {
      const context = builder.buildContext("", "", [], new Map());

      expect(context.purpose).toBeDefined();
      expect(context.domainConcepts).toBeDefined();
      expect(context.technicalApproach).toBeDefined();
      expect(context.fileRoles).toBeDefined();
    });

    it("should handle special characters in PR title", () => {
      const context = builder.buildContext(
        "feat: Add user-authentication & payment processing!",
        "Fixes #123, #456",
        [],
        new Map(),
      );

      expect(context.purpose).toBeDefined();
    });

    it("should limit domain concepts to 5", () => {
      const files: FileReviewTarget[] = [
        { path: "src/payment.rs", status: "added" },
        { path: "src/transaction.rs", status: "added" },
        { path: "src/user.rs", status: "added" },
        { path: "src/account.rs", status: "added" },
        { path: "src/inventory.rs", status: "added" },
        { path: "src/booking.rs", status: "added" },
        { path: "src/order.rs", status: "added" },
      ];

      const context = builder.buildContext(
        "Multi-feature PR",
        "",
        files,
        new Map(),
      );

      expect(context.domainConcepts.length).toBeLessThanOrEqual(5);
    });
  });
});
