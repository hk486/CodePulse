import { API_URL } from './apiClient'

/**
 * The live channel.
 *
 * A scan takes a while, so the browser watches it rather than staring at a
 * spinner. The server sends the progress of every scan the person asking
 * is responsible for.
 *
 * Everything here is best effort. If the socket cannot be opened, the
 * caller falls back to asking the API, so the product still works without
 * it.
 */

export type RealtimeEvent =
  | 'connected'
  | 'analysis:start'
  | 'analysis:progress'
  | 'analysis:complete'
  | 'analysis:error'

export interface RealtimeMessage<T = any> {
  event: RealtimeEvent
  data: T
  timestamp: string
}

export interface AnalysisProgressData {
  analysisId: string
  progress: number
  message: string
  stage?: string
}

export interface AnalysisCompleteData {
  analysisId: string
  findings: number
  summary?: Record<string, number>
}

export interface AnalysisErrorData {
  analysisId: string
  error: string
  hint?: string
  uploadedFiles?: string[]
  fileCount?: number
  scannedFiles?: number
}

type Listener = (message: RealtimeMessage) => void

/**
 * The address of the live channel.
 *
 * It is worked out from the API address, so it is the same machine the
 * rest of the API is on. When the API is behind a proxy that serves the
 * app as well, the same host serves the socket.
 */
export function realtimeUrl(token: string): string {
  const base = API_URL.replace(/\/+$/, '').replace(/\/api$/, '')
  let url: string
  try {
    const parsed = new URL(base)
    url = `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}/ws`
  } catch {
    url = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  }
  return `${url}?token=${encodeURIComponent(token)}`
}

/**
 * One socket for the whole app.
 *
 * The socket is opened when the first listener arrives and closed when the
 * last one goes, so a page that does not care about live updates never
 * opens one.
 */
class RealtimeClient {
  private socket: WebSocket | null = null
  private listeners = new Set<Listener>()
  private token: string | null = null
  private reconnectTimer: number | null = null
  private attempts = 0
  private closedByUs = false

  /**
   * Listen for messages. The function that comes back removes the listener.
   */
  subscribe(token: string, listener: Listener): () => void {
    this.listeners.add(listener)
    this.token = token

    if (!this.socket && token) {
      this.closedByUs = false
      this.open()
    }

    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.disconnect()
      }
    }
  }

  private open() {
    if (!this.token) return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      const socket = new WebSocket(realtimeUrl(this.token))
      this.socket = socket

      socket.onopen = () => {
        this.attempts = 0
      }

      socket.onmessage = event => {
        let message: RealtimeMessage
        try {
          message = JSON.parse(event.data as string)
        } catch {
          return
        }
        if (!message || !message.event) return
        for (const listener of this.listeners) {
          try {
            listener(message)
          } catch {
            // One listener that throws must not stop the others.
          }
        }
      }

      socket.onclose = () => {
        this.socket = null
        if (this.closedByUs || this.listeners.size === 0) return
        // Come back, but not in a tight loop.
        this.attempts += 1
        const wait = Math.min(15000, 500 * 2 ** Math.min(this.attempts, 5))
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer)
        this.reconnectTimer = window.setTimeout(() => this.open(), wait)
      }

      socket.onerror = () => {
        // onclose does the work.
      }
    } catch {
      this.socket = null
    }
  }

  disconnect() {
    this.closedByUs = true
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.socket) {
      try {
        this.socket.close()
      } catch {
        // Nothing to do.
      }
      this.socket = null
    }
    this.token = null
  }

  /**
   * Is the socket open right now?
   */
  get connected() {
    return this.socket?.readyState === WebSocket.OPEN
  }
}

export const realtime = new RealtimeClient()
