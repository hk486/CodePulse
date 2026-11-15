import * as fs from "fs";
import * as path from "path";
import {
  Category,
  Confidence,
  FindingValidation,
  Severity,
  type Finding,
} from "@codepulse/shared";
import { fingerprintFor, redactSnippet } from "./evidence";

const SEVERITY_ORDER: Severity[] = [
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
  Severity.INFO,
];

const KNOWN_CATEGORIES = new Set<string>(Object.values(Category));
const KNOWN_CONFIDENCES = new Set<string>(Object.values(Confidence));

export interface NormalizationOutcome {
  findings: Finding[];
  repaired: number;
  issues: string[];
}

export function normalizeFindings(findings: Finding[]): NormalizationOutcome {
  const issues: string[] = [];
  let repaired = 0;

  const normalized = findings.map((finding) => {
    const next: Finding = { ...finding };
    const repairs: string[] = [];

    if (!next.ruleId) {
      next.ruleId = next.toolRuleId || "UNKNOWN";
      repairs.push("it had no rule id");
    }
    if (!next.toolRuleId) next.toolRuleId = next.ruleId;
    if (!next.tool) next.tool = "CodePulse";
    next.language = String(next.language || "unknown").toLowerCase();

    if (!KNOWN_CATEGORIES.has(next.category)) {
      next.category = Category.CODE_QUALITY;
      repairs.push("its category was not a known one");
    }
    if (!SEVERITY_ORDER.includes(next.severity)) {
      next.severity = normaliseSeverity(next.severity);
      repairs.push("its severity was not one of the five");
    }
    if (!next.confidence || !KNOWN_CONFIDENCES.has(next.confidence)) {
      next.confidence = Confidence.MEDIUM;
      repairs.push("it had no confidence");
    }

    if (!next.title) {
      next.title = next.ruleId;
      repairs.push("it had no title");
    }
    if (!String(next.description || "").trim()) {
      next.description = next.title;
      repairs.push("it had no description");
    }

    const filePath = String(next.location?.filePath || "").replace(/\\/g, "/");
    const startLine = toPositiveInt(next.location?.startLine, 1);
    if (!filePath) repairs.push("it had no file");
    next.location = {
      ...next.location,
      filePath,
      startLine,
      endLine: Math.max(startLine, toPositiveInt(next.location?.endLine, startLine)),
    };

    if (!next.snippet) repairs.push("it had no line of code");
    next.snippet = next.snippet?.trim() || undefined;
    next.detectedAt = next.detectedAt || new Date().toISOString();

    if (
      !next.validation ||
      !Object.values(FindingValidation).includes(next.validation)
    ) {
      next.validation = undefined;
    }

    if (!next.fingerprint) {
      next.fingerprint = fingerprintFor({
        ruleId: next.ruleId,
        filePath: next.location.filePath,
        line: next.location.startLine,
        snippet: next.snippet,
      });
    }
    next.id = `${next.tool}-${next.ruleId}-${next.fingerprint}`;

    if (repairs.length > 0) {
      repaired++;
      if (issues.length < 50) {
        issues.push(
          `${next.ruleId}@${next.location.filePath || "(no file)"} — ${repairs.join(", ")}`
        );
      }
    }

    return next;
  });

  return { findings: normalized, repaired, issues };
}

export function deduplicateFindings(findings: Finding[]): {
  findings: Finding[];
  removed: number;
  groups: number;
} {
  const byKey = new Map<string, Finding>();
  const order: string[] = [];
  let removed = 0;

  for (const finding of findings) {
    const key = duplicateKey(finding);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...finding });
      order.push(key);
      continue;
    }

    removed++;

    const rules = new Set(
      [existing.toolRuleId, finding.toolRuleId].filter(Boolean)
    );
    const named = Array.from(rules).join(", ");
    existing.toolRuleId = named;
    if (!existing.alsoFoundBy) existing.alsoFoundBy = [];
    for (const rule of rules) {
      if (rule !== named && !existing.alsoFoundBy.includes(rule)) {
        existing.alsoFoundBy.push(rule);
      }
    }

    if (severityRank(finding.severity) < severityRank(existing.severity)) {
      existing.severity = finding.severity;
    }
    for (const field of [
      "documentation",
      "rootCause",
      "impact",
      "suggestedAction",
      "snippet",
    ] as const) {
      if (!existing[field] && finding[field]) {
        (existing as unknown as Record<string, unknown>)[field] = finding[field];
      }
    }
  }

  return {
    findings: order.map((key) => byKey.get(key)!),
    removed,
    groups: order.length,
  };
}

export interface EvidenceOutcome {
  findings: Finding[];
  verified: number;
  unverified: number;
  problems: string[];
}

export function validateEvidence(
  findings: Finding[],
  projectPath: string
): EvidenceOutcome {
  const cache = new Map<string, string[] | null>();
  let verified = 0;
  let unverified = 0;
  const problems: string[] = [];

  const root = path.resolve(projectPath);

  const readLines = (relativePath: string): string[] | null => {
    if (cache.has(relativePath)) return cache.get(relativePath)!;
    let lines: string[] | null = null;
    try {
      const full = path.resolve(root, relativePath);
      if (full.startsWith(root)) {
        lines = fs.readFileSync(full, "utf-8").split("\n");
      }
    } catch {
      lines = null;
    }
    cache.set(relativePath, lines);
    return lines;
  };

  const checked = findings.map((finding) => {
    const filePath = finding.location?.filePath || "";
    const line = finding.location?.startLine || 0;

    if (!filePath) {
      unverified++;
      problems.push(`${finding.ruleId} has no file`);
      return degrade(finding, "The finding does not say which file it is about.");
    }

    const lines = readLines(filePath);
    if (!lines) {
      unverified++;
      problems.push(`${finding.ruleId}@${filePath} — the file was not found`);
      return degrade(
        finding,
        `The file ${filePath} was not found in the project, so the finding could not be checked.`
      );
    }

    if (line < 1 || line > lines.length) {
      unverified++;
      problems.push(
        `${finding.ruleId}@${filePath}:${line} — the line is outside the file`
      );
      return degrade(
        finding,
        `The line ${line} is outside ${filePath}, so the finding could not be checked.`
      );
    }

    const realLine = lines[line - 1].trim();
    const snippet = finding.snippet?.trim();
    const redactedLine = redactSnippet(realLine);
    if (
      snippet &&
      realLine &&
      !realLine.startsWith(snippet.slice(0, 40)) &&
      !redactedLine.startsWith(snippet.slice(0, 40))
    ) {
      unverified++;
      problems.push(
        `${finding.ruleId}@${filePath}:${line} — the code does not match the file`
      );
      return degrade(
        finding,
        `The code shown for ${filePath}:${line} does not match the file.`
      );
    }

    verified++;

    if (!snippet && realLine) {
      return {
        ...finding,
        snippet: realLine.length > 240 ? `${realLine.slice(0, 237)}...` : realLine,
      };
    }

    return finding;
  });

  return { findings: checked, verified, unverified, problems };
}

export interface ClassificationOutcome {
  findings: Finding[];
  bySeverity: Record<string, number>;
  byValidation: Record<string, number>;
}

export function classifyFindings(findings: Finding[]): ClassificationOutcome {
  const bySeverity: Record<string, number> = {};
  const byValidation: Record<string, number> = {};

  const classified = findings.map((finding) => {
    const severity = normaliseSeverity(finding.severity);
    const validation = finding.validation || validationFor(severity, finding.category);
    const confidence = confidenceFor(validation, finding.confidence);

    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    byValidation[validation] = (byValidation[validation] || 0) + 1;

    return { ...finding, severity, validation, confidence };
  });

  return { findings: classified, bySeverity, byValidation };
}

export function summariseFindings(findings: Finding[]) {
  const summary = {
    totalFindings: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    byCategory: {} as Record<string, number>,
    byLanguage: {} as Record<string, number>,
    byFacet: {} as Record<string, number>,
    byComponent: {} as Record<string, number>,
  };

  for (const finding of findings) {
    switch (finding.severity) {
      case Severity.CRITICAL:
        summary.critical++;
        break;
      case Severity.HIGH:
        summary.high++;
        break;
      case Severity.MEDIUM:
        summary.medium++;
        break;
      case Severity.LOW:
        summary.low++;
        break;
      case Severity.INFO:
        summary.info++;
        break;
    }

    summary.byCategory[finding.category] =
      (summary.byCategory[finding.category] || 0) + 1;
    summary.byLanguage[finding.language] =
      (summary.byLanguage[finding.language] || 0) + 1;
    if (finding.facet) {
      summary.byFacet[finding.facet] = (summary.byFacet[finding.facet] || 0) + 1;
    }
    if (finding.componentId) {
      summary.byComponent[finding.componentId] =
        (summary.byComponent[finding.componentId] || 0) + 1;
    }
  }

  return summary;
}

function confidenceFor(
  validation: FindingValidation,
  declared?: Confidence
): Confidence {
  switch (validation) {
    case FindingValidation.CONFIRMED:
      return Confidence.VERY_HIGH;
    case FindingValidation.STRONGLY_SUPPORTED:
      return Confidence.HIGH;
    case FindingValidation.SECURITY_WARNING:
      return Confidence.HIGH;
    case FindingValidation.POTENTIAL:
      return declared === Confidence.VERY_HIGH ? Confidence.HIGH : Confidence.MEDIUM;
    case FindingValidation.RECOMMENDATION:
      return Confidence.LOW;
    default:
      return declared || Confidence.MEDIUM;
  }
}

function validationFor(
  severity: Severity,
  category: Category | string
): FindingValidation {
  if (category === Category.SECURITY) {
    return severity === Severity.CRITICAL
      ? FindingValidation.CONFIRMED
      : FindingValidation.SECURITY_WARNING;
  }
  if (
    category === Category.SYNTAX_ERROR ||
    category === Category.TYPE_ERROR ||
    category === Category.COMPILATION_ERROR
  ) {
    return FindingValidation.CONFIRMED;
  }
  if (
    category === Category.CODE_QUALITY ||
    category === Category.COMPLEXITY ||
    category === Category.PERFORMANCE ||
    category === Category.MAINTAINABILITY ||
    category === Category.DUPLICATION ||
    category === Category.BEST_PRACTICE ||
    category === Category.TEST_COVERAGE
  ) {
    return FindingValidation.RECOMMENDATION;
  }
  if (severity === Severity.CRITICAL) return FindingValidation.CONFIRMED;
  return FindingValidation.POTENTIAL;
}

function degrade(finding: Finding, reason: string): Finding {
  return {
    ...finding,
    validation: FindingValidation.POTENTIAL,
    confidence: Confidence.LOW,
    evidence: finding.evidence ? `${finding.evidence}\n${reason}` : reason,
  };
}

function duplicateKey(finding: Finding): string {
  return [
    finding.ruleId || "unknown",
    (finding.location?.filePath || "").replace(/\\/g, "/"),
    finding.location?.startLine || 0,
    String(finding.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
  ].join("|");
}

function normaliseSeverity(value: unknown): Severity {
  const text = String(value || "").toUpperCase();
  if ((SEVERITY_ORDER as string[]).includes(text)) return text as Severity;
  switch (text) {
    case "ERROR":
    case "FATAL":
      return Severity.HIGH;
    case "WARNING":
    case "WARN":
      return Severity.MEDIUM;
    case "NOTE":
    case "INFO":
    case "HINT":
      return Severity.INFO;
    default:
      return Severity.MEDIUM;
  }
}

function severityRank(severity: Severity | string): number {
  const index = SEVERITY_ORDER.indexOf(
    String(severity).toUpperCase() as Severity
  );
  return index === -1 ? SEVERITY_ORDER.length : index;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.floor(number);
}

export { redactSnippet };
