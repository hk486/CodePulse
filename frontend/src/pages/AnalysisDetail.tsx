import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  CheckCircle,
  Trash2,
  AlertCircle,
  RefreshCcw,
  Download,
  ArrowLeft,
  Share2,
  Eye,
} from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'
import { downloadFromApi } from '../services/download'
import { categoryColor, categoryWash, humanise } from '../services/palette'
import { PrintableReportModal } from '../components/PrintableReportModal'
import { DiffPanel } from '../components/DiffPanel'
import { TechStackPanel } from '../components/TechStackPanel'
import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { LiveProgress } from '../components/LiveProgress'
import { CoveragePanel } from '../components/CoveragePanel'
import { useAnalysisProgress } from '../hooks/useAnalysisProgress'
import type { Analysis, ApiFinding, Project } from '@codepulse/shared'

/** A finding as the table shows it. */
interface FindingRow {
  id: string
  title: string
  file: string
  line: number
  severity: string
  category: string
  confidence: string
  facet: string
  componentId?: string
}

export function AnalysisDetail() {
  const { id } = useParams<{ id: string }>()
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  // The project the analysis belongs to. The analysis only carries its
  // id, so the name is a separate question.
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shareNotice, setShareNotice] = useState<string | null>(null)
  const [printEndpoint, setPrintEndpoint] = useState<string | null>(null)
  const [componentFilter, setComponentFilter] = useState<string | null>(null)
  const [facetFilter, setFacetFilter] = useState<string | null>(null)
  const [history, setHistory] = useState<Analysis[]>([])
  const [deletingAnalysis, setDeletingAnalysis] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [findingsPage, setFindingsPage] = useState(0)
  const [comparingWith, setComparingWith] = useState<Analysis | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // A scan that has not finished yet is watched, not rendered. When it
  // settles the page loads the result.
  const isRunning =
    analysis?.status === 'queued' || analysis?.status === 'running'

  const reload = useCallback(async () => {
    if (!id) return
    const response = await apiFetch(`/analysis/${id}`)
    if (!response.ok) return
    const data = await response.json()
    setAnalysis(data)
    if (data?.projectId) {
      apiFetch(`/projects/${data.projectId}`)
        .then(res => (res.ok ? res.json() : null))
        .then(setProject)
        .catch(() => setProject(null))
      apiFetch(`/analysis/project/${data.projectId}`)
        .then(res => (res.ok ? res.json() : []))
        .then(rows => setHistory(Array.isArray(rows) ? rows : []))
        .catch(() => setHistory([]))
    }
  }, [id])

  const progress = useAnalysisProgress(isRunning ? id : undefined, () => {
    void reload()
  })

  /**
   * Stop a scan that is running.
   */
  const cancelAnalysis = async () => {
    if (!id) return
    setCancelling(true)
    try {
      await apiFetch(`/analysis/${id}/cancel`, { method: 'POST' })
    } finally {
      setCancelling(false)
    }
  }

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)

    // The id in the address bar is an analysis id when the page was
    // opened from a report, and a project id when it was opened from a
    // project card. Try the analysis first and fall back to the latest
    // analysis of the project.
    const load = async () => {
      const direct = await apiFetch(`/analysis/${id}`)
      if (direct.ok) return direct.json()

      const latest = await apiFetch(`/analysis/project/${id}/latest`)
      if (latest.ok) return latest.json()

      throw new Error(
        await readError(direct, 'That analysis could not be found. Run the analysis on the project first.')
      )
    }

    load()
      .then(data => {
        setAnalysis(data)
        setLoading(false)
        // The name of the project, so the heading and the exported file
        // say what the report is about.
        if (data?.projectId) {
          apiFetch(`/projects/${data.projectId}`)
            .then(res => (res.ok ? res.json() : null))
            .then(setProject)
            .catch(() => setProject(null))
        }
        // Every run of this project, newest first.
        if (data?.projectId) {
          apiFetch(`/analysis/project/${data.projectId}`)
            .then(res => (res.ok ? res.json() : []))
            .then(rows => setHistory(Array.isArray(rows) ? rows : []))
            .catch(() => setHistory([]))
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : 'Failed to load analysis')
        setLoading(false)
      })
  }, [id])

  /**
   * Remove an old run. The analysis on screen is never removed, because
   * there would be nothing left to show.
   */
  const deleteAnalysis = async (analysisId: string) => {
    if (!window.confirm('Remove this run? The report goes with it.')) return
    setDeletingAnalysis(analysisId)
    setHistoryError(null)
    try {
      const response = await apiFetch(`/analysis/${analysisId}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not remove that run.'))
      }
      setHistory(current => current.filter(row => row.id !== analysisId))
      if (analysisId === analysis?.id) {
        setHistoryError('That run was the one on screen. Open another run to carry on.')
      }
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not remove that run.')
    } finally {
      setDeletingAnalysis(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="animate-spin w-10 h-10 border-4 border-accent border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-ink-2">Loading analysis...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-900/20 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-8 h-8 text-severity-critical" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Failed to load analysis</h2>
        <p className="text-ink-2 mb-6 max-w-[52ch]">{error}</p>
        <Link to="/projects" className="btn-primary">Back to Projects</Link>
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Analysis not found</h2>
        <Link to="/projects" className="btn-primary">Back to Projects</Link>
      </div>
    )
  }

  const totalFindings = analysis.totalFindings || analysis.findings?.length || 0

  // A scan that is still going is shown as it happens, not as a report
  // that is not there yet.
  if (isRunning || progress.status === 'failed') {
    return (
      <>
        <LiveProgress
          progress={
            progress.status === 'failed'
              ? progress
              : {
                  ...progress,
                  status: progress.status === 'completed' ? 'completed' : 'running',
                  progress: progress.progress || analysis.progress || 0,
                  stage: progress.stage || analysis.stage || 'queued',
                }
          }
          projectName={project?.name}
          onCancel={cancelAnalysis}
          cancelling={cancelling}
        />
        {printEndpoint && (
          <PrintableReportModal
            endpoint={printEndpoint}
            title={project?.name ? `Report — ${project.name}` : 'Report'}
            onClose={() => setPrintEndpoint(null)}
          />
        )}
      </>
    )
  }

  const severityData = [
    { name: 'Critical', value: analysis.critical || 0, color: 'rgb(var(--severity-critical))' },
    { name: 'High', value: analysis.high || 0, color: 'rgb(var(--severity-high))' },
    { name: 'Medium', value: analysis.medium || 0, color: 'rgb(var(--severity-medium))' },
    { name: 'Low', value: analysis.low || 0, color: 'rgb(var(--severity-low))' },
  ]

  const categoryData: Record<string, number> = {}
  analysis.findings?.forEach((f: ApiFinding) => {
    categoryData[f.category] = (categoryData[f.category] || 0) + 1
  })
  const categoryBreakdown = Object.entries(categoryData).map(([name, value]) => ({
    name: name.replace(/_/g, ' '),
    value,
  }))

  /**
   * Download the analysis as a JSON report.
   */
  /**
   * Download the findings as rows in a table, so the numbers can be
   * checked by hand.
   */
  const handleExportCsv = async () => {
    try {
      await downloadFromApi('findings', analysis.id)
    } catch (err) {
      setShareNotice(err instanceof Error ? err.message : 'Could not export the findings.')
    }
  }

  const handleExportJson = async () => {
    try {
      await downloadFromApi('analysis', analysis.id)
    } catch (err) {
      setShareNotice(
        err instanceof Error ? err.message : 'Could not export the report.'
      )
    }
  }

  /**
   * Open the printable report, which the browser can save as a PDF.
   */
  const handlePrint = () => {
    setPrintEndpoint(`/pdf/analysis/${analysis.id}`)
  }

  /**
   * Copy a link to this analysis.
   */
  const handleShare = async () => {
    const url = `${window.location.origin}/analysis/${analysis.id}`
    try {
      await navigator.clipboard.writeText(url)
      setShareNotice('Link copied to your clipboard.')
    } catch {
      setShareNotice(`Copy this link manually: ${url}`)
    }
  }

  const stats = [
    {
      label: 'Total Findings',
      metric: 'findings',
      value: totalFindings.toString(),
      emphasis: false,
    },
    {
      label: 'Critical',
      metric: 'critical',
      value: (analysis.critical || 0).toString(),
      emphasis: (analysis.critical || 0) > 0,
    },
    {
      label: 'High',
      metric: 'high',
      value: (analysis.high || 0).toString(),
      emphasis: false,
    },
    {
      label: 'Quality Score',
      metric: 'positive',
      value: totalFindings > 0 ? Math.max(0, 100 - (analysis.critical || 0) * 10 - (analysis.high || 0) * 5).toString() + '/100' : 'N/A',
      emphasis: false,
    },
  ]

  // Counts per component, used by the stack panel
  const byComponent: Record<string, number> = {}
  const byFacet: Record<string, number> = {}
  ;(analysis.findings || []).forEach((f: ApiFinding) => {
    if (f.componentId) byComponent[f.componentId] = (byComponent[f.componentId] || 0) + 1
    if (f.facet) byFacet[f.facet] = (byFacet[f.facet] || 0) + 1
  })

  // The findings the table shows, after the component / facet filters
  const filteredFindings = (analysis.findings || []).filter((f: ApiFinding) => {
    if (componentFilter && f.componentId !== componentFilter) return false
    if (facetFilter && f.facet !== facetFilter) return false
    return true
  })

  // The findings are paged rather than cut off. A project with five
  // hundred findings used to show the first fifty and say nothing about
  // the rest.
  const FINDINGS_PER_PAGE = 25
  const findingsPages = Math.max(1, Math.ceil(filteredFindings.length / FINDINGS_PER_PAGE))
  const currentPage = Math.min(findingsPage, findingsPages - 1)
  const findingsFrom = currentPage * FINDINGS_PER_PAGE
  const findingsTo = Math.min(findingsFrom + FINDINGS_PER_PAGE, filteredFindings.length)
  const recentFindings: FindingRow[] = filteredFindings
    .slice(findingsFrom, findingsTo)
    .map((f: ApiFinding, idx: number) => ({
    id: f.id || `finding-${findingsFrom + idx}`,
    title: f.title || 'Unknown finding',
    file: f.location?.filePath || 'Unknown file',
    line: f.location?.startLine || 0,
    severity: f.severity || 'LOW',
    category: f.category || 'CODE_QUALITY',
    confidence: f.confidence || 'LOW',
    facet: f.facet || 'code',
    componentId: f.componentId,
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analysis Report"
        description={
          <>
            Code quality analysis for project{' '}
            <span className="font-medium text-gray-900 dark:text-white">
              {project?.name || `#${analysis.projectId}`}
            </span>
          </>
        }
        actions={
          <>
            <button
              onClick={() => window.location.reload()}
              className="btn-ghost"
              title="Reload"
              aria-label="Reload"
            >
              <RefreshCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => void handleExportJson()}
              className="btn-outline inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Report
            </button>
            <button
              onClick={() => void handleExportCsv()}
              className="btn-outline inline-flex items-center gap-2"
              title="Download the findings as a CSV table"
            >
              <Download className="w-4 h-4" />
              Findings CSV
            </button>
            <Link to="/projects" className="btn-secondary inline-flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Projects
            </Link>
          </>
        }
      />

      {/* What the analysis actually did, so the findings can be read
          next to what was covered and what was left out. */}
      {analysis.pipeline ? <CoveragePanel pipeline={analysis.pipeline} /> : null}

      {/* Detected stack + components */}
      <TechStackPanel
        languages={analysis.detectedLanguages || []}
        frameworks={analysis.detectedFrameworks || []}
        techStack={analysis.techStack}
        components={analysis.components || []}
        projectType={analysis.projectType}
        analyzersRun={analysis.analyzersRun || []}
        coverage={analysis.coverage}
        byComponent={byComponent}
        activeComponent={componentFilter}
        onFilterByComponent={setComponentFilter}
      />

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            metric={stat.metric}
            emphasis={stat.emphasis}
            delay={index * 40}
          />
        ))}
      </div>

      {/* Charts & Findings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Severity Chart */}
        <div className="lg:col-span-2 card">
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="title">Severity Distribution</h2>
                <p className="text-sm text-ink-2">
                  Breakdown of findings by severity level
                </p>
              </div>
            </div>
            <div className="space-y-6">
              {severityData.map((item) => (
                <div key={item.name} className="flex items-center gap-4">
                  <div className="w-28 shrink-0 flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-2 dark:text-ink-3">{item.name}</span>
                    <span className="text-[13px] font-bold tabular-nums" style={{ color: item.color }}>
                      {item.value}
                    </span>
                  </div>
                  <div className="flex-1 h-2 glass-well rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: totalFindings > 0 ? `${Math.max((item.value / totalFindings) * 100, 5)}%` : '5%',
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Category Chart */}
        <div className="card">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="title">Category Breakdown</h2>
            </div>
            <div className="space-y-5">
              {categoryBreakdown.map((item) => (
                <div key={item.name} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold text-white"
                    style={{ backgroundColor: categoryColor(item.name) }}
                  >
                    {String(item.name[0])}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-ink-2 dark:text-ink-3">{item.name}</span>
                      <span className="text-ink font-medium">{item.value}</span>
                    </div>
                    <div className="h-1.5 w-full glass-well rounded-full mt-1">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: totalFindings > 0 ? `${(item.value / totalFindings) * 100}%` : '0%',
                          backgroundColor: categoryColor(item.name),
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-1 card">
          <h2 className="title mb-6">Quick Actions</h2>
          <div className="space-y-3">
            <button onClick={() => window.location.reload()} className="btn-primary w-full">
              <RefreshCcw className="w-4 h-4 mr-2" />
              Re-run Analysis
            </button>
            <button onClick={() => void handlePrint()} className="btn-outline w-full">
              <Download className="w-4 h-4 mr-2" />
              Export PDF Report
            </button>
            <button onClick={() => void handleShare()} className="btn-secondary w-full">
              <Share2 className="w-4 h-4 mr-2" />
              Share Report
            </button>
            {shareNotice && (
              <p role="status" className="text-[13px] text-severity-positive break-all">
                {shareNotice}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Findings Table */}
      <div className="card-flush">
        <div className="p-6 border-b border-[rgb(var(--glass-edge-inset))]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="title">Key Findings</h2>
              <p className="text-sm text-ink-2 mt-1">
                {filteredFindings.length} of {analysis.findings?.length || 0} issues shown
                {filteredFindings.length > FINDINGS_PER_PAGE && (
                  <span className="text-ink-3">
                    &middot; page {currentPage + 1} of {findingsPages}
                  </span>
                )}
                {componentFilter && ` · filtered to component "${componentFilter}"`}
                {facetFilter && ` · filtered to ${facetFilter}`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {Object.keys(byFacet).length > 1 && (
                <select
                  value={facetFilter || 'all'}
                  onChange={(e) => setFacetFilter(e.target.value === 'all' ? null : e.target.value)}
                  className="input-field h-10 w-auto text-[14px]"
                  aria-label="Filter by facet"
                >
                  <option value="all">All layers</option>
                  {Object.entries(byFacet).map(([facet, count]) => (
                    <option key={facet} value={facet}>{facet} ({count})</option>
                  ))}
                </select>
              )}
              {(componentFilter || facetFilter) && (
                <button
                  onClick={() => { setComponentFilter(null); setFacetFilter(null) }}
                  className="btn-ghost text-[14px] px-3 py-2"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="w-[28%]">Finding</th>
                <th className="w-[22%]">Location</th>
                <th className="w-[13%]">Component</th>
                <th className="text-center w-[9%]">Severity</th>
                <th className="text-center w-[12%]">Category</th>
                <th className="text-center w-[10%]">Confidence</th>
                <th className="text-right w-14">Action</th>
              </tr>
            </thead>
            <tbody>
              {recentFindings.map((finding: FindingRow) => (
                <tr key={finding.id} className="group hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] transition-colors">
                  <td className="text-sm font-medium text-gray-900 dark:text-white">
                    {finding.title}
                  </td>
                  <td className="text-sm text-ink-2 font-mono text-[13px]">
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ''}
                  </td>
                  <td className="text-[13px] text-ink-2">
                    {finding.componentId ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="badge badge-info">{finding.componentId}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3 dark:text-ink-2">-</span>
                    )}
                  </td>
                  <td className="text-center">
                    <span
                      className={`badge ${
                        finding.severity === 'CRITICAL'
                          ? 'badge-critical'
                          : finding.severity === 'HIGH'
                            ? 'badge-high'
                            : finding.severity === 'MEDIUM'
                              ? 'badge-medium'
                              : finding.severity === 'LOW'
                                ? 'badge-low'
                                : 'badge-info'
                      }`}
                    >
                      {finding.severity}
                    </span>
                  </td>
                  <td className="text-center">
                    <span
                      className="badge"
                      style={{
                        backgroundColor: categoryWash(finding.category),
                        borderColor: categoryColor(finding.category),
                        color: categoryColor(finding.category),
                      }}
                    >
                      {humanise(finding.category)}
                    </span>
                  </td>
                  <td className="text-center">
                    <span className="badge badge-info">{finding.confidence}</span>
                  </td>
                  <td className="text-right">
                    <button className="btn-ghost text-[13px] p-1.5">
                      <Eye className="w-3 h-3 text-ink-3 group-hover:text-ink-2 dark:group-hover:text-ink-2" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredFindings.length > FINDINGS_PER_PAGE && (
          <div className="flex items-center justify-between gap-4 px-6 py-4 border-t border-[rgb(var(--glass-edge-inset))]">
            <p className="text-[13px] text-ink-3">
              Showing {findingsFrom + 1} to {findingsTo} of {filteredFindings.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFindingsPage(page => Math.max(0, page - 1))}
                disabled={currentPage === 0}
                className="btn-ghost text-[13px] px-3 py-1.5 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setFindingsPage(page => Math.min(findingsPages - 1, page + 1))}
                disabled={currentPage >= findingsPages - 1}
                className="btn-ghost text-[13px] px-3 py-1.5 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
        {recentFindings.length === 0 && (
          <div className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-6 h-6 text-severity-positive" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No findings detected</h3>
            <p className="text-ink-2">Great job! No code quality issues were found in this analysis.</p>
          </div>
        )}
      </div>

      {/* What changed since an earlier run */}
      {comparingWith && (
        <DiffPanel
          current={analysis}
          other={comparingWith}
          onClose={() => setComparingWith(null)}
        />
      )}

      {/* Every run of this project, so an old one can be compared or
          removed. */}
      {history.length > 1 && (
        <div className="card">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="title">Run history</h2>
              <p className="text-sm text-ink-2 mt-1">
                Every analysis of this project, newest first
              </p>
            </div>
            <span className="text-[13px] text-ink-3">{history.length} runs</span>
          </div>

          {historyError && (
            <p role="alert" className="mb-4 rounded-xl bg-severity-critical/10 border border-severity-critical/25 px-4 py-3 text-sm text-severity-critical">
              {historyError}
            </p>
          )}

          <div className="space-y-2">
            {history.map((row: Analysis) => {
              const isCurrent = row.id === analysis?.id
              return (
                <div
                  key={row.id}
                  className="glass-inset flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-ink truncate">
                      {new Date(row.createdAt).toLocaleString()}
                      {isCurrent && (
                        <span className="ml-2 text-[12px] font-normal text-ink-3">
                          on screen
                        </span>
                      )}
                    </p>
                    <p className="text-[13px] text-ink-2 mt-0.5">
                      {row.totalFindings ?? 0} finding{(row.totalFindings ?? 0) === 1 ? '' : 's'}
                      {row.critical > 0 && `, ${row.critical} critical`}
                      {row.high > 0 && `, ${row.high} high`}
                    </p>
                  </div>

                  {!isCurrent && (
                    <>
                      <button
                        onClick={() => setComparingWith(row)}
                        className="btn-ghost text-[13px] px-3 py-1.5"
                        title="See what changed since that run"
                      >
                        Compare
                      </button>
                      <Link
                        to={`/analysis/${row.id}`}
                        className="btn-ghost text-[13px] px-3 py-1.5"
                      >
                        View
                      </Link>
                    </>
                  )}

                  <button
                    onClick={() => void deleteAnalysis(row.id)}
                    disabled={deletingAnalysis === row.id}
                    className="btn-icon-sm hover:text-severity-critical disabled:opacity-50"
                    title={isCurrent ? 'This run is on screen' : 'Remove this run'}
                    aria-label={`Remove the run from ${new Date(row.createdAt).toLocaleString()}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {printEndpoint && (
        <PrintableReportModal
          endpoint={printEndpoint}
          title="Printable analysis report"
          onClose={() => setPrintEndpoint(null)}
        />
      )}
    </div>
  )
}
