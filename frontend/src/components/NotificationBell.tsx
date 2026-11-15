import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Check, X, CheckCheck, Trash2, Inbox } from 'lucide-react'
import { apiFetch } from '../services/apiClient'

interface NotificationItem {
  id: string
  type: string
  title: string
  message: string | null
  link: string | null
  severity: string
  read: boolean
  createdAt: string
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-rose-100 dark:bg-rose-900/40 text-severity-critical',
  high: 'bg-amber-100 dark:bg-amber-900/40 text-severity-medium',
  medium: 'bg-primary-100 dark:bg-primary-900/40 text-ink-2 hover:text-ink',
  success: 'bg-emerald-100 dark:bg-emerald-900/40 text-severity-positive',
  info: 'glass-chip text-ink-2',
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * The notification bell with a dropdown of everything that happened while
 * the user was away.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  // The live update preference. With it off the bell only refreshes when
  // it is opened, instead of keeping itself up to date in the background.
  const [liveUpdates, setLiveUpdates] = useState(true)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/notifications')
      if (!response.ok) return
      const data = await response.json()
      setItems(data.notifications || [])
      setUnread(data.unread || 0)
      setLiveUpdates(data.preferences?.realTimeUpdates !== false)
    } catch {
      // a failed poll must never break the header
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Poll so a finished analysis shows up without a manual refresh. The
  // live update preference decides whether this runs at all.
  useEffect(() => {
    if (!liveUpdates) return
    const timer = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(timer)
  }, [liveUpdates, load])

  // Close the dropdown when clicking outside of it
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const markRead = async (notification: NotificationItem) => {
    if (!notification.read) {
      setItems(current =>
        current.map(item => (item.id === notification.id ? { ...item, read: true } : item))
      )
      setUnread(count => Math.max(0, count - 1))
      try {
        await apiFetch(`/notifications/${notification.id}/read`, { method: 'POST' })
      } catch {
        void load()
      }
    }
    if (notification.link) {
      setOpen(false)
    }
  }

  const markAllRead = async () => {
    setItems(current => current.map(item => ({ ...item, read: true })))
    setUnread(0)
    try {
      await apiFetch('/notifications/read-all', { method: 'POST' })
    } catch {
      void load()
    }
  }

  const dismiss = async (event: React.MouseEvent, notification: NotificationItem) => {
    event.preventDefault()
    event.stopPropagation()
    setItems(current => current.filter(item => item.id !== notification.id))
    if (!notification.read) setUnread(count => Math.max(0, count - 1))
    try {
      await apiFetch(`/notifications/${notification.id}`, { method: 'DELETE' })
    } catch {
      void load()
    }
  }

  const clearAll = async () => {
    setItems([])
    setUnread(0)
    try {
      await apiFetch('/notifications', { method: 'DELETE' })
    } catch {
      void load()
    }
  }

  return (
    <div className="relative shrink-0" ref={wrapperRef}>
      <button
        onClick={() => {
          setOpen(!open)
          if (!open) void load()
        }}
        className="p-2.5 text-ink-2 dark:text-ink-3 hover:text-ink-2 dark:hover:text-ink-2 hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] rounded-xl transition-colors relative"
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
      >
        <Bell className="w-[19px] h-[19px]" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[19px] h-[19px] px-1 rounded-full bg-rose-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-[rgb(var(--surface-page))]">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="glass-pop absolute right-0 mt-2 w-[380px] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary-200 dark:border-primary-800">
            <h3 className="text-[15px] font-semibold text-ink">
              Notifications
              {unread > 0 && (
                <span className="ml-2 text-[12px] font-medium text-ink-2">
                  {unread} unread
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={markAllRead}
                  className="p-2 rounded-lg text-ink-3 hover:text-ink-2 dark:hover:text-ink-2 hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                  title="Mark all as read"
                  aria-label="Mark all as read"
                >
                  <CheckCheck className="w-4 h-4" />
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={clearAll}
                  className="p-2 rounded-lg text-ink-3 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                  title="Clear all"
                  aria-label="Clear all notifications"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-ink-2">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Inbox className="w-9 h-9 mx-auto text-ink-3 dark:text-ink-2" />
                <p className="mt-3 text-[14px] font-medium text-ink">
                  You are all caught up
                </p>
                <p className="mt-1 text-[13px] text-ink-2">
                  Finished analyses and new issues show up here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[rgb(var(--glass-edge-inset))]">
                {items.map(notification => {
                  const content = (
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          SEVERITY_STYLES[notification.severity] || SEVERITY_STYLES.info
                        }`}
                      >
                        {notification.read ? (
                          <Check className="w-4 h-4" />
                        ) : (
                          <Bell className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-[14px] leading-snug ${
                            notification.read
                              ? 'font-medium text-ink-2'
                              : 'font-semibold text-ink'
                          }`}
                        >
                          {notification.title}
                        </p>
                        {notification.message && (
                          <p className="text-[13px] text-ink-2 mt-0.5 leading-snug">
                            {notification.message}
                          </p>
                        )}
                        <p className="text-[12px] text-ink-2 mt-1">
                          {relativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  )

                  return (
                    <li key={notification.id} className="group relative">
                      {notification.link ? (
                        <Link
                          to={notification.link}
                          onClick={() => {
                            void markRead(notification)
                          }}
                          className={`block px-4 py-3.5 pr-11 transition-colors ${
                            notification.read
                              ? 'hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))]'
                              : 'bg-primary-50/40 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                          }`}
                        >
                          {content}
                        </Link>
                      ) : (
                        <button
                          onClick={() => void markRead(notification)}
                          className="block w-full text-left px-4 py-3.5 pr-11 hover:bg-[rgb(var(--glass-fill-hover))] dark:hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                        >
                          {content}
                        </button>
                      )}
                      <button
                        onClick={event => void dismiss(event, notification)}
                        className="absolute top-3 right-3 p-1.5 rounded-lg text-ink-3 dark:text-ink-2 opacity-0 group-hover:opacity-100 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-[rgb(var(--glass-fill-hover))] transition-colors"
                        title="Dismiss"
                        aria-label={`Dismiss notification: ${notification.title}`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {items.length > 0 && (
            <div className="px-4 py-2.5 border-t border-primary-200 dark:border-primary-800 bg-surface-page dark:bg-surface-raised/40">
              <Link
                to="/settings"
                onClick={() => setOpen(false)}
                className="text-[13px] font-medium text-ink-2 hover:text-ink hover:text-ink-2"
              >
                Notification settings
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
