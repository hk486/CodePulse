import express from 'express'
import { AnalysisService } from '../services/analysisService.js'
import { ProjectService } from '../services/projectService.js'
import { ReportService } from '../services/reportService.js'
import { DownloadTokenService } from '../services/downloadTokenService.js'

/**
 * Files the browser downloads.
 *
 * A download is a navigation, not a request the page makes, so it cannot
 * carry an authorisation header. The page asks for a link first, with its
 * header, and then follows the link. The link stands for one file and is
 * good for two minutes.
 */
export function downloadRoutes(db, requireAuth) {
  const router = express.Router()
  const analysisService = new AnalysisService(db)
  const projectService = new ProjectService(db)
  const reportService = new ReportService(db)
  const tokens = new DownloadTokenService()

  const ownerId = (req) => (req.user && req.user.userId) || null

  /**
   * Ask for a link to a file.
   */
  router.post('/', requireAuth, async (req, res, next) => {
    try {
      const userId = ownerId(req)
      const kind = String(req.body?.kind || '')
      const id = req.body?.id ? String(req.body.id) : null

      const allowed = ['analysis', 'report', 'account']
      if (!allowed.includes(kind)) {
        return res.status(400).json({ error: 'That file cannot be downloaded.' })
      }

      // Check the thing exists and belongs to the person asking, before a
      // link is handed out.
      if (kind === 'analysis') {
        const analysis = await analysisService.getById(id, userId)
        if (!analysis) {
          return res.status(404).json({ error: 'That analysis was not found.' })
        }
      }
      if (kind === 'report') {
        const report = await reportService.getById(id, userId)
        if (!report) {
          return res.status(404).json({ error: 'That report was not found.' })
        }
      }

      const token = tokens.issue(userId, kind, id)
      res.json({ url: `/api/downloads/${token}`, expiresIn: 120 })
    } catch (error) {
      next(error)
    }
  })

  /**
   * Follow the link and get the file.
   */
  router.get('/:token', async (req, res, next) => {
    try {
      const entry = tokens.take(req.params.token)
      if (!entry) {
        return res.status(410).json({
          error: 'That link has expired. Ask for the file again.',
        })
      }

      const send = (filename, body) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/"/g, '')}"`
        )
        res.setHeader('Content-Length', String(Buffer.byteLength(body)))
        res.send(body)
      }

      if (entry.kind === 'analysis') {
        const analysis = await analysisService.getById(entry.id, entry.userId)
        if (!analysis) {
          return res.status(404).json({ error: 'That analysis was not found.' })
        }
        const project = await projectService.getById(analysis.projectId, entry.userId)
        const payload = {
          analysisId: analysis.id,
          projectId: analysis.projectId,
          projectName: project?.name || null,
          generatedAt: new Date().toISOString(),
          summary: {
            totalFindings: analysis.totalFindings || 0,
            critical: analysis.critical || 0,
            high: analysis.high || 0,
            medium: analysis.medium || 0,
            low: analysis.low || 0,
            info: analysis.info || 0,
          },
          findings: analysis.findings || [],
        }
        const name = (project?.name || 'analysis')
          .replace(/[^a-z0-9]+/gi, '-')
          .toLowerCase()
        return send(
          `codepulse-${name}-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(payload, null, 2)
        )
      }

      if (entry.kind === 'report') {
        const report = await reportService.getById(entry.id, entry.userId)
        if (!report) {
          return res.status(404).json({ error: 'That report was not found.' })
        }
        const project = await projectService.getById(report.projectId, entry.userId)
        const name = (project?.name || 'report')
          .replace(/[^a-z0-9]+/gi, '-')
          .toLowerCase()
        return send(
          `codepulse-${name}-${new Date().toISOString().slice(0, 10)}.json`,
          JSON.stringify(report.content, null, 2)
        )
      }

      // The whole account, the same thing the settings page offers.
      const projects = await projectService.getAll(entry.userId)
      const reports = await reportService.listForUser(entry.userId)
      const analyses = []
      for (const project of projects) {
        const rows = await analysisService.getByProject(project.id, entry.userId)
        analyses.push(...rows)
      }
      const profile = await db.get(
        'SELECT id, username, email, fullName, role, createdAt FROM users WHERE id = ?',
        [entry.userId]
      )
      const payload = {
        exportedAt: new Date().toISOString(),
        profile,
        projects,
        analyses,
        reports,
      }
      const name = (profile?.email || 'account').replace(/[^a-z0-9]+/gi, '-')
      return send(`codepulse-data-${name}.json`, JSON.stringify(payload, null, 2))
    } catch (error) {
      next(error)
    }
  })

  return router
}
