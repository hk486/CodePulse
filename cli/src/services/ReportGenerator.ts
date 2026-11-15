import chalk from "chalk";
import * as fs from "fs";
import { ProjectReport, AnalysisResult } from "@codepulse/shared";

export class ReportGenerator {
  generateTextReport(report: ProjectReport): string {
    const lines: string[] = [];

    // Header
    lines.push("\n" + "=".repeat(60));
    lines.push(chalk.bold.blue("CODEPULSE ANALYSIS REPORT"));
    lines.push("=".repeat(60));

    // Project info
    lines.push(`\nProject: ${report.projectName}`);
    lines.push(`Path: ${report.projectPath}`);
    lines.push(`Languages: ${report.detectedLanguages.join(", ")}`);
    lines.push(`Generated: ${new Date(report.generatedAt).toISOString()}`);

    // Summary
    const summary = report.analysis.summary;
    lines.push("\n" + "-".repeat(60));
    lines.push(chalk.bold("Summary"));
    lines.push("-".repeat(60));
    lines.push(`Total Findings: ${summary.totalFindings}`);
    lines.push(
      `  ${chalk.red("Critical")}: ${summary.critical} | ${chalk.yellow("High")}: ${summary.high} | ${chalk.blue("Medium")}: ${summary.medium} | ${chalk.gray("Low")}: ${summary.low} | ${chalk.dim("Info")}: ${summary.info}`
    );

    // By Category
    if (Object.keys(summary.byCategory).length > 0) {
      lines.push("\nFindings by Category:");
      for (const [category, count] of Object.entries(summary.byCategory)) {
        lines.push(`  ${category}: ${count}`);
      }
    }

    // By Language
    if (Object.keys(summary.byLanguage).length > 0) {
      lines.push("\nFindings by Language:");
      for (const [language, count] of Object.entries(summary.byLanguage)) {
        lines.push(`  ${language}: ${count}`);
      }
    }

    // Analyzers run
    if (report.analysis.analyzersRun.length > 0) {
      lines.push("\nAnalyzers Executed:");
      for (const analyzer of report.analysis.analyzersRun) {
        lines.push(`  ✓ ${analyzer}`);
      }
    }

    // Failed analyzers
    if (report.analysis.failedAnalyzers?.length) {
      lines.push("\nFailed Analyzers:");
      for (const analyzer of report.analysis.failedAnalyzers) {
        lines.push(`  ✗ ${analyzer}`);
      }
    }

    // Top findings
    if (report.analysis.findings.length > 0) {
      lines.push("\n" + "-".repeat(60));
      lines.push(chalk.bold("Top 10 Findings"));
      lines.push("-".repeat(60));

      const topFindings = report.analysis.findings.slice(0, 10);
      for (let i = 0; i < topFindings.length; i++) {
        const finding = topFindings[i];
        const severityColor =
          finding.severity === "CRITICAL"
            ? chalk.red
            : finding.severity === "HIGH"
              ? chalk.yellow
              : chalk.blue;

        lines.push(
          `\n${i + 1}. ${severityColor(finding.severity)} - ${finding.title}`
        );
        lines.push(`   File: ${finding.location.filePath}`);
        lines.push(
          `   Lines: ${finding.location.startLine}-${finding.location.endLine}`
        );
        lines.push(`   Category: ${finding.category}`);
        lines.push(`   Tool: ${finding.tool}`);
        if (finding.suggestedAction) {
          lines.push(`   Action: ${finding.suggestedAction}`);
        }
      }

      if (report.analysis.findings.length > 10) {
        lines.push(
          `\n... and ${report.analysis.findings.length - 10} more findings`
        );
      }
    }

    // Execution time
    if (report.analysis.executionTime) {
      lines.push(
        `\nExecution Time: ${(report.analysis.executionTime / 1000).toFixed(2)}s`
      );
    }

    lines.push("\n" + "=".repeat(60) + "\n");

    return lines.join("\n");
  }

  generateHTMLReport(report: ProjectReport): string {
    const summary = report.analysis.summary;
    const severityCounts = {
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      info: summary.info,
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CodePulse Report - ${report.projectName}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 8px;
            margin-bottom: 30px;
        }
        h1 { font-size: 2.5em; margin-bottom: 10px; }
        .project-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-top: 15px;
            font-size: 0.9em;
            opacity: 0.9;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            text-align: center;
        }
        .summary-card h3 { font-size: 0.9em; color: #666; margin-bottom: 10px; text-transform: uppercase; }
        .summary-card .value { font-size: 2.5em; font-weight: bold; }
        .severity-distribution {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        .severity-distribution h2 { margin-bottom: 15px; }
        .severity-bar {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }
        .severity-item {
            flex: 1;
            text-align: center;
        }
        .severity-bar-fill {
            height: 30px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        .critical { background-color: #dc2626; }
        .high { background-color: #f59e0b; }
        .medium { background-color: #3b82f6; }
        .low { background-color: #10b981; }
        .info { background-color: #6b7280; }
        .findings-section {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .findings-section h2 { margin-bottom: 15px; }
        .finding {
            border-left: 4px solid #ccc;
            padding: 15px;
            margin-bottom: 15px;
            background: #fafafa;
            border-radius: 4px;
        }
        .finding.critical { border-left-color: #dc2626; }
        .finding.high { border-left-color: #f59e0b; }
        .finding.medium { border-left-color: #3b82f6; }
        .finding.low { border-left-color: #10b981; }
        .finding-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .finding-title { font-weight: bold; font-size: 1.1em; }
        .finding-severity {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            color: white;
        }
        .finding-severity.critical { background-color: #dc2626; }
        .finding-severity.high { background-color: #f59e0b; }
        .finding-severity.medium { background-color: #3b82f6; }
        .finding-severity.low { background-color: #10b981; }
        .finding-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            font-size: 0.9em;
            color: #666;
            margin-top: 10px;
        }
        .finding-meta-item { display: flex; flex-direction: column; }
        .finding-meta-label { font-weight: bold; }
        footer {
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            color: #999;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>CodePulse Analysis Report</h1>
            <div class="project-info">
                <div><strong>Project:</strong> ${escapeHtml(report.projectName)}</div>
                <div><strong>Generated:</strong> ${new Date(report.generatedAt).toISOString()}</div>
                <div><strong>Languages:</strong> ${escapeHtml(report.detectedLanguages.join(", "))}</div>
                <div><strong>Total Findings:</strong> ${summary.totalFindings}</div>
            </div>
        </header>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Critical</h3>
                <div class="value critical">${severityCounts.critical}</div>
            </div>
            <div class="summary-card">
                <h3>High</h3>
                <div class="value high">${severityCounts.high}</div>
            </div>
            <div class="summary-card">
                <h3>Medium</h3>
                <div class="value medium">${severityCounts.medium}</div>
            </div>
            <div class="summary-card">
                <h3>Low</h3>
                <div class="value low">${severityCounts.low}</div>
            </div>
        </div>

        ${
          report.analysis.findings.length > 0
            ? `
        <div class="findings-section">
            <h2>Top Findings</h2>
            ${report.analysis.findings
              .slice(0, 20)
              .map(
                (finding) => `
            <div class="finding ${finding.severity.toLowerCase()}">
                <div class="finding-header">
                    <div class="finding-title">${escapeHtml(finding.title)}</div>
                    <div class="finding-severity ${finding.severity.toLowerCase()}">
                        ${finding.severity}
                    </div>
                </div>
                <div class="finding-meta">
                    <div class="finding-meta-item">
                        <span class="finding-meta-label">File</span>
                        <span>${escapeHtml(finding.location.filePath)}</span>
                    </div>
                    <div class="finding-meta-item">
                        <span class="finding-meta-label">Lines</span>
                        <span>${finding.location.startLine}-${finding.location.endLine}</span>
                    </div>
                    <div class="finding-meta-item">
                        <span class="finding-meta-label">Category</span>
                        <span>${finding.category}</span>
                    </div>
                    <div class="finding-meta-item">
                        <span class="finding-meta-label">Tool</span>
                        <span>${finding.tool}</span>
                    </div>
                </div>
            </div>
            `
              )
              .join("")}
        </div>
        `
            : ""
        }

        <footer>
            <p>Generated by CodePulse v${report.cliVersion || "0.1.0"}</p>
        </footer>
    </div>
</body>
</html>`;
  }

  generateJSONReport(report: ProjectReport): string {
    return JSON.stringify(report, null, 2);
  }

  saveReport(report: ProjectReport, filePath: string, format: string): void {
    let content: string;

    switch (format.toLowerCase()) {
      case "json":
        content = this.generateJSONReport(report);
        break;
      case "html":
        content = this.generateHTMLReport(report);
        break;
      case "text":
      default:
        content = this.generateTextReport(report);
        break;
    }

    fs.writeFileSync(filePath, content);
  }
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
