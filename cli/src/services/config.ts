import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'

/**
 * The project's own configuration.
 *
 * A project can carry a `.codepulse.yml` that says what to leave out of
 * the analysis and which findings to silence. It sits in the root of the
 * project, so it travels with the code and is reviewed with it.
 *
 *   version: 1
 *   ignore:
 *     - "docs/[star][star]"
 *   exclude:
 *     - "GEN-004"
 *   suppress:
 *     - ruleId: "PY-003"
 *       path: "spec/[star][star]"
 *
 * The star characters are written in full in the starter file.
 */

export interface Suppression {
  ruleId: string
  path?: string
}

export interface CodePulseConfig {
  version: number
  /** Paths to leave out of the analysis. */
  ignore: string[]
  /** Rules to turn off completely. */
  exclude: string[]
  /** Findings to silence, optionally only in certain paths. */
  suppress: Suppression[]
}

export const DEFAULT_CONFIG: CodePulseConfig = {
  version: 1,
  ignore: [],
  exclude: [],
  suppress: [],
}

export const CONFIG_FILENAMES = [
  '.codepulse.yml',
  '.codepulse.yaml',
  '.codepulse.json',
]

/**
 * Turn a glob into a regular expression.
 *
 * The patterns are the ones people already know: `**` crosses directories,
 * `*` does not, `?` is one character. Everything else is literal.
 */
export function globToRegExp(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // ** crosses directories. A trailing /** also matches the folder
        // itself, so "**/node_modules/**" covers "node_modules/x.js".
        if (pattern[i + 2] === '/') {
          source += '(?:.*/)?'
          i += 2
        } else {
          source += '.*'
          i += 1
        }
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

/** True when a path matches one of the patterns. */
export function matchesAny(
  relativePath: string,
  patterns: string[] | undefined
): boolean {
  if (!patterns || patterns.length === 0) return false
  const normalized = relativePath.replace(/\\/g, '/')
  for (const pattern of patterns) {
    const cleaned = String(pattern).trim().replace(/^\.\//, '')
    if (!cleaned) continue
    if (globToRegExp(cleaned).test(normalized)) return true
    // A pattern that names a folder covers everything inside it.
    if (globToRegExp(`${cleaned.replace(/\/$/, '')}/**`).test(normalized)) return true
    if (!cleaned.includes('/') && globToRegExp(`**/${cleaned}/**`).test(normalized)) {
      return true
    }
  }
  return false
}

/**
 * Read the configuration of a project.
 *
 * A broken file is reported and then ignored: a mistake in the config
 * must never stop the analysis.
 *
 * `configFile` points at a file outside the project, which is what the
 * `--config` flag does. When it is given, the project's own file is not
 * read at all, so the flag really does replace it rather than adding to it.
 */
export async function readConfig(
  projectPath: string,
  configFile?: string
): Promise<{ config: CodePulseConfig; found: string | null; error: string | null }> {
  if (configFile) {
    const full = path.resolve(configFile)
    try {
      const raw = fs.readFileSync(full, 'utf8')
      const parsed = full.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw)
      return { config: normalise(parsed), found: full, error: null }
    } catch (error) {
      return {
        config: { ...DEFAULT_CONFIG },
        found: full,
        error: error instanceof Error ? error.message : 'The configuration could not be read.',
      }
    }
  }

  for (const filename of CONFIG_FILENAMES) {
    const full = path.join(projectPath, filename)
    if (!fs.existsSync(full)) continue

    try {
      const raw = fs.readFileSync(full, 'utf8')
      const parsed =
        filename.endsWith('.json')
          ? JSON.parse(raw)
          : yaml.load(raw)
      const config = normalise(parsed)
      return { config, found: filename, error: null }
    } catch (error) {
      return {
        config: { ...DEFAULT_CONFIG },
        found: filename,
        error: error instanceof Error ? error.message : 'The configuration could not be read.',
      }
    }
  }
  return { config: { ...DEFAULT_CONFIG }, found: null, error: null }
}

/**
 * Bring a parsed configuration into shape, ignoring anything that is not
 * what it should be.
 */
function normalise(parsed: unknown): CodePulseConfig {
  const source = (parsed || {}) as Record<string, unknown>
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()) : []

  const suppress: Suppression[] = []
  if (Array.isArray(source.suppress)) {
    for (const entry of source.suppress) {
      if (typeof entry === 'string' && entry.trim()) {
        suppress.push({ ruleId: entry.trim() })
      } else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        const ruleId = String(record.ruleId || record.rule || '').trim()
        if (!ruleId) continue
        suppress.push({
          ruleId,
          path: typeof record.path === 'string' ? record.path.trim() : undefined,
        })
      }
    }
  }

  return {
    version: Number(source.version) || 1,
    ignore: list(source.ignore),
    exclude: list(source.exclude),
    suppress,
  }
}

/** The configuration a starter file is written from. */
export const STARTER_CONFIG = `# CodePulse configuration
#
# This file travels with the project, so it is reviewed with the code.

version: 1

# Paths to leave out of the analysis. The usual build folders are already
# skipped; add the ones that are specific to your project.
ignore:
  - "docs/**"
  - "**/*.min.js"

# Rules to turn off completely, by their id.
exclude: []

# Findings to silence, because you have looked at them and they are fine.
# A path narrows the silence to part of the project.
suppress: []
`
