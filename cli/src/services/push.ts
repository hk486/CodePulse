import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createArchive } from "./archive";

export interface PushOptions {
  /** The base URL of the CodePulse instance. */
  server: string;
  /** The bearer token of the signed in user. */
  token: string;
  /** The folder to push. */
  projectPath: string;
  /** The name of the project in CodePulse. */
  name: string;
  /** Print progress while working. */
  onProgress?: (message: string) => void;
  /** Fail when a finding at or above this severity is found. */
  failOn?: string;
  /** Fail when a finding the previous run did not have is found. */
  baseline?: string;
}

/** What the server said about the gate. */
export interface PushGate {
  failed: boolean;
  reason: string;
  offenders?: {
    severity: string;
    ruleId?: string;
    title?: string;
    filePath?: string;
    line?: number;
  }[];
}

export interface PushResult {
  projectId: string;
  analysisId: string | null;
  findingsCount: number;
  scannedFiles: number;
  languages: string[];
  components: number;
  reportUrl: string;
  analysisUrl: string;
  /** What the server said about the gate, when a gate was asked for. */
  gate?: PushGate;
}

/**
 * Push a local project to a running CodePulse instance.
 *
 * The folder is archived locally and sent as a single request, so a project
 * with tens of thousands of files still travels in one go and never has to
 * fit in memory.
 */
export async function pushProject(options: PushOptions): Promise<PushResult> {
  const { server, token, projectPath, name, onProgress } = options;
  const base = server.replace(/\/+$/, "");
  const log = onProgress ?? (() => undefined);

  // 1. Check the server is reachable and the token is valid
  log(`Checking ${base} ...`);
  const health = await fetch(`${base}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(
      `Could not reach the CodePulse server at ${base}. Check the address and that the server is running.`
    );
  }

  const profileResponse = await fetch(`${base}/api/auth/profile`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!profileResponse.ok) {
    throw new Error(
      "The token was not accepted. Sign in to CodePulse and copy a fresh API token."
    );
  }
  const profile = (await profileResponse.json()) as { email?: string };

  // 2. Create the project
  log(`Creating the project "${name}" ...`);
  const createResponse = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name, path: "", languages: ["auto"] }),
  });
  if (!createResponse.ok) {
    const error = (await createResponse.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error || `Could not create the project (HTTP ${createResponse.status}).`);
  }
  const project = (await createResponse.json()) as { id: string };

  // 3. Archive the folder
  const archivePath = path.join(
    os.tmpdir(),
    `codepulse-${Date.now()}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.tar.gz`
  );
  log("Archiving the project ...");
  const archive = await createArchive(projectPath, archivePath);
  log(`Archived ${archive.fileCount} files (${formatBytes(archive.size)})`);

  try {
    // 4. Upload the archive in one request
    log("Uploading ...");
    const form = new FormData();
    const blob = new Blob([fs.readFileSync(archivePath)], {
      type: "application/gzip",
    });
    form.append("files", blob, "project.tar.gz");

    const uploadResponse = await fetch(
      `${base}/api/projects/${project.id}/upload`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }
    );
    if (!uploadResponse.ok) {
      const error = (await uploadResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || `The upload failed (HTTP ${uploadResponse.status}).`);
    }
    const upload = (await uploadResponse.json()) as {
      count: number;
      skippedFiles?: string[];
      extracted?: boolean;
    };
    log(
      `Uploaded ${upload.count} files${upload.extracted ? " (archive extracted)" : ""}`
    );

    // 5. Ask for the analysis
    log("Analysing ...");
    const runResponse = await fetch(`${base}/api/analysis/run/${project.id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        failOn: options.failOn || undefined,
        baseline: options.baseline || undefined,
      }),
    });
    if (!runResponse.ok) {
      const error = (await runResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || `The analysis failed (HTTP ${runResponse.status}).`);
    }

    // The server answers straight away: the scan is a job, and the job id
    // is what comes back. The result is waited for here.
    const queued = (await runResponse.json()) as { id: string };
    if (!queued?.id) {
      throw new Error("The server did not give back an analysis to wait for.");
    }

    const analysis = await waitForAnalysis(base, token, queued.id, log);

    return {
      projectId: project.id,
      analysisId: analysis.id,
      findingsCount: analysis.findingsCount ?? 0,
      scannedFiles: analysis.scannedFiles ?? 0,
      // The open language set names every language that was found, even the
      // ones without a dedicated analyzer.
      languages:
        analysis.techStack?.languages?.length
          ? analysis.techStack.languages
          : analysis.detectedLanguages || [],
      components: (analysis.components || []).length,
      gate: analysis.gate,
      reportUrl: `${base}/analysis/${analysis.id}`,
      analysisUrl: `${base}/projects`,
    };
  } finally {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      // the temporary archive can stay
    }
  }
}

/** How long to wait for a scan before giving up. */
const WAIT_LIMIT_MS = 15 * 60 * 1000;

/**
 * Wait for a scan to finish.
 *
 * The scan is a job on the server, so the client asks how far along it is
 * until it says it is done. The progress is printed as it comes, so a long
 * scan does not look like a hang.
 */
async function waitForAnalysis(
  base: string,
  token: string,
  analysisId: string,
  log: (message: string) => void
): Promise<PushedAnalysis> {
  const started = Date.now();
  let lastStage = "";

  while (Date.now() - started < WAIT_LIMIT_MS) {
    const response = await fetch(`${base}/api/analysis/${analysisId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(error?.error || `Could not read the analysis (HTTP ${response.status}).`);
    }

    const analysis = (await response.json()) as PushedAnalysis & { status?: string };

    if (analysis.status === "completed") return analysis;
    if (analysis.status === "failed") {
      throw new Error(analysis.error || "The analysis did not finish.");
    }

    // Say what is happening, but only when it changes.
    const stage = analysis.stage || analysis.status || "working";
    if (stage !== lastStage) {
      lastStage = stage;
      log(`  ${stage}...`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error("The analysis took too long and was given up on.");
}

/** The shape of a finished analysis, as the server sends it. */
interface PushedAnalysis {
  id: string;
  status?: string;
  stage?: string;
  error?: string;
  findingsCount?: number;
  scannedFiles?: number;
  detectedLanguages?: string[];
  techStack?: { languages?: string[] };
  components?: unknown[];
  gate?: PushGate;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
