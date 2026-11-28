import { useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react'
import type { PipelineRecord, LanguageAnalysisState } from '@codepulse/shared'

const STATE_LABELS: Record<string, string> = {
  detected: 'Detected',
  supported: 'Supported',
  analyzer_available: 'Analyzer available',
  analysis_completed: 'Analysed',
  partially_analyzed: 'Partly analysed',
  unsupported: 'Generic only',
  failed: 'Failed',
}

const STATE_STYLE: Record<string, string> = {
  analysis_completed: 'text-emerald-600 dark:text-emerald-400',
  partially_analyzed: 'text-amber-600 dark:text-amber-400',
  analyzer_available: 'text-ink-2',
  supported: 'text-ink-2',
  detected: 'text-ink-2',
  unsupported: 'text-ink-2',
  failed: 'text-rose-600 dark:text-rose-400',
}

const STAGE_NAMES: Record<string, string> = {
  project_manifest: 'Reading the manifests',
  file_discovery: 'Finding the files',
  language_detection: 'Working out the languages',
  technology_identification: 'Working out the stack',
  dependency_discovery: 'Finding the dependencies',
  analyzer_selection: 'Choosing the analyzers',
  analyzer_execution: 'Running the analyzers',
  result_collection: 'Gathering the results',
  finding_normalization: 'Putting the results in one shape',
  duplicate_detection: 'Finding the duplicates',
  evidence_validation: 'Checking the findings',
  severity_classification: 'Rating the findings',
  report_generation: 'Writing the report',
}

function StateIcon({ state }: { state: LanguageAnalysisState | string }) {
  if (state === 'analysis_completed') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
  }
  if (state === 'failed') {
    return <XCircle className="w-3.5 h-3.5 text-rose-500" />
  }
  if (state === 'partially_analyzed') {
    return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
  }
  if (state === 'unsupported') {
    return <MinusCircle className="w-3.5 h-3.5 text-ink-3" />
  }
  return <CheckCircle2 className="w-3.5 h-3.5 text-ink-3" />
}

function duration(ms?: number): string {
  if (ms === undefined || ms === null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * What the analysis actually did.
 *
 * The findings are only worth something next to what was looked at, what
 * was left out and what failed. This is that.
 */
export function CoveragePanel({ pipeline }: { pipeline: PipelineRecord }) {
  const [open, setOpen] = useState(false)
  const [showStages, setShowStages] = useState(false)

  const coverage = pipeline.coverage || []
  const analyzers = pipeline.analyzers || []
  const stages = pipeline.stages || []

  const analysed = coverage.filter(c => c.state === 'analysis_completed').length
  const partial = coverage.filter(c => c.state === 'partially_analyzed').length
  const failed = coverage.filter(c => c.state === 'failed').length
  const unsupported = coverage.filter(c => c.state === 'unsupported').length
  const failedAnalyzers = analyzers.filter(a => a.status === 'failed').length
  const unavailableAnalyzers = analyzers.filter(a => a.status === 'unavailable').length

  return (
    <section className="card p-5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div>
          <h2 className="title">Analysis coverage</h2>
          <p className="text-[13px] text-ink-2 mt-1">
            {analysed} language{analysed === 1 ? '' : 's'} analysed
            {partial > 0 ? `, ${partial} partly` : ''}
            {unsupported > 0 ? `, ${unsupported} generic only` : ''}
            {failed > 0 ? `, ${failed} failed` : ''}
            {' · '}
            {analyzers.length} analyzer{analyzers.length === 1 ? '' : 's'} ran
            {failedAnalyzers > 0 ? `, ${failedAnalyzers} failed` : ''}
            {unavailableAnalyzers > 0 ? `, ${unavailableAnalyzers} unavailable` : ''}
            {' · '}
            {pipeline.filesAnalyzed ?? 0} of {pipeline.filesTotal ?? 0} files read
          </p>
        </div>
        {open ? (
          <ChevronDown className="w-4 h-4 text-ink-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-ink-3 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="mt-5 space-y-5">
          {/* The languages */}
          {coverage.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold text-ink-2 mb-2">
                The languages
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-ink-3 border-b border-[rgb(var(--glass-edge-inset))]">
                      <th className="font-medium pb-2 pr-4">Language</th>
                      <th className="font-medium pb-2 pr-4">State</th>
                      <th className="font-medium pb-2 pr-4 text-right">Files</th>
                      <th className="font-medium pb-2 text-right">Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.map(row => (
                      <tr
                        key={row.language}
                        className="border-b border-[rgb(var(--glass-edge-inset))] last:border-0"
                      >
                        <td className="py-2 pr-4 text-ink">{row.language}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center gap-1.5 ${STATE_STYLE[row.state] || 'text-ink-2'}`}
                          >
                            <StateIcon state={row.state} />
                            {STATE_LABELS[row.state] || row.state}
                          </span>
                          {row.reason ? (
                            <p className="text-[12px] text-ink-3 mt-0.5 ml-5">{row.reason}</p>
                          ) : null}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums text-ink-2">
                          {row.filesAnalyzed}/{row.filesDetected}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-ink-2">
                          {row.findings}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* The analyzers */}
          {analyzers.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold text-ink-2 mb-2">
                The analyzers
              </h3>
              <ul className="space-y-1.5">
                {analyzers.map(analyzer => (
                  <li key={analyzer.id + analyzer.startedAt} className="flex items-start gap-2.5">
                    <StateIcon
                      state={
                        analyzer.status === 'completed'
                          ? 'analysis_completed'
                          : analyzer.status === 'failed'
                            ? 'failed'
                            : analyzer.status === 'unavailable'
                              ? 'unsupported'
                              : 'detected'
                      }
                    />
                    <span className="text-[13px] text-ink-2">
                      <span className="text-ink">{analyzer.name}</span>
                      <span className="text-ink-3"> {analyzer.version}</span>
                      {analyzer.status === 'completed' ? (
                        <span className="text-ink-3">
                          {' '}
                          — {analyzer.findingCount} finding
                          {analyzer.findingCount === 1 ? '' : 's'} in{' '}
                          {analyzer.filesAnalyzed} file
                          {analyzer.filesAnalyzed === 1 ? '' : 's'}
                        </span>
                      ) : null}
                      {analyzer.status === 'unavailable' && analyzer.reason ? (
                        <span className="text-ink-3"> — {analyzer.reason}</span>
                      ) : null}
                      {analyzer.status === 'failed' && analyzer.error ? (
                        <span className="text-rose-500"> — {analyzer.error}</span>
                      ) : null}
                    </span>
                    {analyzer.durationMs !== undefined ? (
                      <span className="text-[12px] text-ink-3 font-mono tabular-nums ml-auto flex-shrink-0">
                        {duration(analyzer.durationMs)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The stages */}
          {stages.length > 0 && (
            <div>
              <button
                onClick={() => setShowStages(!showStages)}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-2"
              >
                {showStages ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                The stages
                <span className="font-normal text-ink-3">
                  ({duration(pipeline.durationMs)} in total)
                </span>
              </button>

              {showStages && (
                <ul className="mt-2 space-y-1">
                  {stages.map(stage => (
                    <li
                      key={stage.name + stage.startedAt}
                      className="flex items-center gap-2.5 text-[13px]"
                    >
                      {stage.status === 'failed' ? (
                        <XCircle className="w-3.5 h-3.5 text-rose-500" />
                      ) : stage.status === 'skipped' ? (
                        <MinusCircle className="w-3.5 h-3.5 text-ink-3" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      )}
                      <span className="text-ink-2">
                        {STAGE_NAMES[stage.name] || stage.name}
                      </span>
                      {stage.error ? (
                        <span className="text-rose-500 text-[12px]">{stage.error}</span>
                      ) : null}
                      <span className="text-[12px] text-ink-3 font-mono tabular-nums ml-auto flex-shrink-0 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {duration(stage.durationMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
