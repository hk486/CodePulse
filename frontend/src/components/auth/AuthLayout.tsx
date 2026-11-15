import type { ReactNode } from 'react'
import { Activity, Moon, Sun } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import '../../styles/auth.css'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`auth-logo ${className}`}>
      <span className="auth-logo-mark">
        <Activity size={18} strokeWidth={2.25} />
      </span>
      CodePulse
    </span>
  )
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="auth-theme-toggle"
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
    >
      {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
    </button>
  )
}

/**
 * A finding, the way the product reports it.
 */
interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  where: string
}

/**
 * The real product, rendered in code.
 *
 * These are actual findings from the scanner, so the page shows what the
 * tool produces rather than a picture of what it might produce.
 */
const FINDINGS: Finding[] = [
  {
    severity: 'critical',
    title: 'DELETE without a WHERE clause',
    where: 'infra/migrations/001_init.sql:2',
  },
  {
    severity: 'high',
    title: 'Hardcoded credential',
    where: 'services/auth/config.go:12',
  },
  {
    severity: 'medium',
    title: 'Bare except clause',
    where: 'api/app/main.py:10',
  },
  {
    severity: 'medium',
    title: "Use of 'any' type",
    where: 'frontend/src/App.tsx:3',
  },
]

const MARKER: Record<string, string> = {
  critical: 'rgb(var(--severity-critical))',
  high: 'rgb(var(--severity-high))',
  medium: 'rgb(var(--severity-medium))',
  low: 'rgb(var(--severity-low))',
}

export function AuthBrandPanel() {
  return (
    <aside className="auth-brand">
      <div className="auth-brand-top">
        <Logo />
        <span className="auth-brand-tag">Engineering intelligence</span>
      </div>

      <div className="auth-brand-content">
        <div className="auth-eyebrow">Code analysis</div>
        <h1>
          Every finding, with the file
          <br />
          <span>and the line it came from.</span>
        </h1>
        <p>
          Point CodePulse at a folder. It finds the languages, splits the
          services and reports what is wrong with the code, in the order it
          should be fixed.
        </p>

        {/* The product view. Not a picture of the product, the product. */}
        <div className="auth-preview">
          <div className="auth-preview-head">
            <span className="auth-preview-title">Payment service</span>
            <span className="auth-preview-meta">1,284 files · go, sql, ts</span>
          </div>
          <div className="auth-preview-body">
            {FINDINGS.map(finding => (
              <div className="auth-finding" key={finding.where}>
                <span
                  className="auth-finding-marker"
                  style={{ background: MARKER[finding.severity] }}
                  aria-hidden="true"
                />
                <span>
                  <span className="auth-finding-title">{finding.title}</span>
                  <span className="auth-finding-where">{finding.where}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="auth-preview-foot">
            <span>4 findings</span>
            <span>1 critical</span>
            <span>reviewed in 6s</span>
          </div>
        </div>
      </div>

      <div className="auth-brand-footer">
        <span>Self hosted, deterministic, no source leaves the machine</span>
      </div>
    </aside>
  )
}

export function AuthFormContainer({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="auth-form-container">
      <div className="auth-form-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

export function AuthFooter({ children }: { children: ReactNode }) {
  return <p className="auth-footer">{children}</p>
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <AuthBrandPanel />
      <section className="auth-main">
        <div className="auth-main-top">
          <div className="auth-mobile-logo">
            <Logo />
          </div>
          <ThemeToggle />
        </div>
        <div className="auth-main-content">{children}</div>
        <div className="auth-main-bottom">
          <span>CodePulse</span>
          <span>·</span>
          <span>Static analysis for whole repositories</span>
        </div>
      </section>
    </main>
  )
}
