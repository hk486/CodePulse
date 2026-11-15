/**
 * Finding fingerprints.
 *
 * Every finding carries a fingerprint: a name worked out from the rule,
 * the place and the code. The same problem has the same fingerprint in
 * every run, which is what makes it possible to tell a new finding from
 * an old one, and to notice when two rules found the same thing.
 */

/**
 * Remove the findings that are the same problem twice.
 *
 * Two rules can find the same thing — a command built from a request is
 * both a command injection and an unsafe concatenation. The report says
 * it once, and says which rules found it.
 *
 * @param {Array<object>} findings
 * @returns {{ findings: Array<object>, removed: number }}
 */
export function deduplicateFindings(findings) {
  const byFingerprint = new Map();
  const order = [];

  for (const finding of findings) {
    const key = finding.fingerprint || legacyKey(finding);

    const existing = byFingerprint.get(key);
    if (!existing) {
      byFingerprint.set(key, { ...finding, fingerprint: key });
      order.push(key);
      continue;
    }

    // The same problem found twice. The rule that found it first stays,
    // and the other is named so nothing is hidden.
    const rules = new Set(
      [existing.toolRuleId, finding.toolRuleId].filter(Boolean)
    );
    const named = Array.from(rules).join(', ')
    existing.toolRuleId = named
    if (!existing.alsoFoundBy) existing.alsoFoundBy = []
    for (const rule of rules) {
      if (rule !== named && !existing.alsoFoundBy.includes(rule)) {
        existing.alsoFoundBy.push(rule)
      }
    }
  }

  return {
    findings: order.map(key => byFingerprint.get(key)),
    removed: findings.length - order.length,
  }
}

/**
 * Mark the findings that were not in the previous run.
 *
 * This is what makes "what is new" answerable, which is the question a
 * person asks when they look at a report.
 *
 * @param {Array<object>} findings
 * @param {Array<object>} previousFindings
 * @returns {Array<object>}
 */
export function markNewFindings(findings, previousFindings) {
  if (!previousFindings || previousFindings.length === 0) {
    // With nothing to compare against, everything is new. That is the
    // honest answer for the first run.
    return findings.map(finding => ({ ...finding, isNew: true }))
  }

  const previous = new Set(
    previousFindings.map(finding => finding.fingerprint || legacyKey(finding))
  )

  return findings.map(finding => ({
    ...finding,
    isNew: !previous.has(finding.fingerprint || legacyKey(finding)),
  }))
}

/**
 * A name for a finding that has no fingerprint yet.
 *
 * The findings from before fingerprints existed still need to be compared
 * with each other, so they are matched on what they have.
 *
 * @param {object} finding
 * @returns {string}
 */
function legacyKey(finding) {
  return [
    finding.ruleId || 'unknown',
    (finding.location?.filePath || '').replace(/\\/g, '/'),
    finding.location?.startLine || 0,
    (finding.snippet || '').replace(/\s+/g, ' ').trim(),
  ].join('|')
}
