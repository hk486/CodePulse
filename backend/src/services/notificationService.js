import { v4 as uuidv4 } from 'uuid'

/**
 * In-app notifications.
 *
 * Every notification belongs to a user, can be marked as read, dismissed or
 * removed, and the user controls which kinds they receive through their
 * notification preferences.
 */
export class NotificationService {
  constructor(db) {
    this.db = db
  }

  /**
   * The preferences of a user, with sensible defaults.
   */
  async getPreferences(userId) {
    const row = await this.db.get(
      'SELECT * FROM notification_preferences WHERE userId = ?',
      [userId]
    )
    if (row) {
      return {
        analysisComplete: Boolean(row.analysisComplete),
        criticalIssues: Boolean(row.criticalIssues),
        weeklySummary: Boolean(row.weeklySummary),
        realTimeUpdates: Boolean(row.realTimeUpdates)
      }
    }
    return {
      analysisComplete: true,
      criticalIssues: true,
      weeklySummary: true,
      realTimeUpdates: true
    }
  }

  async savePreferences(userId, preferences) {
    const now = new Date().toISOString()
    await this.db.run(
      `INSERT OR REPLACE INTO notification_preferences
        (userId, analysisComplete, criticalIssues, weeklySummary, realTimeUpdates, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        preferences.analysisComplete ? 1 : 0,
        preferences.criticalIssues ? 1 : 0,
        preferences.weeklySummary ? 1 : 0,
        preferences.realTimeUpdates ? 1 : 0,
        now
      ]
    )
    return this.getPreferences(userId)
  }

  /**
   * Create a notification, unless the user turned this kind off.
   */
  async create(userId, { type, title, message, link, severity, preference }) {
    if (preference) {
      const preferences = await this.getPreferences(userId)
      if (!preferences[preference]) return null
    }

    const id = uuidv4()
    const now = new Date().toISOString()
    await this.db.run(
      `INSERT INTO notifications (id, userId, type, title, message, link, severity, read, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, userId, type, title, message || null, link || null, severity || 'info', now]
    )
    return { id, userId, type, title, message, link, severity, read: 0, createdAt: now }
  }

  /**
   * The figures for the last week, across every project the user owns.
   *
   * This is what the weekly summary is built from.
   */
  async weeklyFigures(userId, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const totals = await this.db.get(
      `SELECT COUNT(*) as analyses,
              COALESCE(SUM(a.totalFindings), 0) as findings,
              COALESCE(SUM(a.critical), 0) as critical,
              COALESCE(SUM(a.high), 0) as high
         FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE (p.userId = ? OR p.userId IS NULL)
          AND a.createdAt >= ?
          AND a.status = 'completed'`,
      [userId, since]
    )

    const perProject = await this.db.all(
      `SELECT p.name as name,
              COUNT(a.id) as analyses,
              COALESCE(SUM(a.totalFindings), 0) as findings,
              COALESCE(SUM(a.critical), 0) as critical
         FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE (p.userId = ? OR p.userId IS NULL)
          AND a.createdAt >= ?
          AND a.status = 'completed'
        GROUP BY p.id, p.name
        ORDER BY findings DESC, p.name ASC`,
      [userId, since]
    )

    return {
      days,
      since,
      analyses: totals.analyses || 0,
      findings: totals.findings || 0,
      critical: totals.critical || 0,
      high: totals.high || 0,
      projects: perProject.map(p => ({
        name: p.name,
        analyses: p.analyses,
        findings: p.findings,
        critical: p.critical,
      })),
    }
  }

  /**
   * When the last weekly summary went out, so one is not sent twice in
   * the same week.
   */
  async lastWeeklySummaryAt(userId) {
    const row = await this.db.get(
      `SELECT createdAt FROM notifications
        WHERE userId = ? AND type = 'weekly_summary'
        ORDER BY createdAt DESC LIMIT 1`,
      [userId]
    )
    return row ? row.createdAt : null
  }

  /**
   * The notifications of a user, newest first, plus the unread count.
   */
  async listForUser(userId, limit = 30) {
    const rows = await this.db.all(
      'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
      [userId, limit]
    )
    const unread = await this.db.get(
      'SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND read = 0',
      [userId]
    )
    return {
      notifications: rows.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title,
        message: row.message,
        link: row.link,
        severity: row.severity,
        read: Boolean(row.read),
        createdAt: row.createdAt
      })),
      unread: unread.count
    }
  }

  async markRead(userId, id) {
    const row = await this.db.get(
      'SELECT id FROM notifications WHERE id = ? AND userId = ?',
      [id, userId]
    )
    if (!row) return false
    await this.db.run('UPDATE notifications SET read = 1 WHERE id = ?', [id])
    return true
  }

  async markAllRead(userId) {
    await this.db.run('UPDATE notifications SET read = 1 WHERE userId = ?', [userId])
    return true
  }

  async dismiss(userId, id) {
    const row = await this.db.get(
      'SELECT id FROM notifications WHERE id = ? AND userId = ?',
      [id, userId]
    )
    if (!row) return false
    await this.db.run('DELETE FROM notifications WHERE id = ?', [id])
    return true
  }

  async clearAll(userId) {
    await this.db.run('DELETE FROM notifications WHERE userId = ?', [userId])
    return true
  }
}
