import * as fs from "fs";
import chalk from "chalk";
import { ProjectReport } from "@codepulse/shared";

interface CompareOptions {
  format: string;
  output?: string;
}

export async function compareCommand(
  oldReportPath: string,
  newReportPath: string,
  options: CompareOptions
) {
  try {
    // Load reports
    const oldReport: ProjectReport = JSON.parse(
      fs.readFileSync(oldReportPath, "utf-8")
    );
    const newReport: ProjectReport = JSON.parse(
      fs.readFileSync(newReportPath, "utf-8")
    );

    // Compare findings
    const oldFindingIds = new Set(oldReport.analysis.findings.map((f) => f.id));
    const newFindingIds = new Set(newReport.analysis.findings.map((f) => f.id));

    const newFindings = newReport.analysis.findings.filter(
      (f) => !oldFindingIds.has(f.id)
    );
    const resolvedFindings = oldReport.analysis.findings.filter(
      (f) => !newFindingIds.has(f.id)
    );

    // Generate comparison report
    console.log(chalk.bold("\nComparison Report"));
    console.log("=".repeat(60));
    console.log(`Old Report: ${oldReport.generatedAt}`);
    console.log(`New Report: ${newReport.generatedAt}`);
    console.log(`\nTotal Findings:`);
    console.log(
      `  Previous: ${oldReport.analysis.summary.totalFindings} findings`
    );
    console.log(`  Current:  ${newReport.analysis.summary.totalFindings} findings`);
    console.log(
      `  Change:   ${newReport.analysis.summary.totalFindings - oldReport.analysis.summary.totalFindings > 0 ? "+" : ""}${newReport.analysis.summary.totalFindings - oldReport.analysis.summary.totalFindings}`
    );

    if (newFindings.length > 0) {
      console.log(`\n${chalk.red(`${newFindings.length} new findings`)}`);
      newFindings.slice(0, 5).forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.severity}] ${f.title}`);
      });
      if (newFindings.length > 5) {
        console.log(`  ... and ${newFindings.length - 5} more`);
      }
    }

    if (resolvedFindings.length > 0) {
      console.log(`\n${chalk.green(`${resolvedFindings.length} resolved findings`)}`);
      resolvedFindings.slice(0, 5).forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.severity}] ${f.title}`);
      });
      if (resolvedFindings.length > 5) {
        console.log(`  ... and ${resolvedFindings.length - 5} more`);
      }
    }

    console.log("\n" + "=".repeat(60) + "\n");
  } catch (error) {
    console.error(chalk.red("Error comparing reports:"), error);
    process.exit(1);
  }
}
