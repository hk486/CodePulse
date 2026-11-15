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
import * as path from "path";
import * as fs from "fs";
import yaml, { YAMLException } from "js-yaml";
import { filesFor, filesMatching } from "../../services/fileIndex";
import { languageForFileName } from "../../services/languageDetector";
import { redactSnippet } from "../../services/evidence";

/**
 * Infrastructure analyzer.
 *
 * Dockerfiles, Terraform, Kubernetes manifests and CI pipelines are part of
 * the product, so they get the same treatment as the application code.
 */
export class InfraAnalyzer implements LanguageAnalyzer {
  readonly id = "infra-analyzer-v1";
  /** The files this analyzer reads. */
  readonly supportedExtensions = ["tf", "yaml", "yml", "json", "dockerfile"];
  /** The languages it covers. */
  readonly covers = ["docker", "docker-compose", "terraform", "kubernetes", "yaml", "ci", "json"];
  readonly language = "infra";
  readonly displayName = "Infrastructure Analyzer";
  readonly facet = Facet.INFRA;
  readonly version = "1.0.0";

  supports(_context: ProjectContext): boolean {
    return true;
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    findings.push(...await this.analyzeDockerfiles(context));
    findings.push(...await this.analyzeDockerCompose(context));
    findings.push(...await this.analyzeTerraform(context));
    findings.push(...await this.analyzeKubernetes(context));
    findings.push(...await this.analyzeCi(context));

    return findings;
  }

  private async analyzeDockerCompose(
    context: ProjectContext
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const entries = await filesMatching(
      context,
      entry => /^(docker-)?compose(?:[.-].+)?\.ya?ml$/i.test(path.basename(entry.path)),
      context.projectPath
    );

    for (const entry of entries) {
      let content: string;
      try {
        content = fs.readFileSync(entry.absolutePath, "utf-8");
      } catch {
        continue;
      }

      let document: unknown;
      try {
        document = yaml.load(content);
      } catch (error) {
        if (!(error instanceof YAMLException)) throw error;
        const line = Math.min(
          content.split(/\r?\n/).length,
          (error.mark?.line ?? 0) + 1
        );
        const finding = this.finding(
          "INFRA-054",
          "Invalid Docker Compose YAML",
          "The Compose file contains invalid YAML and could not be analyzed.",
          "Fix the YAML syntax error before deploying this Compose project",
          Severity.HIGH,
          Category.SYNTAX_ERROR,
          Confidence.HIGH,
          entry.path,
          line
        );
        finding.snippet = redactSnippet(content.split(/\r?\n/)[line - 1] || "");
        findings.push(finding);
        continue;
      }

      const root = asRecord(document);
      const services = asRecord(root?.services);
      if (!services) continue;

      const lines = content.split(/\r?\n/);
      for (const [name, rawService] of Object.entries(services)) {
        const service = asRecord(rawService);
        if (!service) continue;

        const image = typeof service.image === "string" ? service.image : "";
        if (image && !hasPinnedImage(image)) {
          findings.push(
            this.finding(
              "INFRA-050",
              "Compose image is not pinned",
              `Service "${name}" uses "${image}", which can resolve to a different image on a later deployment`,
              "Pin the image to a version tag or immutable digest",
              Severity.MEDIUM,
              Category.MAINTAINABILITY,
              Confidence.HIGH,
              entry.path,
              composePropertyLine(lines, name, "image")
            )
          );
        }

        if (isEnabled(service.privileged)) {
          findings.push(
            this.finding(
              "INFRA-051",
              "Privileged Compose service",
              `Service "${name}" runs with privileged host access, weakening container isolation`,
              "Remove privileged mode and grant only the capabilities the service needs",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              entry.path,
              composePropertyLine(lines, name, "privileged")
            )
          );
        }

        if (String(service.network_mode || "").toLowerCase() === "host") {
          findings.push(
            this.finding(
              "INFRA-052",
              "Compose service uses host networking",
              `Service "${name}" shares the host network namespace and bypasses network isolation`,
              "Use a dedicated Compose network and publish only required ports",
              Severity.HIGH,
              Category.SECURITY,
              Confidence.HIGH,
              entry.path,
              composePropertyLine(lines, name, "network_mode")
            )
          );
        }

        if (isRootUser(service.user)) {
          findings.push(
            this.finding(
              "INFRA-053",
              "Compose service runs as root",
              `Service "${name}" explicitly runs as root inside the container`,
              "Set user to a dedicated non-root account",
              Severity.HIGH,
              Category.SECURITY,
              Confidence.HIGH,
              entry.path,
              composePropertyLine(lines, name, "user")
            )
          );
        }

        if (mountsDockerSocket(service.volumes)) {
          findings.push(
            this.finding(
              "INFRA-055",
              "Docker socket mounted into Compose service",
              `Service "${name}" can control the Docker daemon through its socket mount`,
              "Remove the Docker socket mount or replace it with a narrowly scoped interface",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              entry.path,
              composePropertyLine(lines, name, "volumes")
            )
          );
        }
      }
    }

    return findings;
  }

  private async analyzeDockerfiles(
    context: ProjectContext
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const entries = await filesMatching(
      context,
      (entry) => {
        const base = path.basename(entry.path).toLowerCase();
        return (
          base === "dockerfile" ||
          base === "containerfile" ||
          base.endsWith(".dockerfile")
        );
      },
      context.projectPath
    );
    const files = entries.map(entry => entry.path);

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      const hasUser = lines.some(line => /^\s*USER\s+/i.test(line));
      const hasHealthcheck = /^\s*HEALTHCHECK\s/im.test(content);

      lines.forEach((line, index) => {
        const number = index + 1;

        // Running as root
        if (/^\s*USER\s+root\s*$/i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-001",
              "Container runs as root",
              "A process that runs as root inside the container can escape it if it is compromised",
              "Create a dedicated user and switch to it with USER",
              Severity.HIGH,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        // An unpinned base image
        const from = line.match(/^\s*FROM\s+(\S+)/i);
        if (from) {
          const image = from[1];
          const isLatest = /:latest$/i.test(image) || !image.includes(":");
          if (isLatest && !image.includes("@sha256")) {
            findings.push(
              this.finding(
                "INFRA-002",
                "Base image is not pinned",
                "A floating tag means the build is not reproducible and can pull a different image tomorrow",
                "Pin the image to a version tag or, better, to its digest",
                Severity.MEDIUM,
                Category.MAINTAINABILITY,
                Confidence.HIGH,
                file,
                number
              )
            );
          }
        }

        // A secret baked into the image
        const env = line.match(
          /^\s*(?:ENV|ARG)\s+\w*(?:PASSWORD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY)\w*\s*[=\s]\s*["']?([^"'\s]+)/i
        );
        if (env && env[1] && !/^\$\{?/.test(env[1]) && env[1].length > 6) {
          findings.push(
            this.finding(
              "INFRA-003",
              "Secret baked into the image",
              "A value set with ENV or ARG is stored in the image layer and can be read by anyone with the image",
              "Pass the value at runtime with a build secret or an environment variable",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        // apt-get that keeps the package cache
        if (/apt-get\s+install/i.test(line) && !/--no-install-recommends/.test(line)) {
          findings.push(
            this.finding(
              "INFRA-004",
              "Package cache left in the image",
              "Without cleaning the cache the image carries the downloaded packages and gets much larger",
              "Run apt-get clean and remove the lists in the same layer",
              Severity.LOW,
              Category.PERFORMANCE,
              Confidence.MEDIUM,
              file,
              number
            )
          );
        }

        // curl or wget piped straight into a shell
        if (/(curl|wget)\s+[^\n|]*\|\s*(sudo\s+)?(sh|bash)\b/i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-005",
              "Remote script piped into a shell",
              "The script is fetched and executed without being checked, so a changed remote file runs straight away",
              "Download the script, verify its checksum, then run it",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        // ADD of a remote URL
        if (/^\s*ADD\s+https?:\/\//i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-006",
              "Remote file added with ADD",
              "ADD with a URL does not verify the download and behaves differently from COPY",
              "Use COPY for local files and download remote files in a separate, verified step",
              Severity.LOW,
              Category.MAINTAINABILITY,
              Confidence.MEDIUM,
              file,
              number
            )
          );
        }
      });

      // No USER at all
      if (!hasUser) {
        findings.push(
          this.finding(
            "INFRA-007",
            "No USER instruction in the Dockerfile",
            "Without a USER the container runs as root by default",
            "Add a USER instruction with a non privileged user",
            Severity.MEDIUM,
            Category.SECURITY,
            Confidence.MEDIUM,
            file,
            1
          )
        );
      }

      // No HEALTHCHECK in a service image
      if (!hasHealthcheck && /^\s*FROM\s+/im.test(content)) {
        findings.push(
          this.finding(
            "INFRA-008",
            "No HEALTHCHECK in the Dockerfile",
            "Without a health check the orchestrator cannot tell whether the container is actually serving",
            "Add a HEALTHCHECK that calls the health endpoint",
            Severity.LOW,
            Category.MAINTAINABILITY,
            Confidence.MEDIUM,
            file,
            1
          )
        );
      }
    }

    return findings;
  }

  private async analyzeTerraform(
    context: ProjectContext
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const entries = await filesFor(context, ["tf"], context.projectPath);

    for (const entry of entries) {
      const file = entry.path;
      let content: string;
      try {
        content = fs.readFileSync(entry.absolutePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const number = index + 1;

        // A variable whose name says it holds a credential, with a literal default
        const variableBlock = line.match(
          /^\s*variable\s+"([^"]*(?:password|secret|key|token)[^"]*)"/i
        );
        if (variableBlock) {
          for (let j = index + 1; j < Math.min(lines.length, index + 6); j++) {
            const defaultValue = lines[j].match(/^\s*default\s*=\s*"([^"]{8,})"/i);
            if (defaultValue) {
              findings.push(
                this.finding(
                  "INFRA-020",
                  "Hardcoded credential in Terraform",
                  `The variable "${variableBlock[1]}" has a literal default, so the secret ends up in the state file and in the plan output`,
                  "Remove the default and pass the value in, or read it from a secret manager",
                  Severity.CRITICAL,
                  Category.SECURITY,
                  Confidence.HIGH,
                  file,
                  number
                )
              );
              break;
            }
            if (/^\s*}\s*$/.test(lines[j])) break;
          }
        }

        // A hardcoded credential
        const credential = line.match(
          /\b(password|secret_key|access_key|secret|access_key_id|token)\s*=\s*"([^"]{8,})"/i
        );
        if (credential && !/^(var|local)\./.test(credential[0].trim())) {
          findings.push(
            this.finding(
              "INFRA-020",
              "Hardcoded credential in Terraform",
              "A credential in the configuration ends up in the state file and in the plan output",
              "Use a variable with a sensitive value, or read it from a secret manager",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        // A provider without a pinned version
        if (/^\s*provider\s+"/i.test(line) && !/version\s*=/i.test(content)) {
          findings.push(
            this.finding(
              "INFRA-021",
              "Provider version is not pinned",
              "Without a version constraint the provider can change between plans",
              "Pin the provider version",
              Severity.LOW,
              Category.MAINTAINABILITY,
              Confidence.MEDIUM,
              file,
              number
            )
          );
        }

        // A public bucket
        if (/resource\s+"aws_s3_bucket"\s+"/.test(line)) {
          findings.push(
            this.finding(
              "INFRA-022",
              "S3 bucket declared",
              "Check that the bucket is not public and that it has encryption and versioning enabled",
              "Set acl to private and add an encryption and versioning block",
              Severity.LOW,
              Category.SECURITY,
              Confidence.LOW,
              file,
              number
            )
          );
        }
      });
    }

    return findings;
  }

  private async analyzeKubernetes(
    context: ProjectContext
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const entries = await filesFor(context, ["yaml", "yml"], context.projectPath);

    for (const entry of entries) {
      const file = entry.path;
      // The GitHub workflows are handled by the CI checks
      if (file.startsWith(".github/")) continue;
      let content: string;
      try {
        content = fs.readFileSync(entry.absolutePath, "utf-8");
      } catch {
        continue;
      }

      // Only Kubernetes manifests
      if (!/^apiVersion:\s*\S+/m.test(content) || !/^kind:\s*\S+/m.test(content)) {
        continue;
      }

      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const number = index + 1;

        if (/privileged:\s*true/i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-030",
              "Privileged container",
              "A privileged container can escape its isolation and take over the node",
              "Remove privileged and grant only the capabilities the container needs",
              Severity.CRITICAL,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        if (/runAsUser:\s*0\b/i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-031",
              "Container runs as uid 0",
              "Running as root inside the pod gives a compromised container more power than it needs",
              "Set runAsNonRoot: true and runAsUser to a non zero uid",
              Severity.HIGH,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        const image = line.match(/^\s*image:\s*["']?([^"'\s]+)["']?/i);
        if (image && (/latest/i.test(image[1]) || !image[1].includes(":"))) {
          findings.push(
            this.finding(
              "INFRA-032",
              "Image tag is not pinned",
              "A floating tag means the pod can start a different image after a restart",
              "Pin the image to a version tag or its digest",
              Severity.MEDIUM,
              Category.MAINTAINABILITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }
      });

      // No resource limits on any container
      if (/kind:\s*(Deployment|StatefulSet|DaemonSet)/i.test(content) && !/limits:/i.test(content)) {
        findings.push(
          this.finding(
            "INFRA-033",
            "No resource limits",
            "Without limits a pod can consume the whole node and starve its neighbours",
            "Add resources.limits and resources.requests to the container",
            Severity.MEDIUM,
            Category.PERFORMANCE,
            Confidence.MEDIUM,
            file,
            1
          )
        );
      }
    }

    return findings;
  }

  private async analyzeCi(
    context: ProjectContext
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const entries = await filesFor(context, ["yaml", "yml"], context.projectPath);
    const files = entries
      .filter(entry => entry.path.startsWith(".github/workflows/"))
      .map(entry => entry.path);

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(path.join(context.projectPath, file), "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");

      // A workflow triggered by pull_request_target that checks out the PR code
      const usesPullRequestTarget = /pull_request_target/i.test(content);
      const checksOutHead = /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/i.test(content);

      if (usesPullRequestTarget && checksOutHead) {
        findings.push(
          this.finding(
            "INFRA-040",
            "pull_request_target checks out untrusted code",
            "The workflow runs with the repository secrets while executing code from the pull request, which lets anyone who opens a PR read the secrets",
            "Use pull_request instead, or do not check out the pull request head",
            Severity.CRITICAL,
            Category.SECURITY,
            Confidence.HIGH,
            file,
            1
          )
        );
      }

      // No permissions block
      if (/^on:/m.test(content) && !/^permissions:/m.test(content)) {
        findings.push(
          this.finding(
            "INFRA-041",
            "Workflow has no permissions block",
            "Without a permissions block the workflow gets the default token permissions, which are often write access",
            "Add a permissions block and grant only what the workflow needs",
            Severity.MEDIUM,
            Category.SECURITY,
            Confidence.HIGH,
            file,
            1
          )
        );
      }

      lines.forEach((line, index) => {
        const number = index + 1;

        // A secret printed into the log
        if (/\b(echo|print)\b[^\n]*\$\{\{\s*secrets\./i.test(line)) {
          findings.push(
            this.finding(
              "INFRA-042",
              "Secret written to the workflow log",
              "Secrets printed into the log are visible to anyone who can read the workflow run",
              "Write the value to a secret store instead of echoing it",
              Severity.HIGH,
              Category.SECURITY,
              Confidence.HIGH,
              file,
              number
            )
          );
        }

        // A third party action without a pinned version
        if (/^\s*-\s*uses:\s*[^\s]+@/.test(line) && !/@[0-9a-f]{40}/i.test(line)) {
          // A version tag (v4) or a full release (v4.1.1) is a pin, a
          // branch or a label is not.
          const pinned = /@v?\d+(\.\d+)*(-\w+)?$/.test(line.trim());
          if (!pinned) {
            findings.push(
              this.finding(
                "INFRA-043",
                "Action is not pinned to a version",
                "A floating action tag can run different code after the tag is moved",
                "Pin the action to a release tag or its commit sha",
                Severity.LOW,
                Category.MAINTAINABILITY,
                Confidence.MEDIUM,
                file,
                number
              )
            );
          }
        }
      });
    }

    return findings;
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
      id: `infra-${ruleId}-${line}-${file}`,
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function hasPinnedImage(image: string): boolean {
  if (image.includes("@sha256:")) return true;
  const imageName = image.slice(image.lastIndexOf("/") + 1);
  const tagSeparator = imageName.lastIndexOf(":");
  if (tagSeparator < 0) return false;
  const tag = imageName.slice(tagSeparator + 1);
  return tag.length > 0 && tag.toLowerCase() !== "latest";
}

function isEnabled(value: unknown): boolean {
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function isRootUser(value: unknown): boolean {
  if (value === 0) return true;
  return typeof value === "string" && /^(?:0|root)(?::(?:0|root))?$/.test(value.trim().toLowerCase());
}

function mountsDockerSocket(volumes: unknown): boolean {
  if (!Array.isArray(volumes)) return false;
  return volumes.some(volume => {
    if (typeof volume === "string") return volume.includes("/var/run/docker.sock");
    const record = asRecord(volume);
    return [record?.source, record?.target].some(
      value => typeof value === "string" && value.includes("/var/run/docker.sock")
    );
  });
}

function composePropertyLine(
  lines: string[],
  serviceName: string,
  propertyName: string
): number {
  const servicesLine = lines.findIndex(line => /^\s*services\s*:/i.test(line));
  if (servicesLine < 0) return 1;
  const serviceIndent = lines[servicesLine].search(/\S/) + 2;
  const servicePattern = new RegExp(
    `^\\s{${serviceIndent}}["']?${escapeRegExp(serviceName)}["']?\\s*:`
  );
  const serviceLine = lines.findIndex(
    (line, index) => index > servicesLine && servicePattern.test(line)
  );
  if (serviceLine < 0) return servicesLine + 1;

  const propertyPattern = new RegExp(
    `^\\s{${serviceIndent + 2}}["']?${escapeRegExp(propertyName)}["']?\\s*:`
  );
  for (let index = serviceLine + 1; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indentation = line.search(/\S/);
    if (indentation <= serviceIndent) break;
    if (propertyPattern.test(line)) return index + 1;
  }

  return serviceLine + 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
