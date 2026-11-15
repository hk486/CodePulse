import { useEffect, useState } from 'react'
import { X, ArrowUp, ArrowDown, Equal } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

interface Finding {
  id?: string
  ruleId?: string
  severity?: string
  title?: string
  location?: { filePath?: string; startLine?: number }
}

interface Run {
  id: string
  createdAt: string
  totalFindings?: number
  critical?: number
  high?: number
  medium?: number
  low?: number
  findings?: Finding[]
}

/**
 * The identity of a finding, for comparing two runs.
 *
 * The scanner numbers the findings it finds in a file, so the id changes
 * whenever something is added earlier in the file. The rule and the place
 * are what stay the same.
 */
function fingerprint(finding: Finding): string {
  const rule = finding.ruleId || finding.title || 'unknown'
  const file = finding.location?.filePath || ''
  return `${rule}@${file}`
}

/**
 * What changed between two runs.
 *
 * A finding that is in the new run but not the old one is new. One that
 * was in the old run but not the new one has been fixed.
 */
export function compareRuns(older: Run, newer: Run) {
  const olderKeys = new Map<string, Finding>()
  for (const finding of older.findings || []) {
    olderKeys.set(fingerprint(finding), finding)
  }
  const newerKeys = new Map<string, Finding>()
  for (const finding of newer.findings || []) {
    newerKeys.set(fingerprint(finding), finding)
  }

  const added: Finding[] = []
  const fixed: Finding[] = []
  for (const [key, finding] of newerKeys) {
    if (!olderKeys.has(key)) added.push(finding)
  }
  for (const [key, finding] of olderKeys) {
    if (!newerKeys.has(key)) fixed.push(finding)
  }

  return { added, fixed, unchanged: newerKeys.size - added.length }
}

interface DiffPanelProps {
  /** The run on screen. */
  current: Run
  /** The run being compared against it. */
  other: Run
  onClose: () => void
}

export function DiffPanel({ current, other, onClose }: DiffPanelProps) {
  const [diff, setDiff] = useState<{
    added: Finding[]
    fixed: Finding[]
    unchanged: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiFetch(`/analysis/${other.id}`)
        if (!response.ok) {
          throw new Error(await readError(response, 'Could not load that run.'))
        }
        const run = await response.json()
        setDiff(compareRuns(run, current))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load that run.')
      }
    }
    void load()
  }, [other.id, current])

  const severityColour: Record<string, string> = {
    CRITICAL: 'text-severity-critical',
    HIGH: 'text-severity-medium',
    MEDIUM: 'text-severity-medium',
    LOW: 'text-ink-3',
    INFO: 'text-ink-3',
  }

  return (
    <div className="glass-inset rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="title">What changed</h3>
          <p className="text-sm text-ink-2 mt-1">
            Compared with {new Date(other.createdAt).toLocaleString()}
          </p>
        </div>
        <button
          onClick={onClose}
          className="btn-icon-sm"
          aria-label="Close the comparison"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-severity-critical">
          {error}
        </p>
      )}

      {!diff && !error && <p className="text-[13px] text-ink-3">Comparing the two runs...</p>}

      {diff && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="glass-chip rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <ArrowUp className="w-3.5 h-3.5 text-severity-critical" />
                New
              </div>
              <div className="text-[22px] font-bold text-ink mt-1">{diff.added.length}</div>
            </div>
            <div className="glass-chip rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <ArrowDown className="w-3.5 h-3.5 text-severity-positive" />
                Fixed
              </div>
              <div className="text-[22px] font-bold text-ink mt-1">{diff.fixed.length}</div>
            </div>
            <div className="glass-chip rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <Equal className="w-3.5 h-3.5" />
                Unchanged
              </div>
              <div className="text-[22px] font-bold text-ink mt-1">{diff.unchanged}</div>
            </div>
          </div>

          {diff.added.length === 0 && diff.fixed.length === 0 && (
            <p className="text-[14px] text-ink-2">
              Nothing changed between these two runs.
            </p>
          )}

          {diff.added.length > 0 && (
            <div className="mb-4">
              <h4 className="text-[13px] font-medium text-severity-critical mb-2">
                New findings
              </h4>
              <ul className="space-y-1.5">
                {diff.added.slice(0, 12).map((finding, index) => (
                  <li key={index} className="text-[13px] text-ink-2">
                    <span className={severityColour[finding.severity || 'INFO']}>
                      {finding.severity}
                    </span>{' '}
                    {finding.title}
                    {finding.location?.filePath && (
                      <span className="text-ink-3 font-mono text-[12px]">
                        {' '}
                        {finding.location.filePath}
                        {finding.location.startLine ? `:${finding.location.startLine}` : ''}
                      </span>
                    )}
                  </li>
                ))}
                {diff.added.length > 12 && (
                  <li className="text-[13px] text-ink-3">
                    and {diff.added.length - 12} more
                  </li>
                )}
              </ul>
            </div>
          )}

          {diff.fixed.length > 0 && (
            <div>
              <h4 className="text-[13px] font-medium text-severity-positive mb-2">
                Fixed
              </h4>
              <ul className="space-y-1.5">
                {diff.fixed.slice(0, 12).map((finding, index) => (
                  <li key={index} className="text-[13px] text-ink-2">
                    <span className={severityColour[finding.severity || 'INFO']}>
                      {finding.severity}
                    </span>{' '}
                    {finding.title}
                    {finding.location?.filePath && (
                      <span className="text-ink-3 font-mono text-[12px]">
                        {' '}
                        {finding.location.filePath}
                        {finding.location.startLine ? `:${finding.location.startLine}` : ''}
                      </span>
                    )}
                  </li>
                ))}
                {diff.fixed.length > 12 && (
                  <li className="text-[13px] text-ink-3">
                    and {diff.fixed.length - 12} more
                  </li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}
