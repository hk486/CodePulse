import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Outgoing email.
 *
 * When SMTP is configured the message goes out over the wire. When it is
 * not, the message is written to an outbox folder and logged, so a
 * self-hosted instance without a mail server can still show what would
 * have been sent, and the password reset flow stays usable.
 *
 * The mailer is loaded lazily, so an installation without the optional
 * dependency still boots.
 */
export class EmailService {
  constructor(options = {}) {
    this.outboxDir =
      options.outboxDir ||
      process.env.EMAIL_OUTBOX_DIR ||
      // /app/src/services -> /app/data/outbox, which is the mounted
      // data folder.
      path.resolve(__dirname, '../../data/outbox')
    this.from = process.env.EMAIL_FROM || 'noreply@codepulse.com'
    this.smtp = this.readSmtpConfig()
  }

  /**
   * The SMTP settings, or null when no mail server is configured.
   */
  readSmtpConfig() {
    const host = process.env.EMAIL_HOST
    if (!host) return null
    return {
      host,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: process.env.EMAIL_USER
        ? { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
        : undefined,
    }
  }

  /** True when a mail server is configured and messages go over the wire. */
  get transportAvailable() {
    return Boolean(this.smtp)
  }

  /**
   * Send a message. Never throws: a mail server that is down must not
   * take a request down with it.
   */
  async send(to, subject, html, text) {
    const message = {
      from: this.from,
      to,
      subject,
      html,
      text: text || null,
      sentAt: new Date().toISOString(),
    }

    if (this.smtp) {
      try {
        const nodemailer = (await import('nodemailer')).default
        const transporter = nodemailer.createTransport(this.smtp)
        await transporter.sendMail({
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text || undefined,
        })
        return { delivered: true, transport: 'smtp' }
      } catch (error) {
        // The message is kept in the outbox so it is never lost.
        this.writeToOutbox(message, error.message)
        return { delivered: false, transport: 'outbox', error: error.message }
      }
    }

    this.writeToOutbox(message)
    return { delivered: false, transport: 'outbox' }
  }

  /**
   * Keep the message on disk. This is what a self-hosted instance reads
   * when it has no mail server.
   */
  writeToOutbox(message, error) {
    try {
      fs.mkdirSync(this.outboxDir, { recursive: true })
      const stamp = message.sentAt.replace(/[:.]/g, '-')
      const safeTo = String(message.to).replace(/[^a-zA-Z0-9._@-]/g, '_')
      const base = path.join(this.outboxDir, `${stamp}-${safeTo}`)
      fs.writeFileSync(
        `${base}.json`,
        JSON.stringify({ ...message, deliveryError: error || null }, null, 2)
      )
      fs.writeFileSync(`${base}.html`, message.html)
      console.log(
        `[email] no mail server configured, wrote "${message.subject}" to ${base}.html`
      )
      if (error) {
        console.error(`[email] delivery failed, kept in the outbox: ${error}`)
      }
      return base
    } catch (writeError) {
      console.error('[email] could not write to the outbox:', writeError.message)
      return null
    }
  }

  /**
   * The password reset link.
   */
  async sendPasswordReset(email, resetUrl, fullName) {
    const greeting = fullName ? `Hi ${fullName},` : 'Hi,'
    return this.send(
      email,
      'Reset your CodePulse password',
      `<div style="font-family:Inter,system-ui,sans-serif;max-width:520px;color:#171717">
        <h2 style="font-size:20px;margin:0 0 16px">Reset your CodePulse password</h2>
        <p style="font-size:15px;line-height:1.6;color:#52525b">${greeting}</p>
        <p style="font-size:15px;line-height:1.6;color:#52525b">
          Somebody asked to reset the password for this account. Use the link below
          within the next hour. If it was not you, nothing has changed and you can
          ignore this message.
        </p>
        <p style="margin:28px 0">
          <a href="${resetUrl}"
             style="display:inline-block;background:#171717;color:#fff;text-decoration:none;
                    padding:12px 20px;border-radius:10px;font-size:15px;font-weight:500">Reset password</a>
        </p>
        <p style="font-size:13px;line-height:1.6;color:#71717a">
          If the button does not work, copy this link into your browser:<br />
          <span style="word-break:break-all">${resetUrl}</span>
        </p>
      </div>`,
      `Reset your CodePulse password: ${resetUrl}\n\nThis link is valid for one hour.`
    )
  }

  /**
   * The weekly digest.
   */
  async sendWeeklySummary(email, summary) {
    const projectRows = (summary.projects || [])
      .map(
        p =>
          `<tr>
             <td style="padding:8px 10px;border-bottom:1px solid #e5e5e7">${escapeHtml(p.name)}</td>
             <td style="padding:8px 10px;border-bottom:1px solid #e5e5e7;text-align:right">${p.findings}</td>
             <td style="padding:8px 10px;border-bottom:1px solid #e5e5e7;text-align:right;color:#b91c1c">${p.critical}</td>
           </tr>`
      )
      .join('')

    return this.send(
      email,
      'Your CodePulse week',
      `<div style="font-family:Inter,system-ui,sans-serif;max-width:560px;color:#171717">
        <h2 style="font-size:20px;margin:0 0 4px">Your CodePulse week</h2>
        <p style="font-size:13px;color:#71717a;margin:0 0 24px">${escapeHtml(summary.period)}</p>
        <div style="display:flex;gap:12px;margin-bottom:24px">
          <div style="border:1px solid #e5e5e7;border-radius:14px;padding:14px 18px">
            <div style="font-size:26px;font-weight:700">${summary.findings}</div>
            <div style="font-size:12px;color:#71717a;margin-top:6px">Findings</div>
          </div>
          <div style="border:1px solid #e5e5e7;border-radius:14px;padding:14px 18px">
            <div style="font-size:26px;font-weight:700;color:#b91c1c">${summary.critical}</div>
            <div style="font-size:12px;color:#71717a;margin-top:6px">Critical</div>
          </div>
          <div style="border:1px solid #e5e5e7;border-radius:14px;padding:14px 18px">
            <div style="font-size:26px;font-weight:700">${summary.analyses}</div>
            <div style="font-size:12px;color:#71717a;margin-top:6px">Analyses</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;color:#52525b;font-weight:500">Project</th>
              <th style="text-align:right;padding:8px 10px;color:#52525b;font-weight:500">Findings</th>
              <th style="text-align:right;padding:8px 10px;color:#52525b;font-weight:500">Critical</th>
            </tr>
          </thead>
          <tbody>${projectRows || '<tr><td colspan="3" style="padding:8px 10px;color:#71717a">Nothing analysed this week.</td></tr>'}</tbody>
        </table>
        <p style="margin:28px 0 0">
          <a href="${summary.dashboardUrl}"
             style="display:inline-block;background:#171717;color:#fff;text-decoration:none;
                    padding:12px 20px;border-radius:10px;font-size:15px;font-weight:500">Open the dashboard</a>
        </p>
      </div>`,
      `Your CodePulse week (${summary.period}): ${summary.findings} findings, ${summary.critical} critical. ${summary.dashboardUrl}`
    )
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]
  )
}
