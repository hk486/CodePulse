import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { Finding } from "@codepulse/shared";
import { findFixtures, readTruth, type Truth } from "./truth";

export interface ScanOutcome {
  ok: boolean;
  durationMs: number;
  findings: Finding[];
  detectedLanguages: string[];
  analyzers: {
    id: string;
    name: string;
    status: string;
    findingCount: number;
  }[];
  stages: { name: string; status: string }[];
  error?: string;
  stderr?: string;
}

export interface Match {
  expected: Truth["expected"][number];
  found?: Finding;
}

export interface FixtureResult {
  fixture: string;
  name: string;
  language: string;
  expected: number;
  detected: number;
  truePositives: Match[];
  falsePositives: Finding[];
  falseNegatives: Truth["expected"];
  precision: number;
  recall: number;
  languageDetectionCorrect: boolean;
  durationMs: number;
  pipelineCompleted: boolean;
  error?: string;
}

export interface ValidationSummary {
  fixtures: FixtureResult[];
  byLanguage: Record<
    string,
    {
      expected: number;
      detected: number;
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
      precision: number;
      recall: number;
      falsePositiveRate: number;
      falseNegativeRate: number;
    }
  >;
  totals: {
    fixtures: number;
    expected: number;
    detected: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    falsePositiveRate: number;
    falseNegativeRate: number;
    analyzerSuccessRate: number;
    analyzersRun: number;
    analyzersFailed: number;
    analyzersUnavailable: number;
    languageDetectionAccuracy: number;
    pipelineCompletionRate: number;
    durationMs: number;
  };
}

/**
 * Run the scanner over a folder and read what it says.
 */
export async function runScan(
  projectPath: string,
  options: { cwd?: string; command?: string } = {}
): Promise<ScanOutcome> {
  const cwd = options.cwd || path.resolve(__dirname, "..", "..");
  const command =
    options.command ||
    (fs.existsSync(path.join(cwd, "dist", "cli.js"))
      ? process.execPath
      : "npx");
  const args =
    options.command || fs.existsSync(path.join(cwd, "dist", "cli.js"))
      ? [path.join(cwd, "dist", "cli.js"), "scan", projectPath, "--format", "json"]
      : ["ts-node", path.join(cwd, "src", "cli.ts"), "scan", projectPath, "--format", "json"];

  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      resolve({
        ok: false,
        durationMs: Date.now() - started,
        findings: [],
        detectedLanguages: [],
        analyzers: [],
        stages: [],
        error: error.message,
        stderr,
      });
    });
    child.on("close", () => {
      const durationMs = Date.now() - started;
      let parsed: any = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        const match = stdout.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
          } catch {
            parsed = null;
          }
        }
      }
      if (!parsed) {
        resolve({
          ok: false,
          durationMs,
          findings: [],
          detectedLanguages: [],
          analyzers: [],
          stages: [],
          error: "The scan did not produce a report.",
          stderr,
        });
        return;
      }
      resolve({
        ok: true,
        durationMs,
        findings: parsed.analysis?.findings || [],
        detectedLanguages: parsed.detectedLanguages || [],
        analyzers:
          parsed.pipeline?.analyzers ||
          parsed.analysis?.analyzerExecutions ||
          [],
        stages: parsed.pipeline?.stages || [],
        stderr,
      });
    });
  });
}

/**
 * Does this finding match what was expected?
 */
function matches(finding: Finding, expected: Truth["expected"][number]) {
  if (finding.ruleId !== expected.ruleId) return false;
  if (expected.file) {
    const file = (finding.location?.filePath || "").replace(/\\/g, "/");
    const wanted = expected.file.replace(/\\/g, "/").replace(/^\.\//, "");
    if (file !== wanted && !file.endsWith(`/${wanted}`)) return false;
  }
  if (expected.line !== undefined) {
    if (finding.location?.startLine !== expected.line) return false;
  }
  return true;
}

/**
 * Compare one scan with what it was supposed to find.
 */
export function compare(outcome: ScanOutcome, truth: Truth): FixtureResult {
  const truePositives: Match[] = [];
  const falseNegatives: Truth["expected"] = [];
  const used = new Set<number>();

  for (const expected of truth.expected) {
    let index = outcome.findings.findIndex(
      (finding, position) => !used.has(position) && matches(finding, expected)
    );
    if (index === -1) {
      index = outcome.findings.findIndex((finding) => matches(finding, expected));
    }
    if (index === -1) {
      falseNegatives.push(expected);
      continue;
    }
    used.add(index);
    truePositives.push({ expected, found: outcome.findings[index] });
  }

  const falsePositives = outcome.findings.filter((_, index) => !used.has(index));

  const expectedCount = truth.expected.length;
  const precision =
    outcome.findings.length === 0
      ? expectedCount === 0
        ? 1
        : 0
      : truePositives.length / outcome.findings.length;
  const recall =
    expectedCount === 0
      ? outcome.findings.length === 0
        ? 1
        : 0
      : truePositives.length / expectedCount;

  const languageDetectionCorrect = truth.languages
    ? truth.languages.every((language) => outcome.detectedLanguages.includes(language))
    : outcome.detectedLanguages.includes(truth.language);

  const pipelineCompleted =
    outcome.stages.length > 0 &&
    outcome.stages.every((stage) => stage.status === "completed");

  return {
    fixture: truth.name,
    name: truth.name,
    language: truth.language,
    expected: expectedCount,
    detected: outcome.findings.length,
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    languageDetectionCorrect,
    durationMs: outcome.durationMs,
    pipelineCompleted,
    error: outcome.error,
  };
}

/**
 * Run every fixture and work out how good the analyzers are.
 */
export async function validate(
  root: string,
  options: { cwd?: string } = {}
): Promise<ValidationSummary> {
  const fixtures = findFixtures(root);
  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    const truth = readTruth(fixture);
    const outcome = await runScan(fixture, options);
    results.push(compare(outcome, truth));
  }

  return summarise(results);
}

/**
 * The numbers.
 */
export function summarise(fixtures: FixtureResult[]): ValidationSummary {
  const byLanguage: ValidationSummary["byLanguage"] = {};
  let expected = 0;
  let detected = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let languageCorrect = 0;
  let pipelineCompleted = 0;
  let durationMs = 0;

  for (const result of fixtures) {
    const language = result.language;
    if (!byLanguage[language]) {
      byLanguage[language] = {
        expected: 0,
        detected: 0,
        truePositives: 0,
        falsePositives: 0,
        falseNegatives: 0,
        precision: 0,
        recall: 0,
        falsePositiveRate: 0,
        falseNegativeRate: 0,
      };
    }
    const bucket = byLanguage[language];
    bucket.expected += result.expected;
    bucket.detected += result.detected;
    bucket.truePositives += result.truePositives.length;
    bucket.falsePositives += result.falsePositives.length;
    bucket.falseNegatives += result.falseNegatives.length;

    expected += result.expected;
    detected += result.detected;
    truePositives += result.truePositives.length;
    falsePositives += result.falsePositives.length;
    falseNegatives += result.falseNegatives.length;
    if (result.languageDetectionCorrect) languageCorrect++;
    if (result.pipelineCompleted) pipelineCompleted++;
    durationMs += result.durationMs;
  }

  for (const bucket of Object.values(byLanguage)) {
    bucket.precision =
      bucket.detected === 0
        ? bucket.expected === 0
          ? 1
          : 0
        : bucket.truePositives / bucket.detected;
    bucket.recall =
      bucket.expected === 0
        ? bucket.detected === 0
          ? 1
          : 0
        : bucket.truePositives / bucket.expected;
    bucket.falsePositiveRate =
      bucket.detected === 0 ? 0 : bucket.falsePositives / bucket.detected;
    bucket.falseNegativeRate =
      bucket.expected === 0 ? 0 : bucket.falseNegatives / bucket.expected;
  }

  const precision =
    detected === 0 ? (expected === 0 ? 1 : 0) : truePositives / detected;
  const recall =
    expected === 0 ? (detected === 0 ? 1 : 0) : truePositives / expected;

  return {
    fixtures,
    byLanguage,
    totals: {
      fixtures: fixtures.length,
      expected,
      detected,
      truePositives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      falsePositiveRate: detected === 0 ? 0 : falsePositives / detected,
      falseNegativeRate: expected === 0 ? 0 : falseNegatives / expected,
      analyzerSuccessRate: 0,
      analyzersRun: 0,
      analyzersFailed: 0,
      analyzersUnavailable: 0,
      languageDetectionAccuracy:
        fixtures.length === 0 ? 0 : languageCorrect / fixtures.length,
      pipelineCompletionRate:
        fixtures.length === 0 ? 0 : pipelineCompleted / fixtures.length,
      durationMs,
    },
  };
}
