import express from 'express'
import { ProjectService } from '../services/projectService.js'

export function projectRoutes(db, requireAuth, auditLog) {
  const router = express.Router()
  const projectService = new ProjectService(db)
  const record = auditLog
    ? (userId, action, detail, request) =>
        auditLog.record(userId, action, detail, request)
    : async () => {}

  // Every project route needs a signed in user, so a project list can be
  // scoped to its owner.
  router.use(requireAuth)

  const ownerId = (req) => (req.user && req.user.userId) || null

  // Get all projects
  router.get('/', async (req, res, next) => {
    try {
      const projects = await projectService.getAll(ownerId(req))
      res.json(projects)
    } catch (error) {
      next(error)
    }
  })

  // Create project
  router.post('/', async (req, res, next) => {
    try {
      const project = await projectService.create(req.body, ownerId(req))
      await record(project.userId, 'project_created', { name: project.name }, req)
      res.status(201).json(project)
    } catch (error) {
      next(error)
    }
  })

  // Get project by ID
  router.get('/:id', async (req, res, next) => {
    try {
      const project = await projectService.getById(req.params.id, ownerId(req))
      if (!project) {
        return res.status(404).json({ error: 'Project not found' })
      }
      res.json(project)
    } catch (error) {
      next(error)
    }
  })

  // Update project
  router.put('/:id', async (req, res, next) => {
    try {
      const project = await projectService.update(req.params.id, req.body, ownerId(req))
      if (!project) {
        return res.status(404).json({ error: 'Project not found' })
      }
      res.json(project)
    } catch (error) {
      next(error)
    }
  })

  // Delete project
  router.delete('/:id', async (req, res, next) => {
    try {
      const deleted = await projectService.delete(req.params.id, ownerId(req))
      if (!deleted) {
        return res.status(404).json({ error: 'Project not found' })
      }
      await record(ownerId(req), 'project_deleted', { id: req.params.id }, req)
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // The figures for one project
  router.get('/:id/stats', async (req, res, next) => {
    try {
      const stats = await projectService.stats(req.params.id, ownerId(req))
      if (!stats) {
        return res.status(404).json({ error: 'Project not found' })
      }
      res.json(stats)
    } catch (error) {
      next(error)
    }
  })

  return router
}
