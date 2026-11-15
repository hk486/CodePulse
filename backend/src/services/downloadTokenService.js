import crypto from 'crypto'

/**
 * One-time download links.
 *
 * A file is downloaded by the browser following a link, not by a script
 * making a blob, so the link has to carry something the server can check
 * without the browser sending an authorisation header. A download token
 * does that: it stands for one file, for one person, for two minutes, and
 * it is spent the moment it is used.
 *
 * The tokens live in memory. They are good for two minutes, so there is
 * nothing to lose when the server restarts.
 */
export class DownloadTokenService {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60 * 1000
    this.tokens = new Map()
  }

  /**
   * Make a token for a file.
   *
   * The kind and the id say what to hand over when the link is followed.
   */
  issue(userId, kind, id = null) {
    const token = crypto.randomBytes(24).toString('base64url')
    this.tokens.set(token, {
      userId,
      kind,
      id,
      expiresAt: Date.now() + this.ttlMs,
    })
    this.prune()
    return token
  }

  /**
   * Take a token, and check it.
   *
   * The token is spent as it is read, so a link cannot be used twice.
   */
  take(token) {
    const entry = this.tokens.get(token)
    if (!entry) return null
    this.tokens.delete(token)
    if (entry.expiresAt < Date.now()) return null
    return entry
  }

  /** Remove the tokens that have run out. */
  prune() {
    const now = Date.now()
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token)
    }
  }
}
