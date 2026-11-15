import express from 'express'
import { ReportService } from '../services/reportService.js'

/**
 * Printable report.
 *
 * The endpoint returns a self-contained HTML document that the browser can
 * print straight to PDF (Ctrl/Cmd + P -> Save as PDF). It needs no extra
 * server dependency and always renders the same findings the UI shows.
 */
/**
 * Escape a value for the printable HTML.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The rows of the findings table.
 */
function findingRows(findings) {
  return findings
    .map(
      (finding) => `
        <tr>
          <td>${escapeHtml(finding.title)}</td>
          <td class="mono">${escapeHtml(finding.location?.filePath || "")}:${escapeHtml(finding.location?.startLine || "")}</td>
          <td><span class="badge" style="background:${severityColor(finding.severity)}">${escapeHtml(finding.severity)}</span></td>
          <td>${escapeHtml(humanise(finding.category))}</td>
          <td>${escapeHtml(sourceLabel(finding.language))}</td>
          <td>${escapeHtml(finding.suggestedAction || "")}</td>
        </tr>`
    )
    .join("");
}

/**
 * The layers a finding can come from. The scanner reports the layer in
 * the language field for anything that is not source code.
 */
const SOURCES = {
  code: 'Source code',
  database: 'Database',
  infra: 'Infrastructure',
  config: 'Configuration',
  secrets: 'Secrets',
  dependencies: 'Dependencies',
}

/** A category or a source, written out for people. */
function humanise(value) {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim().toLowerCase()
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function sourceLabel(value) {
  const key = String(value || '').toLowerCase()
  return SOURCES[key] || humanise(value)
}

/**
 * One severity tile of the printable report.
 */
function severityRow(label, value, color) {
  const safe = String(value ?? 0).replace(/[^0-9./]/g, "");
  return `
        <div class="tile">
          <div class="tile-value" style="color:${color}">${safe}</div>
          <div class="tile-label">${label}</div>
        </div>`;
}

export function pdfRoutes(db, requireAuth) {
  const router = express.Router()
  const reportService = new ReportService(db)

  router.use(requireAuth)

  /**
   * Build the printable document for a report snapshot.
   */
  const renderHtml = (content, analysisId, createdAt) => {
    const summary = content.summary || {}
    const findings = content.findings || []

    const rows = findings
      .map(
        (finding) => `
        <tr>
          <td>${escapeHtml(finding.title)}</td>
          <td class="mono">${escapeHtml(finding.location?.filePath || '')}:${escapeHtml(finding.location?.startLine || '')}</td>
          <td><span class="badge" style="background:${severityColor(finding.severity)}">${escapeHtml(finding.severity)}</span></td>
          <td>${escapeHtml(humanise(finding.category))}</td>
          <td>${escapeHtml(sourceLabel(finding.language))}</td>
          <td>${escapeHtml(finding.suggestedAction || '')}</td>
        </tr>`
      )
      .join('')

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CodePulse Report - ${escapeHtml(content.projectName || 'Project')}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #171717; background: #fff; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  .sub { color: #71717a; font-size: 13px; margin-bottom: 28px; }
  .tiles { display: flex; gap: 12px; margin-bottom: 28px; flex-wrap: wrap; }
  .tile { border: 1px solid #dcdcdf; border-radius: 14px; padding: 14px 18px; min-width: 110px; }
  .tile-value { font-size: 26px; font-weight: 700; line-height: 1; }
  .tile-label { font-size: 12px; color: #71717a; margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { text-align: left; padding: 9px 10px; background: #f4f4f5; border-bottom: 1px solid #dcdcdf; font-size: 12px; font-weight: 500; color: #52525b; }
  td { padding: 9px 10px; border-bottom: 1px solid #e5e5e7; vertical-align: top; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 5px; color: #fff; font-size: 10.5px; font-weight: 600; }
  footer { margin-top: 28px; font-size: 11px; color: #a1a1aa; }
  @media print { body { padding: 16px; } .tile { break-inside: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>CodePulse Analysis Report</h1>
  <div class="sub">
    ${escapeHtml(content.projectName || 'Project')} &middot;
    Generated ${escapeHtml(new Date(content.generatedAt || createdAt).toLocaleString())} &middot;
    Analysis ${escapeHtml(analysisId)}
  </div>

  <div class="tiles">
    ${severityRow('Total findings', summary.totalFindings ?? 0, '#171717')}
    ${severityRow('Critical', summary.critical ?? 0, '#dc2626')}
    ${severityRow('High', summary.high ?? 0, '#c2410c')}
    ${severityRow('Medium', summary.medium ?? 0, '#a16207')}
    ${severityRow('Low', summary.low ?? 0, '#64748b')}
    ${severityRow('Quality score', `${summary.qualityScore ?? 100}/100`, '#16a34a')}
  </div>

  <table>
    <thead>
      <tr>
        <th>Finding</th><th>Location</th><th>Severity</th><th>Category</th><th>Source</th><th>Suggested action</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">No findings were recorded for this analysis.</td></tr>'}</tbody>
  </table>

  <footer>Generated by CodePulse &middot; ${escapeHtml(new Date().toLocaleString())}</footer>
</body>
</html>`
  }

  /**
   * Printable report for an analysis. The report snapshot is used when it
   * exists, otherwise one is built from the analysis on the fly.
   */
  router.get('/analysis/:analysisId', async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      const analysis = await db.get('SELECT * FROM analyses WHERE id = ?', [req.params.analysisId])
      if (!analysis) {
        return res.status(404).json({ error: 'Analysis not found' })
      }

      const project = await db.get('SELECT * FROM projects WHERE id = ?', [analysis.projectId])
      if (project && project.userId && project.userId !== userId) {
        return res.status(404).json({ error: 'Analysis not found' })
      }

      const stored = await db.get(
        'SELECT * FROM reports WHERE analysisId = ? ORDER BY createdAt DESC LIMIT 1',
        [analysis.id]
      )

      let content
      if (stored) {
        try {
          content = JSON.parse(stored.content)
        } catch {
          content = null
        }
      }
      if (!content) {
        content = reportService.buildContent(analysis, project)
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Disposition', `inline; filename="codepulse-report-${analysis.id}.html"`)
      res.send(renderHtml(content, analysis.id, analysis.createdAt))
    } catch (error) {
      next(error)
    }
  })

  /**
   * The printable report of a whole project.
   */
  router.get('/project/:projectId', async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null;
      const report = await reportService.projectReport(
        req.params.projectId,
        userId
      );
      if (!report) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const summary = report.summary || {};
      const techStack = report.techStack || {};
      const components = report.components || [];
      const findings = report.findings || [];

      const componentRows = components
        .map(
          (component) => `
        <tr>
          <td>${escapeHtml(component.relativePath || component.name)}</td>
          <td>${escapeHtml((component.languages || []).join(', '))}</td>
          <td>${escapeHtml((component.frameworks || []).join(', '))}</td>
          <td>${escapeHtml((component.facets || []).join(', '))}</td>
        </tr>`
        )
        .join('');

      const stackRows = [
        ["Languages", (techStack.languages || []).join(", ")],
        ["Frameworks", (techStack.frameworks || []).join(", ")],
        ["Databases", (techStack.databases || []).join(", ")],
        ["Infrastructure", (techStack.infrastructure || []).join(", ")],
        ["Package managers", (techStack.packageManagers || []).join(", ")],
        ["CI / CD", (techStack.ciTools || []).join(", ")],
      ]
        .filter(([, value]) => value)
        .map(
          ([label, value]) =>
            `<div><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</div>`
        )
        .join("");

      const historyRows = (report.history || [])
        .map(
          (entry) => `
        <tr>
          <td>${escapeHtml(new Date(entry.createdAt).toLocaleString())}</td>
          <td>${entry.totalFindings}</td>
          <td>${entry.critical}</td>
          <td>${entry.high}</td>
          <td>${entry.medium}</td>
          <td>${entry.low}</td>
        </tr>`
        )
        .join("");

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>CodePulse Project Report - ${escapeHtml(report.project.name)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; color: #171717; background: #fff; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; }
  .sub { color: #71717a; font-size: 13px; margin-bottom: 24px; }
  .tiles { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
  .tile { border: 1px solid #dcdcdf; border-radius: 14px; padding: 14px 18px; min-width: 110px; }
  .tile-value { font-size: 26px; font-weight: 700; line-height: 1; }
  .tile-label { font-size: 12px; color: #71717a; margin-top: 6px; }
  .stack { font-size: 13px; line-height: 1.9; background: #f7f7f8; border: 1px solid #dcdcdf; border-radius: 12px; padding: 14px 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
  th { text-align: left; padding: 9px 10px; background: #f4f4f5; border-bottom: 1px solid #dcdcdf; font-size: 12px; font-weight: 500; color: #52525b; }
  td { padding: 9px 10px; border-bottom: 1px solid #e5e5e7; vertical-align: top; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 5px; color: #fff; font-size: 10.5px; font-weight: 600; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
  footer { margin-top: 30px; font-size: 11px; color: #a1a1aa; }
  @media print { body { padding: 16px; } .tile, tr { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>${escapeHtml(report.project.name)}</h1>
  <div class="sub">
    Project report &middot; generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}
    ${report.project.description ? ` &middot; ${escapeHtml(report.project.description)}` : ""}
  </div>

  <div class="tiles">
    ${severityRow("Total findings", summary.totalFindings ?? 0, "#171717")}
    ${severityRow("Critical", summary.critical ?? 0, "#dc2626")}
    ${severityRow("High", summary.high ?? 0, "#c2410c")}
    ${severityRow("Medium", summary.medium ?? 0, "#a16207")}
    ${severityRow("Low", summary.low ?? 0, "#64748b")}
    ${severityRow("Quality score", `${summary.qualityScore ?? 100}/100`, "#16a34a")}
  </div>

  ${stackRows ? `<h2>Detected stack</h2><div class="stack">${stackRows}</div>` : ""}

  ${
    componentRows
      ? `<h2>Components</h2><table>
    <thead><tr><th>Component</th><th>Languages</th><th>Frameworks</th><th>Layers</th></tr></thead>
    <tbody>${componentRows}</tbody></table>`
      : ""
  }

  <h2>Findings</h2>
  <table>
    <thead><tr><th>Finding</th><th>Location</th><th>Severity</th><th>Category</th><th>Source</th><th>Suggested action</th></tr></thead>
    <tbody>${findingRows(findings) || '<tr><td colspan="6">No findings were recorded for this analysis.</td></tr>'}</tbody>
  </table>

  ${
    historyRows
      ? `<h2>History</h2><table>
    <thead><tr><th>Run</th><th>Findings</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th></tr></thead>
    <tbody>${historyRows}</tbody></table>`
      : ""
  }

  <footer>Generated by CodePulse &middot; ${escapeHtml(new Date().toLocaleString())}</footer>
  <script>window.addEventListener('load', function () { window.print(); });</script>
</body>
</html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="codepulse-project-${report.project.id}.html"`
      );
      res.send(html);
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const userId = (req.user && req.user.userId) || null
      const report = await reportService.getById(req.params.id, userId)
      if (!report) {
        return res.status(404).json({ error: 'Report not found' })
      }

      const content = report.content || {}
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Content-Disposition', `inline; filename="codepulse-report-${report.id}.html"`)
      res.send(renderHtml(content, report.analysisId, report.createdAt))
    } catch (error) {
      next(error)
    }
  })

  return router
}

function severityColor(severity) {
  switch (String(severity || '').toUpperCase()) {
    case 'CRITICAL':
      return '#dc2626'
    case 'HIGH':
      return '#c2410c'
    case 'MEDIUM':
      return '#a16207'
    case 'LOW':
      return '#64748b'
    default:
      return '#71717a'
  }
}
