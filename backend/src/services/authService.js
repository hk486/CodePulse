import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'

// Sessions are persisted in the database so that restarting the backend does
// not invalidate the token a browser is holding. The previous in-memory store
// silently logged every user out on each restart, which made uploads land in
// the wrong folder and analyses come back empty.
const SESSION_TTL_DAYS = 30

function sessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * The one way a password is hashed. The reset flow uses it too, so there
 * is a single implementation of it.
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const verify = crypto.scryptSync(password, salt, 64).toString('hex')
  return verify === hash
}

export class AuthService {
  constructor(db) {
    this.db = db
  }

  async register({ username, email, password, fullName }) {
    if (!email || !password) {
      throw new Error('Email and password are required')
    }
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    // Derive username from email if not provided
    const derivedUsername = username || email.split('@')[0] || fullName || 'user'
    const existing = await this.db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [derivedUsername, email]
    )
    if (existing) {
      throw new Error('Username or email already registered')
    }

    const id = uuidv4()
    const now = new Date().toISOString()
    const role = 'user'
    const displayName = fullName || derivedUsername

    await this.db.run(
      `INSERT INTO users (id, username, email, password, fullName, role, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, derivedUsername, email, hashPassword(password), displayName, role, now]
    )

    const token = uuidv4()
    await this.createSession(token, {
      userId: id,
      username: derivedUsername,
      email,
      role,
      fullName: displayName
    })

    return {
      token,
      userId: id,
      username: derivedUsername,
      email,
      role,
      fullName: displayName
    }
  }

  async login({ username, email, password }) {
    if (!password) {
      throw new Error('Password is required')
    }
    const identifier = username || email
    const user = await this.db.get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    )
    if (!user) {
      throw new Error('No account found with this email or username')
    }
    if (!verifyPassword(password, user.password)) {
      throw new Error('Incorrect password. Please try again.')
    }

    const token = uuidv4()
    await this.createSession(token, {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.fullName
    })

    return {
      token,
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.fullName
    }
  }

  async createSession(token, user) {
    const now = new Date().toISOString()
    await this.db.run(
      `INSERT OR REPLACE INTO sessions (token, userId, createdAt, expiresAt)
       VALUES (?, ?, ?, ?)`,
      [token, user.userId, now, sessionExpiry()]
    )
  }

  /**
   * Resolve a bearer token to its user. Tokens survive a backend restart
   * because they live in the database.
   */
  async verifyToken(token) {
    if (!token) return null
    const session = await this.db.get(
      'SELECT * FROM sessions WHERE token = ?',
      [token]
    )
    if (!session) return null
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
      await this.db.run('DELETE FROM sessions WHERE token = ?', [token])
      return null
    }
    const user = await this.db.get(
      'SELECT id, username, email, fullName, role FROM users WHERE id = ?',
      [session.userId]
    )
    if (!user) {
      await this.db.run('DELETE FROM sessions WHERE token = ?', [token])
      return null
    }
    return {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.fullName
    }
  }

  async getProfile(userId) {
    const user = await this.db.get(
      'SELECT id, username, email, fullName, photoUrl, role, createdAt FROM users WHERE id = ?',
      [userId]
    )
    return user || null
  }

  async updateProfile(userId, { fullName, email, photoUrl }) {
    // Check if email is already taken by another user
    if (email) {
      const existing = await this.db.get(
        'SELECT * FROM users WHERE email = ? AND id != ?',
        [email, userId]
      )
      if (existing) {
        throw new Error('Email already registered')
      }
    }

    const updates = []
    const values = []
    if (fullName !== undefined) {
      updates.push('fullName = ?')
      values.push(fullName)
    }
    if (email !== undefined) {
      updates.push('email = ?')
      values.push(email)
    }
    if (photoUrl !== undefined) {
      updates.push('photoUrl = ?')
      values.push(photoUrl)
    }

    if (updates.length === 0) {
      return this.getProfile(userId)
    }

    values.push(userId)

    await this.db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    )

    return this.getProfile(userId)
  }

  async logout(token) {
    if (!token) return
    await this.db.run('DELETE FROM sessions WHERE token = ?', [token])
  }
}
