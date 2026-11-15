import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliPath = path.join(__dirname, '../../../cli/src/cli.ts')

export class CLIService {
  constructor(db) {
    this.db = db
  }

  async analyzeProject(projectPath) {
    return new Promise((resolve, reject) => {
      const process = spawn('ts-node', [cliPath, 'scan', projectPath])

      let output = ''
      let errorOutput = ''

      process.stdout.on('data', (data) => {
        output += data.toString()
      })

      process.stderr.on('data', (data) => {
        errorOutput += data.toString()
      })

      process.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output)
            resolve(result)
          } catch (e) {
            resolve({ raw: output })
          }
        } else {
          reject(new Error(errorOutput || 'Analysis failed'))
        }
      })

      process.on('error', reject)
    })
  }

  async startAnalysis(projectId, projectPath, analysisId) {
    try {
      // Update status to running
      await this.db.run(
        'UPDATE analyses SET status = ?, startedAt = ? WHERE id = ?',
        ['running', new Date().toISOString(), analysisId]
      )

      // Run CLI analysis
      const result = await this.analyzeProject(projectPath)

      // Parse findings
      const findings = this.parseFindingsFromResult(result)
      const summary = this.calculateSummary(findings)

      // Update analysis with results
      await this.db.run(
        `UPDATE analyses SET 
          status = ?, 
          completedAt = ?, 
          totalFindings = ?,
          critical = ?,
          high = ?,
          medium = ?,
          low = ?,
          info = ?,
          findings = ?,
          executionTime = ?
        WHERE id = ?`,
        [
          'completed',
          new Date().toISOString(),
          summary.totalFindings,
          summary.critical,
          summary.high,
          summary.medium,
          summary.low,
          summary.info,
          JSON.stringify(findings),
          Math.floor((Date.now() - new Date(Date.now()).getTime()) / 1000),
          analysisId
        ]
      )

      return { findings, summary }
    } catch (error) {
      // Update status to failed
      await this.db.run(
        'UPDATE analyses SET status = ?, completedAt = ? WHERE id = ?',
        ['failed', new Date().toISOString(), analysisId]
      )
      throw error
    }
  }

  parseFindingsFromResult(result) {
    // Parse CLI output into findings format
    if (result.findings) {
      return result.findings
    }
    if (result.issues) {
      return result.issues.map(issue => ({
        id: issue.id || `finding-${Math.random()}`,
        title: issue.message,
        description: issue.description || '',
        severity: issue.severity || 'MEDIUM',
        category: issue.type || 'Code Quality',
        file: issue.file,
        line: issue.line
      }))
    }
    return []
  }

  calculateSummary(findings) {
    const summary = {
      totalFindings: findings.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    }

    findings.forEach(finding => {
      const severity = (finding.severity || 'MEDIUM').toUpperCase()
      if (summary.hasOwnProperty(severity.toLowerCase())) {
        summary[severity.toLowerCase()]++
      }
    })

    return summary
  }
}
