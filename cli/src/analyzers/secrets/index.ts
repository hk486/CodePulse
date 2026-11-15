import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  Severity,
  Category,
  Confidence,
  Facet,
  FindingValidation,
} from "@codepulse/shared";
import * as path from "path";
import * as fs from "fs";
import { filesFor } from "../../services/fileIndex";
import { languageForFileName } from "../../services/languageDetector";
import { withEvidence } from "../../services/evidence";

interface SecretPattern {
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  confidence: Confidence;
  pattern: RegExp;
  /** Values that are clearly placeholders and should not be reported. */
  placeholder?: RegExp;
  /** Only report the first match per file. */
  once?: boolean;
}

/**
 * Values that look like a secret but are obviously not one.
 */
const PLACEHOLDER = /(?:^|["'])(?:x{3,}|\*{3,}|\.{3,}|changeme|change_me|placeholder|your[_-]?(?:secret|key|token|password)|example|sample|dummy|test|redacted|todo|fixme|none|null|undefined|lorem|abc123|password123|admin123)/i;

/**
 * Known credential formats. These have a fixed shape, so they can be
 * detected with a high degree of certainty.
 */
const SECRET_PATTERNS: SecretPattern[] = [
  {
    ruleId: "SEC-001",
    title: "AWS access key id",
    description:
      "An AWS access key id is hardcoded in the source, so anyone with the repository can use it",
    action: "Remove it and use an IAM role or an environment variable instead",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/,
    once: true,
  },
  {
    ruleId: "SEC-002",
    title: "AWS secret access key",
    description: "An AWS secret access key is stored in the source",
    action: "Rotate the key and load it from the environment",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\baws_?secret_?access_?key\b\s*[:=]\s*["']([A-Za-z0-9/+=]{40})["']/i,
    once: true,
  },
  {
    ruleId: "SEC-003",
    title: "GitHub token",
    description:
      "A GitHub token in the source can be used to push, read private repositories or change settings",
    action: "Revoke the token and use a GitHub secret or an environment variable",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    once: true,
  },
  {
    ruleId: "SEC-004",
    title: "Slack token",
    description: "A Slack token in the source gives access to the workspace",
    action: "Revoke the token and store it in the environment",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/,
    once: true,
  },
  {
    ruleId: "SEC-005",
    title: "Stripe secret key",
    description:
      "A Stripe secret key allows charges and refunds on the account it belongs to",
    action: "Roll the key in the Stripe dashboard and load it from the environment",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}\b/,
    once: true,
  },
  {
    ruleId: "SEC-006",
    title: "OpenAI API key",
    description: "An OpenAI API key in the source can be used to bill the account",
    action: "Revoke the key and load it from the environment",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
    once: true,
  },
  {
    ruleId: "SEC-007",
    title: "Google API key",
    description: "A Google API key in the source can be used against the project quota",
    action: "Restrict the key and load it from the environment",
    severity: Severity.HIGH,
    confidence: Confidence.HIGH,
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/,
    once: true,
  },
  {
    ruleId: "SEC-008",
    title: "Private key",
    description:
      "A private key in the source means anybody with the repository can impersonate the owner",
    action: "Revoke the key pair and load the key from a secret manager",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE KEY-----/,
    once: true,
  },
  {
    ruleId: "SEC-009",
    title: "Database connection string with a password",
    description:
      "A connection string with the password inline exposes the database credentials",
    action: "Build the connection string from environment variables",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^:@\s"']+:([^@\s"']{4,})@/i,
    once: true,
  },
  {
    ruleId: "SEC-010",
    title: "JSON Web Token",
    description:
      "A JWT in the source can usually be replayed until it expires",
    action: "Issue the token at runtime instead of committing it",
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    once: true,
  },
  {
    ruleId: "SEC-011",
    title: "Twilio or SendGrid API key",
    description: "A messaging API key in the source can be used to send messages or mail",
    action: "Rotate the key and load it from the environment",
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
    pattern: /\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|SK[0-9a-fA-F]{32})\b/,
    once: true,
  },
  {
    ruleId: "SEC-012",
    title: "Password or token assigned in the source",
    description:
      "A credential-looking value is assigned directly in the code instead of coming from the environment",
    action: "Read the value from an environment variable or a secret manager",
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
    pattern:
      /\b(password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["']([^"'\s${}]{8,})["']/i,
    placeholder: PLACEHOLDER,
    once: true,
  },
  {
    ruleId: "SEC-013",
    title: "Basic auth credentials in a URL",
    description: "Credentials in a URL end up in logs and browser history",
    action: "Remove the credentials and use a token header instead",
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
    pattern: /\bhttps?:\/\/[^:@\s/"']+:([^@\s/"']{6,})@/i,
    placeholder: PLACEHOLDER,
    once: true,
  },
];

/**
 * Secret scanner.
 *
 * It looks at every text file in the project, not just source files, because
 * credentials hide in configuration, CI workflows and Docker files.
 */
export class SecretScanner implements LanguageAnalyzer {
  readonly id = "secret-scanner-v1";
  readonly language = "secrets";
  readonly displayName = "Secret Scanner";
  readonly facet = Facet.SECRETS;
  readonly version = "1.0.0";

  supports(_context: ProjectContext): boolean {
    return true
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = []

    // Every file is a candidate, so the shared index is used directly
    const entries = context.files
      ? context.files.map(entry => ({
          path: entry.path,
          absolutePath: entry.absolutePath,
          extension: entry.extension,
          size: entry.size,
        }))
      : await filesFor(context, [], context.projectPath);

    for (const entry of entries) {
      const file = entry.path;

      // Skip the lock files and other known generated content
      if (/\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tgz|jar|class|so|dll|exe|bin|woff2?|ttf|eot|mp4|mov)$/i.test(file)) {
        continue
      }

      let content: string
      try {
        // Lock files and generated bundles are skipped, they are full of
        // hashes that look like secrets.
        if (/\.(lock|min\.js|map)$/.test(file)) continue
        if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock)$/.test(file)) {
          continue
        }
        content = fs.readFileSync(entry.absolutePath, "utf-8")
      } catch {
        continue
      }

      // Binary or not text
      if (content.includes("\u0000")) continue

      const lines = content.split("\n")
      const reported = new Set<string>()

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.trim().length === 0) continue

        for (const secret of SECRET_PATTERNS) {
          if (reported.has(secret.ruleId)) continue
          if (!secret.pattern.test(line)) continue

          // Check the value against the placeholder list
          const match = line.match(secret.pattern)
          const value = match ? match[match.length - 1] : ""
          if (secret.placeholder && secret.placeholder.test(value)) continue
          // A value that references the environment is not a secret
          if (/process\.env|os\.environ|getenv|System\.getenv|\$\{?env/i.test(line)) {
            continue
          }

          reported.add(secret.ruleId)
          findings.push(
            withEvidence(
              {
                id: `secret-${secret.ruleId}-${i + 1}-${file}`,
                ruleId: secret.ruleId,
                language: languageForFileName(file),
                category: Category.SECURITY,
                severity: secret.severity,
                confidence: secret.confidence,
                title: secret.title,
                description: secret.description,
                suggestedAction: secret.action,
                location: {
                  filePath: file,
                  startLine: i + 1,
                  endLine: i + 1,
                },
                tool: this.displayName,
                toolRuleId: secret.ruleId,
                // The credential itself is not written down. The report
                // says where it is, not what it is.
                snippet: redactSecret(line),
                validation: FindingValidation.CONFIRMED,
              },
              { lines: undefined }
            )
          );
        }
      }
    }

    return findings
  }
}

/**
 * Take the secret out of a line of code.
 *
 * A report about a credential must not repeat the credential, because
 * the report is written to a database, sent to a browser and often
 * emailed. The line stays, so the place is still obvious, but the part
 * that is the secret is replaced.
 */
export function redactSecret(line: string): string {
  const text = String(line || "");
  // A quoted value is the usual shape of a credential.
  const redacted = text
    .replace(/(['"])([^'"]{8,})\1/g, '$1[redacted]$1')
    .replace(/[A-Za-z0-9_-]{16,}/g, '[redacted]');
  return redacted.slice(0, 240);
}
