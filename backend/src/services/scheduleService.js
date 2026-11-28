import { v4 as uuidv4 } from 'uuid'

/**
 * Scheduled analyses.
 *
 * A project that is scanned once is a project that goes stale. A schedule
 * says "scan this again every night", so the numbers on the dashboard are
 * about the code as it is now.
 *
 * The schedule itself is stored in the database and worked through by the
 * worker, so it survives a restart.
 */

const UNITS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000
}

export class ScheduleService {
  constructor(db) {
    this.db = db
  }

  /**
   * The schedules of a person.
   */
  async listForUser(userId) {
    const rows = await this.db.all(
      'SELECT * FROM schedules WHERE userId = ? ORDER BY createdAt DESC',
      [userId]
    )
    return rows.map(row => this.hydrate(row))
  }

  async get(id, userId) {
    const row = await this.db.get(
      'SELECT * FROM schedules WHERE id = ? AND userId = ?',
      [id, userId]
    )
    return row ? this.hydrate(row) : null
  }

  /**
   * Make a schedule.
   */
  async create(userId, body = {}) {
    const projectId = String(body.projectId || '').trim()
    if (!projectId) {
      const error = new Error('A schedule needs a project.')
      error.status = 400
      throw error
    }

    const every = Number(body.every || 0)
    const unit = String(body.unit || '').trim()
    if (!every || every < 1 || !UNITS[unit]) {
      const error = new Error(
        `Say how often, with a number and one of: ${Object.keys(UNITS).join(', ')}.`
      )
      error.status = 400
      throw error
    }

    const id = uuidv4()
    const now = new Date().toISOString()
    const intervalMs = every * UNITS[unit]
    const nextRunAt = new Date(Date.now() + intervalMs).toISOString()

    await this.db.run(
      `INSERT INTO schedules
        (id, userId, projectId, every, unit, enabled, createdAt, nextRunAt, lastRunAt, runs)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, NULL, 0)`,
      [id, userId, projectId, every, unit, now, nextRunAt]
    )

    return this.get(id, userId)
  }

  async setEnabled(id, userId, enabled) {
    const result = await this.db.runChanges(
      'UPDATE schedules SET enabled = ? WHERE id = ? AND userId = ?',
      [enabled ? 1 : 0, id, userId]
    )
    return !!(result && result.changes > 0)
  }

  async remove(id, userId) {
    const result = await this.db.runChanges(
      'DELETE FROM schedules WHERE id = ? AND userId = ?',
      [id, userId]
    )
    return !!(result && result.changes > 0)
  }

  /**
   * The schedules that are due.
   *
   * A schedule is claimed in the same statement that reads it, so a
   * schedule cannot be run twice when there is more than one worker.
   */
  async claimDue(now = new Date().toISOString()) {
    const candidate = await this.db.get(
      `SELECT * FROM schedules
        WHERE enabled = 1 AND nextRunAt IS NOT NULL AND nextRunAt <= ?
        ORDER BY nextRunAt ASC
        LIMIT 1`,
      [now]
    )
    if (!candidate) return null

    // Move it on before the work starts, so a long scan cannot make it
    // run again while it is still running. If the server was down and
    // missed intervals, jump to the next future slot instead of catching
    // up one interval at a time.
    const intervalMs = candidate.every * (UNITS[candidate.unit] || UNITS.days)
    const nowMs = new Date(now).getTime()
    let nextMs = new Date(candidate.nextRunAt).getTime() + intervalMs
    if (nextMs <= nowMs) {
      const missed = Math.floor((nowMs - nextMs) / intervalMs) + 1
      nextMs += missed * intervalMs
    }
    const nextRunAt = new Date(nextMs).toISOString()

    const result = await this.db.runChanges(
      `UPDATE schedules
          SET nextRunAt = ?, lastRunAt = ?, runs = runs + 1
        WHERE id = ? AND enabled = 1 AND nextRunAt = ?`,
      [nextRunAt, now, candidate.id, candidate.nextRunAt]
    )

    if (!result || result.changes === 0) return null
    return candidate
  }

  hydrate(row) {
    return {
      id: row.id,
      projectId: row.projectId,
      every: row.every,
      unit: row.unit,
      enabled: !!row.enabled,
      createdAt: row.createdAt,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      runs: row.runs || 0
    }
  }
}

export { UNITS as SCHEDULE_UNITS }
