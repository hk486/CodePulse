import { Router } from 'express'
import { WebhookService, WEBHOOK_EVENTS } from '../services/webhookService.js'

/**
 * The webhooks of the signed in person.
 *
 * A webhook is an address that is told when something happens, so a build
 * does not have to ask. The body that arrives is signed with a secret that
 * only the two sides know.
 */
export function webhookRoutes(db, requireAuth) {
  const router = Router()
  const service = new WebhookService(db)

  router.use(requireAuth)

  /**
   * The events a webhook can listen for.
   */
  router.get('/events', (req, res) => {
    res.json({ events: WEBHOOK_EVENTS })
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

  router.delete('/:id', async (req, res, next) => {
    try {
      const removed = await service.remove(req.params.id, req.user.userId)
      if (!removed) {
        return res.status(404).json({ error: 'Webhook not found' })
      }
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  /**
   * Turn a webhook off and on again without losing it.
   */
  router.patch('/:id', async (req, res, next) => {
    try {
      const active = req.body?.active ? 1 : 0
      const changed = await service.setActive(req.params.id, req.user.userId, active)
      if (!changed) {
        return res.status(404).json({ error: 'Webhook not found' })
      }
      res.json({ success: true, active: !!active })
    } catch (error) {
      next(error)
    }
  })

  /**
   * Send a test delivery, so a person can see the body their build will
   * receive before they rely on it.
   */
  router.post('/:id/test', async (req, res, next) => {
    try {
      const webhook = await service.get(req.params.id, req.user.userId)
      if (!webhook) {
        return res.status(404).json({ error: 'Webhook not found' })
      }

      const result = await service.deliver(webhook, 'test', {
        message: 'This is a test delivery from CodePulse.',
        deliveredAt: new Date().toISOString()
      })

      res.json({
        success: result.delivered,
        status: result.status,
        error: result.error || null
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}
