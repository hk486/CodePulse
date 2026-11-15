import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const reportsDir = path.join(__dirname, '../../reports')

if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true })
}

export class PDFService {
  async generateAnalysisReport(analysis, project) {
    return new Promise((resolve, reject) => {
      try {
        const fileName = `analysis-${analysis.id}-${Date.now()}.pdf`
        const filePath = path.join(reportsDir, fileName)
        const doc = new PDFDocument()
        const stream = fs.createWriteStream(filePath)

        doc.pipe(stream)

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('Code Analysis Report', { align: 'center' })
        doc.fontSize(12).text(project.name, { align: 'center' })
        doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' })

        doc.moveTo(50, doc.y + 10).lineTo(550, doc.y).stroke()

        // Summary
        doc.fontSize(16).font('Helvetica-Bold').text('Summary', doc.y + 20)
        const summary = analysis.findings ? this.calculateSummary(JSON.parse(analysis.findings)) : {}
        
        doc.fontSize(11).font('Helvetica').text(`Total Findings: ${analysis.totalFindings || summary.totalFindings || 0}`)
        doc.text(`Critical: ${analysis.critical || summary.critical || 0}`, { indent: 20 })
        doc.text(`High: ${analysis.high || summary.high || 0}`, { indent: 20 })
        doc.text(`Medium: ${analysis.medium || summary.medium || 0}`, { indent: 20 })
        doc.text(`Low: ${analysis.low || summary.low || 0}`, { indent: 20 })

        // Findings
        if (analysis.findings) {
          const findings = JSON.parse(analysis.findings)
          doc.fontSize(16).font('Helvetica-Bold').text('Findings', doc.y + 20)

          findings.slice(0, 50).forEach((finding, index) => {
            doc.fontSize(11).font('Helvetica-Bold').text(`${index + 1}. ${finding.title}`)
            doc.fontSize(10).font('Helvetica').text(`Severity: ${finding.severity}`)
            doc.text(`Category: ${finding.category}`)
            if (finding.description) {
              doc.text(finding.description, { width: 500, align: 'left' })
            }
            if (finding.file) {
              doc.text(`File: ${finding.file}:${finding.line || '?'}`, { color: '#666' })
            }
            doc.moveDown(0.5)
          })

          if (findings.length > 50) {
            doc.text(`... and ${findings.length - 50} more findings`)
          }
        }

        // Recommendations
        doc.fontSize(16).font('Helvetica-Bold').text('Recommendations', doc.y + 20)
        doc.fontSize(11).font('Helvetica').text('• Address critical security issues immediately')
        doc.text('• Create tickets for high-severity findings')
        doc.text('• Include code review for medium-severity issues')
        doc.text('• Schedule time to address low-priority findings')
        doc.text('• Implement automated testing to prevent regressions')

        doc.end()

        stream.on('finish', () => {
          resolve({ fileName, filePath })
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  calculateSummary(findings) {
    const summary = { totalFindings: findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    findings.forEach(f => {
      const severity = (f.severity || 'MEDIUM').toLowerCase()
      if (summary.hasOwnProperty(severity)) {
        summary[severity]++
      }
    })
    return summary
  }

  async deleteReport(fileName) {
    const filePath = path.join(reportsDir, fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }
}
