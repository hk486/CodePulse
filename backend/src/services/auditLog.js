import { v4 as uuidv4 } from 'uuid'

/**
 * The audit log.
 *
 * A record of what happened to an account: the sign ins, the keys that
 * were made, the projects that were pushed and deleted. It is there so
 * that somebody who suspects their account has been used can see what
 * actually happened.
 *
 * The log never holds a password, a token or a key.
 */
export class AuditLog {
  constructor(db) {
    this.db = db
  }

  /**
   * Write one entry.
   *
   * A failure here must never break the action that was being recorded,
   * so it is caught and put in the log rather than thrown.
   */
  async record(userId, action, detail = {}, request = null) {
    try {
      await this.db.run(
        `INSERT INTO audit_log (id, userId, action, detail, ip, userAgent, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          userId || null,
          String(action),
          JSON.stringify(detail || {}),
          request?.ip || request?.socket?.remoteAddress || null,
          request?.headers?.['user-agent']?.slice(0, 200) || null,
          new Date().toISOString(),
        ]
      )
    } catch (error) {
      console.error('[audit] could not write the entry:', error.message)
    }
  }

  /** The entries of one user, newest first. */
  async listForUser(userId, limit = 100) {
    const rows = await this.db.all(
      'SELECT * FROM audit_log WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
      [userId, limit]
    )
    return rows.map(row => {
      let detail = {}
      try {
        detail = JSON.parse(row.detail || '{}')
      } catch {
        detail = {}
      }
      return {
        id: row.id,
        action: row.action,
        detail,
        ip: row.ip,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
      }
    })
  }
}
