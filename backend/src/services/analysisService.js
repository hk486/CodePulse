import { v4 as uuidv4 } from 'uuid'

/**
 * The analyses of a project.
 *
 * Every read and every delete is scoped to the projects the person asking
 * owns. A project belongs to the user who made it; the projects that
 * predate ownership (userId is null) stay readable by everybody, so
 * nothing that already existed is lost.
 *
 * An analysis is a job as much as it is a result. The row is written the
 * moment the scan is asked for, so a run that is still going can be seen,
 * followed and cancelled, and a run that was interrupted by a restart is
 * picked up again rather than lost.
 */
export class AnalysisService {
  constructor(db) {
    this.db = db
  }

  /**
   * The projects the person may see: their own, plus the ones that were
   * created before ownership was tracked.
   */
  ownedProjectsClause(userId) {
    return {
      sql: userId ? '(p.userId = ? OR p.userId IS NULL)' : '1 = 1',
      values: userId ? [userId] : []
    }
  }

  /**
   * Write down that a scan has been asked for. The row starts life queued,
   * with nothing found in it yet.
   */
  async createJob(projectId, userId = null, options = {}) {
    const id = uuidv4()
    const now = new Date().toISOString()

    await this.db.run(
      `INSERT INTO analyses
        (id, projectId, userId, status, totalFindings, critical, high, medium, low, info,
         findings, createdAt, queuedAt, progress, stage, options)
       VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, ?, ?, ?, 0, ?, ?)`,
      [
        id,
        projectId,
        userId,
        'queued',
        JSON.stringify([]),
        now,
        now,
        'queued',
        JSON.stringify(options || {})
      ]
    )

    return { id, projectId, status: 'queued', progress: 0, stage: 'queued', createdAt: now }
  }

  /**
   * Take the next job that nobody is working on.
   *
   * The row is claimed in the same statement that reads it, so two workers
   * cannot pick up the same job.
   */
  async claimNextJob() {
    const candidate = await this.db.get(
      `SELECT * FROM analyses
        WHERE status = 'queued' AND COALESCE(cancelRequested, 0) = 0
        ORDER BY createdAt ASC
        LIMIT 1`
    )
    if (!candidate) return null

    const now = new Date().toISOString()
    const result = await this.db.runChanges(
      `UPDATE analyses
          SET status = 'running', startedAt = ?, stage = 'starting', progress = 0
        WHERE id = ? AND status = 'queued'`,
      [now, candidate.id]
    )

    // Somebody else got there first.
    if (!result || result.changes === 0) return null

    return this.hydrate({ ...candidate, status: 'running', startedAt: now })
  }

  /**
   * How far the scan has got. The stage and the message are what the
   * browser shows, so they are written as they change.
   */
  async updateProgress(id, { progress, stage, message } = {}) {
    const sets = []
    const values = []
    if (typeof progress === 'number') {
      sets.push('progress = ?')
      values.push(Math.max(0, Math.min(100, Math.round(progress))))
    }
    if (stage) {
      sets.push('stage = ?')
      values.push(stage)
    }
    if (!sets.length) return

    values.push(id)
    await this.db.run(`UPDATE analyses SET ${sets.join(', ')} WHERE id = ?`, values)
  }

  /**
   * Write the result of a scan into the row that was waiting for it.
   */
  async completeJob(id, findings = [], metadata = {}, extra = {}) {
    const now = new Date().toISOString()

    const summary = {
      totalFindings: findings.length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      high: findings.filter(f => f.severity === 'HIGH').length,
      medium: findings.filter(f => f.severity === 'MEDIUM').length,
      low: findings.filter(f => f.severity === 'LOW').length,
      info: findings.filter(f => f.severity === 'INFO').length
    }

    await this.db.run(
      `UPDATE analyses SET
         status = 'completed',
         totalFindings = ?, critical = ?, high = ?, medium = ?, low = ?, info = ?,
         findings = ?, completedAt = ?, executionTime = ?, progress = 100, stage = 'done',
         detectedLanguages = ?, detectedFrameworks = ?, components = ?, techStack = ?,
         projectType = ?, analyzersRun = ?, scannedFiles = ?, coverage = ?,
         gate = ?, analyzedSource = ?, pipeline = ?
       WHERE id = ?`,
      [
        summary.totalFindings,
        summary.critical,
        summary.high,
        summary.medium,
        summary.low,
        summary.info,
        JSON.stringify(findings),
        now,
        metadata.executionTime ?? null,
        JSON.stringify(metadata.detectedLanguages || []),
        JSON.stringify(metadata.detectedFrameworks || []),
        JSON.stringify(metadata.components || []),
        JSON.stringify(metadata.techStack || {}),
        metadata.projectType || null,
        JSON.stringify(metadata.analyzersRun || []),
        metadata.scannedFiles ?? null,
        JSON.stringify(metadata.coverage || {}),
        extra.gate ? JSON.stringify(extra.gate) : null,
        extra.analyzedSource || null,
        extra.pipeline ? JSON.stringify(extra.pipeline) : null,
        id
      ]
    )

    return {
      id,
      ...summary,
      findings,
      createdAt: now,
      completedAt: now,
      status: 'completed',
      progress: 100,
      stage: 'done',
      ...metadata,
      ...extra
    }
  }

  /**
   * Record that a scan did not finish.
   */
  async failJob(id, error, stage = null) {
    const now = new Date().toISOString()
    const message = String(error || 'The analysis did not finish.')
    await this.db.run(
      `UPDATE analyses SET status = 'failed', error = ?, completedAt = ?, stage = ? WHERE id = ?`,
      [message, now, stage, id]
    )
    return { id, status: 'failed', error: message, completedAt: now }
  }

  /**
   * Ask for a scan to stop. The worker notices between steps and kills the
   * scan it is running.
   */
  async requestCancel(id) {
    const result = await this.db.runChanges(
      `UPDATE analyses SET cancelRequested = 1 WHERE id = ? AND status IN ('queued', 'running')`,
      [id]
    )
    return !!result && result.changes > 0
  }

  /**
   * Was this scan asked to stop?
   */
  async isCancelled(id) {
    const row = await this.db.get(
      'SELECT cancelRequested FROM analyses WHERE id = ?',
      [id]
    )
    return !!(row && row.cancelRequested)
  }

  /**
   * Put the scans that were running when the server stopped back on the
   * queue. Nothing was written to them, so they can simply run again.
   */
  async requeueInterrupted() {
    const result = await this.db.runChanges(
      `UPDATE analyses
          SET status = 'queued', stage = 'queued', progress = 0, startedAt = NULL
        WHERE status = 'running'`
    )
    return result && result.changes ? result.changes : 0
  }

  async getByProject(projectId, userId = null) {
    const owned = this.ownedProjectsClause(userId)
    const analyses = await this.db.all(
      `SELECT a.* FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE a.projectId = ? AND ${owned.sql}
        ORDER BY a.createdAt DESC`,
      [projectId, ...owned.values]
    )

    return analyses.map(a => this.hydrate(a))
  }

  async getById(id, userId = null) {
    const owned = this.ownedProjectsClause(userId)
    const analysis = await this.db.get(
      `SELECT a.* FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE a.id = ? AND ${owned.sql}`,
      [id, ...owned.values]
    )

    if (!analysis) return null

    return this.hydrate(analysis)
  }

  async getLatestByProject(projectId, userId = null) {
    const owned = this.ownedProjectsClause(userId)
    const analysis = await this.db.get(
      `SELECT a.* FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE a.projectId = ? AND ${owned.sql}
        ORDER BY a.createdAt DESC LIMIT 1`,
      [projectId, ...owned.values]
    )

    if (!analysis) return null

    return this.hydrate(analysis)
  }

  /**
   * Turn the stored JSON columns into real values so the API can hand
   * the detected stack straight to the UI.
   */
  hydrate(analysis) {
    const parse = (value, fallback) => {
      if (value === null || value === undefined) return fallback
      try {
        return typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        return fallback
      }
    }

    return {
      ...analysis,
      findings: parse(analysis.findings, []),
      detectedLanguages: parse(analysis.detectedLanguages, []),
      detectedFrameworks: parse(analysis.detectedFrameworks, []),
      components: parse(analysis.components, []),
      techStack: parse(analysis.techStack, {}),
      analyzersRun: parse(analysis.analyzersRun, []),
      coverage: parse(analysis.coverage, null),
      gate: parse(analysis.gate, null),
      options: parse(analysis.options, {}),
      pipeline: parse(analysis.pipeline, null),
      progress: typeof analysis.progress === 'number' ? analysis.progress : 0,
      stage: analysis.stage || (analysis.status === 'completed' ? 'done' : analysis.status || null)
    }
  }

  /**
   * Remove an analysis. It only goes if the person asking owns the
   * project it belongs to.
   */
  async delete(id, userId = null) {
    const owned = this.ownedProjectsClause(userId)
    const analysis = await this.db.get(
      `SELECT a.id FROM analyses a
         JOIN projects p ON p.id = a.projectId
        WHERE a.id = ? AND ${owned.sql}`,
      [id, ...owned.values]
    )
    if (!analysis) return false

    await this.db.run('DELETE FROM analyses WHERE id = ?', [id])
    await this.db.run('DELETE FROM reports WHERE analysisId = ?', [id])
    return true
  }
}
