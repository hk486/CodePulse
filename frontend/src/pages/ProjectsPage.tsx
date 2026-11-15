import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'
import { useAuthStore } from '../stores/authStore'
import { ExternalLink, Trash2, ChevronDown, FolderOpen, Upload, Pencil, Plus } from 'lucide-react'
import { AlertCircle, FileText, CheckCircle } from 'lucide-react'
import { FileUpload } from '../components/FileUpload'
import { apiFetch, readError } from '../services/apiClient'
import { PrintableReportModal } from '../components/PrintableReportModal'
import { EditProjectPanel } from '../components/EditProjectPanel'
import { PageHeader } from '../components/ui/PageHeader'
import { SearchInput, Toolbar } from '../components/ui/Toolbar'
import { languageColor, languageName, languageWash } from '../services/palette'
import { matches } from '../services/search'
import type { Project } from '../stores/appStore'
import type { AnalysisQueued } from '@codepulse/shared'

interface NewProjectForm {
  name: string
  description: string
  repositoryUrl: string
  language: string
  languages: string[]
}

/**
 * The languages the scanner actually found. Falls back to what the user
 * declared when the project has not been analysed yet.
 */
function detectedLanguages(project: Project): string[] {
  if (project.detectedLanguages?.length) return project.detectedLanguages
  return (project.languages || []).filter((l: string) => l && l !== 'auto')
}

/**
 * A short description of what the scanner found in a project: the detected
 * languages, or the frameworks when there is no source code, or a plain
 * "analysed" when the project is only configuration.
 */
function stackSummary(project: Project): string {
  if (project.detectedLanguages?.length) {
    return project.detectedLanguages.map(languageName).join(', ')
  }
  if (project.detectedFrameworks?.length) return project.detectedFrameworks.join(', ')
  const languages = (project.languages || []).filter(
    (language: string) => language && language !== 'auto'
  )
  if (languages.length) return languages.map(languageName).join(', ')
  if (project.fileCount) return 'Analysed'
  return 'Not analysed yet'
}

export function ProjectsPage() {
  const { projects, fetchProjects, error, deleteProject } = useAppStore()
  const { token } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('all')
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    repositoryUrl: '',
    language: 'auto',
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const [showNewProjectForm, setShowNewProjectForm] = useState(false)
  const [newProject, setNewProject] = useState<NewProjectForm>({
    name: '',
    description: '',
    repositoryUrl: '',
    language: 'auto',
    languages: ['auto']
  })
  const [creatingProject, setCreatingProject] = useState(false)
  const [createError, setCreateError] = useState('')
  const [runningAnalysis, setRunningAnalysis] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisQueued | null>(null)
  const [reportProjectId, setReportProjectId] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      if (token) {
        setLoading(true)
        try {
          await fetchProjects()
        } catch (error) {
          console.error('Failed to load projects:', error)
        } finally {
          setLoading(false)
        }
      }
    }

    loadData()
  }, [token])

  // When a project opens, bring it into view. Creating one opens it
  // straight away, and the upload panel is below the fold.
  useEffect(() => {
    if (!expandedProjectId) return
    const node = document.querySelector(`[data-project-card="${expandedProjectId}"]`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [expandedProjectId])

  const filteredProjects = projects.filter((p) => {
    const matchesSearch = matches(
      [p.name, p.description, ...detectedLanguages(p)],
      searchTerm
    )
    const matchesLanguage =
      filterLanguage === 'all' || detectedLanguages(p).includes(filterLanguage)
    return matchesSearch && matchesLanguage
  })

  const languages = [
    'all',
    ...new Set(projects.flatMap(p => detectedLanguages(p)).filter(Boolean) as string[])
  ]

  /**
   * Open the edit panel for a project.
   */
  const startEditingProject = (project: Project) => {
    setEditingProjectId(project.id)
    setEditError('')
    setEditForm({
      name: project.name || '',
      description: project.description || '',
      repositoryUrl: project.repositoryUrl || '',
      language:
        project.languages && project.languages.length > 0 && project.languages[0] !== 'auto'
          ? project.languages[0]
          : 'auto',
    })
  }

  /**
   * Save the edit panel.
   */
  const saveProjectEdit = async (projectId: string) => {
    setSavingEdit(true)
    setEditError('')
    try {
      const response = await apiFetch(`/projects/${projectId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim(),
          repositoryUrl: editForm.repositoryUrl.trim(),
          languages: [editForm.language],
        }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not save the project.'))
      }
      await fetchProjects()
      setEditingProjectId(null)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save the project.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleCreateProject = async () => {
    if (!newProject.name.trim()) return

    setCreatingProject(true)
    setCreateError('')
    try {
      const response = await apiFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({ ...newProject, languages: [newProject.language] })
      })

      if (!response.ok) {
        throw new Error(await readError(response, `Could not create project (HTTP ${response.status}).`))
      }
      const created = await response.json()
      await fetchProjects()
      // Open the new project on its upload panel. Getting the code in is
      // the next thing you want to do, so it should not be a hidden step.
      setExpandedProjectId(created.id)
      setNewProject({
        name: '',
        description: '',
        repositoryUrl: '',
        language: 'auto',
        languages: ['auto']
      })
      setShowNewProjectForm(false)
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create project.')
    } finally {
      setCreatingProject(false)
    }
  }

  const formatDate = (timestamp: number | string) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Projects"
        description="Manage your code repositories and analysis"
        actions={
          <button
            onClick={() => setShowNewProjectForm(!showNewProjectForm)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        }
      />

      {/* New Project Form */}
      {showNewProjectForm && (
        <div className="card-flush">
          <div className="p-6 border-b border-[rgb(var(--glass-edge-inset))]">
            <h2 className="title">Create New Project</h2>
            <p className="text-sm text-ink-2 mt-1">
              Create the project, then upload its folder or files &mdash; or point us
              at a public repository to clone.
            </p>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="form-label" htmlFor="new-project-name">Project Name</label>
                <input
                  id="new-project-name"
                  type="text"
                  placeholder="e.g. Payment Gateway"
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="form-label" htmlFor="new-project-language">Language</label>
                <select
                  id="new-project-language"
                  value={newProject.language}
                  onChange={(e) => setNewProject({ ...newProject, language: e.target.value, languages: [e.target.value] })}
                  className="input-field"
                >
                  <option value="auto">Auto-detect (recommended)</option>
                  <option value="TypeScript">TypeScript</option>
                  <option value="JavaScript">JavaScript</option>
                  <option value="Python">Python</option>
                  <option value="Java">Java</option>
                  <option value="Go">Go</option>
                  <option value="Rust">Rust</option>
                  <option value="PHP">PHP</option>
                  <option value="Ruby">Ruby</option>
                  <option value="C#">C#</option>
                </select>
                <p className="form-hint">
                  The scanner detects every language in your project on its own.
                </p>
              </div>
            </div>
            <div>
              <label className="form-label" htmlFor="new-project-repo">
                Repository URL <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <input
                id="new-project-repo"
                type="text"
                placeholder="https://github.com/username/repo"
                value={newProject.repositoryUrl}
                onChange={(e) => setNewProject({ ...newProject, repositoryUrl: e.target.value })}
                className="input-field"
              />
              <p className="form-hint">
                A public GitHub, GitLab or Bitbucket repository. It is cloned and
                scanned when you run the analysis. Leave this empty to upload your own
                folder or files instead.
              </p>
            </div>
            <div>
              <label className="form-label" htmlFor="new-project-description">Description</label>
              <textarea
                id="new-project-description"
                placeholder="Describe what this project does"
                value={newProject.description}
                onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                className="input-field h-32 resize-none"
              />
            </div>
            {createError && (
              <div className="alert alert-error" role="alert">
                <AlertCircle className="w-4 h-4" />
                <span>{createError}</span>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleCreateProject}
                disabled={creatingProject || !newProject.name.trim()}
                className="btn-primary flex-1"
              >
                {creatingProject ? 'Creating...' : 'Create Project'}
              </button>
              <button
                onClick={() => setShowNewProjectForm(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <Toolbar>
        <SearchInput
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by project name or language"
          label="Search projects"
        />
        <select
          value={filterLanguage}
          onChange={(e) => setFilterLanguage(e.target.value)}
          aria-label="Filter by language"
          className="input-field h-11 md:w-48"
        >
          {languages.map((lang) => (
            <option key={lang} value={lang}>
              {lang === 'all' ? 'All languages' : languageName(lang)}
            </option>
          ))}
        </select>
      </Toolbar>

      {/* Projects List */}
      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
      {analysisError && (
        <div className="alert alert-warning" role="alert">
          <AlertCircle className="w-4 h-4" />
          <span>{analysisError}</span>
        </div>
      )}
      {analysisResult && (
        <div className="alert alert-success" role="status">
          <CheckCircle className="w-4 h-4" />
          <span>
            The analysis is under way. Opening the report as it runs...
          </span>
        </div>
      )}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-16">
            <div className="flex items-center justify-center gap-2 animate-pulse">
              <div className="w-3 h-3 bg-primary-500 rounded-full" />
              <div className="w-3 h-3 bg-primary-500 rounded-full" />
              <div className="w-3 h-3 bg-primary-500 rounded-full" />
            </div>
            <p className="mt-4 text-sm text-ink-2">Loading projects...</p>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="empty-state py-16">
            <div className="empty-state-icon">
              <FileText className="w-10 h-10 text-ink-3" />
            </div>
            <div className="empty-state-title">No projects found</div>
            <div className="empty-state-desc">
              {searchTerm ? 'Try adjusting your search or filters.' : 'Create your first project to get started.'}
            </div>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="btn-secondary"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-5">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                data-project-card={project.id}
                className={`card group relative flex flex-col cursor-pointer transition-colors duration-150
                           hover:border-[rgb(var(--glass-edge-strong))]
                           ${expandedProjectId === project.id ? 'lg:col-span-2 2xl:col-span-3' : ''}`}
                onClick={() => setExpandedProjectId(expandedProjectId === project.id ? null : project.id)}
              >
                {/* What it is made of. The languages come first, because
                    that is what tells one project from another. */}
                {(detectedLanguages(project).length > 0 ||
                  (project.components && project.components.length > 1)) && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-4">
                    {detectedLanguages(project).slice(0, 3).map(language => (
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
                    {detectedLanguages(project).length > 3 && (
                      <span className="text-[11px] text-ink-3">
                        +{detectedLanguages(project).length - 3} more
                      </span>
                    )}
                    {project.components && project.components.length > 1 && (
                      <span className="badge badge-info">
                        {project.components.length} components
                      </span>
                    )}
                  </div>
                )}

                {/* The name gets the width it needs, and the quieter
                    actions sit at the end of its own line. */}
                <div className="flex items-start justify-between gap-3">
                  <h3 className="title leading-tight break-words min-w-0" title={project.name}>
                    {project.name}
                  </h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setExpandedProjectId(project.id)
                        startEditingProject(project)
                      }}
                      className="btn-icon-sm"
                      title="Edit the project"
                      aria-label="Edit the project"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setReportProjectId(project.id)
                      }}
                      className="btn-icon-sm"
                      title="Open the project report"
                      aria-label="Open the project report"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm('Delete this project?')) {
                          deleteProject(project.id)
                        }
                      }}
                      className="btn-icon-sm hover:text-severity-critical"
                      title="Delete project"
                      aria-label="Delete project"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-ink-2 mt-2 line-clamp-2 leading-relaxed">
                  {project.description || 'No description provided'}
                </p>

                {/* What it is made of, and how big it is */}
                <div className="mt-5 pt-4 border-t border-[rgb(var(--glass-edge-inset))]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] text-ink-2 truncate">{stackSummary(project)}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="chip-active">{project.status || 'active'}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-ink-3 transition-transform ${
                          expandedProjectId === project.id ? 'rotate-180' : ''
                        }`}
                      />
                    </div>
                  </div>
                  {(project.fileCount ?? 0) === 0 && !project.repositoryUrl && (
                    <p className="mt-2 text-[12px] text-ink-3 flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5" />
                      No files yet &mdash; click to upload your project
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-3 whitespace-nowrap">
                    <span>
                      {project.fileCount ?? 0} file{(project.fileCount ?? 0) === 1 ? '' : 's'}
                    </span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{formatDate(project.createdAt || project.updatedAt || Date.now())}</span>
                  </div>
                </div>

                {/* Repository Link */}
                {project.repositoryUrl && (
                  <div className="mt-3">
                    <a
                      href={project.repositoryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 hover:text-ink transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Open Repository
                    </a>
                  </div>
                )}

                {/* The row of things you can do with it. */}
                <div className="mt-auto pt-5 flex items-center justify-end gap-2">
                  <Link
                    to={`/analysis/${project.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="btn-secondary px-4 py-2 text-[14px] font-medium whitespace-nowrap"
                  >
                    View Analysis
                  </Link>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      setRunningAnalysis(project.id)
                      setAnalysisError(null)
                      try {
                        const response = await apiFetch(`/analysis/run/${project.id}`, {
                          method: 'POST',
                        })
                        if (!response.ok) {
                          let message = `Analysis failed (HTTP ${response.status}).`
                          let hint = ''
                          let uploadedFiles: string[] = []
                          try {
                            const errorData = await response.json()
                            if (errorData?.error) message = errorData.error
                            if (errorData?.hint) hint = errorData.hint
                            if (Array.isArray(errorData?.uploadedFiles)) uploadedFiles = errorData.uploadedFiles
                          } catch {
                            // keep default
                          }
                          const detail = uploadedFiles.length > 0
                            ? `\n\nFiles received (${uploadedFiles.length}): ${uploadedFiles.slice(0, 12).join(', ')}${uploadedFiles.length > 12 ? ', ...' : ''}`
                            : ''
                          throw new Error(`${message}${hint ? `\n${hint}` : ''}${detail}`)
                        }
                        const result = await response.json()
                        // The scan is a job now, so the answer comes back
                        // straight away and the report page follows it
                        // as it runs.
                        setAnalysisResult(result)
                        setTimeout(() => {
                          window.location.href = `/analysis/${result.id}`
                        }, 400)
                      } catch (err) {
                        setAnalysisError(err instanceof Error ? err.message : 'Analysis failed.')
                      } finally {
                        setRunningAnalysis(null)
                      }
                    }}
                    className="btn-primary px-4 py-2 text-[14px] font-medium whitespace-nowrap"
                    disabled={runningAnalysis === project.id}
                  >
                    {runningAnalysis === project.id ? 'Starting...' : 'Run Analysis'}
                  </button>
                </div>

                {/* The edit panel, in place of the upload panel */}
                {editingProjectId === project.id && (
                  <EditProjectPanel
                    project={project}
                    saving={savingEdit}
                    error={editError}
                    onChange={setEditForm}
                    onSave={() => void saveProjectEdit(project.id)}
                    onCancel={() => setEditingProjectId(null)}
                  />
                )}

                {/* File Upload Section - shows when expanded */}
                {expandedProjectId === project.id && !editingProjectId && (
                  <div
                    // Keep clicks inside the panel from bubbling up to the
                    // card, which would collapse the panel straight away.
                    onClick={(e) => e.stopPropagation()}
                    className="glass-inset mt-6 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <FolderOpen className="w-5 h-5 text-ink-2 hover:text-ink" />
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Upload Project Files</h4>
                    </div>
                    <FileUpload projectId={project.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {reportProjectId && (
        <PrintableReportModal
          endpoint={`/pdf/project/${reportProjectId}`}
          title="Project report"
          onClose={() => setReportProjectId(null)}
        />
      )}
    </div>
  )
}


