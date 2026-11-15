import { v4 as uuidv4 } from 'uuid'

/**
 * Builds and stores the reports that the UI shows.
 *
 * A report is a frozen snapshot of an analysis: the findings, the severity
 * breakdown and the quality score. It is created automatically whenever an
 * analysis finishes, so the Reports page always has something to show.
 */
export class ReportService {
  constructor(db) {
    this.db = db
  }

  /**
   * Turn an analysis row into a report snapshot.
   */
  buildContent(analysis, project) {
    const parse = (value, fallback) => {
      if (value === null || value === undefined) return fallback
      try {
        return typeof value === 'string' ? JSON.parse(value) : value
      } catch {
        return fallback
      }
    }

    let findings = []
    try {
      findings = typeof analysis.findings === 'string'
        ? JSON.parse(analysis.findings || '[]')
        : analysis.findings || []
    } catch {
      findings = []
    }

    const components = parse(analysis.components, [])
    const techStack = parse(analysis.techStack, {})
    const detectedLanguages = parse(analysis.detectedLanguages, [])
    const detectedFrameworks = parse(analysis.detectedFrameworks, [])
    const analyzersRun = parse(analysis.analyzersRun, [])
    // What the analysis actually did, so the report is honest about what
    // was covered.
    const pipeline = parse(analysis.pipeline, null)
    const gate = parse(analysis.gate, null)

    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
    const byCategory = {}
    const byLanguage = {}
    const byFile = {}
    const byFacet = {}
    const byComponent = {}

    for (const finding of findings) {
      const severity = String(finding.severity || 'INFO').toUpperCase()
      if (bySeverity[severity] !== undefined) bySeverity[severity]++
      const category = finding.category || 'OTHER'
      byCategory[category] = (byCategory[category] || 0) + 1
      const language = finding.language || 'unknown'
      byLanguage[language] = (byLanguage[language] || 0) + 1
      const file = finding.location?.filePath || 'unknown'
      byFile[file] = (byFile[file] || 0) + 1

      if (finding.facet) {
        byFacet[finding.facet] = (byFacet[finding.facet] || 0) + 1
      }
      if (finding.componentId) {
        byComponent[finding.componentId] = (byComponent[finding.componentId] || 0) + 1
      }
    }

    const total = findings.length
    const weighted =
      bySeverity.CRITICAL * 10 +
      bySeverity.HIGH * 5 +
      bySeverity.MEDIUM * 3 +
      bySeverity.LOW * 1
    const qualityScore = total === 0 ? 100 : Math.max(0, Math.round(100 - (weighted / total) * 4))

    return {
      analysisId: analysis.id,
      projectId: analysis.projectId,
      projectName: project?.name || 'Unknown project',
      projectDescription: project?.description || '',
      languages: project?.languages || [],
      detectedLanguages,
      detectedFrameworks,
      analyzersRun,
      components,
      techStack,
      projectType: analysis.projectType || null,
      pipeline,
      gate,
      generatedAt: new Date().toISOString(),
      summary: {
        totalFindings: total,
        critical: bySeverity.CRITICAL,
        high: bySeverity.HIGH,
        medium: bySeverity.MEDIUM,
        low: bySeverity.LOW,
        info: bySeverity.INFO,
        byCategory,
        byLanguage,
        byFile,
        byFacet,
        byComponent,
        bySeverity,
        qualityScore
      },
      findings
    }
  }

  /**
   * Save (or refresh) the report for an analysis.
   */
  async save(analysis, project) {
    const content = this.buildContent(analysis, project)
    const now = new Date().toISOString()

    const existing = await this.db.get(
      'SELECT id FROM reports WHERE analysisId = ? AND format = ?',
      [analysis.id, 'json']
    )

    if (existing) {
      await this.db.run(
        'UPDATE reports SET content = ?, createdAt = ? WHERE id = ?',
        [JSON.stringify(content), now, existing.id]
      )
      return { ...existing, updated: true, content }
    }

    const id = uuidv4()
    await this.db.run(
      `INSERT INTO reports (id, analysisId, projectId, format, content, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, analysis.id, analysis.projectId, 'json', JSON.stringify(content), now]
    )

    return { id, analysisId: analysis.id, projectId: analysis.projectId, format: 'json', createdAt: now, content }
  }

  parse(value, fallback) {
    if (value === null || value === undefined) return fallback
    try {
      return typeof value === 'string' ? JSON.parse(value) : value
    } catch {
      return fallback
    }
  }

  /**
   * All reports for a user, newest first, with the numbers the list view
   * needs so the browser does not have to download every full report.
   */
  async listForUser(userId, page = null, filters = {}) {
    // The filters the list view uses. They are done here rather than in
    // the browser, so a filter covers every report and not only the ones
    // that happen to be on the page.
    const where = ['(p.userId = ? OR p.userId IS NULL)']
    const values = [userId]

    const severity = String(filters.severity || '').toLowerCase()
    if (severity && severity !== 'all' && ['critical', 'high', 'medium', 'low', 'info'].includes(severity)) {
      where.push(`COALESCE(a.${severity}, 0) > 0`)
    }

    const search = String(filters.search || '').trim()
    if (search) {
      where.push('LOWER(p.name) LIKE ?')
      values.push(`%${search.toLowerCase()}%`)
    }

    const clause = where.join(' AND ')

    const count = await this.db.get(
      `SELECT COUNT(*) as count
         FROM reports r
         LEFT JOIN projects p ON p.id = r.projectId
         LEFT JOIN analyses a ON a.id = r.analysisId
        WHERE ${clause}`,
      values
    )

    const rows = await this.db.all(
      `SELECT r.id, r.analysisId, r.projectId, r.format, r.createdAt,
              p.name AS projectName,
              a.totalFindings, a.critical, a.high, a.medium, a.low, a.info,
              a.detectedLanguages, a.detectedFrameworks, a.components, a.techStack
         FROM reports r
         LEFT JOIN projects p ON p.id = r.projectId
         LEFT JOIN analyses a ON a.id = r.analysisId
        WHERE ${clause}
        ORDER BY r.createdAt DESC
        ${page && page.paged ? 'LIMIT ? OFFSET ?' : ''}`,
      page && page.paged ? [...values, page.pageSize, page.offset] : values
    )

    const items = rows.map(row => ({
      id: row.id,
      analysisId: row.analysisId,
      projectId: row.projectId,
      projectName: row.projectName || 'Unknown project',
      format: row.format,
      createdAt: row.createdAt,
      detectedLanguages: this.parse(row.detectedLanguages, []),
      detectedFrameworks: this.parse(row.detectedFrameworks, []),
      components: this.parse(row.components, []),
      techStack: this.parse(row.techStack, {}),
      summary: {
        totalFindings: row.totalFindings || 0,
        critical: row.critical || 0,
        high: row.high || 0,
        medium: row.medium || 0,
        low: row.low || 0,
        info: row.info || 0
      }
    }))

    // Asking for a page gets the page and the count. Not asking keeps the
    // whole list, which is what the dashboard totals need.
    if (page && page.paged) {
      return { items, total: count.count || 0, ...page }
    }
    return items
  }

  /**
   * Totals across every report of a user, used by the dashboard.
   */
  async summaryForUser(userId) {
    const reports = await this.listForUser(userId)
    const projectIds = new Set()

    const totals = reports.reduce(
      (acc, report) => {
        acc.totalReports += 1
        acc.totalFindings += report.summary.totalFindings
        acc.critical += report.summary.critical
        acc.high += report.summary.high
        acc.medium += report.summary.medium
        acc.low += report.summary.low
        acc.info += report.summary.info
        projectIds.add(report.projectId)
        return acc
      },
      {
        totalReports: 0,
        totalFindings: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
        projects: 0,
        byLanguage: {},
        bySeverity: {},
        byFacet: {},
      }
    )

    totals.projects = projectIds.size

    // The breakdown by language and severity, so the dashboard can show
    // where the findings actually are.
    for (const report of reports) {
      const content = await this.getById(report.id, userId)
      const summary = (content && content.content && content.content.summary) || {}
      for (const [language, count] of Object.entries(summary.byLanguage || {})) {
        totals.byLanguage[language] =
          (totals.byLanguage[language] || 0) + Number(count)
      }
      for (const [severity, count] of Object.entries(summary.bySeverity || {})) {
        totals.bySeverity[severity] =
          (totals.bySeverity[severity] || 0) + Number(count)
      }
      for (const [facet, count] of Object.entries(summary.byFacet || {})) {
        totals.byFacet[facet] = (totals.byFacet[facet] || 0) + Number(count)
      }
    }

    return totals
  }

  /**
   * The report of a whole project: the latest analysis, the detected stack
   * and the history of every analysis that was run.
   */
  async projectReport(projectId, userId) {
    const project = await this.db.get(
      'SELECT * FROM projects WHERE id = ?',
      [projectId]
    );
    if (!project) return null;
    if (project.userId && userId && project.userId !== userId) return null;

    const analyses = await this.db.all(
      'SELECT * FROM analyses WHERE projectId = ? ORDER BY createdAt DESC',
      [projectId]
    );

    const parse = (value, fallback) => {
      if (value === null || value === undefined) return fallback;
      try {
        return typeof value === "string" ? JSON.parse(value) : value;
      } catch {
        return fallback;
      }
    };

    const history = analyses.map(analysis => ({
      id: analysis.id,
      createdAt: analysis.createdAt,
      totalFindings: analysis.totalFindings || 0,
      critical: analysis.critical || 0,
      high: analysis.high || 0,
      medium: analysis.medium || 0,
      low: analysis.low || 0,
      info: analysis.info || 0,
    }));

    const latest = analyses[0] || null;
    const findings = latest ? parse(latest.findings, []) : [];
    const techStack = latest ? parse(latest.techStack, {}) : {};
    const components = latest ? parse(latest.components, []) : [];
    const coverage = latest ? parse(latest.coverage, null) : null;

    // How the numbers moved since the previous run
    const previous = analyses[1] || null;
    const trend = previous
      ? {
          findings: (latest?.totalFindings || 0) - (previous.totalFindings || 0),
          critical: (latest?.critical || 0) - (previous.critical || 0),
        }
      : null;

    const totals = history.reduce(
      (acc, analysis) => {
        acc.totalFindings += analysis.totalFindings;
        acc.critical += analysis.critical;
        acc.high += analysis.high;
        acc.medium += analysis.medium;
        acc.low += analysis.low;
        acc.info += analysis.info;
        return acc;
      },
      { totalFindings: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    );

    const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    const byCategory = {};
    const byLanguage = {};
    const byFile = {};

    for (const finding of findings) {
      const severity = String(finding.severity || "INFO").toUpperCase();
      if (bySeverity[severity] !== undefined) bySeverity[severity]++;
      const category = finding.category || "OTHER";
      byCategory[category] = (byCategory[category] || 0) + 1;
      const language = finding.language || "unknown";
      byLanguage[language] = (byLanguage[language] || 0) + 1;
      const file = finding.location?.filePath || "unknown";
      byFile[file] = (byFile[file] || 0) + 1;
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description || "",
        createdAt: project.createdAt,
      },
      generatedAt: new Date().toISOString(),
      latestAnalysisId: latest?.id || null,
      summary: {
        totalFindings: latest?.totalFindings || 0,
        critical: bySeverity.CRITICAL,
        high: bySeverity.HIGH,
        medium: bySeverity.MEDIUM,
        low: bySeverity.LOW,
        info: bySeverity.INFO,
        byCategory,
        byLanguage,
        byFile,
        qualityScore: latest
          ? Math.max(
              0,
              Math.round(
                100 -
                  ((bySeverity.CRITICAL * 10 +
                    bySeverity.HIGH * 5 +
                    bySeverity.MEDIUM * 3 +
                    bySeverity.LOW) /
                    Math.max(1, findings.length)) *
                    4
              )
            )
          : 100,
      },
      techStack,
      components,
      coverage,
      findings,
      history,
      totals,
      trend,
    };
  }

  async getById(id, userId) {
    const report = await this.db.get('SELECT * FROM reports WHERE id = ?', [id])
    if (!report) return null

    const project = await this.db.get('SELECT * FROM projects WHERE id = ?', [report.projectId])
    if (project && project.userId && project.userId !== userId) return null

    let content = null
    try {
      content = JSON.parse(report.content)
    } catch {
      content = null
    }

    return { ...report, content }
  }

  async delete(id, userId) {
    const report = await this.getById(id, userId)
    if (!report) return false
    await this.db.run('DELETE FROM reports WHERE id = ?', [id])
    return true
  }
}
