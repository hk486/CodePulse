import * as fs from "fs";
import * as path from "path";

export interface ExpectedFinding {
  /** The rule that should fire. */
  ruleId: string;
  /** The file it should be in, relative to the fixture. */
  file?: string;
  /** The line it should be on. */
  line?: number;
  /** A note about why this is expected, for the report. */
  note?: string;
}

export interface Truth {
  /** The name of the fixture. */
  name: string;
  /** The language the fixture is written in. */
  language: string;
  /** What the scan should find. */
  expected: ExpectedFinding[];
  /** The languages the scan should say are there. */
  languages?: string[];
  /**
   * True when the project is clean and the scan should find nothing.
   * It is the same as an empty list of expected findings, but it is
   * written down so the intent is clear.
   */
  clean?: boolean;
  /** True when the project does not compile and the scan should say so. */
  expectCompilationError?: boolean;
}

/**
 * Read the ground truth of a fixture.
 */
export function readTruth(fixturePath: string): Truth {
  const file = path.join(fixturePath, "truth.json");
  const raw = fs.readFileSync(file, "utf-8");
  const parsed = JSON.parse(raw) as Truth;
  if (!parsed.name) parsed.name = path.basename(fixturePath);
  if (!parsed.language) parsed.language = "unknown";
  parsed.expected = parsed.expected || [];
  return parsed;
}

/**
 * Every fixture that has a ground truth.
 */
export function findFixtures(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(full);
        continue;
      }
      if (entry.name === "truth.json") {
        found.push(dir);
        return;
      }
    }
  };
  walk(root);
  return found.sort();
}
