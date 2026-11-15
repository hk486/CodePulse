import * as fs from 'fs'
import { Finding, ProjectReport, Severity } from '@codepulse/shared'

/**
 * The gate a build can be held to.
 *
 * Two ways to fail:
 *
 *   --fail-on critical     the build fails if there are critical findings
 *   --baseline report.json the build fails if there are findings the
 *                          baseline did not have
 *
 * The point is to hold a build to what is already there, so a project
 * that has forty low findings does not have to reach zero before it can
 * start failing on new ones.
 */

const SEVERITY_ORDER: Severity[] = [
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
  Severity.INFO,
]

/** The severity at or above which a finding counts. */
export function severityAtLeast(
  severity: string | undefined,
  threshold: string
): boolean {
  const wanted = String(threshold || '').toLowerCase()
  if (!wanted || wanted === 'none') return false

  const level = SEVERITY_ORDER.findIndex(
    s => String(s).toLowerCase() === wanted
  )
  if (level < 0) return false

  const actual = SEVERITY_ORDER.findIndex(
    s => String(s).toLowerCase() === String(severity || 'info').toLowerCase()
  )
  return actual >= 0 && actual <= level
}

/**
 * The identity of a finding, for comparing two runs.
 *
 * The scanner numbers the findings it finds in a file, so the id moves
 * whenever something is added earlier in the same file. The rule and the
 * place are what stay put.
 */
export function fingerprint(finding: Finding): string {
  const rule = finding.ruleId || finding.title || 'unknown'
  const file = finding.location?.filePath || ''
  return `${rule}@${file}`
}

/** The findings in a report, with their identity. */
export function fingerprintSet(report: ProjectReport): Set<string> {
  const set = new Set<string>()
  for (const finding of report.analysis?.findings || []) {
    set.add(fingerprint(finding))
  }
  return set
}

export interface GateResult {
  failed: boolean
  reason: string
  /** The findings that caused the failure. */
  offenders: Finding[]
}

/**
 * Decide whether the run should fail the build.
 */
export function evaluateGate(
  findings: Finding[],
  options: { failOn?: string; baseline?: ProjectReport | null }
): GateResult {
  const threshold = options.failOn || ''

  if (threshold && threshold.toLowerCase() !== 'none') {
    const offenders = findings.filter(finding =>
      severityAtLeast(finding.severity, threshold)
    )
    if (offenders.length > 0) {
      return {
        failed: true,
        reason: `${offenders.length} finding${
          offenders.length === 1 ? '' : 's'
        } at ${threshold} or above`,
        offenders,
      }
    }
  }

  if (options.baseline) {
    const baseline = fingerprintSet(options.baseline)
    const offenders = findings.filter(
      finding => !baseline.has(fingerprint(finding))
    )
    if (offenders.length > 0) {
      return {
        failed: true,
        reason: `${offenders.length} finding${
          offenders.length === 1 ? '' : 's'
        } the baseline did not have`,
        offenders,
      }
    }
  }

  return { failed: false, reason: '', offenders: [] }
}

/** Read a baseline report from a file. */
export function readBaseline(filePath: string): ProjectReport {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as ProjectReport
}
