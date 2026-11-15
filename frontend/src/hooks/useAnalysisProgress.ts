import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { realtime, type RealtimeMessage } from '../services/realtime'
import { apiFetch } from '../services/apiClient'
import type {
  AnalysisProgressData,
  AnalysisCompleteData,
  AnalysisErrorData,
} from '../services/realtime'

export type AnalysisStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface AnalysisProgress {
  status: AnalysisStatus
  progress: number
  stage: string
  message: string
  error?: string
  hint?: string
  uploadedFiles?: string[]
}

/**
 * Follow a scan while it runs.
 *
 * The server sends the progress over the live channel, which is the quick
 * way. The API is asked as well, because the live channel is a nicety: if
 * it is blocked by a proxy, or the browser refused the socket, the scan
 * still shows what it is doing.
 */
export function useAnalysisProgress(
  analysisId: string | undefined,
  onSettled?: () => void
) {
  const token = useAuthStore(state => state.token)
  const [state, setState] = useState<AnalysisProgress>({
    status: 'queued',
    progress: 0,
    stage: 'queued',
    message: 'Waiting to start',
  })
  const settledRef = useRef(false)
  const onSettledRef = useRef(onSettled)
  onSettledRef.current = onSettled

  const settle = useCallback(() => {
    if (settledRef.current) return
    settledRef.current = true
    onSettledRef.current?.()
  }, [])

  useEffect(() => {
    if (!analysisId || !token) return

    let cancelled = false
    let pollTimer: number | null = null

    const readStatus = async () => {
      try {
        const response = await apiFetch(`/analysis/${analysisId}`)
        if (!response.ok || cancelled) return
        const data = await response.json()
        if (cancelled) return
        const status = (data?.status || 'queued') as AnalysisStatus
        setState(current => ({
          ...current,
          status,
          progress: typeof data?.progress === 'number' ? data.progress : current.progress,
          stage: data?.stage || current.stage,
          message: data?.error || current.message,
          error: data?.error || undefined,
        }))
        if (status === 'completed' || status === 'failed') settle()
      } catch {
        // The next poll will try again.
      }
    }

    // The live channel first.
    const unsubscribe = realtime.subscribe(token, (message: RealtimeMessage) => {
      if (cancelled) return

      if (message.event === 'analysis:progress') {
        const data = message.data as AnalysisProgressData
        if (data.analysisId && data.analysisId !== analysisId) return
        setState(current => ({
          ...current,
          status: 'running',
          progress: typeof data.progress === 'number' ? data.progress : current.progress,
          stage: data.stage || current.stage,
          message: data.message || current.message,
        }))
      } else if (message.event === 'analysis:complete') {
        const data = message.data as AnalysisCompleteData
        if (data.analysisId && data.analysisId !== analysisId) return
        setState(current => ({ ...current, status: 'completed', progress: 100, stage: 'done' }))
        settle()
      } else if (message.event === 'analysis:error') {
        const data = message.data as AnalysisErrorData
        if (data.analysisId && data.analysisId !== analysisId) return
        setState(current => ({
          ...current,
          status: 'failed',
          error: data.error || 'The analysis did not finish.',
          hint: data.hint,
          uploadedFiles: data.uploadedFiles,
        }))
        settle()
      }
    })

    // And the API, in case the live channel is not available.
    const poll = () => {
      void readStatus()
      if (!cancelled) pollTimer = window.setTimeout(poll, 2000)
    }
    pollTimer = window.setTimeout(poll, 500)

    return () => {
      cancelled = true
      if (pollTimer) window.clearTimeout(pollTimer)
      unsubscribe()
    }
  }, [analysisId, token, settle])

  return state
}
