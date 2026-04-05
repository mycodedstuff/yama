/**
 * Report Generator for Yama V2
 * Writes AI-generated reports to files
 *
 * In report mode, the AI directly generates the report content.
 * This class handles writing that content to a file.
 */

import { writeFile, mkdir, readFile } from "fs/promises";
import { dirname } from "path";

export class ReportGenerator {
  /**
   * Write AI response directly to file
   */
  async writeReportFromAIResponse(
    response: string,
    path: string,
  ): Promise<void> {
    // Handle stdout
    if (path === "-") {
      console.log(response);
      return;
    }

    // Ensure directory exists
    const dir = dirname(path);
    await mkdir(dir, { recursive: true });

    // Write file (trim to remove leading/trailing whitespace from AI output)
    await writeFile(path, response.trim(), "utf-8");
  }

  /**
   * Generate default report path
   * @param prId - Pull request ID
   * @param timestamp - Optional timestamp (defaults to now)
   * @param repository - Optional repository name for filename prefix
   */
  generateDefaultPath(
    prId: number | string,
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

    const repoPrefix = repository ? `${repository}-` : "";
    return `.yama/reports/${repoPrefix}pr-${prId}-${tsStr}.md`;
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
}

export function createReportGenerator(): ReportGenerator {
  return new ReportGenerator();
}
