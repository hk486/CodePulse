import { useEffect, useRef, useState } from 'react'
import { Printer, X } from 'lucide-react'
import { apiFetch, readError } from '../services/apiClient'

interface PrintableReportModalProps {
  /** Analysis id (or report id) of the report to render. */
  endpoint: string
  title: string
  onClose: () => void
}

/**
 * Shows a report in a printable preview.
 *
 * The preview is rendered in an iframe so the browser's own print dialog
 * produces a clean PDF with only the report on the page. Nothing opens in a
 * new window, so it also works when pop-ups are blocked.
 */
export function PrintableReportModal({ endpoint, title, onClose }: PrintableReportModalProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await apiFetch(endpoint)
        if (!response.ok) {
          throw new Error(await readError(response, 'Could not load the printable report.'))
        }
        const content = await response.text()
        if (!cancelled) setHtml(content)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the printable report.')
        }
      }
    }
    void load()
    return () => { cancelled = true }
  }, [endpoint])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const handlePrint = () => {
    const frame = frameRef.current
    if (!frame?.contentWindow) return
    frame.contentWindow.focus()
    frame.contentWindow.print()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--scrim)/0.55)] backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="glass-pop w-full max-w-4xl h-[85vh] rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgb(var(--glass-edge-inset))] flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} disabled={!html} className="btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-[13px]">
              <Printer className="w-3.5 h-3.5" />
              Print / Save as PDF
            </button>
            <button onClick={onClose} className="btn-icon" aria-label="Close preview">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden glass-well rounded-b-2xl">
          {error ? (
            <p role="alert" className="m-6 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : html ? (
            <iframe
              ref={frameRef}
              title={title}
              srcDoc={html}
              className="w-full h-full border-0 bg-transparent"
            />
          ) : (
            <p className="m-6 text-sm text-ink-2">Preparing the report…</p>
          )}
        </div>
      </div>
    </div>
  )
}
