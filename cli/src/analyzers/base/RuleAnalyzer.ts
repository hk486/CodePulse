import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  FindingValidation,
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import * as path from "path";
import * as fs from "fs";
import { filesFor } from "../../services/fileIndex";
import { withEvidence } from "../../services/evidence";

/**
 * A single rule of a language analyzer.
 */
export interface Rule {
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  category: Category;
  confidence: Confidence;
  /** The line pattern that triggers the rule. */
  pattern: RegExp;
  /** Report the rule at most once per file. */
  once?: boolean;
  /** Apply the rule to comment lines as well (TODO markers, @ts-ignore). */
  matchComments?: boolean;
  /** Do not apply the rule to these lines (e.g. inside a string). */
  ignoreIf?: RegExp;
  /**
   * How sure the analyzer is, when the category alone does not say.
   * Without it the kind of finding is worked out from the category.
   */
  validation?: FindingValidation;
  /** Where to read more about this. */
  documentation?: string;
  /**
   * The snippet must not quote what it found. A finding about a
   * credential must not repeat the credential.
   */
  redact?: boolean;
}

/**
 * A finding produced by a whole-file check (rules that need more than one
 * line of context).
 */
export interface FileFinding {
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  category: Category;
  confidence: Confidence;
  line: number;
}

export interface FileContext {
  file: string;
  relativePath: string;
  content: string;
  lines: string[];
}

/**
 * Base class for the line based language analyzers.
 *
 * Every analyzer describes its rules as a table and the base class takes
 * care of finding the files, skipping comments and turning matches into
 * findings.
 */
export abstract class BaseRuleAnalyzer implements LanguageAnalyzer {
  abstract readonly id: string;

  /** The file types this analyzer reads. */
  get supportedExtensions(): string[] {
    return this.extensions;
  }
  abstract readonly language: string;
  abstract readonly displayName: string;
  readonly version = "1.0.0";
  readonly facet: Facet = Facet.CODE;

  /** The file extensions this analyzer owns. */
  abstract readonly extensions: string[];

  /** The rules of this analyzer. */
  abstract readonly rules: Rule[];

  /** Line prefixes that start a comment in this language. */
  abstract readonly commentPrefixes: string[];

  /** Rules that need more than a single line. */
  fileChecks?: ((context: FileContext) => FileFinding[])[];

  supports(context: ProjectContext): boolean {
    return context.detectedLanguages.includes(this.language);
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    // The files come from the shared index, so the tree is walked only once
    let files: string[] = [];
    try {
      const entries = await filesFor(context, this.extensions, context.projectPath);
      files = entries.map(entry => entry.path);
    } catch (error) {
      console.error(`Error finding ${this.language} files:`, error);
      return findings;
    }

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;

      const lines = content.split("\n");
      const fileContext: FileContext = {
        file,
        relativePath: file,
        content,
        lines,
      };

      findings.push(...this.applyRules(fileContext));
      findings.push(...this.applyFileChecks(fileContext));
    }

    return findings;
  }

  /**
   * Match the line rules against the file.
   */
  private applyRules(context: FileContext): Finding[] {
    const findings: Finding[] = [];
    const alreadyReported = new Set<string>();

    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i];

      for (const rule of this.rules) {
        if (rule.once && alreadyReported.has(rule.ruleId)) continue;
        if (rule.ignoreIf && rule.ignoreIf.test(line)) continue;
        if (!rule.matchComments && this.isComment(line)) continue;
        if (!rule.pattern.test(line)) continue;

        alreadyReported.add(rule.ruleId);
        findings.push(this.toFinding(rule, context.relativePath, i + 1, context.lines));
      }
    }

    return findings;
  }

  /**
   * Run the whole-file checks.
   */
  private applyFileChecks(context: FileContext): Finding[] {
    if (!this.fileChecks || this.fileChecks.length === 0) return []

    const findings: Finding[] = []
    for (const check of this.fileChecks) {
      let hits: FileFinding[] = []
      try {
        hits = check(context) || []
      } catch (error) {
        console.error(`File check failed for ${context.file}:`, error)
        continue
      }
      for (const hit of hits) {
        findings.push({
          id: `${this.language}-${hit.ruleId}-${hit.line}-${context.relativePath}`,
          ruleId: hit.ruleId,
          language: this.languageForFile(context.relativePath),
          category: hit.category,
          severity: hit.severity,
          confidence: hit.confidence,
          title: hit.title,
          description: hit.description,
          suggestedAction: hit.action,
          location: {
            filePath: context.relativePath,
            startLine: hit.line,
            endLine: hit.line,
          },
          tool: this.displayName,
          toolRuleId: hit.ruleId,
        })
      }
    }
    return findings
  }

  /**
   * The language reported for a file. Analyzers that cover more than one
   * language override this.
   */
  protected languageForFile(_file: string): string {
    return this.language
  }

  private toFinding(
    rule: Rule,
    filePath: string,
    line: number,
    lines?: string[]
  ): Finding {
    return withEvidence(
      {
        id: `${this.language}-${rule.ruleId}-${line}-${filePath}`,
        ruleId: rule.ruleId,
        language: this.languageForFile(filePath),
        category: rule.category,
        severity: rule.severity,
        confidence: rule.confidence,
        title: rule.title,
        description: rule.description,
        suggestedAction: rule.action,
        location: {
          filePath,
          startLine: line,
          endLine: line,
        },
        tool: this.displayName,
        toolRuleId: rule.ruleId,
        validation: rule.validation,
        documentation: rule.documentation,
      },
      { lines, redact: rule.redact }
    );
  }

  /**
   * Find blocks that open and close straight away, for example an empty
   * `catch (...) { }` spread over two lines.
   */
  protected findEmptyBlocks(
    context: FileContext,
    openPattern: RegExp,
    maxLines = 4
  ): number[] {
    const lines: number[] = []
    for (let i = 0; i < context.lines.length; i++) {
      const line = context.lines[i]
      if (this.isComment(line)) continue
      if (!openPattern.test(line)) continue

      // Start counting from the brace that opens the block, so a leading
      // "}" that closes the enclosing block is not counted.
      const match = openPattern.exec(context.lines[i])
      if (!match) continue
      const openIndex = context.lines[i].indexOf("{", match.index + match[0].length - 1)
      if (openIndex < 0) continue

      let depth = 1
      let empty = true
      let closed = false

      for (let j = i; j < Math.min(context.lines.length, i + maxLines + 1) && !closed; j++) {
        const current = context.lines[j]
        const from = j === i ? openIndex + 1 : 0

        for (let k = from; k < current.length; k++) {
          const char = current[k]
          if (char === "{") {
            depth++
          } else if (char === "}") {
            depth--
            if (depth === 0) {
              if (empty) lines.push(i + 1)
              closed = true
              break
            }
          }
        }

        // Any content other than braces means the block is not empty.
        // Only the part inside the block counts.
        const inside = current.slice(from).replace(/[{}]/g, "").trim()
        if (inside.length > 0) empty = false
      }
    }
    return lines
  }

  /**
   * Is this line a comment (or blank)?
   */
  protected isComment(line: string): boolean {
    const trimmed = line.trim()
    if (trimmed.length === 0) return true
    return this.commentPrefixes.some(prefix => trimmed.startsWith(prefix))
  }
}
