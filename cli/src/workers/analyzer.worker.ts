import { parentPort, workerData } from "worker_threads";
import { createAnalyzerByKey } from "../services/analyzerCatalog";
import { startCollecting, stopCollecting } from "../services/fileIndex";

interface WorkerPayload {
  context: Record<string, unknown>;
  config: Record<string, unknown>;
}

interface Job {
  id: string;
  key: string;
}

const port = parentPort;

if (!port) {
  throw new Error("The analyzer worker must be run as a worker thread.");
}

const payload = workerData as WorkerPayload;

port.on("message", async (job: Job) => {
  try {
    const analyzer = createAnalyzerByKey(job.key);
    if (!analyzer) {
      port.postMessage({
        id: job.id,
        error: `There is no analyzer called ${job.key}.`,
      });
      return;
    }

    startCollecting();
    let findings = [];
    let filesRead: string[] = [];
    try {
      findings = await analyzer.analyze(
        payload.context as never,
        payload.config as never
      );
    } finally {
      filesRead = stopCollecting();
    }

    port.postMessage({ id: job.id, findings, filesRead });
  } catch (error) {
    port.postMessage({
      id: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
