import fs from "fs";
import path from "path";
import {
  Severity,
  Category,
  Confidence,
  FindingValidation,
  Facet,
  type Finding,
} from "@codepulse/shared";
import { toolFinding, type ToolDefinition, type ToolContext } from "./runner";

/**
 * The tools that are run against the project.
 *
 * Each one knows how to read its own output, and each one says what it
 * found in the same shape as everything else. A tool that is not
 * installed is recorded as unavailable; it is never faked.
 */

/**
 * The TypeScript compiler.
 *
 * This is the one that knows the types: it follows the imports, works
 * out what every value really is, and says when a call does not fit. No
 * pattern over the text can do that.
 */
export const tscTool: ToolDefinition = {
  id: "tsc",
  name: "TypeScript Compiler",
  command: "tsc",
  extensions: ["ts", "tsx", "mts", "cts"],
  languages: ["typescript", "javascript"],
  timeoutMs: 180000,
  documentation: "https://www.typescriptlang.org/docs/handbook/compiler-api.html",
  args: (context) => {
    const files = context.files
      .filter((file) => ["ts", "tsx", "mts", "cts"].includes(file.extension.toLowerCase()))
      .map((file) => file.path);

    // The project's own settings are used when it has them, because they
    // are the ones the project actually builds with.
    const config = findConfig(context.projectPath);
    if (config) {
      return ["--noEmit", "--pretty", "false", "-p", config];
    }
    return [
      "--noEmit",
      "--pretty",
      "false",
      "--skipLibCheck",
      "--target",
      "es2020",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      "--jsx",
      "react-jsx",
      ...files,
    ];
  },
  parse: (output, context) => {
    const findings: Finding[] = [];

    // file.ts(12,5): error TS2345: The message.
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;

    for (const raw of output.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const match = pattern.exec(line);
      if (!match) continue;

      const [, filePath, row, , level, code, message] = match;
      if (!filePath || !row || !code || !message) continue;

      // A file outside the project is not part of the analysis.
      if (!filePath || filePath.includes("node_modules")) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: tscTool,
          ruleId: code,
          title: message.split("\n")[0].slice(0, 160),
          description: message,
          action: "Change the code so the types fit.",
          severity: level === "warning" ? Severity.MEDIUM : Severity.HIGH,
          category: Category.CODE_QUALITY,
          confidence: Confidence.HIGH,
          filePath: relative,
          line: Number(row),
          context,
          // The compiler worked the types out. It is not a guess.
          validation: FindingValidation.CONFIRMED,
        })
      );
    }

    return findings;
  },
};

/**
 * Ruff, the Python linter and checker.
 */
export const ruffTool: ToolDefinition = {
  id: "ruff",
  name: "Ruff",
  command: "ruff",
  extensions: ["py", "pyi"],
  languages: ["python"],
  timeoutMs: 60000,
  documentation: "https://docs.astral.sh/ruff/rules/",
  // The rules that are worth having: the errors, the unused names, the
  // security ones and the ones that catch a real mistake.
  args: () => [
    "check",
    "--select",
    "E,F,S,B",
    "--output-format",
    "json",
    "--no-cache",
    "."
  ],
  parse: (output, context) => {
    const findings: Finding[] = [];
    let parsed: any[];
    try {
      parsed = JSON.parse(output);
    } catch {
      return findings;
    }
    if (!Array.isArray(parsed)) return findings;

    for (const entry of parsed) {
      const code = String(entry?.code || "RUFF");
      const message = String(entry?.message || "A problem was found.");
      const filePath = String(entry?.filename || "");
      const row = Number(entry?.location?.row || 0);
      if (!filePath) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: ruffTool,
          ruleId: code,
          title: message.split("\n")[0].slice(0, 160),
          description: message,
          action: "Change the code so the rule is happy.",
          severity: severityFromLinter(code),
          category: categoryFromLinter(code),
          confidence: Confidence.HIGH,
          filePath: relative,
          line: row,
          context,
          validation: FindingValidation.STRONGLY_SUPPORTED,
        })
      );
    }

    return findings;
  },
};

/**
 * SQLFluff, which understands the dialects.
 */
export const sqlfluffTool: ToolDefinition = {
  id: "sqlfluff",
  name: "SQLFluff",
  command: "sqlfluff",
  extensions: ["sql"],
  languages: ["sql"],
  timeoutMs: 60000,
  documentation: "https://docs.sqlfluff.com/en/stable/rules.html",
  args: () => ["lint", "--format", "json", "--dialect", "ansi", "."],
  parse: (output, context) => {
    const findings: Finding[] = [];
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch {
      return findings;
    }
    // The output is a list of files, each with the problems in it. The
    // name of the file is on the file, not on each problem.
    const files = Array.isArray(parsed) ? parsed : [parsed];
    const violations: any[] = [];
    for (const file of files) {
      if (!Array.isArray(file?.violations)) continue;
      for (const violation of file.violations) {
        violations.push({ ...violation, filepath: file.filepath });
      }
    }

    for (const entry of violations) {
      const code = String(entry?.code || "SQLF");
      const message = String(entry?.description || "A problem was found.");
      const filePath = String(entry?.filepath || entry?.file_path || "");
      const row = Number(entry?.start_line_no || entry?.line_no || 0);
      if (!filePath) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: sqlfluffTool,
          ruleId: code,
          title: message.split("\n")[0].slice(0, 160),
          description: message,
          action: "Change the query so the rule is happy.",
          severity: Severity.MEDIUM,
          category: Category.CODE_QUALITY,
          confidence: Confidence.HIGH,
          filePath: relative,
          line: row,
          context,
          validation: FindingValidation.STRONGLY_SUPPORTED,
          // A query is the database layer of the project.
          facet: Facet.DATABASE,
        })
      );
    }

    return findings;
  },
};

/**
 * ShellCheck, which knows the shell.
 */
export const shellcheckTool: ToolDefinition = {
  id: "shellcheck",
  name: "ShellCheck",
  command: "shellcheck",
  extensions: ["sh", "bash", "zsh", "ksh"],
  languages: ["shell"],
  timeoutMs: 60000,
  documentation: "https://www.shellcheck.net/wiki/SC1000",
  args: (context) => {
    const files = context.files
      .filter((file) => ["sh", "bash", "zsh", "ksh"].includes(file.extension.toLowerCase()))
      .map((file) => file.path);
    return ["--format=json", ...files];
  },
  parse: (output, context) => {
    const findings: Finding[] = [];
    let parsed: any[];
    try {
      parsed = JSON.parse(output);
    } catch {
      return findings;
    }
    if (!Array.isArray(parsed)) return findings;

    for (const entry of parsed) {
      const code = String(entry?.code || "SC");
      const message = String(entry?.message || "A problem was found.");
      const filePath = String(entry?.file || "");
      const row = Number(entry?.line || 0);
      if (!filePath) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: shellcheckTool,
          ruleId: code,
          title: message.split("\n")[0].slice(0, 160),
          description: message,
          action: "Change the script so the rule is happy.",
          severity: entry?.level === "error" ? Severity.HIGH : Severity.MEDIUM,
          category: Category.CODE_QUALITY,
          confidence: Confidence.HIGH,
          filePath: relative,
          line: row,
          context,
          validation: FindingValidation.STRONGLY_SUPPORTED,
        })
      );
    }

    return findings;
  },
};

/**
 * Cppcheck, which reads C and C++ for the memory mistakes.
 */
export const cppcheckTool: ToolDefinition = {
  id: "cppcheck",
  name: "Cppcheck",
  command: "cppcheck",
  extensions: ["c", "h", "cc", "cpp", "cxx", "hpp"],
  languages: ["cpp"],
  timeoutMs: 120000,
  documentation: "https://cppcheck.sourceforge.io/",
  args: (context) => [
    "--enable=warning,style,performance,portability",
    "--inline-suppr",
    "--template=gcc",
    "--quiet",
    context.projectPath,
  ],
  parse: (output, context) => {
    const findings: Finding[] = [];

    // file.c:12:5: warning: The message [ruleId]
    const pattern = /^(.+?):(\d+):(?:\d+:)?\s*(error|warning|style|performance|portability):\s*(.+?)\s*\[([A-Za-z0-9_]+)\]\s*$/;

    for (const raw of output.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const match = pattern.exec(line);
      if (!match) continue;

      const [, filePath, row, level, message, ruleId] = match;
      if (!filePath || !row || !message || !ruleId) continue;
      if (filePath.includes("node_modules")) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: cppcheckTool,
          ruleId: `CPP-${ruleId}`,
          title: message.slice(0, 160),
          description: message,
          action: "Change the code so the memory mistake goes away.",
          severity:
            level === "error"
              ? Severity.HIGH
              : level === "warning"
                ? Severity.MEDIUM
                : Severity.LOW,
          category: Category.SECURITY,
          confidence: Confidence.HIGH,
          filePath: relative,
          line: Number(row),
          context,
          validation: FindingValidation.STRONGLY_SUPPORTED,
        })
      );
    }

    return findings;
  },
};

/**
 * Gitleaks, which knows what a secret looks like.
 */
export const gitleaksTool: ToolDefinition = {
  id: "gitleaks",
  name: "Gitleaks",
  command: "gitleaks",
  timeoutMs: 120000,
  documentation: "https://github.com/gitleaks/gitleaks",
  // The secret itself is not written into the report.
  redact: true,
  args: (context) => [
    "detect",
    "--source",
    context.projectPath,
    "--report-format",
    "json",
    "--report-path",
    "-",
    "--no-banner",
    "--redact",
    // The uploaded project is a folder of files, not a git repository.
    "--no-git",
  ],
  parse: (output, context) => {
    const findings: Finding[] = [];
    let parsed: any[];
    try {
      parsed = JSON.parse(output);
    } catch {
      return findings;
    }
    if (!Array.isArray(parsed)) return findings;

    for (const entry of parsed) {
      const ruleId = String(entry?.RuleID || entry?.RuleID || "GITLEAK");
      const filePath = String(entry?.File || "");
      const row = Number(entry?.StartLine || 0);
      const message = String(entry?.Description || "A secret was found.");
      if (!filePath) continue;

      const relative = path.isAbsolute(filePath)
        ? path.relative(context.projectPath, filePath)
        : filePath;

      findings.push(
        toolFinding({
          tool: gitleaksTool,
          ruleId: `SEC-${ruleId}`,
          title: message.slice(0, 160),
          description: message,
          action: "Move the secret out of the code and into the place it belongs.",
          severity: Severity.HIGH,
          category: Category.SECURITY,
          confidence: Confidence.HIGH,
          filePath: relative,
          line: row,
          context,
          validation: FindingValidation.CONFIRMED,
        })
      );
    }

    return findings;
  },
};

/**
 * OSV-Scanner, which asks the vulnerability database whether a version
 * is known to be broken.
 */
export const osvTool: ToolDefinition = {
  id: "osv-scanner",
  name: "OSV-Scanner",
  command: "osv-scanner",
  timeoutMs: 180000,
  documentation: "https://google.github.io/osv-scanner/",
  args: (context) => [
    "scan",
    "source",
    "--format",
    "json",
    "--recursive",
    // The uploaded folder is not a git repository, so the ignore files
    // cannot be worked out.
    "--no-ignore",
    context.projectPath,
  ],
  parse: (output, context) => {
    const findings: Finding[] = [];
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch {
      return findings;
    }

    const results = parsed?.results || [];
    for (const result of Array.isArray(results) ? results : []) {
      const filePath = String(result?.source?.path || "");
      const relative = filePath
        ? path.isAbsolute(filePath)
          ? path.relative(context.projectPath, filePath)
          : filePath
        : "a lock file";

      // Every package that was found, and what is wrong with it.
      const packages = result?.packages || [];
      for (const entry of Array.isArray(packages) ? packages : []) {
        const packageName = String(entry?.package?.name || "a dependency");
        const version = String(entry?.package?.version || "");
        const vulnerabilities = entry?.vulnerabilities || [];

        for (const vulnerability of vulnerabilities) {
          const id = String(vulnerability?.id || "OSV");
          // People look for the CVE, so it is named when there is one.
          const aliases: string[] = Array.isArray(vulnerability?.aliases)
            ? vulnerability.aliases
            : [];
          const cve = aliases.find(alias => /^CVE-/i.test(alias)) || id;
          const summary = String(
            vulnerability?.summary || vulnerability?.details || "A known vulnerability."
          ).split("\n")[0];

          findings.push(
            toolFinding({
              tool: osvTool,
              ruleId: cve.startsWith('CVE-') ? cve : `CVE-${cve}`,
              title: `${packageName}${version ? ` ${version}` : ""} has a known vulnerability`,
              description: summary,
              action: "Move to a version that is not affected.",
              severity: Severity.HIGH,
              category: Category.DEPENDENCY,
              confidence: Confidence.HIGH,
              filePath: relative,
              context,
              validation: FindingValidation.CONFIRMED,
              documentation: `https://osv.dev/vulnerability/${id}`,
            })
          );
        }
      }
    }

    return findings;
  },
};

/**
 * Every tool that is run.
 */
export const TOOLS: ToolDefinition[] = [
  tscTool,
  ruffTool,
  sqlfluffTool,
  shellcheckTool,
  cppcheckTool,
  gitleaksTool,
  osvTool,
];

/**
 * The TypeScript project's own settings, when it has them.
 */
function findConfig(projectPath: string): string | undefined {
  for (const name of ["tsconfig.json", "tsconfig.app.json", "tsconfig.build.json"]) {
    const full = path.join(projectPath, name);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // Keep looking.
    }
  }
  return undefined;
}

/**
 * How bad a linter's finding is.
 */
function severityFromLinter(code: string): Severity {
  if (/^(?:E|F|S|B)/.test(code)) return Severity.HIGH;
  if (/^W/.test(code)) return Severity.MEDIUM;
  if (/^C4/.test(code)) return Severity.MEDIUM;
  return Severity.LOW;
}

/**
 * What kind of problem a linter's finding is.
 */
function categoryFromLinter(code: string): Category {
  if (/^S\d/.test(code)) return Category.SECURITY;
  if (/^(?:B|C4)/.test(code)) return Category.BEST_PRACTICE;
  if (/^E\d/.test(code)) return Category.CODE_QUALITY;
  return Category.CODE_QUALITY;
}
