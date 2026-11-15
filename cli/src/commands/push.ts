import * as path from "path";
import * as fs from "fs";
import { pushProject, formatBytes } from "../services/push";

interface PushOptions {
  server?: string;
  token?: string;
  name?: string;
  /** Fail when a finding at or above this severity is found. */
  failOn?: string;
  /** Fail when a finding the previous run did not have is found. */
  baseline?: string;
}

/**
 * Push a local project to a running CodePulse instance.
 *
 *   codepulse push ./my-project --server http://localhost:3000 --token <token>
 *
 * The project is archived locally and sent in a single request, so it works
 * for folders of any size and the source never has to fit in the browser.
 */
export async function pushCommand(
  projectPath: string = ".",
  options: PushOptions = {}
) {
  const resolved = path.resolve(projectPath);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    console.error(`✖ ${resolved} is not a folder.`);
    process.exitCode = 1;
    return;
  }

  const server = options.server || process.env.CODEPULSE_SERVER;
  const token = options.token || process.env.CODEPULSE_TOKEN;

  if (!server) {
    console.error(
      "✖ No server address. Use --server http://localhost:3000 or set CODEPULSE_SERVER."
    );
    process.exitCode = 1;
    return;
  }

  if (!token) {
    console.error(
      "✖ No token. Use --token <token> or set CODEPULSE_TOKEN.\n" +
        "  You can find your token in the CodePulse settings."
    );
    process.exitCode = 1;
    return;
  }

  const name = options.name || path.basename(resolved);

  try {
    const result = await pushProject({
      server,
      token,
      projectPath: resolved,
      name,
      failOn: options.failOn,
      baseline: options.baseline,
      onProgress: message => console.log(`  ${message}`),
    });

    console.log("");
    console.log(`✓ Pushed "${name}" to CodePulse`);
    console.log(`  Project     ${result.projectId}`);
    console.log(`  Files       ${result.scannedFiles} analysed`);
    console.log(`  Languages  ${result.languages.join(", ") || "none detected"}`);
    console.log(`  Components  ${result.components}`);
    console.log(`  Findings    ${result.findingsCount}`);
    console.log(`  Report      ${result.reportUrl}`);

    // The gate. The server ran the analysis and says whether the build
    // should hold.
    if (result.gate) {
      if (result.gate.failed) {
        console.error("");
        console.error(`✖ ${result.gate.reason}`);
        for (const offender of result.gate.offenders || []) {
          const where = offender.filePath
            ? `  ${offender.filePath}${offender.line ? `:${offender.line}` : ""}`
            : "";
          console.error(`  ${offender.severity} ${offender.ruleId || ""} ${offender.title || ""}${where}`);
        }
        process.exitCode = 1;
      } else {
        console.log(`  Gate        passed`);
      }
    }
  } catch (error) {
    console.error(
      `✖ ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
}
