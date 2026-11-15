import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Plus, Trash2, Power } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

interface Schedule {
  id: string
  projectId: string
  every: number
  unit: string
  enabled: boolean
  createdAt: string
  nextRunAt: string | null
  lastRunAt: string | null
  runs: number
}

interface Project {
  id: string
  name: string
}

const UNIT_LABELS: Record<string, string> = {
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
  weeks: 'weeks'
}

/**
 * The scheduled analyses.
 *
 * A project that is scanned once goes stale. A schedule says "scan this
 * again every night", so the numbers are about the code as it is now.
 */
export function SchedulesPanel() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const [every, setEvery] = useState('1')
  const [unit, setUnit] = useState('days')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [scheduleResponse, projectResponse] = await Promise.all([
        apiFetch('/schedules'),
        apiFetch('/projects'),
      ])
      if (!scheduleResponse.ok) {
        throw new Error(await readError(scheduleResponse, 'The schedules could not be read.'))
      }
      const rows = await scheduleResponse.json()
      setSchedules(Array.isArray(rows) ? rows : [])
      if (projectResponse.ok) {
        const list = await projectResponse.json()
        setProjects(Array.isArray(list) ? list : [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The schedules could not be read.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectId) return
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch('/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, every: Number(every), unit }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'The schedule could not be made.'))
      }
      setProjectId('')
      setEvery('1')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The schedule could not be made.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (schedule: Schedule) => {
    try {
      const response = await apiFetch(`/schedules/${schedule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'The schedule could not be changed.'))
      }
      setSchedules(current =>
        current.map(row =>
          row.id === schedule.id ? { ...row, enabled: !row.enabled } : row
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The schedule could not be changed.')
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Remove this schedule?')) return
    try {
      const response = await apiFetch(`/schedules/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await readError(response, 'The schedule could not be removed.'))
      }
      setSchedules(current => current.filter(row => row.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The schedule could not be removed.')
    }
  }

  const nameOf = (id: string) => projects.find(p => p.id === id)?.name || 'A project'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="title">Schedules</h3>
        <p className="text-sm text-ink-2 mt-1">
          Scan a project again on a timer, so the numbers are about the code as it is now
          rather than as it was when you last looked.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}

      <form onSubmit={create} className="space-y-3">
        <div>
          <label className="form-label" htmlFor="schedule-project">
            Which project
          </label>
          <select
            id="schedule-project"
            required
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="input-field h-11"
          >
            <option value="">Choose a project</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <div className="w-24">
            <label className="form-label" htmlFor="schedule-every">
              Every
            </label>
            <input
              id="schedule-every"
              type="number"
              min={1}
              required
              value={every}
              onChange={e => setEvery(e.target.value)}
              className="input-field h-11"
            />
          </div>
          <div className="flex-1">
            <label className="form-label" htmlFor="schedule-unit">
              Unit
            </label>
            <select
              id="schedule-unit"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="input-field h-11"
            >
              {Object.keys(UNIT_LABELS).map(key => (
                <option key={key} value={key}>
                  {UNIT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving || !projectId}
          className="btn-primary"
        >
          <Plus className="w-4 h-4" />
          {saving ? 'Adding...' : 'Add the schedule'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-ink-2">Loading the schedules...</p>
      ) : schedules.length === 0 ? (
        <div className="empty-state py-10">
          <div className="empty-state-icon">
            <CalendarClock className="w-8 h-8 text-ink-3" />
          </div>
          <div className="empty-state-title">Nothing scheduled</div>
          <div className="empty-state-desc">
            Add one above and the project is scanned again on a timer.
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {schedules.map(schedule => (
            <li
              key={schedule.id}
              className="rounded-xl border border-[rgb(var(--glass-edge-inset))] p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">
                  {nameOf(schedule.projectId)}
                </p>
                <p className="text-[13px] text-ink-2 mt-0.5">
                  Every {schedule.every} {UNIT_LABELS[schedule.unit] || schedule.unit}
                  {schedule.nextRunAt ? (
                    <>
                      {' — next on '}
                      {new Date(schedule.nextRunAt).toLocaleString()}
                    </>
                  ) : null}
                </p>
                <p className="text-[12px] text-ink-3 mt-1">
                  {schedule.runs > 0
                    ? `Run ${schedule.runs} time${schedule.runs === 1 ? '' : 's'}${
                        schedule.lastRunAt
                          ? `, last on ${new Date(schedule.lastRunAt).toLocaleString()}`
                          : ''
                      }.`
                    : 'It has not run yet.'}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => void toggle(schedule)}
                  className="btn-ghost p-2"
                  title={schedule.enabled ? 'Pause it' : 'Start it again'}
                >
                  <Power className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => void remove(schedule.id)}
                  className="btn-ghost p-2 text-rose-600 dark:text-rose-400"
                  title="Remove it"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
