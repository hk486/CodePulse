import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Worker } from "worker_threads";
import type {
  AnalysisConfiguration,
  Finding,
  LanguageAnalyzer,
  ProjectContext,
} from "@codepulse/shared";
import { analyzerKey } from "./analyzerCatalog";
import { startCollecting, stopCollecting } from "./fileIndex";

export interface AnalyzerOutcome {
  analyzer: LanguageAnalyzer;
  findings: Finding[];
  /** The files the analyzer really read. */
  filesRead: string[];
  error?: string;
  parallel: boolean;
}

export interface PoolOptions {
  concurrency?: number;
  enabled?: boolean;
  workerPath?: string;
}

export function defaultConcurrency(): number {
  const cpus = os.cpus()?.length || 2;
  return Math.max(1, Math.min(8, cpus - 1));
}

export function resolveWorkerPath(explicit?: string): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  candidates.push(path.join(__dirname, "..", "workers", "analyzer.worker.js"));
  candidates.push(
    path.join(__dirname, "..", "..", "src", "workers", "analyzer.worker.ts")
  );
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export async function runAnalyzers(
  analyzers: LanguageAnalyzer[],
  context: ProjectContext,
  config: AnalysisConfiguration,
  onProgress?: (completed: number) => void,
  options: PoolOptions = {}
): Promise<AnalyzerOutcome[]> {
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? defaultConcurrency(), analyzers.length)
  );

  if (concurrency <= 1 || options.enabled === false) {
    return runHere(analyzers, context, config, onProgress);
  }

  const workerPath = resolveWorkerPath(options.workerPath);
  if (!workerPath) {
    return runHere(analyzers, context, config, onProgress);
  }

  try {
    const pool = new WorkerPool(
      analyzers,
      context,
      config,
      workerPath,
      concurrency
    );
    return await pool.run(onProgress);
  } catch {
    return runHere(analyzers, context, config, onProgress);
  }
}

async function runHere(
  analyzers: LanguageAnalyzer[],
  context: ProjectContext,
  config: AnalysisConfiguration,
  onProgress?: (completed: number) => void
): Promise<AnalyzerOutcome[]> {
  const outcomes: AnalyzerOutcome[] = [];
  for (const analyzer of analyzers) {
    let findings: Finding[] = [];
    let filesRead: string[] = [];
    let error: string | undefined;
    try {
      startCollecting();
      try {
        findings = await analyzer.analyze(context, config);
      } finally {
        filesRead = stopCollecting();
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    outcomes.push({ analyzer, findings, filesRead, error, parallel: false });
    onProgress?.(outcomes.length);
  }
  return outcomes;
}

class WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private results = new Map<string, AnalyzerOutcome>();
  private failures = new Map<string, string>();
  private pending = new Map<number, { key: string; index: number }>();
  private nextJobId = 1;
  private queue: { key: string; index: number }[] = [];
  private completed = 0;
  private stopped = false;

  constructor(
    private analyzers: LanguageAnalyzer[],
    private context: ProjectContext,
    private config: AnalysisConfiguration,
    private workerPath: string,
    private concurrency: number
  ) {
    this.queue = analyzers.map((analyzer, index) => ({
      key: analyzerKey(analyzer),
      index,
    }));
  }

  run(onProgress?: (completed: number) => void): Promise<AnalyzerOutcome[]> {
    return new Promise((resolve, reject) => {
      const payload = {
        context: serialisableContext(this.context),
        config: this.config as unknown as Record<string, unknown>,
      };

      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        for (const worker of this.workers) void worker.terminate();
        resolve(this.collect());
      };

      const dispatch = () => {
        if (this.stopped) return;
        while (this.idle.length > 0 && this.queue.length > 0) {
          const worker = this.idle.pop()!;
          const job = this.queue.shift()!;
          const jobId = this.nextJobId++;
          this.pending.set(jobId, job);
          worker.postMessage({ id: jobId, key: job.key });
        }
        if (
          this.queue.length === 0 &&
          this.pending.size === 0 &&
          this.workers.length > 0
        ) {
          finish();
        }
      };

      const onMessage = (worker: Worker) => (chunk: {
        id: number;
        findings?: Finding[];
        filesRead?: string[];
        error?: string;
      }) => {
        const job = this.pending.get(chunk.id);
        this.pending.delete(chunk.id);
        if (!job) return;

        if (chunk.error) {
          this.failures.set(job.key, chunk.error);
        } else {
          this.results.set(job.key, {
            analyzer: this.analyzers[job.index],
            findings: chunk.findings || [],
            filesRead: chunk.filesRead || [],
            parallel: true,
          });
        }
        this.completed++;
        onProgress?.(this.completed);
        this.idle.push(worker);
        dispatch();
      };

      const onWorkerError = (worker: Worker) => (error: Error) => {
        for (const [jobId, job] of Array.from(this.pending.entries())) {
          this.pending.delete(jobId);
          this.failures.set(job.key, error?.message || "The worker thread stopped.");
          this.completed++;
          onProgress?.(this.completed);
        }
        this.workers = this.workers.filter((candidate) => candidate !== worker);
        this.idle = this.idle.filter((candidate) => candidate !== worker);
        if (this.workers.length === 0 && this.queue.length > 0) {
          void this.finishRemainder(onProgress).then(finish);
          return;
        }
        dispatch();
      };

      try {
        for (let i = 0; i < this.concurrency; i++) {
          const worker = new Worker(this.workerPath, {
            workerData: payload,
            env: process.env,
            execArgv: this.workerPath.endsWith(".ts")
              ? ["-r", "ts-node/register/transpile-only"]
              : [],
          });
          worker.on("message", onMessage(worker));
          worker.on("error", onWorkerError(worker));
          worker.on("exit", (code) => {
            if (code !== 0 && !settled && !this.stopped) {
              this.stopped = true;
              void this.finishRemainder(onProgress).then(finish);
            }
          });
          this.workers.push(worker);
          this.idle.push(worker);
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (this.workers.length === 0) {
        reject(new Error("No worker thread could be started."));
        return;
      }

      dispatch();
    });
  }

  private async finishRemainder(
    onProgress?: (completed: number) => void
  ): Promise<void> {
    for (const job of this.queue) {
      const analyzer = this.analyzers[job.index];
      let filesRead: string[] = [];
      try {
        startCollecting();
        try {
          const findings = await analyzer.analyze(this.context, this.config);
          this.results.set(job.key, {
            analyzer,
            findings,
            filesRead,
            parallel: false,
          });
        } finally {
          filesRead = stopCollecting();
        }
      } catch (error) {
        this.failures.set(
          job.key,
          error instanceof Error ? error.message : String(error)
        );
      }
      this.completed++;
      onProgress?.(this.completed);
    }
    this.queue = [];
  }

  private collect(): AnalyzerOutcome[] {
    return this.analyzers.map((analyzer, index) => {
      const key = analyzerKey(analyzer);
      const found = this.results.get(key);
      if (found) return found;
      return {
        analyzer,
        findings: [],
        filesRead: [],
        error: this.failures.get(key),
        parallel: false,
      };
    });
  }
}

function serialisableContext(context: ProjectContext): Record<string, unknown> {
  return {
    projectPath: context.projectPath,
    projectName: context.projectName,
    detectedLanguages: context.detectedLanguages,
    detectedFrameworks: context.detectedFrameworks,
    components: context.components,
    configuration: context.configuration,
    files: context.files,
    skippedFiles: context.skippedFiles,
  };
}
