import { Router } from 'express'
import { ScheduleService, SCHEDULE_UNITS } from '../services/scheduleService.js'

/**
 * The scheduled analyses of the signed in person.
 */
export function scheduleRoutes(db, requireAuth) {
  const router = Router()
  const service = new ScheduleService(db)

  router.use(requireAuth)

  router.get('/units', (req, res) => {
    res.json({ units: Object.keys(SCHEDULE_UNITS) })
  })

  router.get('/', async (req, res, next) => {
    try {
      res.json(await service.listForUser(req.user.userId))
    } catch (error) {
      next(error)
    }
  })

  router.post('/', async (req, res, next) => {
    try {
      const created = await service.create(req.user.userId, req.body || {})
      res.status(201).json(created)
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message })
      }
      next(error)
    }
  })

  router.patch('/:id', async (req, res, next) => {
    try {
      const enabled = req.body?.enabled ? 1 : 0
      const changed = await service.setEnabled(req.params.id, req.user.userId, enabled)
      if (!changed) {
        return res.status(404).json({ error: 'Schedule not found' })
      }
      res.json({ success: true, enabled: !!enabled })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', async (req, res, next) => {
    try {
      const removed = await service.remove(req.params.id, req.user.userId)
      if (!removed) {
        return res.status(404).json({ error: 'Schedule not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}
