import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertCircle, RefreshCcw, Home } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string | null
}

/**
 * The thing that stops one broken page from taking the whole app with it.
 *
 * Without this, a render error leaves a blank white screen and the person
 * has no way back. With it, they are told what went wrong, they can try
 * again, and they can go back to the dashboard.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The details go to the console, so they are there when they are
    // needed and not in the way of the person who hit the problem.
    console.error('[codepulse] something went wrong while drawing the page:', error, info.componentStack)
    this.setState({ info: info.componentStack?.split('\n').slice(0, 3).join('\n') || null })
  }

  /**
   * Try the page again. The state is cleared, so the component draws
   * itself from scratch.
   */
  private retry = () => {
    this.setState({ error: null, info: null })
  }

  private goHome = () => {
    window.location.href = '/'
  }

  render() {
    const { error, info } = this.state

    if (!error) {
      return this.props.children
    }

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-lg card p-7">
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-severity-critical/10 text-severity-critical">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[19px] font-semibold text-ink">
                Something went wrong
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                This page could not be drawn. The rest of the app still works, and
                nothing was lost.
              </p>
            </div>
          </div>

          {info ? (
            <pre className="mt-5 rounded-lg bg-[rgb(var(--glass-fill-inset))] p-3 font-mono text-[11px] leading-relaxed text-ink-3 overflow-x-auto">
              {info}
            </pre>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={this.retry} className="btn-primary inline-flex items-center gap-2">
              <RefreshCcw className="w-3.5 h-3.5" />
              Try again
            </button>
            <button onClick={this.goHome} className="btn-secondary inline-flex items-center gap-2">
              <Home className="w-3.5 h-3.5" />
              Back to the dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
