import { useCallback, useEffect, useState } from 'react'
import { Webhook, Plus, Trash2, Send, Copy, Check, Power } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

interface Webhook {
  id: string
  projectId: string | null
  url: string
  events: string[]
  active: boolean
  createdAt: string
  lastDeliveryAt: string | null
  lastStatus: number | null
  lastError: string | null
}

const EVENT_LABELS: Record<string, string> = {
  'analysis.completed': 'An analysis finished',
  'analysis.failed': 'An analysis did not finish',
  'gate.failed': 'A gate held the build',
}

const ALL_EVENTS = ['analysis.completed', 'analysis.failed', 'gate.failed']

/**
 * The webhooks of the signed in person.
 *
 * An address that is told when something happens, so a build does not have
 * to keep asking. The body that arrives is signed, and the secret is shown
 * once.
 */
export function WebhooksPanel() {
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['analysis.completed'])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [freshSecret, setFreshSecret] = useState<{ url: string; secret: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/webhooks')
      if (!response.ok) {
        throw new Error(await readError(response, 'The webhooks could not be read.'))
      }
      setHooks(await response.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The webhooks could not be read.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const response = await apiFetch('/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, events }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'The webhook could not be made.'))
      }
      const created = await response.json()
      setFreshSecret({ url: created.url, secret: created.secret })
      setUrl('')
      setEvents(['analysis.completed'])
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The webhook could not be made.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm('Remove this webhook? It stops being told.')) return
    try {
      const response = await apiFetch(`/webhooks/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await readError(response, 'The webhook could not be removed.'))
      }
      setHooks(current => current.filter(hook => hook.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The webhook could not be removed.')
    }
  }

  const toggle = async (hook: Webhook) => {
    try {
      const response = await apiFetch(`/webhooks/${hook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !hook.active }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'The webhook could not be changed.'))
      }
      setHooks(current =>
        current.map(row => (row.id === hook.id ? { ...row, active: !row.active } : row))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The webhook could not be changed.')
    }
  }

  const test = async (id: string) => {
    setTesting(id)
    setError(null)
    try {
      const response = await apiFetch(`/webhooks/${id}/test`, { method: 'POST' })
      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'The address did not take the delivery.')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The test delivery did not work.')
    } finally {
      setTesting(null)
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('The clipboard could not be reached. Copy it by hand.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="title">Webhooks</h3>
        <p className="text-sm text-ink-2 mt-1">
          An address that is told when something happens, so a build does not have to keep
          asking. The body arrives signed with a secret only you and CodePulse know.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {error}
        </p>
      )}

      {freshSecret && (
        <div className="rounded-xl border border-[rgb(var(--glass-edge-inset))] bg-[rgb(var(--glass-fill-inset))] p-4">
          <p className="text-[13px] font-medium text-ink mb-2">
            Copy the secret now. It is shown once and cannot be read again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-[12px] text-ink-2 break-all">
              {freshSecret.secret}
            </code>
            <button
              onClick={() => void copy(freshSecret.secret)}
              className="btn-secondary px-2 py-1.5"
              title="Copy the secret"
            >
              {copied === freshSecret.secret ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-ink-3">
            The delivery carries an <code className="font-mono">X-CodePulse-Signature</code>{' '}
            header: <code className="font-mono">sha256=&lt;HMAC of the timestamp and the body, with
            the secret&gt;</code>. Work it out with the same secret and compare, the way
            Stripe and GitHub do.
          </p>
        </div>
      )}

      <form onSubmit={create} className="space-y-3">
        <div>
          <label className="form-label" htmlFor="webhook-url">
            Where to send it
          </label>
          <input
            id="webhook-url"
            type="url"
            required
            placeholder="https://build.example.com/hooks/codepulse"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <span className="form-label">What to tell it about</span>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {ALL_EVENTS.map(event => {
              const on = events.includes(event)
              return (
                <button
                  key={event}
                  type="button"
                  onClick={() =>
                    setEvents(current =>
                      on ? current.filter(e => e !== event) : [...current, event]
                    )
                  }
                  className={`chip ${on ? 'chip-active' : ''}`}
                >
                  {EVENT_LABELS[event] || event}
                </button>
              )
            })}
          </div>
        </div>

        <button type="submit" disabled={saving || !url.trim()} className="btn-primary">
          <Plus className="w-4 h-4" />
          {saving ? 'Adding...' : 'Add the webhook'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-ink-2">Loading the webhooks...</p>
      ) : hooks.length === 0 ? (
        <div className="empty-state py-10">
          <div className="empty-state-icon">
            <Webhook className="w-8 h-8 text-ink-3" />
          </div>
          <div className="empty-state-title">No webhooks yet</div>
          <div className="empty-state-desc">
            Add an address above and it will be told when a scan finishes.
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {hooks.map(hook => (
            <li
              key={hook.id}
              className="rounded-xl border border-[rgb(var(--glass-edge-inset))] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] text-ink break-all">{hook.url}</p>
                  <p className="text-[12px] text-ink-3 mt-1">
                    {hook.events.map(event => EVENT_LABELS[event] || event).join(' · ')}
                  </p>
                  {hook.lastDeliveryAt ? (
                    <p className="text-[12px] text-ink-3 mt-1">
                      Last delivery {new Date(hook.lastDeliveryAt).toLocaleString()}
                      {hook.lastStatus ? ` — answered with ${hook.lastStatus}` : ''}
                      {hook.lastError ? ` — ${hook.lastError}` : ''}
                    </p>
                  ) : (
                    <p className="text-[12px] text-ink-3 mt-1">Nothing delivered yet.</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => void toggle(hook)}
                    className="btn-ghost p-2"
                    title={hook.active ? 'Stop telling it' : 'Start telling it again'}
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void test(hook.id)}
                    disabled={testing === hook.id}
                    className="btn-ghost p-2"
                    title="Send a test delivery"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => void remove(hook.id)}
                    className="btn-ghost p-2 text-rose-600 dark:text-rose-400"
                    title="Remove it"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {!hook.active && (
                <p className="text-[12px] text-ink-3 mt-2">Paused.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
