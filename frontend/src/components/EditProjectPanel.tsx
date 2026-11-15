import { useState } from 'react'
import { Pencil, Save, X } from 'lucide-react'

/**
 * The edit panel for a project.
 *
 * It opens inside the card, in place of the upload panel, so the card
 * stays where it is and the fields do not open over the page.
 */
interface EditProjectPanelProps {
  project: {
    id: string
    name: string
    description?: string
    repositoryUrl?: string
    languages?: string[]
  }
  saving: boolean
  error: string
  onChange: (updates: { name: string; description: string; repositoryUrl: string; language: string }) => void
  onSave: () => void
  onCancel: () => void
}

const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect (recommended)' },
  { value: 'TypeScript', label: 'TypeScript' },
  { value: 'JavaScript', label: 'JavaScript' },
  { value: 'Python', label: 'Python' },
  { value: 'Java', label: 'Java' },
  { value: 'Go', label: 'Go' },
  { value: 'Rust', label: 'Rust' },
  { value: 'PHP', label: 'PHP' },
  { value: 'Ruby', label: 'Ruby' },
  { value: 'C#', label: 'C#' },
]

export function EditProjectPanel({
  project,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: EditProjectPanelProps) {
  const [form, setForm] = useState({
    name: project.name || '',
    description: project.description || '',
    repositoryUrl: project.repositoryUrl || '',
    language:
      project.languages && project.languages.length > 0 && project.languages[0] !== 'auto'
        ? project.languages[0]
        : 'auto',
  })

  const update = (patch: Partial<typeof form>) => {
    const next = { ...form, ...patch }
    setForm(next)
    onChange(next)
  }

  return (
    <div
      className="glass-inset mt-6 rounded-xl p-4"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Pencil className="w-4 h-4 text-ink-2" />
          <h4 className="text-sm font-semibold text-ink">Edit project</h4>
        </div>
        <button
          onClick={onCancel}
          className="btn-icon-sm"
          aria-label="Cancel the edit"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="form-label" htmlFor="edit-project-name">
            Project Name
          </label>
          <input
            id="edit-project-name"
            type="text"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            className="input-field"
            placeholder="e.g. Payment Gateway"
          />
        </div>

        <div>
          <label className="form-label" htmlFor="edit-project-description">
            Description
          </label>
          <textarea
            id="edit-project-description"
            value={form.description}
            onChange={(e) => update({ description: e.target.value })}
            className="input-field h-20 resize-none"
            placeholder="Describe what this project does"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label" htmlFor="edit-project-language">
              Language
            </label>
            <select
              id="edit-project-language"
              value={form.language}
              onChange={(e) => update({ language: e.target.value })}
              className="input-field"
            >
              {LANGUAGES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="edit-project-repository">
              Repository URL
            </label>
            <input
              id="edit-project-repository"
              type="text"
              value={form.repositoryUrl}
              onChange={(e) => update({ repositoryUrl: e.target.value })}
              className="input-field"
              placeholder="https://github.com/username/repo"
            />
          </div>
        </div>

        {error && (
          <p role="alert" className="text-[13px] text-severity-critical">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="btn-primary flex-1 inline-flex items-center justify-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
