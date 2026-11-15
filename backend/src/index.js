import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import chalk from 'chalk'
import { Database } from './services/database.js'
import { projectRoutes } from './routes/projects.js'
import { analysisRoutes } from './routes/analysis.js'
import { reportRoutes } from './routes/reports.js'
import { pdfRoutes } from './routes/pdf.js'
import { notificationRoutes } from './routes/notifications.js'
import { authRoutes } from './routes/auth.js'
import { downloadRoutes } from './routes/downloads.js'
import { webhookRoutes } from './routes/webhooks.js'
import { scheduleRoutes } from './routes/schedules.js'
import { SummaryScheduler } from './services/summaryScheduler.js'
import { fileRoutes } from './routes/files.js'
import { AuthService } from './services/authService.js'
import { ApiKeyService } from './services/apiKeyService.js'
import { AuditLog } from './services/auditLog.js'
import { AnalysisQueue } from './services/analysisQueue.js'
import { wsManager } from './services/wsManager.js'
import { createRequireAuthMiddleware } from './middleware/auth.js'
import { errorHandler } from './middleware/errorHandler.js'

const app = express()
const PORT = process.env.PORT || 5000

// Initialize database
const db = new Database()
await db.initialize()

// Authentication service + middleware
const authService = new AuthService(db)
const apiKeyService = new ApiKeyService(db)
const auditLog = new AuditLog(db)
const requireAuth = createRequireAuthMiddleware(authService, apiKeyService)

// Middleware
app.use(helmet())
app.use(compression())
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Lightweight request log so every API call is visible in the container logs.
app.use((req, res, next) => {
  const startedAt = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - startedAt
    const user = req.user && req.user.email ? ` user=${req.user.email}` : ''
    console.log(
      `[http] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)${user} ` +
      `ua="${(req.headers['user-agent'] || 'unknown').slice(0, 60)}"`
    )
  })
  next()
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// The worker. Scans are jobs: the request that asks for one answers at
// once, and the worker does the work.
const analysisQueue = new AnalysisQueue(db, { wsManager })

// API Routes
app.use('/api/auth', authRoutes(db, requireAuth, auditLog).router)
app.use('/api/projects', projectRoutes(db, requireAuth, auditLog))
app.use('/api/projects', fileRoutes(db, requireAuth))
app.use('/api/analysis', analysisRoutes(db, requireAuth, analysisQueue))
app.use('/api/reports', reportRoutes(db, requireAuth))
app.use('/api/pdf', pdfRoutes(db, requireAuth))
app.use('/api/notifications', notificationRoutes(db, requireAuth))
app.use('/api/downloads', downloadRoutes(db, requireAuth))
app.use('/api/webhooks', webhookRoutes(db, requireAuth))
app.use('/api/schedules', scheduleRoutes(db, requireAuth))

// Error handling
app.use(errorHandler)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' })
})

// The weekly summary runs on a timer, so it needs the server to be up.
const summaryScheduler = new SummaryScheduler(db)
summaryScheduler.start()

// Start server
const server = app.listen(PORT, () => {
  console.log(chalk.green(`✓ CodePulse Backend Server running on port ${PORT}`))
  console.log(chalk.blue(`  API: http://localhost:${PORT}/api`))
  console.log(chalk.blue(`  Health: http://localhost:${PORT}/api/health`))
  console.log(chalk.gray(`  Frontend: http://localhost:3000`))
})

// The live channel. A browser cannot put an Authorization header on a
// websocket, so the token travels in the query string and is checked the
// same way as everywhere else.
wsManager.setupWebSocket(server, { authService, apiKeyService })
console.log(chalk.gray(`  Live: ws://localhost:${PORT}/ws`))

await analysisQueue.start()

// Stop cleanly, so a scan that is running is not left half done.
const shutdown = async signal => {
  console.log(chalk.gray(`\n${signal} received, shutting down`))
  try {
    await analysisQueue.stop()
  } catch {
    // Nothing to do.
  }
  wsManager.close()
  server.close(() => process.exit(0))
  // Do not wait for ever.
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
