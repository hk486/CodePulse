import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readPage, paged } from '../services/pagination.js'
import {
  extractSafely,
  removeEscapingLinks,
  ArchiveError
} from '../services/archiveService.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import {
  uploadRoot,
  projectUploadDir,
  legacyProjectUploadDir,
  projectUploadCandidates
} from '../services/workspace.js'

const execFileAsync = promisify(execFile)

// The workspace helpers live in a service now, so the analysis worker can
// find a project's files without reaching into the routes. They are still
// exported from here, because this is where they were first written.
export { projectUploadDir, legacyProjectUploadDir, projectUploadCandidates }

/**
 * Normalise a relative path, dropping any traversal segments.
 * The frontend already strips the selected root folder, so the path is
 * stored exactly as the project tree looks on disk.
 */
function sanitizeRelativePath(relativePath, fallbackName) {
  const raw = String(relativePath || fallbackName || '').replace(/\\/g, '/')
  const segments = raw.split('/').filter(s => s && s !== '.' && s !== '..')
  const cleaned = segments.join('/')
  return cleaned || fallbackName
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = (req.user && req.user.userId) || 'anonymous'
    const projectId = req.params.projectId || 'unassigned'
    cb(null, projectUploadDir(userId, projectId))
  },
  filename: (req, file, cb) => {
    // multer does not expose the destination on `req`, so recompute it here
    const userId = (req.user && req.user.userId) || 'anonymous'
    const projectId = req.params.projectId || 'unassigned'
    const dir = projectUploadDir(userId, projectId)

    // `preservePath: true` keeps the browser-sent relative path in originalname
    const relativePath = sanitizeRelativePath(file.originalname, file.originalname)
    const parent = path.dirname(path.join(dir, relativePath))
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true })
    }
    cb(null, relativePath)
  }
})

/**
 * Everything the scanner can read.
 *
 * This list is kept in step with the scanner's own extension table, so
 * a project written in a language the scanner understands can always be
 * uploaded. A file that is not on the list is skipped, and the client is
 * told what was left out.
 */
const ALLOWED_EXTENSIONS = [
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyw', '.java', '.kt', '.kts', '.scala', '.sc', '.groovy', '.gvy',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.m', '.mm',
  '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.dart', '.ex', '.exs',
  '.erl', '.hrl', '.hs', '.lhs', '.clj', '.cljs', '.cljc',
  '.elm', '.nim', '.zig', '.cr', '.jl', '.jt', '.r', '.rex', '.lua',
  '.pl', '.pm', '.raku', '.tcl',
  '.fs', '.fsx', '.ml', '.mli', '.purs', '.scm', '.rkt',
  '.f', '.f90', '.f95', '.for', '.cob', '.cobol', '.pas', '.pp', '.dpr',
  '.ada', '.adb', '.d', '.c3', '.odin', '.move',
  '.sol', '.v', '.sv', '.vhd', '.vhdl', '.asm', '.s', '.vb', '.vbs',
  '.bas', '.frm', '.vbnet', '.gd', '.gml', '.marko', '.fish',
  '.sql', '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf',
  '.env', '.properties', '.hcl', '.tf', '.tfvars', '.proto', '.graphql',
  '.gql', '.gradle', '.bzl', '.nix', '.cmake', '.mk', '.make',
  '.mod', '.sum', '.lock', '.md', '.mdx', '.rst', '.txt', '.adoc',
  '.ipynb', '.ipy', '.rmd', '.do', '.tex',
  '.html', '.htm', '.xhtml', '.css', '.scss', '.sass', '.less', '.styl',
  '.vue', '.svelte', '.astro', '.coffee', '.pug', '.jade',
  '.hbs', '.ejs', '.tpl', '.twig', '.jinja', '.j2',
  '.gitignore', '.dockerignore', '.dockerfile', '.editorconfig',
  '.eslintrc', '.prettierrc',
  '.zip', '.tar', '.gz', '.tgz'
]

/**
 * Files that carry no extension but are still worth analysing, such as a
 * Dockerfile or a Makefile.
 */
const KNOWN_EXTENSIONLESS_FILES = [
  'dockerfile', 'containerfile', 'makefile', 'jenkinsfile', 'procfile',
  'rakefile', 'gemfile', 'brewfile', 'vagrantfile', 'cmakelists.txt',
  'justfile', 'taskfile.yml', 'taskfile.yaml', 'earthfile', 'nix',
]

/**
 * Silently skip files we do not analyse instead of aborting the whole upload,
 * but record them so the client can tell the user what was left out.
 */
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  const base = path.basename(file.originalname)
  const lowerBase = base.toLowerCase()
  const isArchive = file.mimetype.includes('archive') || file.mimetype.includes('zip')
  const isConfigFile = base.startsWith('.') && ALLOWED_EXTENSIONS.includes(base)
  const isKnownFile = KNOWN_EXTENSIONLESS_FILES.includes(lowerBase)
  // Dot files such as .env or .gitignore have no extension either
  const isDotFile = base.startsWith('.') && base.length > 1 && !base.includes(' ')

  if (
    ALLOWED_EXTENSIONS.includes(ext) ||
    isArchive ||
    isConfigFile ||
    isKnownFile ||
    isDotFile
  ) {
    return cb(null, true)
  }
  req.skippedFiles = req.skippedFiles || []
  req.skippedFiles.push(file.originalname)
  cb(null, false)
}

/**
 * Extract an uploaded archive into the project workspace so its sources can
 * be analysed.
 *
 * The archive is untrusted input, so it is listed and checked first: a
 * path that would be written outside the workspace, a symbolic link, or
 * an archive that unpacks to too much are all refused before anything is
 * written.
 */
async function extractArchive(archivePath, workspaceDir) {
  const target = path.join(workspaceDir, 'extracted')
  fs.mkdirSync(target, { recursive: true })

  try {
    const result = await extractSafely(archivePath, target, {
      maxFiles: UPLOAD_BUDGET.maxFiles,
      maxBytes: UPLOAD_BUDGET.maxProjectSize,
      maxFileBytes: UPLOAD_BUDGET.maxFileSize
    })
    if (!result.extracted) return null

    // Even after the check, a link that was written is removed.
    removeEscapingLinks(target)

    return target
  } catch (error) {
    if (error instanceof ArchiveError) {
      console.warn(`[upload] the archive was refused: ${error.reason} — ${error.message}`)
      const refusal = new Error(error.message)
      refusal.status = 400
      refusal.reason = error.reason
      throw refusal
    }
    return null
  }
}

/**
 * Upload budgets.
 *
 * A hard limit on the file count used to reject every real project (1000
 * files is nothing), so the count is now generous and the real guard is the
 * total size of the project.
 */
export const UPLOAD_BUDGET = {
  /** The largest single file we accept. */
  maxFileSize: 100 * 1024 * 1024,
  /** The largest project we accept, in bytes (2 GB). */
  maxProjectSize: 2 * 1024 * 1024 * 1024,
  /** The largest number of files in one project. */
  maxFiles: 200000,
}

const upload = multer({
  storage,
  fileFilter,
  preservePath: true,
  limits: {
    fileSize: UPLOAD_BUDGET.maxFileSize,
    files: UPLOAD_BUDGET.maxFiles,
  },
})

/**
 * Turn a multer limit error into something a person can act on.
 */
function uploadLimitError(error) {
  if (error.code === 'LIMIT_FILE_SIZE') {
    return {
      status: 413,
      error: `One of the files is larger than ${Math.round(
        UPLOAD_BUDGET.maxFileSize / (1024 * 1024)
      )} MB. Please split it or upload a compressed archive instead.`,
    }
  }
  if (error.code === 'LIMIT_FILE_COUNT') {
    return {
      status: 413,
      error: `This project has more than ${UPLOAD_BUDGET.maxFiles.toLocaleString()} files. Please upload it as a compressed archive instead.`,
    }
  }
  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      status: 400,
      error: "Unexpected file field. Use the 'files' field when uploading a project.",
    }
  }
  return null
}

export function fileRoutes(db, requireAuth) {
  const router = Router()
  router.use(requireAuth)

  /**
   * Make sure the signed in user may touch the project. Projects created
   * before ownership was tracked (userId is null) stay accessible.
   */
  const ownsProject = async (req) => {
    const userId = (req.user && req.user.userId) || null
    const project = await db.get(
      'SELECT id FROM projects WHERE id = ? AND status = "active" AND (userId = ? OR userId IS NULL)',
      [req.params.projectId, userId]
    )
    return Boolean(project)
  }

  /**
   * Upload a whole project folder (or individual files).
   * The browser sends each file's path in the multipart filename, so the
   * original folder structure is preserved on disk.
   */
  // An upload fills the disk, so the number of them is limited.
  const uploadLimit = createRateLimit({
    windowMs: 10 * 60 * 1000,
    max: Number(process.env.UPLOADS_PER_WINDOW || 60),
    message:
      'Too many uploads in a short time. Please wait a little and try again.',
    keyFn: req => (req.user && req.user.userId) || req.ip || 'unknown'
  })

  router.post(
    '/:projectId/upload',
    uploadLimit,
    (req, res, next) => {
      upload.fields([
        { name: 'files', maxCount: UPLOAD_BUDGET.maxFiles },
        { name: 'file', maxCount: 1 }
      ])(req, res, error => {
        if (!error) return next()
        const limit = uploadLimitError(error)
        if (limit) {
          return res.status(limit.status).json({ error: limit.error })
        }
        next(error)
      })
    },
    async (req, res, next) => {
      try {
        if (!(await ownsProject(req))) {
          return res.status(404).json({ error: 'Project not found' })
        }

        const collected = []
        if (req.files && !Array.isArray(req.files)) {
          for (const group of Object.values(req.files)) {
            if (Array.isArray(group)) collected.push(...group)
            else if (group) collected.push(group)
          }
        }

        if (collected.length === 0) {
          return res.status(400).json({
            error: 'No analysable files were uploaded.',
            hint: 'Upload source files (.ts, .js, .py, .java, ...) or a project folder.'
          })
        }

        // The project budget is the total size of everything uploaded to it.
        const existingSize = await db.get(
          'SELECT COALESCE(SUM(fileSize), 0) as total FROM files WHERE projectId = ?',
          [req.params.projectId]
        )
        const incomingSize = collected.reduce((sum, file) => sum + (file.size || 0), 0)
        const projectSize = Number(existingSize?.total || 0) + incomingSize

        if (projectSize > UPLOAD_BUDGET.maxProjectSize) {
          // Remove what this request wrote so the project is left as it was
          for (const file of collected) {
            try {
              if (fs.existsSync(file.path)) fs.unlinkSync(file.path)
            } catch {
              // ignore
            }
          }
          const maxGb = (UPLOAD_BUDGET.maxProjectSize / (1024 * 1024 * 1024)).toFixed(1)
          return res.status(413).json({
            error:
              `This upload would take the project over the ${maxGb} GB limit. ` +
              'Please upload fewer files, or exclude the build output and dependency folders.',
          })
        }

        const now = new Date().toISOString()
        const inserted = []
        const archives = []
        const workspaceDir = projectUploadDir(
          (req.user && req.user.userId) || 'anonymous',
          req.params.projectId
        )

        for (const file of collected) {
          const id = uuidv4()
          const relativePath = sanitizeRelativePath(file.originalname, file.originalname)
          const isArchive = /\.(zip|tar|tar\.gz|tgz|gz)$/i.test(file.originalname)

          // Replace a previous upload of the same path so the file list does
          // not accumulate duplicates when a folder is uploaded again.
          const previous = await db.all(
            'SELECT id, storedPath FROM files WHERE projectId = ? AND relativePath = ?',
            [req.params.projectId, relativePath]
          )
          for (const old of previous) {
            await db.run('DELETE FROM files WHERE id = ?', [old.id])
            // The new upload may have been written to the very same path, so
            // only remove the old file when it is a different one.
            const samePath =
              old.storedPath && path.resolve(old.storedPath) === path.resolve(file.path)
            if (samePath) continue
            try {
              if (old.storedPath && fs.existsSync(old.storedPath)) fs.unlinkSync(old.storedPath)
            } catch {
              // the file may already be gone
            }
          }

          await db.run(
            `INSERT INTO files (id, projectId, originalFilename, relativePath, fileSize, storedPath, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.projectId, path.basename(file.originalname), relativePath, file.size, file.path, now]
          )
          inserted.push({
            id,
            projectId: req.params.projectId,
            originalFilename: path.basename(file.originalname),
            relativePath,
            fileSize: file.size,
            createdAt: now
          })

          if (isArchive) {
            archives.push(file.path)
          }
        }

        // Extract any uploaded archives so their sources can be analysed
        let extractedTo = null
        const problems = []
        for (const archive of archives) {
          const target = await extractArchive(archive, workspaceDir)
          if (target) {
            extractedTo = target
          } else {
            problems.push(path.basename(archive))
          }
        }

        // An archive that was accepted but could not be taken apart is
        // said out loud. Otherwise the person is left with an empty
        // project and no idea why.
        if (problems.length > 0) {
          problems.forEach(name => {
            console.warn(`[upload] the archive ${name} could not be taken apart`)
          })
        }

        const skippedFiles = req.skippedFiles || []

        console.log(
          `[upload] project=${req.params.projectId} user=${(req.user && req.user.email) || 'anonymous'} ` +
          `accepted=${inserted.length} skipped=${skippedFiles.length} ` +
          `files=[${inserted.slice(0, 20).map(f => f.relativePath).join(', ')}${inserted.length > 20 ? ', ...' : ''}]`
        )

        res.status(201).json({
          files: inserted,
          count: inserted.length,
          skippedFiles,
          extracted: Boolean(extractedTo),
          scanPath: extractedTo || workspaceDir,
          projectSize,
          // The archives that could not be taken apart, when there were
          // any.
          archivesNotExtracted: problems.length > 0 ? problems : undefined
        })
      } catch (error) {
        if (error && error.status === 400) {
          return res.status(400).json({ error: error.message })
        }
        next(error)
      }
    }
  )

  // List uploaded files for a project
  router.get('/:projectId/files', async (req, res, next) => {
    try {
      if (!(await ownsProject(req))) {
        return res.status(404).json({ error: 'Project not found' })
      }
      // A project with five thousand files should not send five thousand
      // rows to a browser that shows twenty of them. Asking for a page
      // gets one page and the count; not asking keeps the whole list.
      const page = readPage(req.query)
      const total = await db.get(
        'SELECT COUNT(*) as count FROM files WHERE projectId = ?',
        [req.params.projectId]
      )

      const rows = await db.all(
        `SELECT * FROM files WHERE projectId = ? ORDER BY relativePath ASC
         ${page.paged ? 'LIMIT ? OFFSET ?' : ''}`,
        page.paged
          ? [req.params.projectId, page.pageSize, page.offset]
          : [req.params.projectId]
      )

      const items = rows.map(f => ({
        id: f.id,
        originalFilename: f.originalFilename,
        relativePath: f.relativePath,
        fileSize: f.fileSize
      }))

      if (page.paged) {
        return res.json(paged(items, total.count || 0, page))
      }
      res.json(items)
    } catch (error) {
      next(error)
    }
  })

  // Delete an uploaded file
  router.delete('/:projectId/files/:id', async (req, res, next) => {
    try {
      if (!(await ownsProject(req))) {
        return res.status(404).json({ error: 'Project not found' })
      }
      const file = await db.get(
        'SELECT * FROM files WHERE id = ? AND projectId = ?',
        [req.params.id, req.params.projectId]
      )
      if (!file) {
        return res.status(404).json({ error: 'File not found' })
      }

      await db.run('DELETE FROM files WHERE id = ?', [req.params.id])
      try {
        fs.unlinkSync(file.storedPath)
      } catch {
        // File may already be missing; ignore
      }

      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // Delete ALL uploaded files for a project (reset workspace)
  router.delete('/:projectId/files', async (req, res, next) => {
    try {
      if (!(await ownsProject(req))) {
        return res.status(404).json({ error: 'Project not found' })
      }
      const rows = await db.all('SELECT * FROM files WHERE projectId = ?', [req.params.projectId])
      for (const row of rows) {
        try {
          fs.unlinkSync(row.storedPath)
        } catch {
          // ignore
        }
      }
      await db.run('DELETE FROM files WHERE projectId = ?', [req.params.projectId])
      res.json({ success: true, deleted: rows.length })
    } catch (error) {
      next(error)
    }
  })

  return router
}
