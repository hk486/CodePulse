import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { AnalysisService } from './analysisService.js'
import { ReportService } from './reportService.js'
import { NotificationService } from './notificationService.js'
import { WebhookService } from './webhookService.js'
import { ScheduleService } from './scheduleService.js'
import { deduplicateFindings, markNewFindings } from './findingFingerprint.js'
import { cloneRepository } from './cloneService.js'
import { projectUploadCandidates } from './workspace.js'

/**
 * The analysis queue.
 *
 * A scan takes a while, and a big project takes a long while. Running it
 * inside the request that asked for it meant the connection was held open
 * for minutes, a refresh lost the run, and a second click started a second
 * scan. So a scan is a job: the row is written the moment it is asked for,
 * a worker picks it up, and the browser watches it over the websocket.
 *
 * The queue lives in the database, so it survives a restart. Anything that
 * was running when the server stopped goes back on the queue.
 */

/** How often the worker looks for something to do. */
const POLL_INTERVAL_MS = Number(process.env.ANALYSIS_QUEUE_POLL_MS || 400)

/** How often the schedules are looked at. */
const SCHEDULE_POLL_MS = Number(process.env.SCHEDULE_POLL_MS || 60 * 1000)

/** How long a scan may run before it is stopped. */
const SCAN_TIMEOUT_MS = Number(process.env.ANALYSIS_TIMEOUT_MS || 15 * 60 * 1000)

/**
 * The extensions the CLI is able to analyse. Kept in sync with the
 * analyzers registered in the CLI (cli/src/analyzers).
 */
const ANALYSABLE_EXTENSIONS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'java', 'go', 'rs', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp',
  'cs', 'php', 'rb', 'kt', 'kts', 'swift', 'dart',
  'sh', 'bash', 'zsh', 'sql',
  'vue', 'svelte', 'astro', 'html', 'htm', 'xhtml',
  'css', 'scss', 'sass', 'less', 'styl',
  'json', 'json5', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'ini', 'cfg',
  'conf', 'properties', 'hcl', 'tf', 'tfvars',
  'md', 'mdx', 'rst', 'txt', 'adoc',
  'scala', 'groovy', 'gvy', 'lua', 'pl', 'pm', 'r', 'jl',
  'm', 'mm', 'ex', 'exs', 'erl', 'hrl', 'hs', 'lhs',
  'clj', 'cljs', 'cljc', 'elm', 'nim', 'zig', 'cr',
  'sol', 'v', 'sv', 'vhd', 'asm', 's', 'vb', 'vbs',
  'ps1', 'psm1', 'psd1', 'bat', 'cmd',
  'proto', 'graphql', 'gql', 'gradle', 'bzl', 'nix',
  'dockerfile', 'makefile', 'mk', 'cmake',
  'hbs', 'ejs', 'tpl', 'twig', 'jinja', 'j2', 'pug', 'jade',
  'coffee', 'rkt', 'scm', 'lisp', 'el', 'pas', 'd', 'jf',
])

const IGNORED_DIRS = new Set([
  'node_modules', 'vendor', 'dist', 'build', 'target', '.git',
  'coverage', 'venv', '__pycache__',
])

/**
 * Count the files under `dir` that the CLI can actually analyse.
 */
export function countAnalysableFiles(dir) {
  let count = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(path.join(current, entry.name))
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).replace(/^\./, '').toLowerCase()
        if (ANALYSABLE_EXTENSIONS.has(ext)) count++
      }
    }
  }
  return count
}

export class AnalysisQueue {
  constructor(db, { wsManager = null, logger = console } = {}) {
    this.db = db
    this.wsManager = wsManager
    this.logger = logger
    this.analysisService = new AnalysisService(db)
    this.reportService = new ReportService(db)
    this.notificationService = new NotificationService(db)
    this.webhookService = new WebhookService(db)
    this.scheduleService = new ScheduleService(db)
    this.scheduleTimer = null

    this.running = false
    this.timer = null
    this.active = null // the child process of the scan being run
    this.activeId = null
    // The progress updates are written one after another, so the bar does
    // not jump about.
    this.progressChain = Promise.resolve()
  }

  /**
   * Start the worker. Scans that were running when the server stopped go
   * back on the queue first.
   */
  async start() {
    if (this.running) return
    this.running = true

    try {
      const requeued = await this.analysisService.requeueInterrupted()
      if (requeued > 0) {
        this.logger.log(`[queue] ${requeued} interrupted scan(s) put back on the queue`)
      }
    } catch (error) {
      this.logger.error('[queue] could not requeue the interrupted scans:', error?.message || error)
    }

    this.timer = setInterval(() => {
      void this.tick()
    }, POLL_INTERVAL_MS)
    if (this.timer.unref) this.timer.unref()

    // The schedules that are due. They are worked through on their own
    // timer, so a nightly scan does not have to wait for the poll.
    this.scheduleTimer = setInterval(() => {
      void this.runDueSchedules()
    }, SCHEDULE_POLL_MS)
    if (this.scheduleTimer.unref) this.scheduleTimer.unref()

    this.logger.log(`[queue] the worker is ready (${POLL_INTERVAL_MS}ms apart)`)
  }

  /**
   * Stop the worker. The scan that is running is stopped with it, so the
   * server does not hang on the way down.
   */
  async stop() {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer)
      this.scheduleTimer = null
    }
    if (this.active) {
      try {
        this.active.kill('SIGTERM')
      } catch {
        // It is already gone.
      }
    }
  }

  /**
   * Put a scan on the queue. The row is written straight away, so the
   * person who asked can see the scan and follow it.
   */
  async enqueue(projectId, userId, options = {}) {
    const job = await this.analysisService.createJob(projectId, userId, options)
    // Do not wait for the poll; pick it up now.
    void this.tick()
    return job
  }

  /**
   * Run the scans whose schedule is due.
   *
   * A schedule says "scan this again every night". The scan itself is
   * queued, so it goes through the same worker as everything else.
   */
  async runDueSchedules() {
    if (!this.running) return
    try {
      // Every schedule that is due, one at a time, so a burst of them
      // does not flood the queue.
      for (let i = 0; i < 5; i++) {
        const schedule = await this.scheduleService.claimDue()
        if (!schedule) break

        const project = await this.db.get(
          'SELECT * FROM projects WHERE id = ? AND status = "active"',
          [schedule.projectId]
        )
        if (!project) {
          this.logger.log(`[schedule] the project ${schedule.projectId} is gone`)
          continue
        }

        // The scan is queued, so it waits its turn like everything else.
        await this.enqueue(schedule.projectId, schedule.userId, {
          scheduled: true,
          scheduleId: schedule.id
        })
        this.logger.log(
          `[schedule] queued a scan of ${project.name} (${schedule.every} ${schedule.unit})`
        )
      }
    } catch (error) {
      this.logger.error('[schedule] could not run the due schedules:', error?.message || error)
    }
  }

  /**
   * One turn of the worker: take a job if there is one, run it.
   */
  async tick() {
    if (!this.running || this.active) return

    let job = null
    try {
      job = await this.analysisService.claimNextJob()
    } catch (error) {
      this.logger.error('[queue] could not look for work:', error?.message || error)
      return
    }
    if (!job) return

    this.activeId = job.id
    try {
      await this.runJob(job)
    } catch (error) {
      this.logger.error('[queue] the scan broke:', error?.message || error)
      const message = error?.message || 'The analysis did not finish.'
      await this.analysisService.failJob(job.id, message)
      this.broadcastError(job, message)
      await this.deliverWebhooks(job, { id: job.projectId, name: job.projectId }, {
        event: 'analysis.failed',
        payload: { analysisId: job.id, projectId: job.projectId, error: message }
      })
    } finally {
      this.active = null
      this.activeId = null
    }
  }

  /**
   * Work out what to scan.
   *
   *  1. An extracted archive (if the user uploaded a .zip/.tar.gz)
   *  2. The project's uploaded workspace
   *  3. The project's configured local path
   *  4. A repository to clone
   */
  async resolveScanPath(project, userId) {
    const candidates = projectUploadCandidates(userId, project.id)
    const uploaded = await this.db.get(
      'SELECT COUNT(*) as count FROM files WHERE projectId = ?',
      [project.id]
    )

    const workspace = candidates.find(dir => {
      if (!fs.existsSync(dir)) return false
      try {
        return fs.readdirSync(dir).length > 0
      } catch {
        return false
      }
    })

    if (uploaded && uploaded.count > 0 && workspace) {
      const extractedDir = path.join(workspace, 'extracted')
      if (fs.existsSync(extractedDir)) {
        return { scanPath: extractedDir, source: 'extracted archive' }
      }
      return { scanPath: workspace, source: 'uploaded files' }
    }

    if (project.path && fs.existsSync(project.path)) {
      return { scanPath: project.path, source: 'project path' }
    }

    if (project.path && /^https?:\/\//i.test(project.path)) {
      const destination = path.join(candidates[0], 'repository')
      await cloneRepository(project.path, destination)
      return { scanPath: destination, source: 'cloned repository' }
    }

    return null
  }

  /**
   * Run one scan from beginning to end.
   */
  async runJob(job) {
    const userId = job.userId || null
    const project = await this.db.get('SELECT * FROM projects WHERE id = ?', [job.projectId])

    if (!project) {
      await this.analysisService.failJob(job.id, 'The project is no longer there.', 'starting')
      this.broadcastError(job, 'The project is no longer there.')
      await this.deliverWebhooks(job, project, {
        event: 'analysis.failed',
        payload: {
          analysisId: job.id,
          projectId: project.id,
          projectName: project.name,
          error: 'The project is no longer there.'
        }
      })
      return
    }

    this.broadcastStart(job, project.name)

    let resolved = null
    try {
      await this.progress(job, 2, 'preparing', 'Getting the files ready')
      resolved = await this.resolveScanPath(project, userId)
    } catch (error) {
      await this.analysisService.failJob(
        job.id,
        error?.message || 'The files could not be prepared.',
        'preparing'
      )
      this.broadcastError(job, error?.message || 'The files could not be prepared.')
      return
    }

    if (!resolved) {
      const message =
        'Nothing to analyse yet. Upload your project folder, or give a repository URL to clone.'
      await this.analysisService.failJob(job.id, message, 'preparing')
      this.broadcastError(job, message)
      return
    }

    const { scanPath, source } = resolved

    // The scan itself.
    let stdout = ''
    let stderr = ''
    let exitCode = 0
    let spawnError = null

    const cliPath = process.env.CLI_PATH || '/app/cli'

    // The scan is given a budget. A project that makes the scanner spin
    // holds a worker for ever otherwise.
    const cpuSeconds = Math.max(30, Math.floor(SCAN_TIMEOUT_MS / 1000))
    const heapMb = Number(process.env.SCAN_HEAP_MB || 2048)
    const processes = Number(process.env.SCAN_MAX_PROCESSES || 512)

    // The scan does not need the server's secrets, and it is given an
    // environment without them.
    const scanEnv = { ...process.env }
    for (const secret of [
      'JWT_SECRET',
      'DATABASE_URL',
      'DB_PASSWORD',
      'SMTP_PASSWORD',
      'EMAIL_PASSWORD',
      'CODEDASHBOARD_SECRET',
    ]) {
      delete scanEnv[secret]
    }

    try {
      await new Promise((resolve, reject) => {
        // The limits are set by the shell before the scanner starts, so
        // the scanner and every tool it runs share them.
        const command = [
          `ulimit -t ${cpuSeconds} 2>/dev/null || true`,
          `ulimit -u ${processes} 2>/dev/null || true`,
          `exec node --max-old-space-size=${heapMb} dist/cli.js scan` +
            ` ${shellQuote(scanPath)} --format json --progress`,
        ].join('; ')

        const child = spawn('sh', ['-c', command], {
          cwd: cliPath,
          env: scanEnv
        })
        this.active = child

        const timeout = setTimeout(() => {
          spawnError = new Error('The scan took too long and was stopped.')
          try {
            child.kill('SIGTERM')
          } catch {
            // It is already gone.
          }
        }, SCAN_TIMEOUT_MS)
        if (timeout.unref) timeout.unref()

        // The progress lines the CLI writes, one JSON object per line.
        let pending = ''
        child.stderr.on('data', chunk => {
          const text = chunk.toString()
          stderr += text
          pending += text
          const lines = pending.split('\n')
          pending = lines.pop() || ''
          for (const line of lines) {
            const event = this.parseProgress(line)
            if (!event) continue
            void this.progress(job, event.progress, event.stage, event.message)
          }
        })

        child.stdout.on('data', chunk => {
          stdout += chunk.toString()
        })

        child.on('error', error => {
          clearTimeout(timeout)
          spawnError = error
          reject(error)
        })

        child.on('close', code => {
          clearTimeout(timeout)
          exitCode = code === null ? 1 : code
          resolve()
        })
      })
    } catch (error) {
      spawnError = error
    }

    this.active = null

    // Was it asked to stop?
    if (await this.analysisService.isCancelled(job.id)) {
      await this.analysisService.failJob(job.id, 'The scan was stopped.', 'cancelled')
      this.broadcastError(job, 'The scan was stopped.')
      return
    }

    if (spawnError) {
      const message = spawnError.message || 'The scan could not be started.'
      await this.analysisService.failJob(job.id, message, 'scanning')
      this.broadcastError(job, message)
      return
    }

    if (exitCode !== 0) {
      const details = (stderr || '').split('\n').filter(Boolean).slice(-3).join(' ')
      const message = details || `The scan stopped with code ${exitCode}.`
      await this.analysisService.failJob(job.id, message, 'scanning')
      this.broadcastError(job, message)
      return
    }

    // Read the report the CLI produced.
    let scanResult
    try {
      scanResult = JSON.parse(stdout)
    } catch {
      const jsonMatch = stdout.match(/\{[\s\S]*\}/)
      try {
        scanResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null
      } catch {
        scanResult = null
      }
    }

    if (!scanResult) {
      const message = 'Analysis failed: could not read scan output'
      await this.analysisService.failJob(job.id, message, 'scanning')
      this.broadcastError(job, message)
      return
    }

    const findings = scanResult.analysis?.findings || []
    const analyzersRun = scanResult.analysis?.analyzersRun || []
    const detectedLanguages = scanResult.detectedLanguages || []
    const detectedFrameworks = scanResult.detectedFrameworks || []
    const components = scanResult.components || []
    const techStack = scanResult.techStack || {}
    const projectType = scanResult.projectType || null
    const coverage = scanResult.coverage || null
    const executionTime = scanResult.analysis?.executionTime ?? null
    // What the scan actually did, so the report can say what was covered.
    const pipeline = scanResult.pipeline || null

    const scannedFiles = countAnalysableFiles(scanPath)
    this.logger.log(
      `[queue] analysis=${job.id} project=${job.projectId} scanPath=${scanPath} ` +
        `scannedFiles=${scannedFiles} analyzers=${analyzersRun.length} findings=${findings.length}`
    )

    // The scan produced nothing at all and there is genuinely no source
    // code in the project - say exactly what was there, so the person can
    // see what went wrong.
    if (scannedFiles === 0) {
      const uploadedRows = await this.db.all(
        'SELECT originalFilename, relativePath FROM files WHERE projectId = ? ORDER BY relativePath',
        [job.projectId]
      )
      const fileList = uploadedRows
        .map(f => f.relativePath || f.originalFilename)
        .slice(0, 25)
      const message =
        `No analysable source files were found in the uploaded files. ` +
        `${uploadedRows.length} file(s) were received: ${fileList.join(', ')}`
      await this.analysisService.failJob(job.id, message, 'scanning')
      this.broadcastError(job, message, {
        hint:
          'Upload a project folder that contains source code. Supported types include ' +
          '.ts .tsx .js .jsx .py .java .go .rs .cs .php .cpp .c .rb .swift .dart .kt .sql .sh ' +
          'as well as .vue .svelte .html .css .json .yaml .md',
        uploadedFiles: fileList,
        fileCount: uploadedRows.length,
        scannedFiles: 0
      })
      return
    }

    // The gate. A caller can hold a build to what is already there, so
    // a project with findings does not have to reach zero before it can
    // start failing on new ones.
    // Two rules can find the same problem. The report says it once, and
    // says which rules found it.
    const deduped = deduplicateFindings(findings)
    if (deduped.removed > 0) {
      this.logger.log(
        `[queue] ${deduped.removed} duplicate finding(s) folded into the ones they matched`
      )
    }

    // What was not in the previous run is new, which is the question a
    // person asks when they look at a report.
    const previous = await this.db.get(
      `SELECT findings FROM analyses
        WHERE projectId = ? AND id != ? AND status = 'completed'
        ORDER BY createdAt DESC LIMIT 1`,
      [job.projectId, job.id]
    )
    let previousFindings = []
    if (previous) {
      try {
        previousFindings = JSON.parse(previous.findings || '[]')
      } catch {
        previousFindings = []
      }
    }
    const withNew = markNewFindings(deduped.findings, previousFindings)

    const gate = await this.evaluateGate(job, findings)

    // A gate that held the build is worth telling the addresses about on
    // its own, because that is the one a build server acts on.
    if (gate && gate.failed) {
      await this.deliverWebhooks(job, project, {
        event: 'gate.failed',
        payload: {
          analysisId: job.id,
          projectId: project.id,
          projectName: project.name,
          gate
        }
      })
    }

    await this.progress(job, 100, 'saving', 'Saving the result')

    const analysis = await this.analysisService.completeJob(
      job.id,
      withNew,
      {
        detectedLanguages,
        detectedFrameworks,
        components,
        techStack,
        projectType,
        analyzersRun,
        scannedFiles,
        coverage,
        executionTime
      },
      { gate, analyzedSource: source, pipeline }
    )

    // Tell the user that the analysis finished.
    if (userId) {
      const critical = findings.filter(f => f.severity === 'CRITICAL').length
      const high = findings.filter(f => f.severity === 'HIGH').length
      try {
        await this.notificationService.create(userId, {
          type: 'analysis_complete',
          title: `Analysis complete for ${project.name}`,
          message:
            findings.length === 0
              ? 'No issues were found.'
              : `${findings.length} finding${
                  findings.length === 1 ? '' : 's'
                } found (${critical} critical, ${high} high).`,
          link: `/analysis/${analysis.id}`,
          severity:
            critical > 0 ? 'critical' : high > 0 ? 'high' : findings.length > 0 ? 'medium' : 'success',
          preference: 'analysisComplete'
        })

        if (critical > 0) {
          await this.notificationService.create(userId, {
            type: 'critical_issues',
            title: `${critical} critical issue${critical === 1 ? '' : 's'} in ${project.name}`,
            message: 'These need attention before the code ships.',
            link: `/analysis/${analysis.id}`,
            severity: 'critical',
            preference: 'criticalIssues'
          })
        }
      } catch (notificationError) {
        this.logger.error('[queue] could not create notification:', notificationError?.message || notificationError)
      }
    }

    // Freeze the result into a report so the Reports page has a snapshot.
    try {
      const stored = await this.db.get('SELECT * FROM analyses WHERE id = ?', [analysis.id])
      await this.reportService.save(stored, project)
    } catch (reportError) {
      this.logger.error('[queue] could not save report:', reportError?.message || reportError)
    }

    this.broadcastComplete(job, findings.length, {
      totalFindings: findings.length,
      critical: findings.filter(f => f.severity === 'CRITICAL').length,
      high: findings.filter(f => f.severity === 'HIGH').length
    })

    // Tell the addresses that want to know. A build should not have to ask.
    await this.deliverWebhooks(job, project, {
      event: 'analysis.completed',
      payload: {
        analysisId: analysis.id,
        projectId: project.id,
        projectName: project.name,
        findingsCount: findings.length,
        critical: findings.filter(f => f.severity === 'CRITICAL').length,
        high: findings.filter(f => f.severity === 'HIGH').length,
        gate: gate || null,
        reportUrl: `/analysis/${analysis.id}`
      }
    })
  }

  /**
   * Send the webhook deliveries for something that happened.
   *
   * A delivery that fails is recorded on the webhook and nothing more: a
   * build server that is down for a moment must not take the analysis with
   * it.
   */
  async deliverWebhooks(job, project, { event, payload }) {
    if (!job.userId) return

    try {
      const webhooks = await this.webhookService.findForEvent(
        job.userId,
        project.id,
        event
      )
      for (const webhook of webhooks) {
        const result = await this.webhookService.deliver(webhook, event, payload)
        if (!result.delivered) {
          this.logger.log(
            `[webhook] ${webhook.url} did not take the delivery: ${result.error}`
          )
        }
      }
    } catch (error) {
      this.logger.error('[webhook] the deliveries failed:', error?.message || error)
    }
  }

  /**
   * Read one of the CLI's progress lines.
   */
  parseProgress(line) {
    const trimmed = String(line || '').trim()
    if (!trimmed.startsWith('{')) return null
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && parsed.event === 'progress') {
        return {
          stage: String(parsed.stage || 'scanning'),
          progress: Number(parsed.progress || 0),
          message: String(parsed.message || '')
        }
      }
    } catch {
      // Not one of ours.
    }
    return null
  }

  /**
   * The gate: what would make a build fail.
   */
  async evaluateGate(job, findings) {
    const options = job.options || {}
    const failOn = String(options.failOn || '').trim()
    const compareWith = String(options.baseline || '').trim()
    if (!failOn && !compareWith) return null

    const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 }
    const threshold =
      failOn && severityRank[failOn.toUpperCase()] !== undefined
        ? severityRank[failOn.toUpperCase()]
        : undefined

    const key = finding =>
      `${finding.ruleId || finding.title || 'unknown'}@${finding.location?.filePath || ''}`

    let baselineKeys = null
    if (compareWith) {
      // The run before this one, so a build fails on what is new. The
      // job that is running now is not the previous run, even though its
      // row was written when it was asked for.
      const previous = await this.db.all(
        `SELECT findings FROM analyses
          WHERE projectId = ? AND id != ? AND status = 'completed'
          ORDER BY createdAt DESC
          LIMIT 1`,
        [job.projectId, job.id]
      )
      if (previous.length > 0) {
        let findings = []
        try {
          findings = JSON.parse(previous[0].findings || '[]')
        } catch {
          findings = []
        }
        baselineKeys = new Set(findings.map(key))
      }
    }

    const offenders = findings.filter(finding => {
      if (threshold !== undefined) {
        const rank = severityRank[String(finding.severity || 'INFO').toUpperCase()]
        if (rank === undefined || rank > threshold) return false
        if (baselineKeys && baselineKeys.has(key(finding))) return false
        return true
      }
      if (baselineKeys) return !baselineKeys.has(key(finding))
      return false
    })

    return {
      failed: offenders.length > 0,
      reason:
        offenders.length > 0
          ? `${offenders.length} finding${
              offenders.length === 1 ? '' : 's'
            }${
              threshold !== undefined
                ? ` at ${failOn} or above`
                : ' the previous run did not have'
            }`
          : '',
      offenders: offenders.slice(0, 20).map(finding => ({
        severity: finding.severity,
        ruleId: finding.ruleId,
        title: finding.title,
        filePath: finding.location?.filePath,
        line: finding.location?.startLine
      }))
    }
  }

  /**
   * Record how far the scan has got and tell the browser.
   *
   * The updates go one after another. The scan reports its steps as they
   * happen, and if the writes raced each other the bar would jump about.
   */
  progress(job, percent, stage, message) {
    this.progressChain = this.progressChain
      .then(() => this.writeProgress(job, percent, stage, message))
      .catch(error => {
        this.logger.error('[queue] could not save the progress:', error?.message || error)
      })
    return this.progressChain
  }

  async writeProgress(job, percent, stage, message) {
    try {
      await this.analysisService.updateProgress(job.id, {
        progress: percent,
        stage,
        message
      })
    } catch (error) {
      this.logger.error('[queue] could not save the progress:', error?.message || error)
    }
    if (this.wsManager && job.userId) {
      this.wsManager.sendAnalysisProgress(job.userId, job.id, percent, message, stage)
    }
  }

  broadcastStart(job, projectName) {
    if (!this.wsManager || !job.userId) return
    this.wsManager.sendAnalysisStart(job.userId, job.id, projectName)
  }

  broadcastProgress(job, percent, stage, message) {
    if (!this.wsManager || !job.userId) return
    this.wsManager.sendAnalysisProgress(job.userId, job.id, percent, message, stage)
  }

  broadcastComplete(job, findingsCount, summary) {
    if (!this.wsManager || !job.userId) return
    this.wsManager.sendAnalysisComplete(job.userId, job.id, findingsCount, summary)
  }

  broadcastError(job, message, extra = {}) {
    if (!this.wsManager || !job.userId) return
    this.wsManager.broadcast(job.userId, 'analysis:error', {
      analysisId: job.id,
      error: message,
      ...extra
    })
  }
}

/**
 * Quote a value for the shell.
 *
 * The path of the project goes into the command that runs the scan, so it
 * is quoted properly rather than trusted.
 *
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}
