import type { ReactNode } from 'react'
import { ArrowUpRight, Check, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useTheme } from '../../contexts/ThemeContext'
import { BrandLogo } from '../ui/BrandLogo'
import '../../styles/auth.css'

export function Logo({ className = '' }: { className?: string }) {
  return <BrandLogo compact className={`auth-brand-logo ${className}`} />
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
 * A small sample report to make the product experience concrete.
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
          See the whole codebase.
          <span> Know what to improve.</span>
        </h1>
        <p>
          CodePulse brings code quality, security, and engineering health into
          one clear view—across every language and service in your project.
        </p>

        <div className="auth-capabilities" aria-label="CodePulse capabilities">
          <span><Check size={14} aria-hidden="true" /> Multi-language</span>
          <span><Check size={14} aria-hidden="true" /> Service-aware</span>
          <span><Check size={14} aria-hidden="true" /> Actionable findings</span>
        </div>

        <div className="auth-preview">
          <div className="auth-preview-head">
            <div className="auth-preview-project">
              <span className="auth-preview-project-icon"><ShieldCheck size={16} /></span>
              <span>
                <span className="auth-preview-title">Sample analysis</span>
                <span className="auth-preview-subtitle">A snapshot of your engineering health</span>
              </span>
            </div>
            <span className="auth-preview-meta">EXAMPLE REPORT</span>
          </div>
          <div className="auth-preview-languages" aria-label="Example project technologies">
            <span>TypeScript</span>
            <span>Python</span>
            <span>Go</span>
            <span>Docker</span>
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
            <span>4 example findings</span>
            <span>1 critical · 1 high · 2 medium</span>
            <span className="auth-preview-link">Explore insights <ArrowUpRight size={14} /></span>
          </div>
        </div>
      </div>

      <div className="auth-brand-footer">
        <span className="auth-footer-mark"><ShieldCheck size={15} aria-hidden="true" /></span>
        <span>Built for better software engineering.</span>
      </div>
    </aside>
  )
}

export function AuthFormContainer({
  title,
  subtitle,
  eyebrow = 'CODEPULSE WORKSPACE',
  children,
}: {
  title: string
  subtitle: string
  eyebrow?: string
  children: ReactNode
}) {
  return (
    <div className="auth-form-container">
      <div className="auth-form-heading">
        <div className="auth-form-kicker">{eyebrow}</div>
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
          <span className="codepulse-wordmark">
            <span className="code">Code</span><span className="pulse">Pulse</span>
          </span>
          <span>·</span>
          <span>Static analysis for whole repositories</span>
        </div>
      </section>
    </main>
  )
}
