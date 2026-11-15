import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import * as glob from "glob";
import * as path from "path";
import * as fs from "fs";
import { languageForFileName } from "../../services/languageDetector";

interface Dependency {
  name: string;
  version: string;
  line: number;
  dev: boolean;
}

/**
 * Dependency analyzer.
 *
 * Parses the dependency manifests of the project and reports the things that
 * quietly make a build unreproducible or a release risky.
 */
export class DependencyAnalyzer implements LanguageAnalyzer {
  readonly id = "dependency-analyzer-v1";
  /** The manifests this analyzer reads. */
  readonly supportedExtensions = [
    "json",
    "toml",
    "xml",
    "gradle",
    "txt",
    "mod",
    "lock",
    "sum",
  ];
  readonly language = "dependencies";
  readonly displayName = "Dependency Analyzer";
  readonly facet = Facet.DEPENDENCIES;
  readonly version = "1.0.0";

  supports(_context: ProjectContext): boolean {
    return true;
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    findings.push(...this.analyzePackageJson(context));
    findings.push(...this.analyzeRequirements(context));
    findings.push(...this.analyzeGoMod(context));
    findings.push(...this.analyzeCargo(context));
    findings.push(...this.analyzePom(context));

    return findings;
  }

  /**
   * package.json
   */
  private analyzePackageJson(context: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    const file = "package.json";
    let content: string;
    try {
      content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
    } catch {
      return findings;
    }

    let manifest: any;
    try {
      manifest = JSON.parse(content);
    } catch {
      findings.push(
        this.finding(
          "DEP-001",
          "package.json is not valid JSON",
          "A broken manifest stops the build and hides the real error",
          "Fix the JSON syntax",
          Severity.HIGH,
          Category.MAINTAINABILITY,
          Confidence.HIGH,
          file,
          1
        )
      );
      return findings;
    }

    const dependencies = this.collect(manifest.dependencies, false);
    const devDependencies = this.collect(manifest.devDependencies, true);
    const all = [...dependencies, ...devDependencies];

    // Duplicated in both lists
    const names = new Set(dependencies.map(d => d.name));
    for (const dev of devDependencies) {
      if (names.has(dev.name)) {
        findings.push(
          this.finding(
            "DEP-002",
            `"${dev.name}" is in dependencies and devDependencies`,
            "npm uses whichever it finds first, so the production install is not what you think it is",
            "Keep the dependency in one list only",
            Severity.MEDIUM,
            Category.DEPENDENCY,
            Confidence.HIGH,
            file,
            dev.line
          )
        );
      }
    }

    findings.push(...this.checkPinning(all, file));

    // A missing lock file
    if (!fs.existsSync(path.join(context.projectPath, "package-lock.json")) &&
        !fs.existsSync(path.join(context.projectPath, "yarn.lock")) &&
        !fs.existsSync(path.join(context.projectPath, "pnpm-lock.yaml"))) {
      findings.push(
        this.finding(
          "DEP-010",
          "No lock file",
          "Without a lock file the exact versions are resolved on every install, so two installs can differ",
          "Commit the lock file for your package manager",
          Severity.MEDIUM,
          Category.DEPENDENCY,
          Confidence.MEDIUM,
          file,
          1
        )
      );
    }

    return findings;
  }

  /**
   * requirements.txt
   */
  private analyzeRequirements(context: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    const file = "requirements.txt";
    let content: string;
    try {
      content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
    } catch {
      return findings;
    }

    const dependencies: Dependency[] = []
    content.split("\n").forEach((line, index) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) return
      const match = trimmed.match(/^([A-Za-z0-9._-]+)\s*([=<>!~].*)?$/)
      if (!match) return
      dependencies.push({
        name: match[1],
        version: (match[2] || "").trim(),
        line: index + 1,
        dev: false,
      })
    })

    findings.push(...this.checkPinning(dependencies, file))
    return findings
  }

  /**
   * go.mod
   */
  private analyzeGoMod(context: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    const file = "go.mod";
    let content: string;
    try {
      content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
    } catch {
      return findings;
    }

    const dependencies: Dependency[] = []
    const lines = content.split("\n")
    let inBlock = false

    lines.forEach((line, index) => {
      if (/^require\s*\($/.test(line.trim())) {
        inBlock = true
        return
      }
      if (inBlock && /^\)/.test(line.trim())) {
        inBlock = false
        return
      }

      const single = line.match(/^\s*require\s+(\S+)\s+(\S+)/)
      const inRequireBlock = inBlock ? line.match(/^\s+(\S+)\s+(\S+)/) : null
      const match = single || inRequireBlock
      if (!match) return

      // A replace directive pointing at a local path is fine
      if (/=>|replace/i.test(line)) return

      dependencies.push({
        name: match[1],
        version: match[2],
        line: index + 1,
        dev: false,
      })
    })

    // Pseudo versions point at an untagged commit
    for (const dependency of dependencies) {
      if (/v0\.0\.0-\d{14}-[0-9a-f]{12}/.test(dependency.version)) {
        findings.push(
          this.finding(
            "DEP-020",
            `"${dependency.name}" is pinned to a pseudo version`,
            "A pseudo version points at an untagged commit, so the module cannot be fetched again reliably",
            "Tag the commit and depend on the tagged version",
            Severity.MEDIUM,
            Category.DEPENDENCY,
            Confidence.HIGH,
            file,
            dependency.line
          )
        )
      }
    }

    if (!fs.existsSync(path.join(context.projectPath, "go.sum"))) {
      findings.push(
        this.finding(
          "DEP-021",
          "No go.sum",
          "Without go.sum the module checksums are not verified",
          "Run go mod tidy and commit go.sum",
          Severity.MEDIUM,
          Category.DEPENDENCY,
          Confidence.MEDIUM,
          file,
          1
        )
      );
    }

    return findings;
  }

  /**
   * Cargo.toml
   */
  private analyzeCargo(context: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    const file = "Cargo.toml";
    let content: string;
    try {
      content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
    } catch {
      return findings;
    }

    const dependencies: Dependency[] = []
    const lines = content.split("\n")
    let inSection = ""

    lines.forEach((line, index) => {
      const section = line.match(/^\s*\[(dependencies|dev-dependencies|build-dependencies)\]/i)
      if (section) {
        inSection = section[1].toLowerCase()
        return
      }
      if (/^\s*\[/.test(line)) {
        inSection = ""
        return
      }
      if (!inSection) return

      const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")/)
      if (!match) return

      dependencies.push({
        name: match[1],
        version: match[2] || match[3] || "",
        line: index + 1,
        dev: inSection === "dev-dependencies",
      })
    })

    findings.push(...this.checkPinning(dependencies, file))
    return findings;
  }

  /**
   * pom.xml
   */
  private analyzePom(context: ProjectContext): Finding[] {
    const findings: Finding[] = [];
    const file = "pom.xml";
    let content: string;
    try {
      content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
    } catch {
      return findings;
    }

    const dependencies: Dependency[] = []
    const lines = content.split("\n")
    let inDependency = false

    lines.forEach((line, index) => {
      if (/<dependency>/.test(line)) {
        inDependency = true
        return
      }
      if (!inDependency) return

      const artifact = line.match(/<artifactId>\s*([^<]+)\s*<\/artifactId>/)
      const version = line.match(/<version>\s*([^<]+)\s*<\/version>/)
      if (artifact) {
        dependencies.push({
          name: artifact[1],
          version: version ? version[1] : "",
          line: index + 1,
          dev: false,
        })
      }
      if (/<\/dependency>/.test(line)) inDependency = false;
    })

    // A version range instead of a fixed version
    for (const dependency of dependencies) {
      if (/[\[\]()]|LATEST|RELEASE/i.test(dependency.version)) {
        findings.push(
          this.finding(
            "DEP-030",
            `"${dependency.name}" uses a version range`,
            "A version range makes the build non reproducible because the resolved version can change",
            "Pin the dependency to a fixed version",
            Severity.MEDIUM,
            Category.DEPENDENCY,
            Confidence.HIGH,
            file,
            dependency.line
          )
        );
      }
    }

    return findings;
  }

  /**
   * The rules that apply to every manifest.
   */
  private checkPinning(dependencies: Dependency[], file: string): Finding[] {
    const findings: Finding[] = []
    const seen = new Set<string>()

    for (const dependency of dependencies) {
      // The same package can appear in both the runtime and the dev list
      if (seen.has(dependency.name)) continue
      seen.add(dependency.name)

      const version = dependency.version

      // No version at all
      if (!version) continue

      // A floating version
      if (version === "*" || version === "latest" || version === "") {
        findings.push(
          this.finding(
            "DEP-001",
            `"${dependency.name}" has no fixed version`,
            "A floating version resolves to a different release on every install, so the build is not reproducible",
            "Pin the dependency to a specific version",
            Severity.MEDIUM,
            Category.DEPENDENCY,
            Confidence.HIGH,
            file,
            dependency.line
          )
        );
        continue;
      }

      // A caret or tilde range
      if (/^[\^~]/.test(version) || /^\d+\.\d+\.\d+/.test(version) === false && /[\d]\.[\d]/.test(version)) {
        if (!/^[><=]/.test(version) && !/^v?\d+\.\d+\.\d+/.test(version)) {
          findings.push(
            this.finding(
              "DEP-003",
              `"${dependency.name}" is not pinned to an exact version`,
              "A range allows a newer release to be picked up, which can change the behaviour without a code change",
              "Pin the dependency to an exact version",
              Severity.LOW,
              Category.DEPENDENCY,
              Confidence.MEDIUM,
              file,
              dependency.line
            )
          );
        }
      }
    }

    return findings;
  }

  private collect(
    record: Record<string, string> | undefined,
    dev: boolean
  ): Dependency[] {
    if (!record) return []
    return Object.entries(record).map(([name, version]) => ({
      name,
      version: String(version),
      line: 0,
      dev,
    }))
  }

  private finding(
    ruleId: string,
    title: string,
    description: string,
    action: string,
    severity: Severity,
    category: Category,
    confidence: Confidence,
    file: string,
    line: number
  ): Finding {
    return {
      id: `dep-${ruleId}-${file}-${line}-${title}`,
      ruleId,
      language: languageForFileName(file),
      category,
      severity,
      confidence,
      title,
      description,
      suggestedAction: action,
      location: {
        filePath: file,
        startLine: line,
        endLine: line,
      },
      tool: this.displayName,
      toolRuleId: ruleId,
    };
  }
}
