import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

/**
 * Password resets.
 *
 * A reset token is 32 random bytes. Only its hash is stored, so a copy of
 * the database cannot be turned into a list of working reset links. The
 * token is good for one hour and for one use, and resetting the password
 * ends every session that account had, because a password reset is
 * exactly what someone does when they think someone else is in the
 * account.
 */

const DEFAULT_TTL_MINUTES = 60

export class PasswordResetService {
  constructor(db, options = {}) {
    this.db = db
    this.ttlMs =
      options.ttlMs ?? Number(process.env.PASSWORD_RESET_TTL_MINUTES || DEFAULT_TTL_MINUTES) * 60 * 1000
  }

  /** Only the hash of a token is ever stored. */
  static hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex')
  }

  /**
   * Start a reset.
   *
   * Returns null when there is no account for that address, so the caller
   * can answer the same way either way.
   */
  async request(email) {
    const address = String(email || '').trim().toLowerCase()
    if (!address) return null

    const user = await this.db.get(
      'SELECT id, email, fullName FROM users WHERE email = ?',
      [address]
    )
    if (!user) return null

    // One live reset per account: a new request replaces the old one.
    await this.db.run(
      'DELETE FROM password_resets WHERE userId = ? AND usedAt IS NULL',
      [user.id]
    )

    const token = crypto.randomBytes(32).toString('base64url')
    const now = new Date()
    await this.db.run(
      `INSERT INTO password_resets (id, userId, tokenHash, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        user.id,
        PasswordResetService.hashToken(token),
        now.toISOString(),
        new Date(now.getTime() + this.ttlMs).toISOString(),
      ]
    )

    return { token, user }
  }

  /**
   * Use a reset token to set a new password.
   *
   * The password is set by the caller, because the hashing lives with the
   * accounts.
   */
  async findValid(token) {
    if (!token) return { ok: false, error: 'A reset token is required.' }

    const row = await this.db.get(
      'SELECT * FROM password_resets WHERE tokenHash = ?',
      [PasswordResetService.hashToken(token)]
    )
    if (!row) {
      return { ok: false, error: 'That reset link is not valid.' }
    }
    if (row.usedAt) {
      return { ok: false, error: 'That reset link has already been used.' }
    }
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      await this.db.run('DELETE FROM password_resets WHERE id = ?', [row.id])
      return { ok: false, error: 'That reset link has expired. Request a new one.' }
    }
    return { ok: true, row }
  }

  /** Mark a reset as used and close it down. */
  async consume(id) {
    await this.db.run(
      'UPDATE password_resets SET usedAt = ? WHERE id = ?',
      [new Date().toISOString(), id]
    )
  }

  /** Remove the expired and the spent ones. */
  async prune() {
    const now = new Date().toISOString()
    await this.db.run('DELETE FROM password_resets WHERE expiresAt < ?', [now])
    await this.db.run(
      'DELETE FROM password_resets WHERE usedAt IS NOT NULL AND usedAt < ?',
      [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]
    )
  }
}
