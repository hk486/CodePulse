import * as path from "path";
import { validate, type ValidationSummary } from "../validation/harness";

export interface ValidateOptions {
  format?: string;
  output?: string;
  /** The folder the fixtures are in. */
  fixtures?: string;
}

/**
 * The fixtures that are shipped with the scanner.
 */
export function defaultFixtureRoot(): string {
  return path.resolve(__dirname, "..", "..", "fixtures", "validation");
}

/**
 * Run the fixtures and say how good the analyzers are.
 */
export async function validateCommand(
  options: ValidateOptions = {}
): Promise<ValidationSummary> {
  const root = options.fixtures
    ? path.resolve(options.fixtures)
    : defaultFixtureRoot();

  const summary = await validate(root);

  if (options.format === "json" && !options.output) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  console.log("");
  console.log("CodePulse validation");
  console.log("===================");
  console.log("");

  for (const fixture of summary.fixtures) {
    const status = fixture.error
      ? "ERROR"
      : fixture.falseNegatives.length === 0 && fixture.falsePositives.length === 0
        ? "PASS"
        : "PARTIAL";
    console.log(
      `${status.padEnd(8)} ${fixture.name.padEnd(24)} ` +
        `expected ${fixture.expected}, found ${fixture.detected}, ` +
        `precision ${(fixture.precision * 100).toFixed(0)}%, ` +
        `recall ${(fixture.recall * 100).toFixed(0)}%, ` +
        `${fixture.durationMs}ms`
    );
    for (const missed of fixture.falseNegatives) {
      console.log(`         missing: ${missed.ruleId} ${missed.file || ""}`);
    }
    for (const extra of fixture.falsePositives) {
      console.log(
        `         extra:   ${extra.ruleId} ${extra.location?.filePath || ""}:${extra.location?.startLine || 0}`
      );
    }
  }

  console.log("");
  console.log("By language");
  console.log("-----------");
  for (const [language, numbers] of Object.entries(summary.byLanguage)) {
    console.log(
      `${language.padEnd(14)} precision ${(numbers.precision * 100).toFixed(1)}%  ` +
        `recall ${(numbers.recall * 100).toFixed(1)}%  ` +
        `false positives ${numbers.falsePositives}  false negatives ${numbers.falseNegatives}`
    );
  }

  console.log("");
  console.log("In total");
  console.log("--------");
  console.log(`fixtures:             ${summary.totals.fixtures}`);
  console.log(`expected findings:    ${summary.totals.expected}`);
  console.log(`detected findings:    ${summary.totals.detected}`);
  console.log(`true positives:       ${summary.totals.truePositives}`);
  console.log(`false positives:      ${summary.totals.falsePositives}`);
  console.log(`false negatives:      ${summary.totals.falseNegatives}`);
  console.log(`precision:            ${(summary.totals.precision * 100).toFixed(1)}%`);
  console.log(`recall:               ${(summary.totals.recall * 100).toFixed(1)}%`);
  console.log(
    `language detection:   ${(summary.totals.languageDetectionAccuracy * 100).toFixed(1)}%`
  );
  console.log(
    `pipeline completion:  ${(summary.totals.pipelineCompletionRate * 100).toFixed(1)}%`
  );
  console.log(`time:                 ${summary.totals.durationMs}ms`);
  console.log("");

  if (options.output) {
    const outputPath = path.resolve(options.output);
    require("fs").writeFileSync(outputPath, JSON.stringify(summary, null, 2));
    console.log(`Report saved to ${outputPath}`);
  }

  return summary;
}
