import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import * as fs from "fs";
import { filesFor } from "../../services/fileIndex";

/**
 * A rule of the generic analyzer.
 */
interface Rule {
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  category: Category;
  confidence: Confidence;
  pattern: RegExp;
  once?: boolean;
  /** Apply the rule to comment lines as well. */
  matchComments?: boolean;
}

/**
 * Rules that hold in every language, from C to Zig to SQL.
 */
const UNIVERSAL_RULES: Rule[] = [
  {
    ruleId: "GEN-001",
    title: "Unfinished work marker",
    description: "A TODO/FIXME marker was committed instead of being resolved",
    action: "Resolve it or track it in your issue tracker",
    severity: Severity.LOW,
    category: Category.MAINTAINABILITY,
    confidence: Confidence.HIGH,
    pattern: /\b(TODO|FIXME|HACK|XXX)\b/,
    once: true,
    matchComments: true,
  },
  {
    ruleId: "GEN-003",
    title: "Merge conflict marker",
    description: "Unresolved conflict markers are committed in the file",
    action: "Resolve the merge conflict and commit the result",
    severity: Severity.HIGH,
    category: Category.MAINTAINABILITY,
    confidence: Confidence.HIGH,
    pattern: /^<{7}\s|\|{7}|^={7}\s|^>{7}\s/m,
    matchComments: true,
    once: true,
  },
  {
    ruleId: "GEN-004",
    title: "Very long line",
    description:
      "The line is unusually long, which hurts readability and diff review",
    action: "Split the line into smaller statements",
    severity: Severity.LOW,
    category: Category.CODE_QUALITY,
    confidence: Confidence.MEDIUM,
    pattern: /^.{201,}$/,
  },
  {
    ruleId: "GEN-005",
    title: "Debugging left in the code",
    description:
      "A debug print or breakpoint is usually left over from debugging",
    action: "Remove it or route it through a logger",
    severity: Severity.LOW,
    category: Category.CODE_QUALITY,
    confidence: Confidence.MEDIUM,
    pattern:
      /(^|[^\w.])(debugger\s*;|breakpoint\s*;|console\.debug\s*\(|std\.debug\.print\s*\(|fmt\.Print(ln|f)?\s*\(|System\.out\.print(ln)?\s*\(|printf\s*\(|println\s*\(|puts\s+|IO\.puts\s*\()/,
    once: true,
  },
];

/**
 * Rules that only make sense in languages with braces and a C-like syntax.
 */
const CODE_RULES: Rule[] = [
  {
    ruleId: "GEN-010",
    title: "var declaration used",
    description:
      "var is function scoped and hoisted, which makes the value harder to reason about",
    action: "Use let or const instead",
    severity: Severity.LOW,
    category: Category.CODE_QUALITY,
    confidence: Confidence.HIGH,
    // The type annotation is optional, so "var x = 1" and "var x: int = 1"
    // both match.
    pattern: /(^|[^\w.$])var\s+[A-Za-z_$][\w$]*\s*(:\s*[\w<>[\]\.,\s]+)?\s*[=;]/,
  },
  {
    ruleId: "GEN-011",
    title: "Loose null comparison",
    description:
      "== null also matches undefined and 0, so it is not a null check",
    action: "Compare the types explicitly",
    severity: Severity.LOW,
    category: Category.CODE_QUALITY,
    confidence: Confidence.MEDIUM,
    pattern: /[^=!<>]==\s*(null|undefined)\b/,
  },
  {
    ruleId: "GEN-012",
    title: "Empty error handler",
    description:
      "The catch block is empty, so the error is swallowed without a trace",
    action: "Log the error or re-throw it",
    severity: Severity.HIGH,
    category: Category.MAINTAINABILITY,
    confidence: Confidence.HIGH,
    pattern: /catch\s*(\([^)]*\))?\s*\{\s*\}/,
  },
  {
    ruleId: "GEN-013",
    title: "Dynamic code execution",
    description:
      "eval and new Function execute code at runtime and are a common injection vector",
    action: "Replace with an explicit lookup",
    severity: Severity.CRITICAL,
    category: Category.SECURITY,
    confidence: Confidence.HIGH,
    pattern: /(^|[^\w.])(eval|new\s+Function)\s*\(/,
  },
];

/**
 * The extensions that a dedicated analyzer owns.
 *
 * Those files are skipped here, because the dedicated analyzer gives much
 * better findings for them. The generic analyzer exists for everything the
 * dedicated analyzers do not cover.
 */
const DEDICATED_EXTENSIONS = new Set([
  // Java and the JVM
  "java", "kt", "kts", "scala", "sc", "groovy", "gvy",
  // JavaScript and TypeScript
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs",
  // Python
  "py", "pyw",
  // Go, Rust, C, C++, C#
  "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp", "cs",
  // PHP, Ruby, Kotlin, Swift, Dart, Shell, SQL
  "php", "rb", "swift", "dart", "sh", "bash", "zsh", "sql",
]);

/**
 * The extensions of languages with a C-like syntax, where the code rules
 * apply.
 */
const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "vue", "svelte",
  "astro", "java", "kt", "kts", "scala", "sc", "groovy", "gvy", "clj",
  "cljs", "cljc", "go", "rs", "zig", "nim", "odin", "c3", "d", "cr", "c",
  "h", "cc", "cpp", "cxx", "hpp", "cs", "fs", "fsx", "php", "rb", "pl",
  "pm", "lua", "swift", "dart", "ex", "exs", "erl", "hrl", "hs", "lhs",
  "ml", "mli", "elm", "purs", "scm", "rkt", "m", "mm", "sol", "v", "sv",
  "vhdl", "asm", "s", "ada", "adb", "vb", "vbs", "bas", "frm", "f", "f90",
  "f95", "cob", "cobol", "pas", "pp", "dpr", "raku", "tcl", "jl", "r",
  "rex", "groovy", "gradle", "sh", "bash", "zsh", "fish", "ps1", "bat",
  "cmd", "coffee", "pug", "jade", "hbs", "ejs", "tpl", "twig", "jinja",
  "j2", "ipynb", "ipy", "rmd", "gd", "gml", "htm", "html", "css", "scss",
  "sass", "less", "styl",
]);

/**
 * The generic analyzer.
 *
 * It is the safety net for every project: it runs on every file, in every
 * language, including the ones that have no dedicated analyzer. The rules
 * that hold everywhere always apply, the code specific ones only apply to
 * languages they make sense in.
 */
export class GenericSourceAnalyzer implements LanguageAnalyzer {
  readonly id = "generic-source-analyzer-v2";
  readonly language = "generic";
  readonly displayName = "Generic Source Analyzer";
  readonly facet = Facet.CONFIG;
  readonly version = "1.0.0";

  supports(_context: ProjectContext): boolean {
    return true;
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Every file is a candidate, in every language
    const entries = await filesFor(context, [], context.projectPath);

    for (const entry of entries) {
      // A dedicated analyzer covers these files better
      if (DEDICATED_EXTENSIONS.has(entry.extension)) continue;

      let content: string;
      try {
        content = fs.readFileSync(entry.absolutePath, "utf-8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;

      const lines = content.split("\n");
      const isCode = CODE_EXTENSIONS.has(entry.extension);
      const rules = isCode ? [...UNIVERSAL_RULES, ...CODE_RULES] : UNIVERSAL_RULES;
      const alreadyReported = new Set<string>();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 4000) continue;

        for (const rule of rules) {
          if (rule.once && alreadyReported.has(rule.ruleId)) continue;
          if (!rule.matchComments && isCommentLine(line)) continue;
          if (!rule.pattern.test(line)) continue;

          alreadyReported.add(rule.ruleId);
          findings.push({
            id: `generic-${rule.ruleId}-${i + 1}-${entry.path}`,
            ruleId: rule.ruleId,
            language: entry.extension,
            category: rule.category,
            severity: rule.severity,
            confidence: rule.confidence,
            title: rule.title,
            description: rule.description,
            suggestedAction: rule.action,
            location: {
              filePath: entry.path,
              startLine: i + 1,
              endLine: i + 1,
            },
            tool: this.displayName,
            toolRuleId: rule.ruleId,
          });
        }
      }
    }

    return findings;
  }
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("--")
  );
}
