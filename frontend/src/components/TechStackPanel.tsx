import { useMemo, useState } from 'react'
import { Boxes, Database, Cloud, Package, GitBranch, Layers, ShieldAlert, FileCode } from 'lucide-react'
import { facetColor, facetWash, languageColor, languageName, languageWash } from '../services/palette'

export interface DetectedComponent {
  id: string
  name: string
  relativePath?: string
  languages?: string[]
  frameworks?: string[]
  databases?: string[]
  infrastructure?: string[]
  packageManagers?: string[]
  ciTools?: string[]
  facets?: string[]
  manifests?: string[]
  fileCount?: number
}

export interface DetectedTechStack {
  languages: string[]
  frameworks: string[]
  databases: string[]
  infrastructure: string[]
  packageManagers: string[]
  ciTools: string[]
  facets: string[]
}

interface DetectedCoverage {
  totalFiles?: number
  totalBytes?: number
  skippedByBudget?: number
  skippedBySize?: number
  truncated?: boolean
  languages?: Record<string, number>
  languagesWithoutAnalyzer?: string[]
}

interface TechStackPanelProps {
  languages: string[]
  frameworks: string[]
  techStack?: DetectedTechStack
  components?: DetectedComponent[]
  projectType?: string | null
  analyzersRun?: string[]
  /** How much of the project was analysed. */
  coverage?: DetectedCoverage | null
  /** Findings per component, used for the counts. */
  byComponent?: Record<string, number>
  onFilterByComponent?: (componentId: string | null) => void
  activeComponent?: string | null
}

/**
 * The facets each get a hue, the same way languages do, so the key holds
 * across the panel. Code stays neutral: it is the default case, not a
 * category to shout about.
 */
const FACET_META: Record<string, { label: string; icon: typeof FileCode }> = {
  code: { label: 'Code', icon: FileCode },
  database: { label: 'Database', icon: Database },
  infra: { label: 'Infrastructure', icon: Cloud },
  config: { label: 'Configuration', icon: Layers },
  secrets: { label: 'Secrets', icon: ShieldAlert },
  dependencies: { label: 'Dependencies', icon: Package },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/**
 * A chip of glass. The tone picks a slot from the same palette the
 * languages and the facets use, so a chip keeps its colour wherever it
 * appears.
 */
function Chip({ label, slot = null }: { label: string; slot?: number | null }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium glass-chip"
      style={
        slot != null
          ? {
              backgroundColor: `rgb(var(--lang-${slot}) / 0.14)`,
              borderColor: `rgb(var(--lang-${slot}))`,
              color: `rgb(var(--lang-${slot}))`,
            }
          : undefined
      }
    >
      {label}
    </span>
  )
}

/**
 * Shows what the scanner actually found in the project: the languages, the
 * frameworks, the databases, the infrastructure and - for a polyglot or
 * monorepo project - the individual components it is made of.
 */
export function TechStackPanel({
  languages,
  frameworks,
  techStack,
  components = [],
  projectType,
  analyzersRun = [],
  coverage,
  byComponent = {},
  onFilterByComponent,
  activeComponent,
}: TechStackPanelProps) {
  // The stack is context, not the headline. It starts folded away so the
  // numbers that matter are the first thing on the page.
  const [expanded, setExpanded] = useState(false)

  const stack = useMemo(() => ({
    databases: techStack?.databases ?? [],
    infrastructure: techStack?.infrastructure ?? [],
    packageManagers: techStack?.packageManagers ?? [],
    ciTools: techStack?.ciTools ?? [],
    facets: techStack?.facets ?? [],
  }), [techStack])

  // Every language that was found, whether or not it has a dedicated analyzer
  const allLanguages = useMemo(() => {
    const fromStack = techStack?.languages ?? []
    const merged = [...new Set([...fromStack, ...languages])]
    return merged
  }, [techStack?.languages, languages])

  const withoutAnalyzer = useMemo(() => {
    const listed = new Set(coverage?.languagesWithoutAnalyzer ?? [])
    // Any language that is not one of the analysed ones has no dedicated
    // analyzer, otherwise the report would not know about it.
    return allLanguages.filter(language => listed.has(language))
  }, [allLanguages, coverage?.languagesWithoutAnalyzer])

  const hasStack =
    languages.length > 0 ||
    frameworks.length > 0 ||
    stack.databases.length > 0 ||
    stack.infrastructure.length > 0

  if (!hasStack && components.length === 0) return null

  return (
    <div className="card-flush">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-6 text-left"
      >
        <div className="flex items-center gap-3">
          <Boxes className="w-5 h-5 text-ink-2" />
          <div>
            <h2 className="title">
              Detected Stack
              {components.length > 1 && (
                <span className="ml-2 text-[13px] font-normal text-ink-2">
                  {components.length} components
                </span>
              )}
            </h2>
            <p className="text-sm text-ink-2 mt-1">
              {projectType && projectType !== 'unknown'
                ? `${projectType.charAt(0).toUpperCase()}${projectType.slice(1)} project`
                : 'What the scanner found in your project'}
            </p>
          </div>
        </div>
        <span className="text-[13px] text-ink-3">{expanded ? 'Hide' : 'Show'}</span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 space-y-6">
          {/* What was analysed */}
          {coverage && coverage.totalFiles !== undefined && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-2 dark:text-ink-3">
              <span>
                <strong className="font-semibold text-gray-900 dark:text-white">
                  {coverage.totalFiles.toLocaleString()}
                </strong>{' '}
                files analysed
              </span>
              {coverage.totalBytes !== undefined && coverage.totalBytes > 0 && (
                <span>&middot; {formatBytes(coverage.totalBytes)} read</span>
              )}
              {coverage.truncated && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
                  {((coverage.skippedByBudget ?? 0) + (coverage.skippedBySize ?? 0)).toLocaleString()}{' '}
                  files left out to stay within the analysis budget
                </span>
              )}
            </div>
          )}
          {/* Facets */}
          {stack.facets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {stack.facets.map(facet => {
                const meta = FACET_META[facet]
                const Icon = meta?.icon ?? Layers
                return (
                  <span
                    key={facet}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] font-medium glass-chip"
                    style={{
                      backgroundColor: facetWash(facet),
                      borderColor: facetColor(facet),
                      color: facetColor(facet),
                    }}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {meta?.label ?? facet}
                  </span>
                )
              })}
            </div>
          )}

          {/* Stack groups */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {allLanguages.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  Languages
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {allLanguages.map(language => {
                    const pending = withoutAnalyzer.includes(language)
                    return (
                      <span
                        key={language}
                        title={
                          pending
                            ? `${languageName(language)} has no dedicated analyzer yet, the generic rules were applied`
                            : undefined
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${
                          pending
                            ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-dashed border-amber-300 dark:border-amber-700'
                            : 'bg-primary-50 dark:bg-primary-900/30 text-ink dark:text-ink-2'
                        }`}
                      >
                        {languageName(language)}
                        {pending && <span className="text-[10px] font-normal">· generic only</span>}
                      </span>
                    )
                  })}
                </div>
                {withoutAnalyzer.length > 0 && (
                  <p className="text-[12px] text-ink-2 mt-2">
                    {withoutAnalyzer.length} language{withoutAnalyzer.length === 1 ? '' : 's'} have no
                    dedicated analyzer yet. The generic rules were applied to them.
                  </p>
                )}
              </div>
            )}

            {frameworks.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  Frameworks
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {frameworks.map(framework => (
                    <Chip key={framework} label={framework} />
                  ))}
                </div>
              </div>
            )}

            {stack.databases.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  Databases
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stack.databases.map(database => (
                    <Chip key={database} label={database} slot={2} />
                  ))}
                </div>
              </div>
            )}

            {stack.infrastructure.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  Infrastructure
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stack.infrastructure.map(tool => (
                    <Chip key={tool} label={tool} slot={3} />
                  ))}
                </div>
              </div>
            )}

            {stack.packageManagers.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  Package managers
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stack.packageManagers.map(manager => (
                    <Chip key={manager} label={manager} slot={1} />
                  ))}
                </div>
              </div>
            )}

            {stack.ciTools.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-ink-3 mb-2">
                  CI / CD
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {stack.ciTools.map(tool => (
                    <Chip key={tool} label={tool} slot={3} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Components */}
          {components.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-ink-3 mb-3">
                Components
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {components.map(component => {
                  const count = byComponent[component.id] ?? 0
                  const isActive = activeComponent === component.id
                  return (
                    <button
                      key={component.id}
                      type="button"
                      onClick={() => onFilterByComponent?.(isActive ? null : component.id)}
                      className={`text-left p-4 rounded-xl border transition-colors ${
                        isActive
                          ? 'border-primary-400 dark:border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-primary-200 dark:border-primary-800 hover:border-primary-300 dark:hover:border-primary-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                            <GitBranch className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
                            <span className="truncate">
                              {component.relativePath || component.name}
                            </span>
                          </p>
                          {component.relativePath && (
                            <p className="text-[11px] text-ink-3 mt-0.5 ml-5">
                              {component.name}
                            </p>
                          )}
                        </div>
                        <span className={`shrink-0 text-[13px] font-semibold px-2 py-0.5 rounded-md ${
                          count > 0
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                            : 'glass-chip text-ink-2'
                        }`}>
                          {count} finding{count === 1 ? '' : 's'}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5 mt-3 ml-5">
                        {(component.languages ?? []).map(language => (
                          <span
                            key={language}
                            className="badge"
                            style={{
                              backgroundColor: languageWash(language),
                              borderColor: languageColor(language),
                              color: languageColor(language),
                            }}
                          >
                            {languageName(language)}
                          </span>
                        ))}
                        {(component.frameworks ?? []).map(framework => (
                          <Chip key={framework} label={framework} />
                        ))}
                        {(component.databases ?? []).map(database => (
                          <Chip key={database} label={database} slot={2} />
                        ))}
                        {(component.infrastructure ?? []).map(tool => (
                          <Chip key={tool} label={tool} slot={3} />
                        ))}
                      </div>

                      {(component.manifests ?? []).length > 0 && (
                        <p className="text-[11px] text-ink-3 mt-2 ml-5 font-mono truncate">
                          {(component.manifests ?? []).join(' · ')}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {analyzersRun.length > 0 && (
            <div>
              <p className="text-[12px] font-medium text-ink-3 mb-2">
                Analyzers that ran
              </p>
              <div className="flex flex-wrap gap-1.5">
                {analyzersRun.map(analyzer => (
                  <Chip key={analyzer} label={analyzer} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
