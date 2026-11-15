/**
 * Progress reporting for a scan.
 *
 * A scan of a large project takes a while, and the person who started it
 * should be able to see that something is happening. The lines this writes
 * go to stderr, one JSON object per line, so stdout stays pure JSON for
 * whatever is consuming the report.
 *
 * The backend reads these lines and turns them into messages on the
 * websocket, so the browser can show the scan as it happens.
 */

export interface ProgressEvent {
  event: "progress"
  stage: string
  /** How far along the scan is, from 0 to 100. */
  progress: number
  message: string
}

export type ProgressCallback = (event: ProgressEvent) => void

/**
 * Writes progress lines, but only when somebody is listening.
 */
export class ProgressReporter {
  private readonly write: ProgressCallback | null

  constructor(write: ProgressCallback | null) {
    this.write = write
  }

  /** A reporter that keeps quiet. */
  static readonly silent = new ProgressReporter(null)

  report(stage: string, progress: number, message: string): void {
    if (!this.write) return
    const clamped = Math.max(0, Math.min(100, Math.round(progress)))
    try {
      this.write({ event: "progress", stage, progress: clamped, message })
    } catch {
      // A listener that throws must not stop the scan.
    }
  }
}

/**
 * A reporter that writes to stderr, one JSON object per line.
 */
export function stderrReporter(): ProgressReporter {
  return new ProgressReporter(event => {
    process.stderr.write(`${JSON.stringify(event)}\n`)
  })
}
