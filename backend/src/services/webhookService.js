import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import dns from 'dns/promises'
import net from 'net'

/**
 * Webhooks.
 *
 * A build does not want to poll. When a scan finishes, CodePulse tells
 * the address the person gave, and says what happened.
 *
 * Every delivery is signed, so the other side can tell that it really came
 * from CodePulse and not from somebody guessing the address.
 */

const EVENTS = ['analysis.completed', 'analysis.failed', 'gate.failed']

/**
 * The addresses a webhook may not go to.
 *
 * A signed in person must not be able to make the server ask an address
 * inside the network it runs in. Set ALLOW_PRIVATE_WEBHOOKS=1 when the
 * person running the server means it.
 */
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
]

export class WebhookService {
  constructor(db) {
    this.db = db
  }

  /**
   * Is this an address a webhook may go to?
   *
   * The name is looked up as well as read, because a name that points
   * inside the network is the same thing as an address inside it.
   */
  async isAllowedUrl(rawUrl) {
    let url
    try {
      url = new URL(String(rawUrl))
    } catch {
      return { allowed: false, reason: 'That is not a valid address.' }
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { allowed: false, reason: 'A webhook has to be an http or https address.' }
    }

    if (process.env.ALLOW_PRIVATE_WEBHOOKS === '1') {
      return { allowed: true }
    }

    const host = url.hostname
    if (BLOCKED_HOSTS.some(pattern => pattern.test(host))) {
      return {
        allowed: false,
        reason:
          'That address is inside the network the server runs in, so it is not allowed. ' +
          'Set ALLOW_PRIVATE_WEBHOOKS=1 if you mean it.'
      }
    }

    // The name may point somewhere inside the network even when the name
    // itself does not say so.
    let addresses = []
    try {
      addresses = await dns.lookup(host, { all: true })
    } catch {
      // A name that does not resolve will fail at the delivery anyway.
      return { allowed: true }
    }

    for (const entry of addresses) {
      if (WebhookService.isPrivateAddress(entry.address)) {
        return {
          allowed: false,
          reason:
            'That address points inside the network the server runs in, so it is not allowed. ' +
            'Set ALLOW_PRIVATE_WEBHOOKS=1 if you mean it.'
        }
      }
    }

    return { allowed: true }
  }

  /**
   * Is this address one of the private ones?
   */
  static isPrivateAddress(address) {
    if (!address) return false
    if (net.isIPv4(address)) {
      const parts = address.split('.').map(Number)
      const [a, b] = parts
      if (a === 10) return true
      if (a === 127) return true
      if (a === 0) return true
      if (a === 192 && b === 168) return true
      if (a === 169 && b === 254) return true
      if (a === 172 && b >= 16 && b <= 31) return true
      if (a === 100 && b >= 64 && b <= 127) return true // carrier grade NAT
      return false
    }
    if (net.isIPv6(address)) {
      const lower = address.toLowerCase()
      if (lower === '::1') return true
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local
      if (lower.startsWith('fe80')) return true // link local
      if (lower.startsWith('::ffff:')) {
        return WebhookService.isPrivateAddress(lower.slice(7))
      }
      return false
    }
    return false
  }

  /**
   * Make a webhook.
   */
  async create(userId, body = {}) {
    const url = String(body.url || '').trim()
    const check = await this.isAllowedUrl(url)
    if (!check.allowed) {
      const error = new Error(check.reason)
      error.status = 400
      throw error
    }

    const events = Array.isArray(body.events) && body.events.length
      ? body.events.filter(event => EVENTS.includes(event))
      : ['analysis.completed']

    if (!events.length) {
      const error = new Error(`Choose at least one of: ${EVENTS.join(', ')}.`)
      error.status = 400
      throw error
    }

    const id = uuidv4()
    const now = new Date().toISOString()
    const secret = body.secret || `whsec_${crypto.randomBytes(24).toString('hex')}`

    await this.db.run(
      `INSERT INTO webhooks
        (id, userId, projectId, url, secret, events, active, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        id,
        userId,
        body.projectId || null,
        url,
        secret,
        JSON.stringify(events),
        now
      ]
    )

    return {
      id,
      url,
      events,
      secret,
      active: true,
      createdAt: now
    }
  }

  /**
   * The webhooks of a person. The secret is only given when one is made.
   */
  async listForUser(userId) {
    const rows = await this.db.all(
      'SELECT * FROM webhooks WHERE userId = ? ORDER BY createdAt DESC',
      [userId]
    )
    return rows.map(row => ({
      id: row.id,
      projectId: row.projectId,
      url: row.url,
      events: this.parse(row.events, []),
      active: !!row.active,
      createdAt: row.createdAt,
      lastDeliveryAt: row.lastDeliveryAt,
      lastStatus: row.lastStatus,
      lastError: row.lastError
    }))
  }

  async get(id, userId) {
    const row = await this.db.get(
      'SELECT * FROM webhooks WHERE id = ? AND userId = ?',
      [id, userId]
    )
    return row || null
  }

  async remove(id, userId) {
    const result = await this.db.runChanges(
      'DELETE FROM webhooks WHERE id = ? AND userId = ?',
      [id, userId]
    )
    return !!(result && result.changes > 0)
  }

  async setActive(id, userId, active) {
    const result = await this.db.runChanges(
      'UPDATE webhooks SET active = ? WHERE id = ? AND userId = ?',
      [active ? 1 : 0, id, userId]
    )
    return !!(result && result.changes > 0)
  }

  /**
   * The webhooks that want to hear about something.
   */
  async findForEvent(userId, projectId, event) {
    const rows = await this.db.all(
      'SELECT * FROM webhooks WHERE userId = ? AND active = 1',
      [userId]
    )
    return rows.filter(row => {
      if (row.projectId && row.projectId !== projectId) return false
      return this.parse(row.events, []).includes(event)
    })
  }

  /**
   * The signature of a delivery. The other side works it out with the same
   * secret and compares.
   */
  static sign(secret, body, timestamp = Date.now()) {
    const payload = `${timestamp}.${body}`
    return crypto.createHmac('sha256', secret).update(payload).digest('hex')
  }

  /**
   * Send one delivery.
   *
   * A webhook that fails is recorded and left alone. A build server that is
   * down for a moment must not take the analysis with it.
   */
  async deliver(webhook, event, payload) {
    const body = JSON.stringify({ event, ...payload })
    const timestamp = Date.now()
    const signature = WebhookService.sign(webhook.secret, body, timestamp)

    let status = 0
    let error = null

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'CodePulse-Webhook/1.0',
          'X-CodePulse-Event': event,
          'X-CodePulse-Timestamp': String(timestamp),
          'X-CodePulse-Signature': `sha256=${signature}`
        },
        body,
        signal: controller.signal
      })
      clearTimeout(timeout)
      status = response.status
      if (!response.ok) {
        error = `The address answered with ${status}.`
      }
    } catch (e) {
      error = e?.name === 'AbortError' ? 'The address did not answer in time.' : String(e?.message || e)
    }

    await this.db.run(
      'UPDATE webhooks SET lastDeliveryAt = ?, lastStatus = ?, lastError = ? WHERE id = ?',
      [new Date().toISOString(), status || null, error, webhook.id]
    )

    return { delivered: !error, status, error }
  }

  parse(value, fallback) {
    if (value === null || value === undefined) return fallback
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value
      return Array.isArray(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  }
}

export { EVENTS as WEBHOOK_EVENTS }
