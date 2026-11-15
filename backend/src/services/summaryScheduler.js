import { NotificationService } from './notificationService.js'
import { EmailService } from './emailService.js'

/**
 * The weekly summary.
 *
 * It is built once a week per user who asked for it, and only if they
 * have not had one in the last seven days. The scheduler wakes up every
 * hour, which is often enough that a summary lands on the day it is due
 * without the server having to be up at a particular minute.
 */

const TICK_MS = 60 * 60 * 1000
const SUMMARY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

export class SummaryScheduler {
  constructor(db, options = {}) {
    this.db = db
    this.notifications = new NotificationService(db)
    this.email = new EmailService()
    this.intervalMs = options.intervalMs ?? TICK_MS
    this.timer = null
    this.running = false
  }

  start() {
    if (this.timer) return
    // Give the server a moment to finish booting before the first tick.
    setTimeout(() => {
      void this.tick()
      this.timer = setInterval(() => void this.tick(), this.intervalMs)
      if (this.timer.unref) this.timer.unref()
    }, 5000)
    console.log('[scheduler] the weekly summary is scheduled')
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * One pass. Safe to call at any time: it does nothing for a user who
   * has turned the summary off, or who has already had one this week.
   */
  async tick() {
    if (this.running) return { skipped: 'already running' }
    this.running = true
    const created = []
    try {
      const users = await this.db.all(
        `SELECT u.id as id, u.email as email, u.fullName as fullName
           FROM users u
           JOIN notification_preferences p ON p.userId = u.id
          WHERE p.weeklySummary = 1`
      )

      for (const user of users) {
        const last = await this.notifications.lastWeeklySummaryAt(user.id)
        if (last && Date.now() - new Date(last).getTime() < SUMMARY_INTERVAL_MS) {
          continue
        }

        const figures = await this.notifications.weeklyFigures(user.id)
        // Nothing happened this week, so there is nothing to say.
        if (figures.analyses === 0) continue

        const period = `The last ${figures.days} days`
        const notification = await this.notifications.create(user.id, {
          type: 'weekly_summary',
          title: 'Your CodePulse week',
          message: `${figures.findings} finding${figures.findings === 1 ? '' : 's'} across ${figures.analyses} analys${figures.analyses === 1 ? 'is' : 'es'}, ${figures.critical} critical.`,
          link: '/',
          severity: figures.critical > 0 ? 'critical' : 'medium',
          preference: 'weeklySummary',
        })
        if (!notification) continue
        created.push(notification)

        // The email is a bonus: the in-app notification is the record.
        const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
        await this.email.sendWeeklySummary(user.email, {
          period,
          findings: figures.findings,
          critical: figures.critical,
          analyses: figures.analyses,
          projects: figures.projects,
          dashboardUrl: base,
        })
      }
    } catch (error) {
      console.error('[scheduler] the weekly summary failed:', error.message)
    } finally {
      this.running = false
    }
    if (created.length) {
      console.log(`[scheduler] ${created.length} weekly summar${created.length === 1 ? 'y' : 'ies'} created`)
    }
    return { created: created.length }
  }
}
