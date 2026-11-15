import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  ProjectDetector,
  SupportedLanguage,
  ProjectMetadata,
  ManifestType,
  ProjectType,
  DetectionResult,
} from "@codepulse/shared";
import { ComponentDetector } from "./ComponentDetector";
import { FileIndex, EXTENSION_LANGUAGES } from "./fileIndex";
import { detectLanguages } from "./languageDetector";

export class DefaultProjectDetector implements ProjectDetector {
  /**
   * Detect a project. When a file index is supplied the tree is not walked
   * again, which keeps a large project fast.
   */
  async detect(
    projectPath: string,
    index?: FileIndex
  ): Promise<DetectionResult> {
    const projectName = path.basename(projectPath);
    const metadata = await this.detectMetadata(projectPath, index);

    return {
      projectName,
      projectPath,
      metadata,
      confidence: this.calculateConfidence(metadata),
    };
  }

  private async detectMetadata(
    projectPath: string,
    index?: FileIndex
  ): Promise<ProjectMetadata> {
    const detection = detectLanguages(projectPath, index?.entries ?? []);
    const languages = detection.languages;
    const frameworks = await this.detectFrameworks(projectPath, languages);
    const manifests = await this.findManifests(projectPath);
    const testInfo = await this.detectTests(projectPath, languages);
    const ciInfo = await this.detectCI(projectPath);

    // Split the project into components and work out the full technical
    // stack. This is what makes a polyglot project understandable.
    const componentDetector = new ComponentDetector();
    const detected = await componentDetector.detect(projectPath, index);

    // The component detector walks the whole tree, so it is the better
    // source of truth for the stack. The enum based list still drives which
    // analyzers run.
    const stackLanguages = Array.from(
      new Set([...detected.techStack.languages, ...languages])
    );
    const mergedFrameworks = detected.techStack.frameworks.length
      ? detected.techStack.frameworks
      : frameworks;

    const databases = Array.from(
      new Set([
        ...detected.techStack.databases,
        ...(detection.dialects.sql ? [detection.dialects.sql] : []),
      ])
    );

    return {
      languages,
      dialects: detection.dialects,
      languageEvidence: detection.evidence,
      detectedTechnologies: Array.from(
        new Set([...detection.technologies, ...mergedFrameworks])
      ),
      frameworks: mergedFrameworks,
      manifests,
      hasTests: testInfo.hasTests,
      testFrameworks: testInfo.frameworks,
      hasCI: ciInfo.hasCI,
      ciTools: ciInfo.tools,
      projectType: this.inferProjectType(
        languages,
        mergedFrameworks,
        manifests,
        detected.isMonorepo
      ),
      components: detected.components,
      techStack: {
        ...detected.techStack,
        languages: stackLanguages,
        databases,
      },
    };
  }

  private async detectFrameworks(
    projectPath: string,
    languages: string[]
  ): Promise<string[]> {
    const frameworks: string[] = [];

    // Java frameworks
    if (languages.includes(SupportedLanguage.JAVA)) {
      if (this.fileExists(projectPath, "pom.xml")) {
        if (
          this.fileContains(
            projectPath,
            "pom.xml",
            "spring-boot-starter"
          )
        ) {
          frameworks.push("Spring Boot");
        }
      }
      if (this.fileExists(projectPath, "build.gradle")) {
        frameworks.push("Gradle");
      }
    }

    // JavaScript/TypeScript frameworks
    if (
      languages.includes(SupportedLanguage.JAVASCRIPT) ||
      languages.includes(SupportedLanguage.TYPESCRIPT)
    ) {
      const pkgJson = this.readJSON(projectPath, "package.json");
      if (pkgJson) {
        const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        if (deps.react) frameworks.push("React");
        if (deps.vue) frameworks.push("Vue");
        if (deps.angular) frameworks.push("Angular");
        if (deps.express) frameworks.push("Express");
        if (deps.next) frameworks.push("Next.js");
      }
    }

    // Python frameworks, from the requirements.
    if (languages.includes(SupportedLanguage.PYTHON)) {
      const requirements = await this.readRequirements(projectPath);
      if (requirements.has("django")) frameworks.push("Django");
      if (requirements.has("flask")) frameworks.push("Flask");
      if (requirements.has("fastapi")) frameworks.push("FastAPI");
    }

    return frameworks;
  }

  /**
   * The packages a python project asks for, in lower case.
   */
  private async readRequirements(projectPath: string): Promise<Set<string>> {
    const names = new Set<string>();
    for (const file of ["requirements.txt", "pyproject.toml"]) {
      const full = path.join(projectPath, file);
      if (!fs.existsSync(full)) continue;
      try {
        const raw = await fs.promises.readFile(full, "utf8");
        for (const line of raw.split("\n")) {
          const match = line.trim().match(/^([A-Za-z0-9_.-]+)/);
          if (match) names.add(match[1].toLowerCase());
        }
      } catch {
        // a requirements file that cannot be read is simply not used
      }
    }
    return names;
  }

  private async findManifests(projectPath: string): Promise<ManifestType[]> {
    const manifests: ManifestType[] = [];

    const filesToCheck = [
      ManifestType.POM_XML,
      ManifestType.BUILD_GRADLE,
      ManifestType.BUILD_GRADLE_KTS,
      ManifestType.PACKAGE_JSON,
      ManifestType.TSCONFIG_JSON,
      ManifestType.GO_MOD,
      ManifestType.CARGO_TOML,
      ManifestType.COMPOSER_JSON,
      ManifestType.GEMFILE,
      ManifestType.DOCKERFILE,
      ManifestType.DOCKER_COMPOSE,
    ];

    for (const manifest of filesToCheck) {
      if (this.fileExists(projectPath, manifest)) {
        manifests.push(manifest);
      }
    }

    return manifests;
  }

  private async detectTests(
    projectPath: string,
    languages: string[]
  ): Promise<{ hasTests: boolean; frameworks: string[] }> {
    const frameworks: string[] = [];
    const testDirs = await glob("**/*{test,spec,tests}", {
      cwd: projectPath,
      ignore: this.getDefaultIgnorePatterns(),
      maxDepth: 5,
    });

    if (testDirs.length === 0) {
      return { hasTests: false, frameworks };
    }

    // Look for test framework indicators
    if (languages.includes(SupportedLanguage.JAVA)) {
      if (this.fileContains(projectPath, "pom.xml", "junit"))
        frameworks.push("JUnit");
      if (this.fileContains(projectPath, "pom.xml", "mockito"))
        frameworks.push("Mockito");
      if (this.fileContains(projectPath, "pom.xml", "testng"))
        frameworks.push("TestNG");
    }

    if (
      languages.includes(SupportedLanguage.JAVASCRIPT) ||
      languages.includes(SupportedLanguage.TYPESCRIPT)
    ) {
      const pkgJson = this.readJSON(projectPath, "package.json");
      if (pkgJson?.devDependencies) {
        const deps = pkgJson.devDependencies;
        if (deps.jest) frameworks.push("Jest");
        if (deps.mocha) frameworks.push("Mocha");
        if (deps.vitest) frameworks.push("Vitest");
        if (deps.cypress) frameworks.push("Cypress");
        if (deps.playwright) frameworks.push("Playwright");
      }
    }

    return { hasTests: testDirs.length > 0, frameworks };
  }

  private async detectCI(
    projectPath: string
  ): Promise<{ hasCI: boolean; tools: string[] }> {
    const tools: string[] = [];

    if (this.fileExists(projectPath, ".github/workflows")) {
      tools.push("GitHub Actions");
    }
    if (this.fileExists(projectPath, ".gitlab-ci.yml")) {
      tools.push("GitLab CI");
    }
    if (this.fileExists(projectPath, ".travis.yml")) {
      tools.push("Travis CI");
    }
    if (this.fileExists(projectPath, "Jenkinsfile")) {
      tools.push("Jenkins");
    }
    if (this.fileExists(projectPath, ".circleci")) {
      tools.push("CircleCI");
    }

    return { hasCI: tools.length > 0, tools };
  }

  private inferProjectType(
    languages: string[],
    frameworks: string[],
    manifests: ManifestType[],
    isMonorepo = false
  ): ProjectType {
    if (isMonorepo) {
      return ProjectType.MONOREPO;
    }
    if (manifests.includes(ManifestType.DOCKER_COMPOSE)) {
      return ProjectType.MICROSERVICE;
    }
    if (manifests.some((m) => m.includes(".gradle")) && languages.length > 1) {
      return ProjectType.MONOREPO;
    }
    if (
      frameworks.includes("Express") ||
      frameworks.includes("Spring Boot") ||
      frameworks.includes("Next.js")
    ) {
      return ProjectType.APPLICATION;
    }
    if (
      manifests.includes(ManifestType.CARGO_TOML) ||
      manifests.includes(ManifestType.POM_XML)
    ) {
      return ProjectType.LIBRARY;
    }

    return ProjectType.UNKNOWN;
  }

  private calculateConfidence(metadata: ProjectMetadata): number {
    let score = 50;
    if (metadata.languages.length > 0) score += 20;
    if (metadata.frameworks.length > 0) score += 10;
    if (metadata.manifests.length > 0) score += 15;
    if (metadata.hasTests) score += 3;
    if (metadata.hasCI) score += 2;
    return Math.min(score, 100);
  }

  private getDefaultIgnorePatterns(): string[] {
    return [
      "**/node_modules/**",
      "**/.git/**",
      "**/dist/**",
      "**/build/**",
      "**/target/**",
      "**/.venv/**",
      "**/venv/**",
      "**/__pycache__/**",
      "**/.egg-info/**",
      "**/coverage/**",
    ];
  }

  private fileExists(projectPath: string, filePath: string): boolean {
    return fs.existsSync(path.join(projectPath, filePath));
  }

  private fileContains(
    projectPath: string,
    filePath: string,
    pattern: string
  ): boolean {
    try {
      const content = fs.readFileSync(path.join(projectPath, filePath), "utf-8");
      return content.includes(pattern);
    } catch {
      return false;
    }
  }

  private readJSON(projectPath: string, filePath: string): any {
    try {
      const content = fs.readFileSync(path.join(projectPath, filePath), "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
