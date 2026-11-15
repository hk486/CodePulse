import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, FolderOpen, FileText, Loader2, CornerDownLeft } from 'lucide-react'
import { apiFetch } from '../services/apiClient'
import { languageName } from '../services/palette'
import { matches } from '../services/search'

interface ProjectHit {
  id: string
  name: string
  description?: string
  languages?: string[]
  detectedLanguages?: string[]
  fileCount?: number
}

interface ReportHit {
  id: string
  analysisId: string
  projectName: string
  createdAt: string
  summary?: { totalFindings?: number }
}

interface SearchResults {
  projects: ProjectHit[]
  reports: ReportHit[]
}

/**
 * Global search across projects and reports.
 *
 * The results are grouped so it is clear what a hit points at, and every
 * result is a real destination: a project opens its analysis, a report
 * opens the snapshot it was taken from.
 */
export function GlobalSearch({ variant = 'header' }: { variant?: 'header' | 'drawer' }) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResults>({ projects: [], reports: [] })
  const [active, setActive] = useState(0)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounceRef = useRef<number | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const runSearch = useCallback(async (query: string) => {
    if (query.trim().length < 1) {
      setResults({ projects: [], reports: [] })
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [projectsResponse, reportsResponse] = await Promise.all([
        apiFetch('/projects'),
        apiFetch('/reports'),
      ])

      const projects: ProjectHit[] = projectsResponse.ok
        ? (await projectsResponse.json())
            .filter((project: ProjectHit) =>
              matches(
                [
                  project.name,
                  project.description,
                  ...(project.detectedLanguages || project.languages || []),
                ],
                query
              )
            )
            .slice(0, 5)
        : []

      const reports: ReportHit[] = reportsResponse.ok
        ? (await reportsResponse.json())
            .filter((report: ReportHit) => matches([report.projectName], query))
            .slice(0, 5)
        : []

      setResults({ projects, reports })
      setActive(0)
    } catch {
      setResults({ projects: [], reports: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void runSearch(term), 220)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [term, runSearch])

  // Where the dropdown goes. It is measured from the input and rendered
  // in a portal, because the header carries its own backdrop filter and a
  // panel inside it has nothing left to refract.
  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null)
      return
    }
    const measure = () => {
      const node = wrapperRef.current
      if (!node) return
      const rect = node.getBoundingClientRect()
      const width = variant === 'drawer' ? rect.width : 420
      const left = variant === 'drawer' ? rect.left : Math.max(12, rect.right - width)
      setAnchor({ top: rect.bottom + 8, left, width })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [open, variant])

  // Close when clicking outside
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  // Keyboard shortcuts: "/" focuses the search, Escape closes it
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)

      if (event.key === '/' && !isTyping) {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (event.key === 'Escape') {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const flatResults = [
    ...results.projects.map(project => ({ kind: 'project' as const, project })),
    ...results.reports.map(report => ({ kind: 'report' as const, report })),
  ]

  const go = (item: (typeof flatResults)[number] | undefined) => {
    if (!item) return
    // A project opens its analysis, which is the project page. A report
    // opens the snapshot it was taken from.
    if (item.kind === 'project') {
      navigate(`/analysis/${item.project.id}`)
    } else {
      navigate(`/analysis/${item.report.analysisId}`)
    }
    setOpen(false)
    setTerm('')
    inputRef.current?.blur()
  }

  const hasResults = flatResults.length > 0
  const inDrawer = variant === 'drawer'

  return (
    <div
      className={`relative ${inDrawer ? 'w-full' : 'hidden md:block w-72 shrink-0'}`}
      ref={wrapperRef}
    >
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={term}
        placeholder={inDrawer ? 'Search projects, reports...' : 'Search projects, reports...'}
        onChange={event => {
          setTerm(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActive(index => (flatResults.length ? Math.min(index + 1, flatResults.length - 1) : 0))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive(index => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            go(flatResults[active])
          }
        }}
        className="pl-10 pr-10 h-10 rounded-xl text-[14px] text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 transition-colors duration-150 w-full
          [--tw-ring-color:rgb(var(--accent)/0.35)] [--tw-ring-offset-color:transparent]
          bg-white/70 dark:bg-white/[0.05]
          border border-white/85 dark:border-white/[0.09]
          shadow-[0_8px_20px_-12px_rgb(15_23_42_/_0.18)] dark:shadow-none"
        aria-label="Search projects and reports"
      />
      {loading ? (
        <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 animate-spin" />
      ) : (
        !inDrawer && (
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-medium text-ink-3 border border-primary-200 dark:border-primary-800 rounded px-1.5 py-0.5 pointer-events-none">
            /
          </kbd>
        )
      )}

      {open && term.trim().length >= 1 && anchor &&
        createPortal(
        <div
          ref={panelRef}
          className="glass-pop fixed rounded-2xl overflow-hidden z-[60]"
          style={{ top: anchor.top, left: anchor.left, width: anchor.width }}
        >
          {hasResults ? (
            <div className="max-h-[420px] overflow-y-auto py-2">
              {results.projects.length > 0 && (
                <div className="mb-1">
                  <p className="px-4 py-1.5 text-[12px] font-medium text-ink-3">
                    Projects
                  </p>
                  {results.projects.map((project, index) => (
                    <button
                      key={project.id}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go({ kind: 'project', project })}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        active === index
                          ? 'glass-inset'
                          : 'hover:bg-[rgb(var(--glass-fill-hover))]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg glass-chip text-ink-2 flex items-center justify-center flex-shrink-0">
                        <FolderOpen className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-ink truncate">
                          {project.name}
                        </p>
                        <p className="text-[12.5px] text-ink-2 truncate">
                          {project.description ||
                            (project.detectedLanguages || project.languages || [])
                              .map(languageName)
                              .join(', ') ||
                            `${project.fileCount ?? 0} files`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {results.reports.length > 0 && (
                <div>
                  <p className="px-4 py-1.5 text-[12px] font-medium text-ink-3">
                    Reports
                  </p>
                  {results.reports.map((report, index) => {
                    const offset = results.projects.length
                    return (
                      <button
                        key={report.id}
                        onMouseEnter={() => setActive(offset + index)}
                        onClick={() => go({ kind: 'report', report })}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          active === offset + index
                            ? 'glass-inset'
                            : 'hover:bg-[rgb(var(--glass-fill-hover))]'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
                          <FileText className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium text-ink truncate">
                            {report.projectName}
                          </p>
                          <p className="text-[12.5px] text-ink-2 truncate">
                            {report.summary?.totalFindings ?? 0} findings &middot;{' '}
                            {new Date(report.createdAt).toLocaleString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <Search className="w-8 h-8 mx-auto text-ink-3" />
              <p className="mt-3 text-[14px] font-medium text-ink">
                No matches for &quot;{term.trim()}&quot;
              </p>
              <p className="mt-1 text-[13px] text-ink-2">
                Try a project name or a language.
              </p>
            </div>
          )}

          <div className="px-4 py-2 border-t border-[rgb(var(--glass-edge-inset))] flex items-center gap-4 text-[11.5px] text-ink-2">
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> open
            </span>
            <span>&uarr;&darr; navigate</span>
            <span>esc close</span>
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}
