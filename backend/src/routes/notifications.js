import express from 'express'
import { NotificationService } from '../services/notificationService.js'

export function notificationRoutes(db, requireAuth) {
  const router = express.Router()
  const notificationService = new NotificationService(db)

  router.use(requireAuth)

  const userId = (req) => (req.user && req.user.userId) || null

  // The notification preferences of the signed in user
  router.get('/preferences', async (req, res, next) => {
    try {
      res.json(await notificationService.getPreferences(userId(req)))
    } catch (error) {
      next(error)
    }
  })

  router.put('/preferences', async (req, res, next) => {
    try {
      const { analysisComplete, criticalIssues, weeklySummary, realTimeUpdates } = req.body || {}
      const saved = await notificationService.savePreferences(userId(req), {
        analysisComplete: analysisComplete !== false,
        criticalIssues: criticalIssues !== false,
        weeklySummary: weeklySummary !== false,
        realTimeUpdates: realTimeUpdates !== false
      })
      res.json(saved)
    } catch (error) {
      next(error)
    }
  })

  // All notifications of the signed in user, with the preferences, so the
  // bell can decide whether to keep itself up to date in one request.
  router.get('/', async (req, res, next) => {
    try {
      const id = userId(req)
      const [list, preferences] = await Promise.all([
        notificationService.listForUser(id),
        notificationService.getPreferences(id)
      ])
      res.json({ ...list, preferences })
    } catch (error) {
      next(error)
    }
  })

  // Mark every notification as read
  router.post('/read-all', async (req, res, next) => {
    try {
      await notificationService.markAllRead(userId(req))
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // Remove every notification
  router.delete('/', async (req, res, next) => {
    try {
      await notificationService.clearAll(userId(req))
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // One notification
  router.get('/:id', async (req, res, next) => {
    try {
      const { notifications } = await notificationService.listForUser(userId(req), 200)
      const notification = notifications.find(item => item.id === req.params.id)
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' })
      }
      res.json(notification)
    } catch (error) {
      next(error)
    }
  })

  // Mark one notification as read
  router.post('/:id/read', async (req, res, next) => {
    try {
      const ok = await notificationService.markRead(userId(req), req.params.id)
      if (!ok) {
        return res.status(404).json({ error: 'Notification not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // Dismiss one notification
  router.delete('/:id', async (req, res, next) => {
    try {
      const ok = await notificationService.dismiss(userId(req), req.params.id)
      if (!ok) {
        return res.status(404).json({ error: 'Notification not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}
