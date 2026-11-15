import express from 'express'
import { AnalysisService } from '../services/analysisService.js'
import fs from 'fs'
import { projectUploadCandidates } from '../services/workspace.js'
import { createRateLimit } from '../middleware/rateLimit.js'

export function analysisRoutes(db, requireAuth, analysisQueue) {
  const router = express.Router()
  const analysisService = new AnalysisService(db)

  const ownerId = (req) => (req.user && req.user.userId) || null

  // A scan is an expensive thing to ask for, so the number of them is
  // limited. Without this, one signed in person can keep the worker busy
  // for ever.
  const runLimit = createRateLimit({
    windowMs: 10 * 60 * 1000,
    max: Number(process.env.ANALYSIS_RUNS_PER_WINDOW || 60),
    message:
      'Too many analyses have been asked for in a short time. Please wait a little and try again.',
    keyFn: req => (req.user && req.user.userId) || req.ip || 'unknown'
  })

  // Every route below reads or changes an analysis, so every route needs
  // a signed in person. Only the run route said so before, which left the
  // rest of this file open to anybody.
  router.use(requireAuth)

  // Run analysis on a project.
  //
  // The scan is a job: the row is written straight away and a worker picks
  // it up. The request answers as soon as the job is on the queue, so a
  // project of any size no longer holds a connection open for minutes, a
  // refresh does not lose the run, and a second click cannot start a
  // second scan.
  router.post('/run/:projectId', runLimit, async (req, res, next) => {
    try {
      const project = ownerId(req)
        ? await analysisService.db.get(
            'SELECT * FROM projects WHERE id = ? AND status = "active" AND (userId = ? OR userId IS NULL)',
            [req.params.projectId, ownerId(req)]
          )
        : await analysisService.db.get(
            'SELECT * FROM projects WHERE id = ? AND status = "active"',
            [req.params.projectId]
          )
      if (!project) {
        return res.status(404).json({ error: 'Project not found' })
      }

      // A scan that is already going for this project would be a second
      // copy of the same work.
      const running = await analysisService.db.get(
        `SELECT id FROM analyses
          WHERE projectId = ? AND status IN ('queued', 'running')
          ORDER BY createdAt DESC LIMIT 1`,
        [req.params.projectId]
      )
      if (running) {
        return res.status(202).json({
          id: running.id,
          projectId: req.params.projectId,
          status: 'running',
          progress: 0,
          stage: 'queued',
          message: 'This project is already being analysed.',
          alreadyRunning: true,
          findingsCount: 0
        })
      }

      // The quick checks that can be answered straight away. The slow work
      // happens in the worker.
      const userId = (req.user && req.user.userId) || 'anonymous'
      const candidates = projectUploadCandidates(userId, req.params.projectId)
      const uploaded = await analysisService.db.get(
        'SELECT COUNT(*) as count FROM files WHERE projectId = ?',
        [req.params.projectId]
      )
      const hasWorkspace = candidates.some(dir => {
        if (!fs.existsSync(dir)) return false
        try {
          return fs.readdirSync(dir).length > 0
        } catch {
          return false
        }
      })
      const hasLocalPath = !!(project.path && fs.existsSync(project.path))
      const hasRepository = !!(project.path && /^https?:\/\//i.test(project.path))

      if (!((uploaded && uploaded.count > 0 && hasWorkspace) || hasLocalPath || hasRepository)) {
        return res.status(400).json({
          error:
            'Nothing to analyse yet. Upload your project folder, or give a repository URL to clone.'
        })
      }

      // The gate. A caller can hold a build to what is already there, so
      // a project with findings does not have to reach zero before it can
      // start failing on new ones.
      const failOn = String(req.body?.failOn || '').trim()
      const compareWith = String(req.body?.baseline || '').trim()

      const job = await analysisQueue.enqueue(req.params.projectId, ownerId(req), {
        failOn: failOn || null,
        baseline: compareWith || null
      })

      res.status(202).json({
        id: job.id,
        projectId: req.params.projectId,
        status: job.status,
        progress: 0,
        stage: 'queued',
        message: 'The analysis is queued.',
        findingsCount: 0,
        queuedAt: job.createdAt
      })
    } catch (error) {
      next(error)
    }
  })

  // Stop a scan that is queued or running.
  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const analysis = await analysisService.getById(req.params.id, ownerId(req))
      if (!analysis) {
        return res.status(404).json({ error: 'Analysis not found' })
      }
      if (analysis.status !== 'queued' && analysis.status !== 'running') {
        return res.status(409).json({
          error: 'That analysis has already finished.',
          status: analysis.status
        })
      }
      const cancelled = await analysisService.requestCancel(req.params.id)
      res.json({ success: cancelled, id: req.params.id, status: 'cancelling' })
    } catch (error) {
      next(error)
    }
  })

  // Get analyses for project
  router.get('/project/:projectId', async (req, res, next) => {
    try {
      const analyses = await analysisService.getByProject(
        req.params.projectId,
        ownerId(req)
      )
      res.json(analyses)
    } catch (error) {
      next(error)
    }
  })

  // Get analysis by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const analysis = await analysisService.getById(req.params.id, ownerId(req))
      if (!analysis) {
        return res.status(404).json({ error: 'Analysis not found' })
      }

      // The report that was frozen from this run, if there is one.
      const report = await analysisService.db.get(
        'SELECT id FROM reports WHERE analysisId = ? ORDER BY createdAt DESC LIMIT 1',
        [req.params.id]
      )

      res.json({
        ...analysis,
        findingsCount: analysis.totalFindings ?? (analysis.findings || []).length,
        reportId: report?.id || null,
        message: analysis.error || undefined
      })
    } catch (error) {
      next(error)
    }
  })

  // Get latest analysis for project
  router.get('/project/:projectId/latest', async (req, res, next) => {
    try {
      const analysis = await analysisService.getLatestByProject(
        req.params.projectId,
        ownerId(req)
      )
      if (!analysis) {
        return res.status(404).json({ error: 'No analysis found' })
      }
      res.json(analysis)
    } catch (error) {
      next(error)
    }
  })

  // Delete analysis
  router.delete('/:id', async (req, res, next) => {
    try {
      const deleted = await analysisService.delete(req.params.id, ownerId(req))
      if (!deleted) {
        return res.status(404).json({ error: 'Analysis not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}
