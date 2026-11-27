import sqlite3 from 'sqlite3'
import { promisify } from 'util'
import chalk from 'chalk'
import crypto from 'crypto'

export class Database {
  constructor(filename = './data/codepulse.db') {
    this.db = new sqlite3.Database(filename)
    this.run = promisify(this.db.run.bind(this.db))
    this.get = promisify(this.db.get.bind(this.db))
    this.all = promisify(this.db.all.bind(this.db))
  }

  /**
   * Run a statement and say how many rows it changed.
   *
   * The plain run() throws the count away, because the callback is called
   * with the statement's own context. When a job is claimed by exactly one
   * worker, that count is the proof it worked.
   */
  runChanges(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (error) {
        if (error) return reject(error)
        resolve({ changes: this.changes, lastID: this.lastID })
      })
    })
  }

  async initialize() {
    console.log(chalk.yellow('Initializing database...'))

    await this.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        description TEXT,
        languages TEXT,
        frameworks TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        status TEXT DEFAULT 'active'
      )
    `)

    await this.run(`
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        totalFindings INTEGER DEFAULT 0,
        critical INTEGER DEFAULT 0,
        high INTEGER DEFAULT 0,
        medium INTEGER DEFAULT 0,
        low INTEGER DEFAULT 0,
        info INTEGER DEFAULT 0,
        executionTime INTEGER,
        analyzersRun TEXT,
        findings TEXT,
        createdAt TEXT NOT NULL,
        startedAt TEXT,
        completedAt TEXT,
        FOREIGN KEY (projectId) REFERENCES projects(id)
      )
    `)

    await this.run(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        analysisId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        format TEXT DEFAULT 'json',
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (analysisId) REFERENCES analyses(id),
        FOREIGN KEY (projectId) REFERENCES projects(id)
      )
    `)

    await this.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        fullName TEXT,
        role TEXT DEFAULT 'user',
        photoUrl TEXT,
        createdAt TEXT NOT NULL,
        lastLogin TEXT
      )
    `)

    // Webhooks: a build does not want to poll, so the address is told
    // when a scan finishes.
    await this.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        projectId TEXT,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        active INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        lastDeliveryAt TEXT,
        lastStatus INTEGER,
        lastError TEXT,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)
    try {
      await this.run(
        'CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks (userId, active)'
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    // Scheduled analyses: a project that is scanned once goes stale.
    await this.run(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        projectId TEXT NOT NULL,
        every INTEGER NOT NULL,
        unit TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        nextRunAt TEXT,
        lastRunAt TEXT,
        runs INTEGER DEFAULT 0,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)
    try {
      await this.run(
        'CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules (enabled, nextRunAt)'
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    // The audit log: what happened to an account.
    await this.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        userId TEXT,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        ip TEXT,
        userAgent TEXT,
        createdAt TEXT NOT NULL
      )
    `)
    try {
      await this.run(
        'CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (userId, createdAt)'
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    // API keys for the machines: a build that pushes a project, a script
    // that asks for a report. Only the hash of a key is stored.
    await this.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        name TEXT NOT NULL,
        keyHash TEXT NOT NULL,
        keyPrefix TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastUsedAt TEXT,
        revokedAt TEXT,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)
    try {
      await this.run(
        'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (keyHash)'
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    // Password resets. Only the hash of a token is stored, so a copy of
    // the database cannot be turned into a list of working reset links.
    await this.run(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        tokenHash TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        usedAt TEXT
      )
    `)
    try {
      await this.run(
        'CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets (tokenHash)'
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    // Add photoUrl column to existing databases (migration)
    try {
      await this.run(`ALTER TABLE users ADD COLUMN photoUrl TEXT`)
    } catch {
      // Column already exists, ignore
    }

    // Add userId column to existing project tables (migration)
    try {
      await this.run(`ALTER TABLE projects ADD COLUMN userId TEXT`)
    } catch {
      // Column already exists, ignore
    }

    // Add the detected stack columns to existing analyses (migration)
    for (const column of [
      'detectedLanguages TEXT',
      'detectedFrameworks TEXT',
      'components TEXT',
      'techStack TEXT',
      'projectType TEXT',
      'scannedFiles INTEGER',
      'coverage TEXT'
    ]) {
      try {
        await this.run(`ALTER TABLE analyses ADD COLUMN ${column}`)
      } catch {
        // Column already exists, ignore
      }
    }

    // The job columns. An analysis row is created the moment it is asked
    // for and is worked through afterwards, so the row is the record of a
    // job: what was asked, how far it got, and how it ended.
    for (const column of [
      'userId TEXT',
      'progress INTEGER DEFAULT 0',
      'stage TEXT',
      'error TEXT',
      'queuedAt TEXT',
      'gate TEXT',
      'analyzedSource TEXT',
      'cancelRequested INTEGER DEFAULT 0',
      'options TEXT',
      'pipeline TEXT'
    ]) {
      try {
        await this.run(`ALTER TABLE analyses ADD COLUMN ${column}`)
      } catch {
        // Column already exists, ignore
      }
    }

    // Jobs are picked up in the order they were asked for.
    try {
      await this.run(
        `CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses (status, createdAt)`
      )
    } catch {
      // The index is an optimisation, not a requirement.
    }

    await this.run(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        projectId TEXT NOT NULL,
        originalFilename TEXT NOT NULL,
        relativePath TEXT,
        fileSize INTEGER,
        storedPath TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (projectId) REFERENCES projects(id)
      )
    `)

    // Persistent sessions so a backend restart does not log everybody out
    await this.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)

    // Notifications raised by the platform for the signed in user
    await this.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        link TEXT,
        severity TEXT DEFAULT 'info',
        read INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)

    // Which notifications a user wants to receive
    await this.run(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        userId TEXT PRIMARY KEY,
        analysisComplete INTEGER DEFAULT 1,
        criticalIssues INTEGER DEFAULT 1,
        weeklySummary INTEGER DEFAULT 1,
        realTimeUpdates INTEGER DEFAULT 1,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `)

    console.log(chalk.green('✓ Database initialized'))
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
}
