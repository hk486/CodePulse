import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'

/**
 * API keys.
 *
 * A key is for a machine: a build that pushes a project, or a script that
 * asks for a report. It is shown once, when it is made, and only its
 * hash is kept, so a copy of the database cannot be turned into a list of
 * working keys.
 *
 * The key is also a way to be turned off. A key can be revoked and it
 * stops working at once, which a shared password cannot do.
 */

const KEY_PREFIX = 'cp_live_'
const PREFIX_LENGTH = 12

export class ApiKeyService {
  constructor(db) {
    this.db = db
  }

  /** The key is random; only its hash is stored. */
  static hashKey(key) {
    return crypto.createHash('sha256').update(String(key)).digest('hex')
  }

  /** The first few characters, so a key can be told apart in a list. */
  static prefixOf(key) {
    return String(key).slice(0, PREFIX_LENGTH)
  }

  /**
   * Make a key. The secret is returned once and never again.
   */
  async create(userId, name) {
    const id = uuidv4()
    const secret = crypto.randomBytes(24).toString('base64url')
    const key = `${KEY_PREFIX}${secret}`
    const now = new Date().toISOString()

    await this.db.run(
      `INSERT INTO api_keys (id, userId, name, keyHash, keyPrefix, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, String(name || 'API key').trim() || 'API key', ApiKeyService.hashKey(key), ApiKeyService.prefixOf(key), now]
    )

    return {
      id,
      name: String(name || 'API key').trim() || 'API key',
      prefix: ApiKeyService.prefixOf(key),
      key,
      createdAt: now,
    }
  }

  /** The keys of a user, without the secrets. */
  async listForUser(userId) {
    const rows = await this.db.all(
      `SELECT id, name, keyPrefix, createdAt, lastUsedAt, revokedAt
         FROM api_keys WHERE userId = ? ORDER BY createdAt DESC`,
      [userId]
    )
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      prefix: row.keyPrefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      revoked: Boolean(row.revokedAt),
    }))
  }

  /** Take a key away. It stops working at once. */
  async revoke(userId, id) {
    const row = await this.db.get(
      'SELECT id FROM api_keys WHERE id = ? AND userId = ?',
      [id, userId]
    )
    if (!row) return false

    await this.db.run(
      'UPDATE api_keys SET revokedAt = ? WHERE id = ?',
      [new Date().toISOString(), id]
    )
    return true
  }

  /**
   * The account a key belongs to, or null when the key is not one of ours,
   * has been revoked, or has expired.
   */
  async verifyKey(key) {
    if (!key || !String(key).startsWith(KEY_PREFIX)) return null

    const row = await this.db.get(
      `SELECT k.*, u.id as userId, u.username, u.email, u.fullName, u.role
         FROM api_keys k
         JOIN users u ON u.id = k.userId
        WHERE k.keyHash = ?`,
      [ApiKeyService.hashKey(key)]
    )
    if (!row) return null
    if (row.revokedAt) return null

    // Remember when it was last used, so an unused key can be spotted.
    await this.db.run(
      'UPDATE api_keys SET lastUsedAt = ? WHERE id = ?',
      [new Date().toISOString(), row.id]
    )

    return {
      userId: row.userId,
      username: row.username,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      apiKeyId: row.id,
    }
  }
}
