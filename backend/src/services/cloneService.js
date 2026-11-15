import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * Clone a public repository so the scanner can analyse it.
 *
 * The scanner already runs over a local folder, so a clone is all that
 * stands between a repository URL and a report. The clone is shallow,
 * because nobody needs the history to find a hard-coded secret.
 */

const CLONE_TIMEOUT_MS = 120000

/** The hosts a repository URL may point at. */
const ALLOWED_HOSTS = [
  'github.com',
  'www.github.com',
  'gitlab.com',
  'www.gitlab.com',
  'bitbucket.org',
  'www.bitbucket.org',
]

/**
 * Check that a URL is a repository we are willing to fetch.
 *
 * This is a server that fetches a URL the user typed, so the scheme and
 * the host are both checked: only https, and only a known host. Without
 * this, the URL field would be a way to make the server fetch anything
 * on the network.
 */
export function validateRepositoryUrl(rawUrl) {
  const value = String(rawUrl || '').trim()
  if (!value) {
    return { ok: false, error: 'A repository URL is required.' }
  }

  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, error: 'That is not a valid URL.' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only https repository URLs are supported.' }
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      error: 'Only GitHub, GitLab and Bitbucket repositories are supported.',
    }
  }

  // A repository needs a path, and it must not be empty.
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length < 2) {
    return {
      ok: false,
      error: 'That URL does not point at a repository.',
    }
  }

  return {
    ok: true,
    url: `https://${parsed.hostname.toLowerCase()}/${segments.join('/').replace(/\.git$/, '')}`,
  }
}

/**
 * Clone a repository into a folder.
 *
 * Returns the folder on success and throws with a readable message on
 * failure, because a clone fails for reasons the user can act on: a
 * private repository, a typo in the URL, no network.
 */
export async function cloneRepository(rawUrl, destination) {
  const check = validateRepositoryUrl(rawUrl)
  if (!check.ok) {
    throw new Error(check.error)
  }

  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true })
  }

  // A clone into a folder that already has files fails, so the folder is
  // cleared first.
  for (const entry of fs.readdirSync(destination)) {
    fs.rmSync(path.join(destination, entry), { recursive: true, force: true })
  }

  try {
    await execFileAsync(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--single-branch',
        '--no-tags',
        '--quiet',
        check.url,
        destination,
      ],
      { timeout: CLONE_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    )
  } catch (error) {
    const detail = String(error.stderr || error.message || '')
    if (/Authentication failed|could not read Username|terminal prompts disabled/i.test(detail)) {
      // GitHub asks for credentials for a private repository and for a
      // repository that does not exist, so both come back the same way.
      throw new Error(
        'That repository could not be read. It is either private, or the URL is wrong.'
      )
    }
    if (/not found|does not exist|Repository not found/i.test(detail)) {
      throw new Error('No repository was found at that URL.')
    }
    if (/unable to access|Could not resolve host|Network is unreachable|Failed to connect/i.test(detail)) {
      throw new Error('The repository could not be reached. Check the URL and try again.')
    }
    throw new Error(detail.trim().split('\n').slice(-1)[0] || 'The repository could not be cloned.')
  }

  return destination
}
