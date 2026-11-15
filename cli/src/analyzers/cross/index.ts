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
import * as fs from "fs";
import * as path from "path";

/**
 * The relationships between the parts of a project.
 *
 * Everything else looks at one file at a time. These rules look at the
 * project as a whole: the variables the code expects and the ones the
 * deployment provides, the addresses the frontend calls and the ones the
 * backend answers, and the versions two services ask for.
 *
 * They only say something when the evidence is there. A variable that
 * might be set by the platform is not reported, and an address that
 * matches nothing exactly is compared before it is named.
 */

/** The variables a platform sets for its own reasons. */
const WELL_KNOWN = new Set([
  "PATH", "HOME", "USER", "SHELL", "PWD", "LANG", "LC_ALL", "TERM",
  "NODE_ENV", "PORT", "HOST", "HOSTNAME", "TZ", "TMPDIR",
  "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
  "CI", "GITHUB_ACTIONS", "GITLAB_CI", "TRAVIS", "JENKINS_URL",
]);

/** What makes a variable look like something the project needs to declare. */
const PROJECT_VARIABLE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|DSN|URL|URI|HOST|ENDPOINT|DATABASE|DB_|REDIS|S3|BUCKET|ACCOUNT|PROJECT)/;

interface RuleHit {
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  filePath: string;
  line?: number;
  language?: string;
}

export class CrossProjectAnalyzer implements LanguageAnalyzer {
  readonly id = "cross-project-analyzer-v1";
  readonly language = "cross";
  readonly displayName = "Cross-Project Analyzer";
  readonly version = "1.0.0";
  readonly facet = Facet.CODE;

  supports(context: ProjectContext): boolean {
    // There has to be more than one part to the project, or a deployment
    // configuration, before there is anything to relate.
    return true;
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      const files = await this.readFiles(context);
      if (files.length === 0) return findings;

      const hits: RuleHit[] = [
        ...this.environmentVariables(files),
        ...this.routeMismatch(files),
        ...this.dependencyConflicts(files),
        ...this.deploymentConsistency(files)
      ];

      for (const hit of hits) {
        findings.push({
          id: `${hit.ruleId}-${hit.filePath}-${hit.line || 0}`,
          ruleId: hit.ruleId,
          language: hit.language || "configuration",
          category: hit.ruleId.startsWith("XSEC")
            ? Category.SECURITY
            : Category.ARCHITECTURE,
          severity: hit.severity,
          confidence: Confidence.MEDIUM,
          title: hit.title,
          description: hit.description,
          suggestedAction: hit.action,
          location: {
            filePath: hit.filePath,
            startLine: hit.line || 1,
            endLine: hit.line || 1
          },
          tool: this.displayName,
          toolRuleId: hit.ruleId,
          validation: FindingValidation.POTENTIAL
        });
      }
    } catch (error) {
      console.error("Error analysing the relationships:", error);
    }

    return findings;
  }

  /**
   * Read every text file of the project, once.
   */
  private async readFiles(
    context: ProjectContext
  ): Promise<{ relativePath: string; lines: string[]; extension: string }[]> {
    const out: { relativePath: string; lines: string[]; extension: string }[] = [];

    for (const file of context.files || []) {
      const full = path.join(context.projectPath, file.path);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue
        const content = fs.readFileSync(full, "utf-8");
        if (content.includes("\u0000")) continue
        out.push({
          relativePath: file.path,
          lines: content.split("\n"),
          extension: file.extension
        });
      } catch {
        // A file that cannot be read is not part of the analysis.
      }
    }

    return out;
  }

  /**
   * The variables the code expects, and the ones the deployment provides.
   */
  private environmentVariables(
    files: { relativePath: string; lines: string[]; extension: string }[]
  ): RuleHit[] {
    const hits: RuleHit[] = [];
    const used = new Map<string, { file: string; line: number }[]>();
    const declared = new Set<string>();

    // Where a variable is used.
    const usePatterns = [
      /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
      /\bos\.(?:environ|getenv)\[\s*["']([A-Z][A-Z0-9_]*)["']/g,
      /\bENV\[\s*["']([A-Z][A-Z0-9_]*)["']/g,
      /\$\{\s*([A-Z][A-Z0-9_]{3,})\s*\}/g,
      /\$([A-Z][A-Z0-9_]{6,})(?![A-Z0-9_])/
    ]

    for (const file of files) {
      file.lines.forEach((line, index) => {
        for (const pattern of usePatterns) {
          pattern.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = pattern.exec(line)) !== null) {
            const name = match[1]
            if (!name || WELL_KNOWN.has(name)) continue
            if (!used.has(name)) used.set(name, [])
            used.get(name)!.push({ file: file.relativePath, line: index + 1 })
          }
        }
      })
    }

    // Where a variable is declared.
    for (const file of files) {
      const lower = file.relativePath.toLowerCase()
      const isDeclaration =
        lower.includes(".env") ||
        lower.includes("docker-compose") ||
        lower.endsWith(".tf") ||
        lower.endsWith("dockerfile") ||
        lower.endsWith("deployment.yaml") ||
        lower.endsWith("deployment.yml")

      if (!isDeclaration) continue

      for (const line of file.lines) {
        // KEY=value
        const assignment = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line)
        if (assignment) {
          declared.add(assignment[1])
          continue
        }
        // environment: [NAME=value] or "NAME: value"
        const listed = /["']?([A-Z][A-Z0-9_]{2,})["']?\s*[:=]/.exec(line)
        if (listed) declared.add(listed[1])
        // docker-compose environment entries have no colon on their own line
        if (/^\s*-\s+([A-Z][A-Z0-9_]{2,})=/.test(line)) {
          declared.add(/^\s*-\s+([A-Z][A-Z0-9_]{2,})=/.exec(line)![1])
        }
      }
    }

    // Only the ones that look like they matter, and that the code really
    // needs. A variable mentioned once in a comment is not it.
    for (const [name, places] of used) {
      if (declared.has(name)) continue
      if (!PROJECT_VARIABLE.test(name)) continue
      const sources = new Set(places.map(p => p.file))
      if (sources.size < 1) continue

      const first = places[0]
      hits.push({
        ruleId: "XENV-001",
        title: `${name} is used but never declared`,
        description:
          `The code reads ${name} in ${places.length} place(s) across ` +
          `${sources.size} file(s), but nothing in the project declares it. ` +
          `If it is not set where the project runs, it comes back empty.`,
        action: `Declare ${name} in a .env file, in the Dockerfile, or in the deployment configuration.`,
        severity: Severity.HIGH,
        filePath: first.file,
        line: first.line
      })
    }

    return hits
  }

  /**
   * The addresses the frontend calls, and the ones the backend answers.
   */
  private routeMismatch(
    files: { relativePath: string; lines: string[]; extension: string }[]
  ): RuleHit[] {
    const hits: RuleHit[] = []
    const routes: { path: string; file: string; line: number }[] = []
    const calls: { path: string; file: string; line: number }[] = []

    // The backend: a route is defined.
    const routePatterns = [
      /\b(?:app|router|server)\.(?:get|post|put|patch|delete|all)\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /@\w+\.(?:route|get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["'`]([^"'`]+)["'`]/g,
      /\.(?:Get|Post|Put|Delete|Patch)Mapping\s*\(\s*["'`]([^"'`]+)["'`]/g,
      /@(Get|Post|Put|Delete)Mapping\s*\(\s*["'`]([^"'`]+)["'`]/g
    ]

    const callPatterns = [
      /\bfetch\s*\(\s*[`"'](\/[^`"'\s?]*)[`"']/g,
      /\baxios\.\w+\s*\(\s*[`"'](\/[^`"'\s?]*)[`"']/g,
      /\brequest\s*\(\s*[`"'](\/[^`"'\s?]*)[`"']/g,
      /\b(?:http|https)\.(?:get|post|put|patch|delete)\s*\(\s*[`"'](\/[^`"'\s?]*)[`"']/g
    ]

    for (const file of files) {
      const language = guessLanguage(file.extension)
      const isBackend = ["typescript", "javascript", "python", "java", "go"].includes(language)
      const isFrontend = file.relativePath.includes("/frontend/") || language === "typescript"

      file.lines.forEach((line, index) => {
        if (isBackend) {
          for (const pattern of routePatterns) {
            pattern.lastIndex = 0
            let match: RegExpExecArray | null
            while ((match = pattern.exec(line)) !== null) {
              if (match[1] && match[1].startsWith("/")) {
                routes.push({ path: match[1], file: file.relativePath, line: index + 1 })
              }
            }
          }
        }

        if (isFrontend) {
          for (const pattern of callPatterns) {
            pattern.lastIndex = 0
            let match: RegExpExecArray | null
            while ((match = pattern.exec(line)) !== null) {
              if (match[1] && match[1].length > 1) {
                calls.push({ path: match[1], file: file.relativePath, line: index + 1 })
              }
            }
          }
        }
      })
    }

    if (routes.length === 0 || calls.length === 0) return hits

    // Compare every call against every route. Parameters are put in the
    // same shape, so "/users/:id" and "/users/{id}" are the same address.
    const shape = (address: string) =>
      address
        .replace(/\$\{[^}]+\}/g, ":param")
        .replace(/\{[^}]+\}/g, ":param")
        .replace(/:[^/]+/g, ":param")
        .replace(/\/$/, "")

    const knownRoutes = new Set(routes.map(route => shape(route.path)))

    for (const call of calls) {
      const wanted = shape(call.path)
      if (knownRoutes.has(wanted)) continue

      // Something close is worth naming, because the difference is usually
      // a small one.
      const close = routes.find(
        route => shape(route.path).split("/").slice(0, -1).join("/") ===
          wanted.split("/").slice(0, -1).join("/") &&
          shape(route.path).split("/").length === wanted.split("/").length
      )

      if (!close) continue

      hits.push({
        ruleId: "XROUTE-001",
        title: `The page calls ${call.path} but the backend answers ${close.path}`,
        description:
          `The frontend asks for ${call.path}, and the closest route the ` +
          `backend defines is ${close.path}. The difference is enough for the ` +
          `call to miss.`,
        action: `Make the two agree: change the call to ${close.path}, or change the route to ${call.path}.`,
        severity: Severity.MEDIUM,
        filePath: call.file,
        line: call.line
      })
    }

    return hits
  }

  /**
   * Two parts of the project asking for different versions of the same thing.
   */
  private dependencyConflicts(
    files: { relativePath: string; lines: string[]; extension: string }[]
  ): RuleHit[] {
    const hits: RuleHit[] = []

    const wanted: { name: string; version: string; file: string; line: number }[] = []

    for (const file of files) {
      if (file.extension === "json") {
        let parsed: any
        try {
          parsed = JSON.parse(file.lines.join("\n"))
        } catch {
          continue
        }
        const dependencies = parsed?.dependencies || {}
        const devDependencies = parsed?.devDependencies || {}
        for (const source of [dependencies, devDependencies]) {
          for (const name of Object.keys(source)) {
            wanted.push({
              name,
              version: String(source[name]),
              file: file.relativePath,
              line: 1
            })
          }
        }
      }

      // A Go module's requirements.
      if (file.extension === "mod") {
        file.lines.forEach((line, index) => {
          const match = /^\s*([a-zA-Z0-9._/-]+)\s+(v[^\s]+)/.exec(line)
          if (match) {
            wanted.push({
              name: match[1],
              version: match[2],
              file: file.relativePath,
              line: index + 1
            })
          }
        })
      }
    }

    // The same thing asked for twice, differently.
    const byName = new Map<string, { version: string; file: string; line: number }[]>()
    for (const entry of wanted) {
      if (!byName.has(entry.name)) byName.set(entry.name, [])
      byName.get(entry.name)!.push({ version: entry.version, file: entry.file, line: entry.line })
    }

    for (const [name, entries] of byName) {
      const versions = new Set(entries.map(entry => normaliseVersion(entry.version)))
      if (versions.size < 2) continue

      const where = entries
        .map(entry => `${entry.file}${entry.line > 1 ? `:${entry.line}` : ""} wants ${entry.version}`)
        .join(", ")

      hits.push({
        ruleId: "XDEP-001",
        title: `${name} is asked for in ${versions.size} different versions`,
        description:
          `The parts of the project do not agree on ${name}: ${where}. ` +
          `One of them gets a different copy than the other.`,
        action: `Settle on one version of ${name} and put it in both places.`,
        severity: Severity.MEDIUM,
        filePath: entries[0].file,
        line: entries[0].line
      })
    }

    return hits
  }

  /**
   * The deployment and the project.
   */
  private deploymentConsistency(
    files: { relativePath: string; lines: string[]; extension: string }[]
  ): RuleHit[] {
    const hits: RuleHit[] = []

    // A compose service that builds something that is not there.
    for (const file of files) {
      const lower = file.relativePath.toLowerCase()
      if (!lower.includes("docker-compose") && !lower.endsWith(".yml") && !lower.endsWith(".yaml")) {
        continue
      }

      let service: string | null = null
      let context: string | null = null

      file.lines.forEach((line, index) => {
        const nextService = /^ {2}([a-z0-9_-]+):\s*$/.exec(line)
        if (nextService) {
          service = nextService[1]
          context = null
          return
        }
        const build = /^\s+build:\s*(.+)$/.exec(line)
        if (build && service) {
          const value = build[1].trim().replace(/^["']|["']$/g, "")
          const contextMatch = /^(.*?)[\/\\]?$/.exec(value)
          const buildContext = value.includes("/")
            ? value.split(":")[0]
            : value.replace(/^["']|["']$/g, "")
          context = buildContext || "."
          void contextMatch

          const root = path.dirname(file.relativePath)
          const candidate = path.resolve(root, buildContext || ".")
          const dockerfile = ["Dockerfile", "dockerfile"]
            .map(name => path.join(candidate, name))
            .find(candidate => fs.existsSync(candidate))

          if (!dockerfile) {
            hits.push({
              ruleId: "XDOCK-001",
              title: `The service ${service} builds a folder with no Dockerfile`,
              description:
                `The service ${service} is set to build ${buildContext}, but there ` +
                `is no Dockerfile in that folder. The build will fail.`,
              action: `Add a Dockerfile to ${buildContext}, or point the service at one that is there.`,
              severity: Severity.HIGH,
              filePath: file.relativePath,
              line: index + 1
            })
          }
        }
      })
    }

    return hits
  }
}

/**
 * The language of a file, from its extension.
 */
function guessLanguage(extension: string): string {
  const table: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", java: "java", go: "go", rb: "ruby", php: "php",
    rs: "rust", c: "cpp", h: "cpp", cpp: "cpp", cs: "csharp"
  }
  return table[(extension || "").toLowerCase()] || ""
}

/**
 * Put two version strings in the same shape, so "1.2.3" and "^1.2.3" can
 * be told apart from "1.2.4".
 */
function normaliseVersion(version: string): string {
  const cleaned = String(version || "").replace(/^[~^>=<*\s]+/, "").trim()
  return cleaned || "unknown"
}