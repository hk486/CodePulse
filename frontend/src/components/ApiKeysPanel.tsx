import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Plus, Trash2, Copy, Check } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  revoked: boolean
}

/**
 * The API keys of the account.
 *
 * A key is for a machine: a build that pushes a project, a script that
 * asks for a report. The secret is shown once, when it is made, and the
 * list never shows it again.
 */
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [freshKey, setFreshKey] = useState('')
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/auth/api-keys')
      if (!response.ok) return
      const data = await response.json()
      setKeys(data.apiKeys || [])
    } catch {
      // the panel is not important enough to shout about
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setCreating(true)
    setError('')
    try {
      const response = await apiFetch('/auth/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim() || 'API key' }),
      })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not make the key.'))
      }
      const created = await response.json()
      setFreshKey(created.key)
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not make the key.')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (id: string) => {
    if (!window.confirm('Take this key away? It stops working at once.')) return
    setRevoking(id)
    setError('')
    try {
      const response = await apiFetch(`/auth/api-keys/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not take the key away.'))
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not take the key away.')
    } finally {
      setRevoking(null)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(freshKey)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy the key by hand.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="glass-inset rounded-xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <KeyRound className="w-5 h-5 text-ink-2 mt-0.5" />
          <div>
            <div className="text-sm font-medium text-ink">Make a key</div>
            <div className="text-[13px] text-ink-2">
              For a build that pushes a project, or a script that asks for a report.
              Give it a name so you know what it is for.
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="CI on the main branch"
            className="input-field flex-1"
            aria-label="The name of the key"
          />
          <button
            onClick={() => void create()}
            disabled={creating}
            className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {creating ? 'Making...' : 'Make key'}
          </button>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] text-severity-critical">
            {error}
          </p>
        )}
      </div>

      {freshKey && (
        <div className="glass-inset rounded-xl p-6 border-l-2 border-l-accent">
          <div className="flex items-start gap-3 mb-4">
            <Check className="w-5 h-5 text-severity-positive mt-0.5" />
            <div>
              <div className="text-sm font-medium text-ink">Your key is ready</div>
              <div className="text-[13px] text-ink-2">
                Copy it now. It is shown once and cannot be read again.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 min-w-0 truncate rounded-[10px] bg-[rgb(var(--glass-fill-inset))] border border-[rgb(var(--glass-edge-inset))] px-3 py-2.5 text-[13px] font-mono text-ink">
              {freshKey}
            </code>
            <button onClick={() => void copy()} className="btn-secondary px-3 py-2.5">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      <div className="glass-inset rounded-xl p-6">
        <div className="text-sm font-medium text-ink mb-4">Your keys</div>

        {keys.length === 0 ? (
          <p className="text-[13px] text-ink-2">
            There are no keys yet. A key lets a machine use the API without
            holding your password.
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map(key => (
              <div
                key={key.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgb(var(--glass-edge-inset))] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-ink truncate">
                    {key.name}
                    {key.revoked && (
                      <span className="ml-2 text-[12px] font-normal text-ink-3">
                        revoked
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] text-ink-3 mt-0.5 font-mono">
                    {key.prefix}...
                    {key.lastUsedAt
                      ? ` · last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : ' · never used'}
                  </p>
                </div>
                {!key.revoked && (
                  <button
                    onClick={() => void revoke(key.id)}
                    disabled={revoking === key.id}
                    className="btn-icon-sm hover:text-severity-critical disabled:opacity-50"
                    title="Take this key away"
                    aria-label={`Take away the key ${key.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
