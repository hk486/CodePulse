import { Router } from 'express'
import { AuthService, hashPassword } from '../services/authService.js'
import { PasswordResetService } from '../services/passwordResetService.js'
import { EmailService } from '../services/emailService.js'
import { ApiKeyService } from '../services/apiKeyService.js'
import { createRateLimit } from '../middleware/rateLimit.js'
import fs from 'fs'

export function authRoutes(db, requireAuth, auditLog) {
  const router = Router()
  const authService = new AuthService(db)
  const resetService = new PasswordResetService(db)
  const emailService = new EmailService()
  const apiKeyService = new ApiKeyService(db)
  const record = auditLog
    ? (userId, action, detail, request) =>
        auditLog.record(userId, action, detail, request)
    : async () => {}

  // Signing in is the door into an account, so it is limited. The limit
  // is per address, and it only counts the failures: a person signing in
  // on their own machine is never turned away.
  const loginLimit = createRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    keyFn: req => `login:${req.ip || 'unknown'}`,
    message: 'Too many sign in attempts. Please wait a few minutes and try again.',
  })

  const registerLimit = createRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyFn: req => `register:${req.ip || 'unknown'}`,
    message: 'Too many accounts made from this address. Please try again later.',
  })

  const resetLimit = createRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyFn: req => `reset:${req.ip || 'unknown'}`,
    message: 'Too many password resets asked for. Please try again later.',
  })

  // Register a new account
  router.post('/register', registerLimit, async (req, res, next) => {
    try {
      const { username, email, password, fullName } = req.body
      const data = await authService.register({ username, email, password, fullName })
      // Making an account worked, so the count of attempts starts again.
      registerLimit.clear(req)
      await record(data.userId, 'registered', { email: data.email }, req)
      res.status(201).json(data)
    } catch (error) {
      if (error.message.includes('already registered')) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' })
      }
      if (error.message.includes('required') || error.message.includes('characters')) {
        return res.status(400).json({ error: error.message })
      }
      next(error)
    }
  })

  // Log in with username or email
  router.post('/login', loginLimit, async (req, res, next) => {
    // Read the details out here: the catch below needs them too.
    const { username, email, password } = req.body || {}
    try {
      const data = await authService.login({ username, email, password })
      // Signing in worked, so the count of failures starts again.
      loginLimit.clear(req)
      await record(data.userId, 'signed_in', { email: data.email }, req)
      res.json(data)
    } catch (error) {
      if (error.message.includes('No account found')) {
        await record(null, 'sign_in_failed', { email: email || username }, req)
        return res.status(401).json({ error: 'No account found with this email. Please create an account first.' })
      }
      if (error.message.includes('Incorrect password')) {
        // Somebody tried to get into this account and got the password
        // wrong. The account should be able to see that, so it is put
        // against the account rather than left unattributed.
        const identifier = email || username
        const account = identifier
          ? await db.get(
              'SELECT id FROM users WHERE email = ? OR username = ?',
              [identifier, identifier]
            )
          : null
        await record(account?.id || null, 'sign_in_failed', { email: identifier }, req)
        return res.status(401).json({ error: 'Incorrect password. Please try again.' })
      }
      next(error)
    }
  })

  // Ask for a password reset link.
  //
  // The answer is the same whether or not the account exists, so this
  // cannot be used to find out who has an account.
  router.post('/forgot-password', resetLimit, async (req, res, next) => {
    try {
      const email = String(req.body?.email || '').trim().toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Enter a valid email address.' })
      }

      const request = await resetService.request(email)

      const response = {
        sent: true,
        message:
          'If an account exists for that address, a reset link is on its way.',
      }

      if (request) {
        await record(request.user.id, 'password_reset_requested', { email }, req)
        const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
        const resetUrl = `${base}/reset-password?token=${encodeURIComponent(request.token)}`
        await emailService.sendPasswordReset(request.user.email, resetUrl, request.user.fullName)

        // With no mail server there is no inbox to check, so the link is
        // handed back for the flow to be completed. Never in production.
        if (!emailService.transportAvailable && process.env.NODE_ENV !== 'production') {
          response.resetUrl = resetUrl
        }
      }

      res.json(response)
    } catch (error) {
      next(error)
    }
  })

  // Set a new password with a reset token.
  router.post('/reset-password', resetLimit, async (req, res, next) => {
    try {
      const { token, password } = req.body
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' })
      }

      const found = await resetService.findValid(token)
      if (!found.ok) {
        return res.status(400).json({ error: found.error })
      }

      const user = await db.get('SELECT id FROM users WHERE id = ?', [found.row.userId])
      if (!user) {
        return res.status(400).json({ error: 'That reset link is not valid.' })
      }

      await db.run('UPDATE users SET password = ? WHERE id = ?', [
        hashPassword(password),
        user.id,
      ])
      await resetService.consume(found.row.id)
      await record(user.id, 'password_reset_completed', {}, req)

      // A password reset ends every session that account had, so a
      // stolen token cannot be used alongside the person who asked for
      // the reset.
      const sessions = await db.all('SELECT token FROM sessions WHERE userId = ?', [user.id])
      for (const session of sessions) {
        await db.run('DELETE FROM sessions WHERE token = ?', [session.token])
      }

      res.json({
        reset: true,
        message: 'Your password has been changed. Sign in with the new one.',
        sessionsEnded: sessions.length,
      })
    } catch (error) {
      next(error)
    }
  })

  // Make an API key.
  //
  // The key is shown once. Only its hash is kept, so a copy of the
  // database cannot be turned into a list of working keys.
  router.post('/api-keys', requireAuth, async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      if (!userId) {
        return res.status(401).json({ error: 'You need to be signed in to do that.' })
      }
      const created = await apiKeyService.create(userId, req.body?.name)
      await record(userId, 'api_key_created', { name: created.name }, req)
      res.status(201).json({
        ...created,
        message:
          'Copy the key now. It is shown once and cannot be read again.',
      })
    } catch (error) {
      next(error)
    }
  })

  // The keys of the signed in user, without the secrets.
  router.get('/api-keys', requireAuth, async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      if (!userId) {
        return res.status(401).json({ error: 'You need to be signed in to do that.' })
      }
      res.json({ apiKeys: await apiKeyService.listForUser(userId) })
    } catch (error) {
      next(error)
    }
  })

  // Take a key away. It stops working at once.
  router.delete('/api-keys/:id', requireAuth, async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      if (!userId) {
        return res.status(401).json({ error: 'You need to be signed in to do that.' })
      }
      const revoked = await apiKeyService.revoke(userId, req.params.id)
      if (!revoked) {
        return res.status(404).json({ error: 'That key was not found.' })
      }
      await record(userId, 'api_key_revoked', { id: req.params.id }, req)
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // Get current user profile
  router.get('/profile', requireAuth, async (req, res, next) => {
    try {
      const user = await authService.getProfile(req.user.userId)
      if (!user) {
        return res.status(404).json({ error: 'User not found' })
      }
      res.json(user)
    } catch (error) {
      next(error)
    }
  })

  // Update current user profile
  router.patch('/profile', requireAuth, async (req, res, next) => {
    try {
      const { fullName, email, photoUrl } = req.body
      const data = await authService.updateProfile(req.user.userId, { fullName, email, photoUrl })
      if (!data) {
        return res.status(404).json({ error: 'User not found' })
      }
      res.json(data)
    } catch (error) {
      if (error.message.includes('already registered')) {
        return res.status(409).json({ error: error.message })
      }
      next(error)
    }
  })

  // The entries of the signed in user
  router.get('/audit-log', requireAuth, async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      if (!userId) {
        return res.status(401).json({ error: 'You need to be signed in to do that.' })
      }
      res.json({ entries: await auditLog.listForUser(userId) })
    } catch (error) {
      next(error)
    }
  })

  // Sign out. The session is ended on the server too, so a token that
  // was signed out cannot be used again.
  router.post('/logout', requireAuth, async (req, res, next) => {
    try {
      const header = req.headers.authorization || ''
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
      await authService.logout(token)
      res.json({ success: true })
    } catch (error) {
      next(error)
    }
  })

  // Delete the signed in account and everything it owns
  router.delete('/account', requireAuth, async (req, res, next) => {
    try {
      const userId = req.user.userId
      const projects = await db.all('SELECT id FROM projects WHERE userId = ?', [userId])

      for (const project of projects) {
        const files = await db.all('SELECT storedPath FROM files WHERE projectId = ?', [project.id])
        for (const file of files) {
          try {
            if (file.storedPath && fs.existsSync(file.storedPath)) fs.unlinkSync(file.storedPath)
          } catch {
            // the file may already be gone
          }
        }
        await db.run('DELETE FROM files WHERE projectId = ?', [project.id])
        await db.run('DELETE FROM reports WHERE projectId = ?', [project.id])
        await db.run('DELETE FROM analyses WHERE projectId = ?', [project.id])
        await db.run('DELETE FROM projects WHERE id = ?', [project.id])
      }

      await db.run('DELETE FROM sessions WHERE userId = ?', [userId])
      await db.run('DELETE FROM users WHERE id = ?', [userId])

      res.json({ success: true, message: 'Your account and all of its data were deleted.' })
    } catch (error) {
      next(error)
    }
  })

  return { router, authService }
}
