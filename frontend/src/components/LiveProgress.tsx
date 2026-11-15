import { useState } from 'react'
import { Loader2, Square, AlertCircle, CheckCircle2 } from 'lucide-react'
import type { AnalysisProgress } from '../hooks/useAnalysisProgress'

/**
 * The steps a scan goes through, in the order it goes through them.
 *
 * The list is here so the person waiting can see where they are, not just
 * how far along they are.
 */
const STEPS = [
  { key: 'preparing', label: 'Getting the files ready' },
  { key: 'indexing', label: 'Walking the project' },
  { key: 'detecting', label: 'Working out what the project is' },
  { key: 'analyzing', label: 'Running the rules' },
  { key: 'reporting', label: 'Writing the report' },
  { key: 'saving', label: 'Saving the result' },
]

interface LiveProgressProps {
  progress: AnalysisProgress
  projectName?: string
  onCancel?: () => void
  cancelling?: boolean
}

/**
 * What is on screen while a scan is running.
 *
 * The bar follows the scan as it happens, and the step list shows where it
 * has got to. If the scan fails, what went wrong is said plainly.
 */
export function LiveProgress({ progress, projectName, onCancel, cancelling }: LiveProgressProps) {
  const [expanded, setExpanded] = useState(false)
  const percent = Math.max(0, Math.min(100, progress.progress || 0))
  const failed = progress.status === 'failed'

  // How far along the step list it is.
  const currentIndex = STEPS.findIndex(step => step.key === progress.stage)
  const visibleSteps = currentIndex >= 0 ? STEPS.slice(0, currentIndex + 1) : STEPS

  return (
    <div className="min-h-screen flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="card p-7">
          <div className="flex items-start gap-4">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                failed
                  ? 'bg-severity-critical/10 text-severity-critical'
                  : 'bg-accent/10 text-accent'
              }`}
            >
              {failed ? (
                <AlertCircle className="w-5 h-5" />
              ) : progress.status === 'completed' ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <Loader2 className="w-5 h-5 animate-spin" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-[19px] font-semibold text-ink">
                {failed
                  ? 'The analysis did not finish'
                  : progress.status === 'completed'
                    ? 'The analysis is ready'
                    : 'Analysing'}
                {projectName ? <span className="text-ink-2 font-normal"> {projectName}</span> : null}
              </h1>

              {failed ? (
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  {progress.error || 'Something went wrong while the project was being scanned.'}
                </p>
              ) : (
                <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                  {progress.message || 'The scan is under way.'}
                </p>
              )}

              {progress.hint ? (
                <p className="mt-2 text-[13px] leading-relaxed text-ink-3">{progress.hint}</p>
              ) : null}

              {progress.uploadedFiles && progress.uploadedFiles.length > 0 ? (
                <details className="mt-3" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
                  <summary className="text-[13px] text-ink-2 cursor-pointer select-none">
                    The {progress.uploadedFiles.length} file(s) that were received
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-[12px] text-ink-3 max-h-40 overflow-y-auto">
                    {progress.uploadedFiles.map(file => (
                      <li key={file} className="truncate">{file}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </div>

          {/* The bar */}
          <div className="mt-6">
            <div className="flex items-center justify-between text-[12px] text-ink-2 mb-2">
              <span className="font-medium">
                {STEPS.find(step => step.key === progress.stage)?.label ||
                  (progress.status === 'queued' ? 'Waiting to start' : 'Working')}
              </span>
              <span className="font-mono tabular-nums">{percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-[rgb(var(--glass-fill-inset))] overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  failed ? 'bg-severity-critical' : 'bg-accent'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* The steps */}
          {!failed && (
            <ol className="mt-6 space-y-2.5">
              {visibleSteps.map((step, index) => {
                const isLast = index === visibleSteps.length - 1
                const done = !isLast
                return (
                  <li key={step.key} className="flex items-center gap-3">
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                        done
                          ? 'bg-accent border-accent'
                          : 'border-accent/50 bg-accent/10'
                      }`}
                    >
                      {done ? (
                        <CheckCircle2 className="w-3 h-3 text-white" />
                      ) : (
                        <Loader2 className="w-3 h-3 text-accent animate-spin" />
                      )}
                    </span>
                    <span className={`text-[13px] ${done ? 'text-ink-3' : 'text-ink font-medium'}`}>
                      {step.label}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          {onCancel && !failed && progress.status !== 'completed' && (
            <div className="mt-7 pt-5 border-t border-[rgb(var(--glass-edge-inset))] flex justify-end">
              <button onClick={onCancel} disabled={cancelling} className="btn-secondary">
                <Square className="w-3.5 h-3.5" />
                {cancelling ? 'Stopping...' : 'Stop the scan'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
