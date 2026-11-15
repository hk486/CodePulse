import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText,
  Download,
  Printer,
  Share2,
  Trash2,
  RefreshCcw,
  ChevronRight,
} from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'
import type { ApiFinding, ComponentInfo, TechStack } from '@codepulse/shared'
import { downloadFromApi } from '../services/download'
import { formatNumber } from '../services/format'
import { languageName } from '../services/palette'
import { PrintableReportModal } from '../components/PrintableReportModal'
/** How many reports are shown at a time. */
const REPORTS_PER_PAGE = 25

import { PageHeader } from '../components/ui/PageHeader'
import { StatCard } from '../components/ui/StatCard'
import { SearchInput, Toolbar } from '../components/ui/Toolbar'

interface ReportSummary {
  totalFindings: number
  critical: number
  high: number
  medium: number
  low: number
  info: number
}

interface ReportListItem {
  id: string
  analysisId: string
  projectId: string
  projectName: string
  format: string
  createdAt: string
  summary: ReportSummary
  detectedLanguages?: string[]
  detectedFrameworks?: string[]
  components?: ComponentInfo[]
  techStack?: TechStack
}

interface ReportTotals {
  totalReports: number
  totalFindings: number
  critical: number
  high: number
  medium: number
  low: number
  info: number
  projects: number
}

const emptyTotals: ReportTotals = {
  totalReports: 0,
  totalFindings: 0,
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  projects: 0,
}

function severityBadgeClass(severity: string) {
  switch (severity) {
    case 'CRITICAL':
      return 'badge-critical'
    case 'HIGH':
      return 'badge-high'
    case 'MEDIUM':
      return 'badge-medium'
    case 'LOW':
      return 'badge-low'
    default:
      return 'badge-info'
  }
}

export function ReportsPage() {
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [totals, setTotals] = useState<ReportTotals>(emptyTotals)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [info, setInfo] = useState('')
  const [search, setSearch] = useState('')
  // The list is shown a page at a time, because a project that is
  // analysed often has a lot of reports. The server does the paging and
  // the filtering, so a filter covers every report and not only the ones
  // that happen to be on the page.
  const [visibleCount, setVisibleCount] = useState(REPORTS_PER_PAGE)
  const [totalReports, setTotalReports] = useState(0)
  const [severityFilter, setSeverityFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedFindings, setExpandedFindings] = useState<ApiFinding[]>([])
  const [printEndpoint, setPrintEndpoint] = useState<string | null>(null)

  const load = useCallback(
    async (options: { append?: boolean } = {}) => {
      const append = options.append === true
      if (!append) setLoading(true)
      setError('')
      try {
        // The server does the filtering and the paging.
        const query = new URLSearchParams({
          page: String(Math.ceil(visibleCount / REPORTS_PER_PAGE) || 1),
          pageSize: String(REPORTS_PER_PAGE)
        })
        if (severityFilter && severityFilter !== 'all') query.set('severity', severityFilter)
        if (search.trim()) query.set('search', search.trim())

        const [listResponse, summaryResponse] = await Promise.all([
          apiFetch(`/reports?${query.toString()}`),
          apiFetch('/reports/summary'),
        ])
        if (!listResponse.ok) {
          throw new Error(await readError(listResponse, 'Could not load the reports.'))
        }
        const body = await listResponse.json()
        if (body && Array.isArray(body.items)) {
          setReports(current => (append ? [...current, ...body.items] : body.items))
          setTotalReports(body.total ?? body.items.length)
          setVisibleCount(current => (append ? current + REPORTS_PER_PAGE : REPORTS_PER_PAGE))
        } else {
          // A server that does not page sends the whole list.
          setReports(Array.isArray(body) ? body : [])
          setTotalReports(Array.isArray(body) ? body.length : 0)
        }
        if (summaryResponse.ok) {
          setTotals(await summaryResponse.json())
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load the reports.')
      } finally {
        setLoading(false)
      }
    },
    [search, severityFilter, visibleCount]
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, severityFilter])

  const openReport = async (report: ReportListItem) => {
    if (expandedId === report.id) {
      setExpandedId(null)
      setExpandedFindings([])
      return
    }
    setExpandedId(report.id)
    setExpandedFindings([])
    try {
      const response = await apiFetch(`/reports/${report.id}`)
      if (!response.ok) throw new Error(await readError(response, 'Could not open the report.'))
      const data = await response.json()
      setExpandedFindings(data?.content?.findings || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the report.')
    }
  }

  const downloadJson = async (report: ReportListItem) => {
    try {
      await downloadFromApi('report', report.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the report.')
    }
  }

  const openPrintable = (report: ReportListItem) => {
    setPrintEndpoint(`/pdf/${report.id}`)
  }

  const shareReport = async (report: ReportListItem) => {
    const url = `${window.location.origin}/analysis/${report.analysisId}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice('Link copied to your clipboard.')
    } catch {
      setInfo(`Copy this link manually: ${url}`)
    }
  }

  const removeReport = async (report: ReportListItem) => {
    try {
      const response = await apiFetch(`/reports/${report.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readError(response, 'Could not delete the report.'))
      setReports(current => current.filter(item => item.id !== report.id))
      setNotice('Report deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the report.')
    }
  }

  const stats = [
    { label: 'Reports', metric: 'reports', value: totals.totalReports, emphasis: false },
    { label: 'Findings', metric: 'findings', value: totals.totalFindings, emphasis: false },
    { label: 'Critical', metric: 'critical', value: totals.critical, emphasis: totals.critical > 0 },
    { label: 'Projects covered', metric: 'projects', value: totals.projects, emphasis: false },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Every analysis snapshot, ready to review, export and share"
        actions={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {error && (
        <p role="alert" className="rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="glass-inset rounded-xl px-4 py-3 text-sm text-ink-2">
          {info}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map(stat => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            metric={stat.metric}
            emphasis={stat.emphasis}
          />
        ))}
      </div>

      {/* Filters */}
      <Toolbar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by project"
          label="Search reports"
        />
        <select
          value={severityFilter}
          onChange={event => setSeverityFilter(event.target.value)}
          aria-label="Filter by severity"
          className="input-field h-11 md:w-48"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </Toolbar>

      {/* Report list */}
      {loading ? (
        <p className="text-sm text-ink-2">Loading reports…</p>
      ) : reports.length === 0 ? (
        <div className="card p-10 text-center">
          <FileText className="w-10 h-10 mx-auto text-ink-3 dark:text-ink-2" />
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">No reports yet</h3>
          <p className="mt-2 text-sm text-ink-2">
            {reports.length === 0
              ? 'Run an analysis on a project and the report will show up here automatically.'
              : 'No report matches your filters.'}
          </p>
          {reports.length === 0 && (
            <Link to="/projects" className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 text-sm mt-5">
              Go to Projects
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map(report => (
            <div key={report.id} className="card p-5">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <button
                  onClick={() => void openReport(report)}
                  className="flex items-start gap-3 flex-1 text-left min-w-0"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 text-ink-2 hover:text-ink flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white truncate">{report.projectName}</p>
                    <p className="text-[13px] text-ink-2 mt-0.5">
                      {new Date(report.createdAt).toLocaleString()} &middot; {formatNumber(report.summary.totalFindings)} finding{report.summary.totalFindings === 1 ? '' : 's'}
                    </p>
                    {(report.detectedLanguages?.length || report.components?.length) && (
                      <p className="text-[11px] text-ink-3 mt-1">
                        {report.detectedLanguages?.length
                          ? report.detectedLanguages.map(languageName).join(', ')
                          : ''}
                        {report.components && report.components.length > 1
                          ? ` · ${report.components.length} components`
                          : ''}
                      </p>
                    )}
                  </div>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {report.summary.critical > 0 && (
                    <span className={`badge ${severityBadgeClass('CRITICAL')}`}>{report.summary.critical} critical</span>
                  )}
                  {report.summary.high > 0 && (
                    <span className={`badge ${severityBadgeClass('HIGH')}`}>{report.summary.high} high</span>
                  )}
                  {report.summary.medium > 0 && (
                    <span className={`badge ${severityBadgeClass('MEDIUM')}`}>{report.summary.medium} medium</span>
                  )}
                  {report.summary.low > 0 && (
                    <span className={`badge ${severityBadgeClass('LOW')}`}>{report.summary.low} low</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void downloadJson(report)}
                    className="btn-icon"
                    title="Download JSON"
                    aria-label="Download report as JSON"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openPrintable(report)}
                    className="btn-icon"
                    title="Print / save as PDF"
                    aria-label="Printable report"
                  >
                    <Printer className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => void shareReport(report)}
                    className="btn-icon"
                    title="Copy link"
                    aria-label="Share report"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                  <Link
                    to={`/analysis/${report.analysisId}`}
                    className="btn-secondary px-3 py-1.5 text-[13px] inline-flex items-center gap-1"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => void removeReport(report)}
                    className="btn-icon hover:text-severity-critical"
                    title="Delete report"
                    aria-label="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {expandedId === report.id && (
                <div className="mt-4 pt-4 border-t border-primary-200 dark:border-primary-800">
                  {expandedFindings.length === 0 ? (
                    <p className="text-sm text-ink-2">
                      This analysis recorded no findings.
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {expandedFindings.map((finding: ApiFinding, index: number) => (
                        <li key={`${finding.id || finding.ruleId}-${index}`} className="py-2.5 flex items-start gap-3">
                          <span className={`badge ${severityBadgeClass(finding.severity)} flex-shrink-0`}>
                            {finding.severity}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{finding.title}</p>
                            <p className="text-[13px] text-ink-2 font-mono mt-0.5">
                              {finding.location?.filePath}:{finding.location?.startLine}
                            </p>
                            {finding.suggestedAction && (
                              <p className="text-[13px] text-ink-2 mt-1">{finding.suggestedAction}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}

          {reports.length < totalReports && (
            <div className="flex items-center justify-center gap-4 pt-2">
              <p className="text-[13px] text-ink-3">
                Showing {reports.length} of {totalReports}
              </p>
              <button
                onClick={() => void load({ append: true })}
                disabled={loading}
                className="btn-secondary px-4 py-2"
              >
                {loading ? 'Loading...' : 'Show more'}
              </button>
            </div>
          )}
        </div>
      )}

      {printEndpoint && (
        <PrintableReportModal
          endpoint={printEndpoint}
          title={`Printable report - ${reports.find(r => `/pdf/${r.id}` === printEndpoint)?.projectName || 'Project'}`}
          onClose={() => setPrintEndpoint(null)}
        />
      )}
    </div>
  )
}
