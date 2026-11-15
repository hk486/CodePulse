import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../../uploads')

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true })
}

/**
 * Where a project's uploaded files live on disk.
 *
 * The workspace is keyed by project id only. Keying it by user id as well
 * meant that a request whose token had expired wrote into a different
 * folder than the one the analysis later looked in, so the analysis found
 * nothing.
 *
 * Layout: <UPLOAD_DIR>/<projectId>/
 */
export function projectUploadDir(userId, projectId) {
  const dir = path.join(uploadRoot, projectId || 'unassigned')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * The legacy layout (<UPLOAD_DIR>/<userId>/<projectId>) that earlier
 * versions used. It is still searched so projects uploaded before the
 * change keep working.
 */
export function legacyProjectUploadDir(userId, projectId) {
  return path.join(uploadRoot, userId || 'anonymous', projectId || 'unassigned')
}

/**
 * Every folder that could hold a project's files, most specific first.
 */
export function projectUploadCandidates(userId, projectId) {
  return [
    path.join(uploadRoot, projectId || 'unassigned'),
    legacyProjectUploadDir(userId, projectId)
  ]
}

export { uploadRoot }
