import { useCallback, useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { apiFetch } from '../services/apiClient'

interface AuditEntry {
  id: string
  action: string
  detail: Record<string, unknown>
  ip: string | null
  userAgent: string | null
  createdAt: string
}

/**
 * The words a person reads.
 *
 * The actions are stored in a shape that can be searched, and shown like
 * this.
 */
const LABELS: Record<string, string> = {
  registered: 'Created the account',
  signed_in: 'Signed in',
  sign_in_failed: 'Failed to sign in',
  signed_out: 'Signed out',
  account_deleted: 'Deleted the account',
  profile_updated: 'Changed the profile',
  data_downloaded: 'Downloaded their data',
  api_key_created: 'Made an API key',
  api_key_revoked: 'Took an API key away',
  project_created: 'Created a project',
  project_deleted: 'Deleted a project',
  analysis_run: 'Ran an analysis',
  password_reset_requested: 'Asked for a password reset',
  password_reset_completed: 'Reset the password',
}

/**
 * The record of what happened to the account.
 *
 * It is there so that somebody who suspects their account has been used
 * can see what actually happened.
 */
export function AuditLogPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/auth/audit-log')
      if (!response.ok) return
      const data = await response.json()
      setEntries(data.entries || [])
    } catch {
      // the log is not important enough to shout about
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const describe = (entry: AuditEntry): string => {
    const label = LABELS[entry.action] || entry.action.replace(/_/g, ' ')
    const name = entry.detail?.name
    const email = entry.detail?.email
    const suffix = name || email ? ` (${name || email})` : ''
    return `${label}${suffix}`
  }

  return (
    <div className="glass-inset rounded-xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <History className="w-5 h-5 text-ink-2 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-ink">What has happened</div>
          <div className="text-[13px] text-ink-2">
            Every sign in, every key and every change to your projects.
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-ink-3">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-ink-2">
          Nothing has happened yet.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <div
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-[rgb(var(--glass-edge-inset))] px-4 py-3"
            >
              <span className="text-[13px] text-ink">{describe(entry)}</span>
              <span className="text-[12px] text-ink-3">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              {entry.ip && (
                <span className="text-[12px] text-ink-3 font-mono ml-auto">
                  {entry.ip}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
