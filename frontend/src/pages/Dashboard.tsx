import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { apiFetch } from '../services/apiClient'
import { facetColor, languageColor, languageWash } from '../services/palette'
import { PageHeader } from '../components/ui/PageHeader'
import type { Project } from '../stores/appStore'
import { StatCard } from '../components/ui/StatCard'
import {
  Grid,
  FileText,
  ArrowRight,
  RefreshCcw,
  Settings,
  Plus,
} from 'lucide-react'

/** The layers of a project, written out for people. */
const FACET_LABELS: Record<string, string> = {
  code: 'Source code',
  database: 'Database',
  infra: 'Infrastructure',
  config: 'Configuration',
  secrets: 'Secrets',
  dependencies: 'Dependencies',
}

/**
 * A short description of what the scanner found in a project: the detected
 * languages, or the frameworks when there is no source code, or a plain
 * "analysed" when the project is only configuration.
 */
function stackSummary(project: Project): string {
  if (project.detectedLanguages?.length) return project.detectedLanguages.join(', ')
  if (project.detectedFrameworks?.length) return project.detectedFrameworks.join(', ')
  const languages = (project.languages || []).filter((language: string) => language && language !== 'auto')
  if (languages.length) return languages.join(', ')
  if (project.fileCount) return 'Analysed'
  return 'Not analysed yet'
}

export function Dashboard() {
  const { projects, fetchProjects, loading, error } = useAppStore()
  const [refreshing, setRefreshing] = useState(false)
  const [totals, setTotals] = useState({
    totalReports: 0,
    totalFindings: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    projects: 0,
    byLanguage: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    byFacet: {} as Record<string, number>,
  })

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  // Real numbers come from the saved reports, so the KPIs always reflect
  // the analyses that actually ran.
  useEffect(() => {
    let cancelled = false
    const loadTotals = async () => {
      try {
        const response = await apiFetch('/reports/summary')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) setTotals(data)
      } catch {
        // the dashboard still works without the report totals
      }
    }
    void loadTotals()
    return () => { cancelled = true }
  }, [projects.length])

  const totalFindings = totals.totalFindings
  const totalCritical = totals.critical

  const stats = [
    {
      label: 'Projects',
      metric: 'projects',
      value: projects.length.toString(),
      trend:
        projects.length > 0
          ? `${totals.projects} analysed`
          : 'nothing uploaded yet',
      emphasis: false,
    },
    {
      label: 'Reports',
      metric: 'reports',
      value: totals.totalReports.toString(),
      trend: totals.totalReports > 0 ? 'saved snapshots' : 'none yet',
      emphasis: false,
    },
    {
      label: 'Findings',
      metric: 'findings',
      value: totalFindings.toString(),
      trend:
        totalFindings > 0
          ? `across ${totals.totalReports} reports`
          : 'nothing found yet',
      emphasis: false,
    },
    {
      label: 'Critical',
      metric: 'critical',
      value: totalCritical.toString(),
      trend: totalCritical > 0 ? 'needs attention' : 'all clear',
      emphasis: totalCritical > 0,
    },
  ]

  // Where the findings are. The layer a finding came from is the honest
  // dimension: a secret found in a yaml file has no language, but it does
  // have a layer.
  const layerRows = useMemo(
    () =>
      Object.entries(totals.byFacet || {})
        .map(([facet, count]) => ({
          facet,
          label: FACET_LABELS[facet] || facet,
          count,
          percent: totalFindings > 0 ? Math.round((count / totalFindings) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count),
    [totals.byFacet, totalFindings]
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchProjects()
    setRefreshing(false)
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Overview of your code quality metrics and project health"
        actions={
          <>
            <Link to="/projects" className="btn-primary inline-flex items-center gap-2">
              <ArrowRight className="w-4 h-4" /> New Project
            </Link>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-ghost"
              title="Refresh"
              aria-label="Refresh the dashboard"
            >
              <RefreshCcw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {/* Stat cards. A number, its label and what it compares to. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {stats.map((stat, index) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            metric={stat.metric}
            trend={stat.trend}
            emphasis={stat.emphasis}
            delay={index * 40}
          />
        ))}
      </div>

      {/* Projects Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Recent Projects */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="title">Recent Projects</h2>
              <p className="text-sm text-ink-2">
                Your recently analyzed code projects
              </p>
            </div>
            <Link to="/projects" className="text-sm font-medium text-ink-2 hover:text-ink transition-colors">
              View all <ArrowRight className="w-3 h-3 inline ml-1" />
            </Link>
          </div>

          <div className="space-y-4">
            {loading ? (
              <div className="space-y-4 py-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="skeleton w-10 h-10 rounded-full" />
                    <div className="flex-1">
                      <div className="skeleton-text" />
                      <div className="skeleton-text w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="p-4 rounded-xl bg-severity-critical/10 border border-severity-critical/25 text-severity-critical text-sm">
                {error}
              </div>
            ) : projects.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <Grid className="w-10 h-10 text-ink-3" />
                </div>
                <div className="empty-state-title">No projects yet</div>
                <div className="empty-state-desc">
                  Get started by creating your first project and uploading source files.
                </div>
                <Link to="/projects" className="btn-primary">
                  Create Project
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div key={project.id} className="glass-inset glass-hover flex items-center justify-between p-3 rounded-xl transition-colors">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{
                          backgroundColor: languageWash(project.detectedLanguages?.[0]),
                          color: languageColor(project.detectedLanguages?.[0]),
                        }}
                      >
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{project.name}</div>
                        <div className="text-[13px] text-ink-2">
                          {stackSummary(project)} • {new Date(project.createdAt || project.updatedAt || Date.now()).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{project.fileCount ?? 0} file{(project.fileCount ?? 0) === 1 ? '' : 's'}</div>
                      <Link to={`/analysis/${project.id}`} className="text-[12px] font-bold text-[12px] text-ink-3 hover:text-ink">
                        View
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="lg:col-span-1 card">
          <div className="mb-6">
            <h2 className="title">Quick Actions</h2>
            <p className="text-sm text-ink-2 mt-1">
              Common tasks to get started
            </p>
          </div>
          <div className="space-y-3">
            <Link
              to="/projects"
              className="glass-inset glass-hover flex items-center justify-between p-4 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg glass-chip text-ink-2 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">Create Project</div>
                  <div className="text-[13px] text-ink-2">Add a new code repository</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-ink-3" />
            </Link>
            <Link
              to="/settings"
              className="glass-inset glass-hover flex items-center justify-between p-4 rounded-xl transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg glass-chip text-ink-2 flex items-center justify-center">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">Settings</div>
                  <div className="text-[13px] text-ink-2">Configure preferences</div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-ink-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Where the findings are. One chart, one accent. */}
      <div className="card">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="title">Where the findings are</h2>
          <span className="text-[13px] text-ink-3">
            {totalFindings} across {totals.totalReports} reports
          </span>
        </div>

        {layerRows.length === 0 ? (
          <p className="text-[14px] text-ink-3 py-6">
            No findings yet. Analyse a project and the breakdown appears here.
          </p>
        ) : (
          <div className="space-y-3">
            {layerRows.map((row) => (
              <div key={row.facet} className="flex items-center gap-4">
                <div className="w-28 shrink-0">
                  <span className="text-[13px] text-ink-2 truncate block">
                    {row.label}
                  </span>
                </div>
                <div className="flex-1 h-2 rounded-full glass-well overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${row.percent}%`,
                      backgroundColor: facetColor(row.facet),
                    }}
                  />
                </div>
                <div className="w-10 text-right shrink-0">
                  <span className="text-[13px] text-ink tabular-nums">{row.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
