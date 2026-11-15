import { v4 as uuidv4 } from 'uuid'

/**
 * The project plus the detected stack of its most recent analysis.
 */
const PROJECT_SELECT = `
  SELECT p.*,
         (SELECT COUNT(*) FROM files f WHERE f.projectId = p.id) AS fileCount,
         (SELECT a.detectedLanguages FROM analyses a
           WHERE a.projectId = p.id ORDER BY a.createdAt DESC LIMIT 1) AS detectedLanguages,
         (SELECT a.detectedFrameworks FROM analyses a
           WHERE a.projectId = p.id ORDER BY a.createdAt DESC LIMIT 1) AS detectedFrameworks,
         (SELECT a.components FROM analyses a
           WHERE a.projectId = p.id ORDER BY a.createdAt DESC LIMIT 1) AS components,
         (SELECT a.techStack FROM analyses a
           WHERE a.projectId = p.id ORDER BY a.createdAt DESC LIMIT 1) AS techStack
    FROM projects p`

export class ProjectService {
  constructor(db) {
    this.db = db
  }

  async create(projectData, userId = null) {
    const id = uuidv4()
    const now = new Date().toISOString()

    await this.db.run(
      `INSERT INTO projects (id, name, path, description, languages, frameworks, createdAt, updatedAt, status, userId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        projectData.name,
        projectData.path || projectData.repositoryUrl || '',
        projectData.description || '',
        JSON.stringify(projectData.languages || []),
        JSON.stringify(projectData.frameworks || []),
        now,
        now,
        'active',
        userId
      ]
    )

    return { id, ...projectData, userId, createdAt: now, updatedAt: now }
  }

  /**
   * Projects owned by the given user. Projects created before ownership was
   * tracked (userId is null) stay visible to everyone so nothing is lost.
   */
  async getAll(userId = null) {
    // Projects whose owner no longer exists are orphans and are hidden.
    const projects = userId
      ? await this.db.all(
          `${PROJECT_SELECT} WHERE p.status = "active"
             AND (p.userId = ? OR p.userId IS NULL)
             AND (p.userId IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = p.userId))
           ORDER BY p.updatedAt DESC`,
          [userId]
        )
      : await this.db.all(
          `${PROJECT_SELECT} WHERE p.status = "active"
             AND (p.userId IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id = p.userId))
           ORDER BY p.updatedAt DESC`
        )

    return projects.map(p => this.hydrate(p))
  }

  async getById(id, userId = null) {
    const project = userId
      ? await this.db.get(
          `${PROJECT_SELECT} WHERE p.id = ? AND p.status = "active" AND (p.userId = ? OR p.userId IS NULL)`,
          [id, userId]
        )
      : await this.db.get(
          `${PROJECT_SELECT} WHERE p.id = ? AND p.status = "active"`,
          [id]
        )

    if (!project) return null

    return this.hydrate(project)
  }

  /**
   * Add the detected stack of the latest analysis so the project card shows
   * what the scanner actually found instead of what the user typed.
   */
  hydrate(project) {
    const parse = (value, fallback) => {
      if (value === null || value === undefined) return fallback
      try {
        return typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        return fallback
      }
    }

    return {
      ...project,
      // The repository URL is stored in the path column. The frontend
      // needs it under its own name to offer the link.
      repositoryUrl: project.path || '',
      languages: parse(project.languages, []),
      frameworks: parse(project.frameworks, []),
      detectedLanguages: parse(project.detectedLanguages, []),
      detectedFrameworks: parse(project.detectedFrameworks, []),
      components: parse(project.components, []),
      techStack: parse(project.techStack, {})
    }
  }

  async update(id, updates, userId = null) {
    const now = new Date().toISOString()
    const existing = await this.getById(id, userId)
    if (!existing) return null

    // The repository URL is kept in the path column. Changing it is
    // allowed, but only when a new one is given, so a blank field does not
    // wipe it.
    const repositoryUrl =
      updates.repositoryUrl !== undefined
        ? updates.repositoryUrl
        : existing.repositoryUrl

    await this.db.run(
      `UPDATE projects SET 
        name = ?, 
        description = ?, 
        languages = ?, 
        frameworks = ?,
        path = ?,
        updatedAt = ?
       WHERE id = ?`,
      [
        updates.name ?? existing.name,
        updates.description ?? existing.description,
        JSON.stringify(updates.languages || existing.languages || []),
        JSON.stringify(updates.frameworks || existing.frameworks || []),
        repositoryUrl ?? existing.path ?? '',
        now,
        id
      ]
    )

    return this.getById(id, userId)
  }

  async delete(id, userId = null) {
    if (userId) {
      const existing = await this.getById(id, userId)
      if (!existing) return false
    }
    await this.db.run(
      'UPDATE projects SET status = "deleted", updatedAt = ? WHERE id = ?',
      [new Date().toISOString(), id]
    )
    return true
  }

  /**
   * The figures for one project.
   *
   * This used to return the totals for every project the user owns, which
   * meant the same numbers came back whatever the project id in the URL.
   * Now everything is about the project that was asked for.
   */
  async stats(projectId, userId = null) {
    const project = userId
      ? await this.db.get(
          `SELECT * FROM projects
            WHERE id = ? AND status = "active" AND (userId = ? OR userId IS NULL)`,
          [projectId, userId]
        )
      : await this.db.get(
          `SELECT * FROM projects WHERE id = ? AND status = "active"`,
          [projectId]
        )
    if (!project) return null

    const files = await this.db.get(
      `SELECT COUNT(*) as count, COALESCE(SUM(fileSize), 0) as bytes
         FROM files WHERE projectId = ?`,
      [projectId]
    )

    const analyses = await this.db.get(
      `SELECT COUNT(*) as count FROM analyses WHERE projectId = ?`,
      [projectId]
    )

    const last = await this.db.get(
      `SELECT id, totalFindings, critical, high, medium, low, info,
              detectedLanguages, createdAt, completedAt, executionTime
         FROM analyses
        WHERE projectId = ? AND status = 'completed'
        ORDER BY createdAt DESC LIMIT 1`,
      [projectId]
    )

    const severity = await this.db.get(
      `SELECT COALESCE(SUM(critical), 0) as critical,
              COALESCE(SUM(high), 0) as high,
              COALESCE(SUM(medium), 0) as medium,
              COALESCE(SUM(low), 0) as low,
              COALESCE(SUM(info), 0) as info,
              COALESCE(SUM(totalFindings), 0) as total
         FROM analyses WHERE projectId = ?`,
      [projectId]
    )

    const parse = (value, fallback) => {
      if (value === null || value === undefined) return fallback
      try {
        return typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        return fallback
      }
    }

    return {
      projectId,
      name: project.name,
      files: files.count || 0,
      bytes: files.bytes || 0,
      analyses: analyses.count || 0,
      findings: severity.total || 0,
      critical: severity.critical || 0,
      high: severity.high || 0,
      medium: severity.medium || 0,
      low: severity.low || 0,
      info: severity.info || 0,
      languages: parse(last ? last.detectedLanguages : null, []),
      lastAnalysisAt: last ? last.createdAt : null,
      lastAnalysisId: last ? last.id : null,
    }
  }
}
