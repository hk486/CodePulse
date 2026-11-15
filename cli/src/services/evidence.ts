import * as crypto from "crypto";
import {
  Category,
  Severity,
  FindingValidation,
  type Finding,
} from "@codepulse/shared";

/**
 * The evidence a finding carries.
 *
 * A finding is only worth something if it can be traced back to the code
 * that caused it. This works out a name for it that stays the same from
 * one run to the next, keeps the line of code it is about, and says how
 * sure the analyzer is.
 */

/**
 * A stable name for a finding.
 *
 * It is worked out from the rule, the place and the code, so the same
 * problem has the same name in every run. That is what makes it possible
 * to tell a new finding from an old one, and to notice when two rules
 * found the same thing.
 */
export function fingerprintFor(options: {
  ruleId?: string;
  filePath?: string;
  line?: number;
  snippet?: string;
}): string {
  // The line is left out of the name on purpose: when the code above a
  // finding moves, the finding has not moved. The code itself is what
  // tells them apart.
  const parts = [
    options.ruleId || "unknown",
    (options.filePath || "").replace(/\\/g, "/"),
    normaliseSnippet(options.snippet),
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * The code of a finding, with the spacing and the line endings put right,
 * so two copies of the same code have the same name.
 */
function normaliseSnippet(snippet?: string): string {
  if (!snippet) return "";
  return snippet.replace(/\s+/g, " ").trim();
}

/**
 * The line of code a finding is about.
 */
export function snippetFor(
  lines: string[] | undefined,
  line: number | undefined
): string | undefined {
  if (!lines || !line || line < 1 || line > lines.length) return undefined;
  const text = lines[line - 1];
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  // A very long line is cut, because the whole of it is not read anyway.
  return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
}

/**
 * How sure the analyzer is, and what kind of thing it found.
 *
 * A rule can say what it is. When it does not, it is worked out from what
 * the rule is about: a security rule is a warning, a rule about the shape
 * of the code is a suggestion, and everything else is a possible problem.
 */
export function validationFor(options: {
  category?: Category | string;
  severity?: Severity | string;
  /** What the rule says about itself. */
  declared?: FindingValidation;
}): FindingValidation {
  if (options.declared) return options.declared;

  const category = String(options.category || "");
  const severity = String(options.severity || "");

  if (category === Category.SECURITY) {
    // A critical security finding with a precise pattern behind it is
    // more than a warning.
    if (severity === Severity.CRITICAL) return FindingValidation.CONFIRMED;
    return FindingValidation.SECURITY_WARNING;
  }

  if (
    category === Category.BEST_PRACTICE ||
    category === Category.CODE_QUALITY ||
    category === Category.COMPLEXITY ||
    category === Category.PERFORMANCE ||
    category === Category.MAINTAINABILITY ||
    category === Category.DUPLICATION
  ) {
    return FindingValidation.RECOMMENDATION;
  }

  if (category === Category.TEST_COVERAGE) {
    return FindingValidation.RECOMMENDATION;
  }

  if (severity === Severity.CRITICAL) return FindingValidation.CONFIRMED;
  return FindingValidation.POTENTIAL;
}

/**
 * Take the secret out of a line of code.
 *
 * A report about a credential must not repeat the credential, because the
 * report is written to a database, sent to a browser and often emailed.
 * The line stays, so the place is still obvious, but the part that is
 * the secret is replaced.
 */
export function redactSnippet(line: string): string {
  const text = String(line || "");
  const redacted = text
    .replace(
      /\b(pass(?:word|wd)?|secret(?:[_-]?key)?|token|api[_-]?key|access[_-]?key|private[_-]?key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}]+)/gi,
      "$1$2[redacted]"
    )
    .replace(/(['"])([^'"]{8,})\1/g, '$1[redacted]$1')
    .replace(/[A-Za-z0-9_-]{16,}/g, '[redacted]');
  return redacted.slice(0, 240);
}

/**
 * Put the evidence on a finding.
 *
 * Everything the finding knows about itself is set here, so every analyzer
 * produces the same shape whether it read the code or matched a pattern.
 */
export function withEvidence(
  finding: Finding,
  options: {
    lines?: string[];
    validation?: FindingValidation;
    documentation?: string;
    rootCause?: string;
    impact?: string;
    evidence?: string;
    detectedAt?: string;
    /** The snippet must not quote what it found. */
    redact?: boolean;
  } = {}
): Finding {
  let snippet =
    finding.snippet ?? snippetFor(options.lines, finding.location?.startLine);

  // A finding about a credential must not repeat the credential.
  if (options.redact && snippet) {
    snippet = redactSnippet(snippet);
  }

  const validation =
    options.validation ??
    finding.validation ??
    validationFor({
      category: finding.category,
      severity: finding.severity,
    });

  const fingerprint =
    finding.fingerprint ??
    fingerprintFor({
      ruleId: finding.ruleId,
      filePath: finding.location?.filePath,
      line: finding.location?.startLine,
      snippet,
    });

  return {
    ...finding,
    snippet,
    validation,
    fingerprint,
    detectedAt: finding.detectedAt ?? options.detectedAt ?? new Date().toISOString(),
    documentation: finding.documentation ?? options.documentation,
    rootCause: finding.rootCause ?? options.rootCause,
    impact: finding.impact ?? options.impact,
    evidence: finding.evidence ?? options.evidence,
  };
}
