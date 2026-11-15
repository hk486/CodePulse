import express from 'express'
import { ReportService } from '../services/reportService.js'
import { readPage } from '../services/pagination.js'

export function reportRoutes(db, requireAuth) {
  const router = express.Router()
  const reportService = new ReportService(db)

  router.use(requireAuth)

  const ownerId = (req) => (req.user && req.user.userId) || null

  // Totals across every report of the signed in user
  router.get('/summary', async (req, res, next) => {
    try {
      res.json(await reportService.summaryForUser(ownerId(req)))
    } catch (error) {
      next(error)
    }
  })

  // List all reports
  router.get('/', async (req, res, next) => {
    try {
      const page = readPage(req.query)
      res.json(
        await reportService.listForUser(ownerId(req), page, {
          severity: req.query.severity,
          search: req.query.search
        })
      )
    } catch (error) {
      next(error)
    }
  })

  // There is no route for creating a report. A report is a snapshot of an
  // analysis, so it is written by the analysis itself, which checks that
  // the project belongs to the person running it. This route used to
  // insert one directly and let any signed in user file a report against
  // somebody else's project.

  // Get reports for analysis
  // The report of a whole project
  router.get('/project/:projectId', async (req, res, next) => {
    try {
      const report = await reportService.projectReport(
        req.params.projectId,
        ownerId(req)
      )
      if (!report) {
        return res.status(404).json({ error: 'Project not found' })
      }
      res.json(report)
    } catch (error) {
      next(error)
    }
  })

  router.get('/analysis/:analysisId', async (req, res, next) => {
    try {
      const reports = await db.all(
        'SELECT id, analysisId, projectId, format, createdAt FROM reports WHERE analysisId = ? ORDER BY createdAt DESC',
        [req.params.analysisId]
      )
      res.json(reports)
    } catch (error) {
      next(error)
    }
  })

  // Get report by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const report = await reportService.getById(req.params.id, ownerId(req))
      if (!report) {
        return res.status(404).json({ error: 'Report not found' })
      }
      res.json(report)
    } catch (error) {
      next(error)
    }
  })

  // Delete report
  router.delete('/:id', async (req, res, next) => {
    try {
      const deleted = await reportService.delete(req.params.id, ownerId(req))
      if (!deleted) {
        return res.status(404).json({ error: 'Report not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}
