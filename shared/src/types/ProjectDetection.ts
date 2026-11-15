/**
 * Project Detection Engine
 * Identifies languages, frameworks, and project structure
 */

/**
 * The languages that have a dedicated analyzer.
 *
 * The set of languages a project can be written in is much wider than
 * this: the scanner names about ninety of them from an open table. This
 * enum is the ones with rules of their own, and the detection is not
 * limited to them.
 */
export enum SupportedLanguage {
  JAVA = "java",
  PYTHON = "python",
  JAVASCRIPT = "javascript",
  TYPESCRIPT = "typescript",
  GO = "go",
  RUST = "rust",
  CPP = "cpp",
  CSHARP = "csharp",
  PHP = "php",
  RUBY = "ruby",
  KOTLIN = "kotlin",
  SWIFT = "swift",
  DART = "dart",
  SHELL = "shell",
  SQL = "sql",
  LUA = "lua",
  SCALA = "scala",
  ELIXIR = "elixir",
  ERLANG = "erlang",
  HASKELL = "haskell",
  CLOJURE = "clojure",
  OBJECTIVE_C = "objective-c",
  POWERSHELL = "powershell",
  GROOVY = "groovy",
  PERL = "perl",
  R = "r",
  JULIA = "julia",
  SOLIDITY = "solidity",
  TCL = "tcl",
  FORTRAN = "fortran",
}

/**
 * The kind of thing a finding is about.
 *
 * Real projects mix application code with databases, infrastructure and
 * configuration. Splitting the findings by facet keeps "3 critical migration
 * risks in the database" separate from "40 code issues in the services".
 */
export enum Facet {
  /** Application / business logic */
  CODE = "code",
  /** Schemas, migrations, queries, ORM models */
  DATABASE = "database",
  /** Docker, Terraform, Kubernetes, CI pipelines */
  INFRA = "infra",
  /** Configuration and manifests */
  CONFIG = "config",
  /** Credentials and other secrets */
  SECRETS = "secrets",
  /** Third party dependencies */
  DEPENDENCIES = "dependencies",
  /** Documentation */
  DOCUMENTATION = "documentation",
}

/**
 * A component of a project. In a monorepo this is one service or package;
 * in a single app project it is the project itself.
 */
export interface ComponentInfo {
  /** Stable id (derived from the relative path). */
  id: string;
  /** Human readable name, usually the folder name. */
  name: string;
  /** Path relative to the project root. "" for the root component. */
  relativePath: string;
  /**
   * The languages used inside this component. This is an open set, it is
   * not limited to the languages that have a dedicated analyzer.
   */
  languages: string[];
  /** Frameworks / libraries detected for this component. */
  frameworks: string[];
  /** Databases this component talks to or owns. */
  databases: string[];
  /** Infrastructure tools used by this component. */
  infrastructure: string[];
  /** Package managers used by this component. */
  packageManagers: string[];
  /** Continuous integration tools used by this component. */
  ciTools: string[];
  /** Facets this component contributes to. */
  facets: Facet[];
  /** Manifest files that identified this component. */
  manifests: string[];
  /** Number of source files in this component. */
  fileCount: number;
}

/**
 * The full technical stack of a project, grouped by facet.
 */
export interface TechStack {
  /**
   * Every language that was found, whether or not it has a dedicated
   * analyzer.
   */
  languages: string[];
  /**
   * The languages that were found but have no dedicated analyzer, so the UI
   * can say so instead of showing an empty stack.
   */
  languagesWithoutAnalyzer?: string[];
  frameworks: string[];
  databases: string[];
  infrastructure: string[];
  packageManagers: string[];
  ciTools: string[];
  facets: Facet[];
}

export interface ProjectMetadata {
  /**
   * Every language that was found. This is an open set: a project can be
   * written in a language that has no dedicated analyzer, and it is still
   * reported rather than hidden.
   */
  languages: string[];
  /**
   * The dialect of each language that has more than one, such as
   * "postgresql" for SQL.
   */
  dialects?: Record<string, string>;
  /**
   * How each language was worked out: by its extension, by what is in
   * the file, by a manifest, or by its name.
   */
  languageEvidence?: Record<string, string[]>;
  /**
   * The technologies that were found: the frameworks with their versions,
   * the migration tools, the package managers.
   */
  detectedTechnologies?: string[];
  frameworks: string[];
  manifests: ManifestType[];
  hasTests: boolean;
  testFrameworks: string[];
  hasCI: boolean;
  ciTools: string[];
  projectType: ProjectType;
  /** The individual services/packages that make up the project. */
  components?: ComponentInfo[];
  /** The grouped technical stack of the whole project. */
  techStack?: TechStack;
}

export enum ProjectType {
  LIBRARY = "library",
  APPLICATION = "application",
  MICROSERVICE = "microservice",
  MONOREPO = "monorepo",
  UNKNOWN = "unknown",
}

export enum ManifestType {
  // Java
  POM_XML = "pom.xml",
  BUILD_GRADLE = "build.gradle",
  BUILD_GRADLE_KTS = "build.gradle.kts",

  // Python
  REQUIREMENTS_TXT = "requirements.txt",
  SETUP_PY = "setup.py",
  PYPROJECT_TOML = "pyproject.toml",

  // JavaScript / TypeScript
  PACKAGE_JSON = "package.json",
  TSCONFIG_JSON = "tsconfig.json",

  // Go
  GO_MOD = "go.mod",

  // Rust
  CARGO_TOML = "Cargo.toml",

  // C#
  CSPROJ = "*.csproj",
  SLN = "*.sln",

  // PHP
  COMPOSER_JSON = "composer.json",

  // Ruby
  GEMFILE = "Gemfile",

  // General
  DOCKERFILE = "Dockerfile",
  DOCKER_COMPOSE = "docker-compose.yml",
  GITIGNORE = ".gitignore",
  CI_WORKFLOWS = ".github/workflows",
}

export interface DetectionResult {
  projectName: string;
  projectPath: string;
  metadata: ProjectMetadata;
  confidence: number; // 0-100
  warnings?: string[];
}

export interface ProjectDetector {
  /**
   * Detect project languages and metadata
   */
  detect(projectPath: string): Promise<DetectionResult>;
}
