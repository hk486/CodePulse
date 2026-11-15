import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

/**
 * Taking an uploaded archive apart, safely.
 *
 * An uploaded archive is untrusted input. A plain `tar -xf` will happily
 * write outside the folder it was told to write into, follow a symlink
 * out of it, and fill the disk with a small file that unpacks into
 * petabytes. So the archive is looked at before anything is written.
 */

export const DEFAULT_ARCHIVE_LIMITS = {
  /** The most files the archive may hold. */
  maxFiles: 200000,
  /** The most the archive may unpack to, in bytes. */
  maxBytes: 2 * 1024 * 1024 * 1024,
  /** The most a single file may be, in bytes. */
  maxFileBytes: 100 * 1024 * 1024,
}

export class ArchiveError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = 'ArchiveError'
    this.reason = reason
    this.status = 400
  }
}

/**
 * Is this path safe to write?
 *
 * It has to stay inside the folder it is being written to. A path with
 * `..` in it, or an absolute path, is not.
 *
 * @param {string} entryPath
 * @returns {boolean}
 */
export function isSafePath(entryPath) {
  if (!entryPath) return false
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return false
  // A Windows drive letter is an absolute path too.
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return false

  const normalised = path.posix.normalize(entryPath.replace(/\\/g, '/'))
  if (normalised.startsWith('../')) return false
  if (normalised === '..') return false
  if (path.posix.isAbsolute(normalised)) return false
  return true
}

/**
 * Read what is in a tar archive, without writing anything.
 *
 * The listing is: the permissions, the owner, the size, the date, the
 * time and the name. A link is written as "name -> target", and the
 * target is the dangerous part.
 *
 * @param {string} archivePath
 * @returns {Promise<Array<{path: string, size: number, isLink: boolean, isDirectory: boolean}>>}
 */
export async function listTar(archivePath) {
  // The names are read out of the archive itself rather than from `tar`.
  // tar takes the leading "../" off a member's name before it prints it,
  // so a path that would escape is invisible in its listing. Reading the
  // header shows what is really in there.
  try {
    return await listTarHeaders(archivePath)
  } catch {
    // A tar that is not in the usual shape. The listing tar gives is
    // still worth having.
  }

  const { stdout } = await execFileAsync('tar', ['-tvzf', archivePath], {
    maxBuffer: 64 * 1024 * 1024
  })

  const entries = []
  const pattern =
    /^([-dlcbps])([rwxSsTt-]{9})[.+]?\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const match = pattern.exec(line)
    if (!match) continue

    const [, kind, , size, rest] = match
    const parts = rest.split(' -> ')
    const entryPath = parts[0].trim()
    if (!entryPath) continue

    entries.push({
      path: entryPath,
      size: Number(size) || 0,
      isLink: kind === 'l',
      isDirectory: kind === 'd'
    })
  }

  return entries
}

/**
 * Read the member names out of a tar archive's headers.
 *
 * The format is simple: every member has a 512 byte header, and the
 * name is the first hundred bytes of it. The gzip is undone first.
 *
 * @param {string} archivePath
 * @returns {Promise<Array<{path: string, size: number, isLink: boolean, isDirectory: boolean}>>}
 */
async function listTarHeaders(archivePath) {
  const zlib = await import('zlib')
  const fsPromises = await import('fs/promises')

  const raw = await fsPromises.readFile(archivePath)
  const isGzip = raw[0] === 0x1f && raw[1] === 0x8b
  const data = isGzip ? zlib.gunzipSync(raw) : raw

  const entries = []
  let offset = 0

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)

    // Two blocks of nothing ends the archive.
    if (header.every(byte => byte === 0)) break

    const name = readString(header, 0, 100)
    const prefix = readString(header, 345, 155)
    const sizeField = readString(header, 124, 12).trim()
    const typeFlag = String.fromCharCode(header[156] || 0)
    const linkName = readString(header, 157, 100)

    let size = 0
    if (sizeField) {
      // The size is written in octal.
      size = parseInt(sizeField.replace(/[^0-7]/g, ''), 8) || 0
    }

    const entryPath = prefix ? `${prefix}/${name}` : name
    if (entryPath) {
      entries.push({
        path: entryPath,
        size,
        // A type flag of "2" is a symbolic link, and "1" is a hard link.
        isLink: typeFlag === '2' || typeFlag === '1',
        isDirectory: typeFlag === '5' || entryPath.endsWith('/'),
        linkName
      })
    }

    // The header, then the contents, rounded up to the next block.
    offset += 512 + Math.ceil(size / 512) * 512
  }

  return entries
}

/**
 * Read a string out of a block of bytes, stopping at the first nothing.
 *
 * @param {Buffer} buffer
 * @param {number} start
 * @param {number} length
 * @returns {string}
 */
function readString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length)
  const end = slice.indexOf(0)
  return slice.toString('utf8', 0, end === -1 ? slice.length : end).trim()
}

/**
 * Read what is in a zip archive, without writing anything.
 *
 * zipinfo prints a table: the permissions, the version, the system, the
 * size, the kind, the method, the date, the time and the name.
 *
 * @param {string} archivePath
 * @returns {Promise<Array<{path: string, size: number, isLink: boolean, isDirectory: boolean}>>}
 */
export async function listZip(archivePath) {
  const { stdout } = await execFileAsync('zipinfo', ['-l', archivePath], {
    maxBuffer: 64 * 1024 * 1024
  })

  const entries = []
  const pattern =
    /^([-dlcbps])([rwxSsTt-]{9})\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+)$/

  for (const line of stdout.split('\n')) {
    const match = pattern.exec(line)
    if (!match) continue

    const [, kind, , size, rest] = match
    const parts = rest.split(' -> ')
    const entryPath = parts[0].trim()
    if (!entryPath) continue

    entries.push({
      path: entryPath,
      size: Number(size) || 0,
      isLink: kind === 'l',
      isDirectory: kind === 'd'
    })
  }

  return entries
}

/**
 * Check what is in the archive before anything is written.
 *
 * @param {Array<{path: string, size: number, isLink: boolean, isDirectory: boolean}>} entries
 * @param {{maxFiles: number, maxBytes: number, maxFileBytes: number}} limits
 * @returns {{files: number, bytes: number}}
 */
export function checkEntries(entries, limits = DEFAULT_ARCHIVE_LIMITS) {
  if (entries.length > limits.maxFiles) {
    throw new ArchiveError(
      `The archive holds ${entries.length} entries, which is more than the ${limits.maxFiles} allowed.`,
      'too-many-files'
    )
  }

  let bytes = 0
  let files = 0

  for (const entry of entries) {
    if (!isSafePath(entry.path)) {
      throw new ArchiveError(
        `The archive holds a path that would be written outside the project (${entry.path}). It was refused.`,
        'unsafe-path'
      )
    }

    if (entry.isLink) {
      throw new ArchiveError(
        `The archive holds a symbolic link (${entry.path}). Links are not extracted, because they can point anywhere.`,
        'symlink'
      )
    }

    if (entry.isDirectory) continue

    files++
    bytes += entry.size

    if (entry.size > limits.maxFileBytes) {
      throw new ArchiveError(
        `The archive holds a file of ${entry.size} bytes, which is more than the ${limits.maxFileBytes} allowed.`,
        'file-too-large'
      )
    }

    if (bytes > limits.maxBytes) {
      throw new ArchiveError(
        `The archive unpacks to more than the ${limits.maxBytes} bytes allowed. It was refused before anything was written.`,
        'too-large'
      )
    }
  }

  return { files, bytes }
}

/**
 * Take an archive apart into a folder, safely.
 *
 * The archive is listed and checked first, so a path that would escape,
 * a symbolic link, or an archive that unpacks to too much are all
 * refused before a single byte is written.
 *
 * @param {string} archivePath
 * @param {string} target
 * @param {{maxFiles: number, maxBytes: number, maxFileBytes: number}} limits
 * @returns {Promise<{extracted: boolean, files: number, bytes: number, reason?: string}>}
 */
export async function extractSafely(archivePath, target, limits = DEFAULT_ARCHIVE_LIMITS) {
  const lower = archivePath.toLowerCase()
  fs.mkdirSync(target, { recursive: true })

  try {
    if (lower.endsWith('.zip')) {
      const entries = await listZip(archivePath)
      const { files, bytes } = checkEntries(entries, limits)
      // -o overwrites, -q is quiet. The paths were checked already.
      await execFileAsync('unzip', ['-o', '-q', archivePath, '-d', target], {
        maxBuffer: 32 * 1024 * 1024
      })
      return { extracted: true, files, bytes }
    }

    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar')) {
      const entries = await listTar(archivePath)
      const { files, bytes } = checkEntries(entries, limits)
      await execFileAsync(
        'tar',
        ['--no-same-owner', '--no-same-permissions', '-xf', archivePath, '-C', target],
        { maxBuffer: 32 * 1024 * 1024 }
      )
      return { extracted: true, files, bytes }
    }

    if (lower.endsWith('.gz')) {
      const name = path.basename(archivePath, '.gz')
      if (!isSafePath(name)) {
        throw new ArchiveError('That file name was refused.', 'unsafe-path')
      }
      const destination = path.join(target, name)
      await execFileAsync(
        'sh',
        ['-c', `gzip -dc ${JSON.stringify(archivePath)} > ${JSON.stringify(destination)}`]
      )
      const size = fs.existsSync(destination) ? fs.statSync(destination).size : 0
      if (size > limits.maxFileBytes) {
        throw new ArchiveError(
          `That file is ${size} bytes, which is more than the ${limits.maxFileBytes} allowed.`,
          'file-too-large'
        )
      }
      return { extracted: true, files: 1, bytes: size }
    }

    return { extracted: false, files: 0, bytes: 0, reason: 'not-an-archive' }
  } catch (error) {
    if (error instanceof ArchiveError) throw error
    return {
      extracted: false,
      files: 0,
      bytes: 0,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * Remove anything a symlink could have reached.
 *
 * Even after the archive is checked, a file that was written may be a
 * link. This finds them and removes them, so nothing in the workspace
 * points outside it.
 *
 * @param {string} root
 * @returns {number} how many were removed
 */
export function removeEscapingLinks(root) {
  let removed = 0

  const walk = (dir) => {
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        let real = full
        try {
          real = path.resolve(dir, fs.readlinkSync(full))
        } catch {
          // It cannot be read, so it cannot point anywhere useful.
        }
        if (!real.startsWith(path.resolve(root))) {
          try {
            fs.unlinkSync(full)
            removed++
          } catch {
            // Nothing to do.
          }
        }
        continue
      }
      if (entry.isDirectory()) walk(full)
    }
  }

  walk(root)
  return removed
}
