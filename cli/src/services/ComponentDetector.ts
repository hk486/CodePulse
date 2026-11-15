import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";
import {
  SupportedLanguage,
  Facet,
  ComponentInfo,
  TechStack,
  ManifestType,
} from "@codepulse/shared";
import { FileIndex, EXTENSION_LANGUAGES } from "./fileIndex";

/**
 * Detects the components of a project.
 *
 * A real world project is rarely a single application. It is a set of
 * services, packages and infrastructure folders. This detector splits the
 * project into those components, works out what each one is built with and
 * which facet (code, database, infra, ...) it contributes to.
 */

const IGNORED_DIRS = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/.git/**",
  "**/coverage/**",
  "**/venv/**",
  "**/.venv/**",
  "**/__pycache__/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.gradle/**",
  "**/.idea/**",
  "**/bin/**",
  "**/obj/**",
];

/** Files that mark a directory as a buildable component. */
const MANIFEST_FILES = [
  "package.json",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "requirements.txt",
  "pyproject.toml",
  "setup.py",
  "Pipfile",
  "Cargo.toml",
  "composer.json",
  "Gemfile",
  "mix.exs",
  "pubspec.yaml",
  "CMakeLists.txt",
  "deno.json",
];

/** Lock files that show which package manager a component uses. */
const LOCK_FILES: Record<string, string> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "poetry.lock": "poetry",
  "Pipfile.lock": "pipenv",
  "uv.lock": "uv",
  "Cargo.lock": "cargo",
  "Gemfile.lock": "bundler",
  "composer.lock": "composer",
  "go.sum": "go modules",
  "gradle.lockfile": "gradle",
  "pubspec.lock": "pub",
};

const LANGUAGE_BY_EXTENSION: Record<string, SupportedLanguage> = {
  ts: SupportedLanguage.TYPESCRIPT,
  tsx: SupportedLanguage.TYPESCRIPT,
  mts: SupportedLanguage.TYPESCRIPT,
  cts: SupportedLanguage.TYPESCRIPT,
  js: SupportedLanguage.JAVASCRIPT,
  jsx: SupportedLanguage.JAVASCRIPT,
  mjs: SupportedLanguage.JAVASCRIPT,
  cjs: SupportedLanguage.JAVASCRIPT,
  py: SupportedLanguage.PYTHON,
  java: SupportedLanguage.JAVA,
  go: SupportedLanguage.GO,
  rs: SupportedLanguage.RUST,
  c: SupportedLanguage.CPP,
  cc: SupportedLanguage.CPP,
  cpp: SupportedLanguage.CPP,
  cxx: SupportedLanguage.CPP,
  h: SupportedLanguage.CPP,
  hpp: SupportedLanguage.CPP,
  cs: SupportedLanguage.CSHARP,
  php: SupportedLanguage.PHP,
  rb: SupportedLanguage.RUBY,
  kt: SupportedLanguage.KOTLIN,
  kts: SupportedLanguage.KOTLIN,
  swift: SupportedLanguage.SWIFT,
  dart: SupportedLanguage.DART,
  sh: SupportedLanguage.SHELL,
  bash: SupportedLanguage.SHELL,
  zsh: SupportedLanguage.SHELL,
  sql: SupportedLanguage.SQL,
};

/**
 * Every file type the analyzers actually read. Used for the file count of
 * a component, so an infrastructure only component is not reported as empty.
 */
const ANALYSED_EXTENSIONS = new Set([
  ...Object.keys(LANGUAGE_BY_EXTENSION),
  "vue", "svelte", "astro", "html", "htm", "css", "scss", "sass", "less",
  "json", "jsonc", "yaml", "yml", "toml", "xml", "ini", "cfg", "conf",
  "properties", "env", "hcl", "tf", "tfvars", "proto", "graphql", "gql",
  "gradle", "bzl", "nix", "cmake", "mk", "make", "mod", "sum", "lock",
  "md", "mdx", "rst", "txt", "adoc", "sh", "bash", "zsh", "ps1", "bat", "cmd",
  "dockerfile", "tf", "sql", "prisma",
]);

const FRAMEWORK_LIBRARIES: Record<string, string> = {
  react: "React",
  next: "Next.js",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  "@nestjs/core": "NestJS",
  koa: "Koa",
  hapi: "Hapi",
  electron: "Electron",
  reactnative: "React Native",
  "react-native": "React Native",
  django: "Django",
  flask: "Flask",
  fastapi: "FastAPI",
  tornado: "Tornado",
  pyramid: "Pyramid",
  rails: "Ruby on Rails",
  laravel: "Laravel",
  symfony: "Symfony",
  gin: "Gin",
  echo: "Echo",
  fiber: "Fiber",
  actix: "Actix",
  rocket: "Rocket",
  axum: "Axum",
  spring: "Spring",
  "spring-boot": "Spring Boot",
  quarkus: "Quarkus",
  micronaut: "Micronaut",
};

const DATABASE_LIBRARIES: Record<string, string> = {
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  sequelize: "Sequelize",
  typeorm: "TypeORM",
  mongoose: "MongoDB (Mongoose)",
  knex: "Knex",
  drizzle: "Drizzle ORM",
  sqlalchemy: "SQLAlchemy",
  psycopg2: "PostgreSQL",
  "psycopg": "PostgreSQL",
  pg: "PostgreSQL",
  mysql: "MySQL",
  mysql2: "MySQL",
  pymysql: "MySQL",
  sqlite3: "SQLite",
  "sqlite": "SQLite",
  django: "Django ORM",
  "mysql-connector": "MySQL",
  "oracledb": "Oracle DB",
  "microsoft": "SQL Server",
};

const DATABASE_SERVICES: Record<string, string> = {
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  timescale: "TimescaleDB",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mongo: "MongoDB",
  mongodb: "MongoDB",
  redis: "Redis",
  cassandra: "Cassandra",
  neo4j: "Neo4j",
  clickhouse: "ClickHouse",
  elasticsearch: "Elasticsearch",
  opensearch: "OpenSearch",
  influxdb: "InfluxDB",
  sqlite: "SQLite",
  cockroach: "CockroachDB",
};

const INFRA_FILES: Record<string, string> = {
  "Dockerfile": "Docker",
  "docker-compose.yml": "Docker Compose",
  "docker-compose.yaml": "Docker Compose",
  "compose.yml": "Docker Compose",
  "compose.yaml": "Docker Compose",
  "Jenkinsfile": "Jenkins",
  ".gitlab-ci.yml": "GitLab CI",
  "serverless.yml": "Serverless",
  "vercel.json": "Vercel",
  "netlify.toml": "Netlify",
  "fly.toml": "Fly.io",
  "Chart.yaml": "Helm",
  "skaffold.yaml": "Skaffold",
  "kustomization.yaml": "Kustomize",
};

export interface DetectedComponents {
  components: ComponentInfo[];
  techStack: TechStack;
  isMonorepo: boolean;
}

export class ComponentDetector {
  /**
   * Split the project into components and work out its technical stack.
   */
  async detect(
    projectPath: string,
    index?: FileIndex
  ): Promise<DetectedComponents> {
    const componentRoots = await this.findComponentRoots(projectPath, index);
    const components: ComponentInfo[] = [];

    for (const relativePath of componentRoots) {
      // A component does not own the files of a more specific component
      // nested inside it - those belong to the nested one.
      const nested = componentRoots.filter(
        (other) =>
          other !== relativePath &&
          other.startsWith(`${relativePath}/`)
      );
      const component = await this.describeComponent(
      projectPath,
      relativePath,
      nested,
      index
    );
      if (component) components.push(component);
    }

    const techStack = this.mergeTechStack(components);

    return {
      components,
      techStack,
      isMonorepo: components.length > 1,
    };
  }

  /**
   * Every directory that holds a manifest (or is declared as a workspace
   * package) is treated as a component root.
   */
  private async findComponentRoots(
    projectPath: string,
    index?: FileIndex
  ): Promise<string[]> {
    const roots = new Set<string>();

    // 1. Explicit workspace declarations
    for (const pattern of await this.explicitWorkspacePatterns(projectPath)) {
      const matches = await glob.glob(pattern, {
        cwd: projectPath,
        ignore: IGNORED_DIRS,
        maxDepth: 6,
      });
      for (const match of matches) {
        roots.add(match.split("/").slice(0, -1).join("/"));
      }
    }

    // 2. Directories that contain a build manifest
    const manifests = index
      ? index.entries
          .filter(entry => MANIFEST_FILES.includes(entry.path.split("/").pop() || ""))
          .map(entry => entry.path)
      : await glob.glob(`**/{${MANIFEST_FILES.join(",")}}`, {
          cwd: projectPath,
          ignore: IGNORED_DIRS,
          maxDepth: 8,
          nodir: true,
        });
    for (const manifest of manifests) {
      const dir = path.dirname(manifest).split(path.sep).join("/");
      // path.dirname returns "." for a file in the project root
      roots.add(dir === "." ? "" : dir);
    }

    // 3. .csproj / .sln mark a component too
    const dotnet = await glob.glob("**/*.{csproj,sln,fsproj}", {
      cwd: projectPath,
      ignore: IGNORED_DIRS,
      maxDepth: 8,
      nodir: true,
    });
    for (const file of dotnet) {
      const dir = path.dirname(file).split(path.sep).join("/");
      roots.add(dir === "." ? "" : dir);
    }

    // Always keep the project root
    roots.add("");

    // Drop components that live inside another component (e.g. a nested
    // example folder) - the outermost one wins.
    const sorted = [...roots].sort((a, b) => a.length - b.length);
    const result: string[] = [];
    for (const candidate of sorted) {
      if (result.some(parent => candidate === parent || candidate.startsWith(`${parent}/`))) {
        continue;
      }
      result.push(candidate);
    }
    return result;
  }

  /**
   * Workspace globs declared by the common monorepo tools.
   */
  private async explicitWorkspacePatterns(projectPath: string): Promise<string[]> {
    const patterns: string[] = [];

    // package.json workspaces
    const packageJson = this.readJson(path.join(projectPath, "package.json"));
    if (packageJson?.workspaces) {
      const list = Array.isArray(packageJson.workspaces)
        ? packageJson.workspaces
        : packageJson.workspaces?.packages || [];
      patterns.push(...list.map((entry: string) => entry.replace(/\/\*+$/, "/*")));
    }

    // pnpm-workspace.yaml
    const pnpm = this.readFile(path.join(projectPath, "pnpm-workspace.yaml"));
    if (pnpm) {
      const inPackages = pnpm.split("packages:")[1];
      if (inPackages) {
        for (const line of inPackages.split("\n")) {
          const match = line.match(/^\s*-\s*["']?([^"'\n#]+)["']?/);
          if (match) patterns.push(match[1].trim().replace(/\/\*+$/, "/*"));
        }
      }
    }

    // lerna.json
    const lerna = this.readJson(path.join(projectPath, "lerna.json"));
    if (Array.isArray(lerna?.packages)) {
      patterns.push(...lerna.packages.map((p: string) => p.replace(/\/\*+$/, "/*")));
    }

    // turbo.json / nx.json
    const turbo = this.readJson(path.join(projectPath, "turbo.json"));
    if (Array.isArray(turbo?.workspaces)) {
      patterns.push(...turbo.workspaces);
    }
    const nx = this.readJson(path.join(projectPath, "nx.json"));
    if (Array.isArray(nx?.workspaces)) {
      patterns.push(...nx.workspaces);
    }

    // Cargo workspace members
    const cargo = this.readFile(path.join(projectPath, "Cargo.toml"));
    if (cargo) {
      const members = cargo.match(/\[workspace\][\s\S]*?members\s*=\s*\[([^\]]*)\]/);
      if (members) {
        for (const entry of members[1].split(",")) {
          const value = entry.trim().replace(/^["']|["']$/g, "");
          if (value) patterns.push(value.replace(/\/\*+$/, "/*"));
        }
      }
    }

    // go.work
    const goWork = this.readFile(path.join(projectPath, "go.work"));
    if (goWork) {
      for (const line of goWork.split("\n")) {
        const match = line.match(/^\s*use\s+\(?\s*"?([^"\)\s]+)"?/);
        if (match) patterns.push(`${match[1].replace(/\/$/, "")}/**`);
      }
    }

    // Gradle settings.gradle include
    const gradle = this.readFile(path.join(projectPath, "settings.gradle"));
    if (gradle) {
      const include = gradle.match(/include\s+([^\n]*)/);
      if (include) {
        for (const entry of include[1].split(",")) {
          const value = entry.replace(/["']/g, "").trim().replace(/:\*$/, "");
          if (value) patterns.push(`${value}/**`);
        }
      }
    }

    return patterns;
  }

  /**
   * Work out languages, frameworks and facets for one component.
   */
  private async describeComponent(
    projectPath: string,
    relativePath: string,
    nestedRoots: string[] = [],
    index?: FileIndex
  ): Promise<ComponentInfo | null> {
    const root = relativePath
      ? path.join(projectPath, relativePath)
      : projectPath;

    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const databases = new Set<string>();
    const infrastructure = new Set<string>();
    const packageManagers = new Set<string>();
    const ciTools = new Set<string>();
    const manifests: string[] = [];
    const facets = new Set<Facet>();

    // Ignore the folders of nested components - they own their own files.
    const nestedIgnores = nestedRoots.map(
      (nested) => `**/${nested}/**`
    );

    // Source files -> languages
    const sourceFiles = index
      ? index.entries
          .filter(entry => {
            if (nestedIgnores.length === 0) return true;
            return !nestedIgnores.some(
              (nested) => entry.path === nested || entry.path.startsWith(`${nested}/`)
            );
          })
          .map(entry => entry.path)
      : await glob.glob("**/*", {
          cwd: root,
          ignore: [...IGNORED_DIRS, ...nestedIgnores],
          maxDepth: 12,
          nodir: true,
        });

    let fileCount = 0;
    for (const file of sourceFiles) {
      const base = path.basename(file).toLowerCase();
      const ext = path.extname(file).replace(/^\./, "").toLowerCase();
      // The open table names every language we recognise, whether or not it
      // has a dedicated analyzer.
      const language = EXTENSION_LANGUAGES[ext] ?? LANGUAGE_BY_EXTENSION[ext];
      if (language) {
        languages.add(language);
        fileCount++;
        continue;
      }
      // Infrastructure and configuration files count towards the component
      if (
        ANALYSED_EXTENSIONS.has(ext) ||
        base === "dockerfile" ||
        base === "containerfile" ||
        base === "makefile" ||
        base === "jenkinsfile"
      ) {
        fileCount++;
      }
    }

    // Manifests in this component
    const manifestFiles = await glob.glob(`**/{${MANIFEST_FILES.join(",")}}`, {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores],
      maxDepth: 8,
      nodir: true,
    });
    for (const manifest of manifestFiles) {
      if (!manifests.includes(manifest)) manifests.push(manifest);
    }

    // Lock files -> package managers
    for (const [lock, manager] of Object.entries(LOCK_FILES)) {
      if (fs.existsSync(path.join(root, lock))) packageManagers.add(manager);
    }

    // Frameworks / databases from package.json
    const packageJson = this.readJson(path.join(root, "package.json"));
    if (packageJson) {
      const deps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      for (const [name, value] of Object.entries(deps)) {
        const framework = FRAMEWORK_LIBRARIES[name];
        if (framework) frameworks.add(framework);
        const database = DATABASE_LIBRARIES[name];
        if (database) databases.add(database);
        if (name === "@nestjs/core" || name === "express" || name === "fastify") {
          facets.add(Facet.CODE);
        }
      }
    }

    // Python dependencies
    const requirements = this.readFile(path.join(root, "requirements.txt"));
    if (requirements) {
      for (const line of requirements.split("\n")) {
        const name = line.split(/[<>=~!;\[]/)[0].trim().toLowerCase();
        if (!name) continue;
        const framework = FRAMEWORK_LIBRARIES[name];
        if (framework) frameworks.add(framework);
        const database = DATABASE_LIBRARIES[name];
        if (database) databases.add(database);
      }
    }

    // Go dependencies
    const goMod = this.readFile(path.join(root, "go.mod"));
    if (goMod) {
      const requireBlock = goMod.match(/require\s*\(([\s\S]*?)\)/);
      const entries = requireBlock
        ? requireBlock[1].split("\n")
        : (goMod.match(/^require\s+(.+)$/m)?.[1] || "").split("\n");
      for (const entry of entries) {
        const name = entry.trim().split(/\s+/)[0]?.toLowerCase();
        if (!name) continue;
        const framework = FRAMEWORK_LIBRARIES[name];
        if (framework) frameworks.add(framework);
        const database = DATABASE_LIBRARIES[name];
        if (database) databases.add(database);
      }
    }

    // Java / JVM dependencies (pom.xml / build.gradle)
    const pom = this.readFile(path.join(root, "pom.xml"));
    if (pom) {
      if (pom.includes("spring-boot")) frameworks.add("Spring Boot");
      if (pom.includes("spring")) frameworks.add("Spring");
      if (pom.includes("quarkus")) frameworks.add("Quarkus");
      if (pom.includes("hibernate")) databases.add("Hibernate");
      if (pom.includes("postgres")) databases.add("PostgreSQL");
      if (pom.includes("mysql")) databases.add("MySQL");
    }

    // Rust / PHP / Ruby dependencies
    const cargo = this.readFile(path.join(root, "Cargo.toml"));
    if (cargo) {
      for (const [name, label] of Object.entries(FRAMEWORK_LIBRARIES)) {
        if (cargo.includes(`"${name}"`)) frameworks.add(label);
      }
    }
    const composer = this.readJson(path.join(root, "composer.json"));
    if (composer) {
      const deps = { ...(composer.require || {}), ...(composer["require-dev"] || {}) };
      for (const name of Object.keys(deps)) {
        const framework = FRAMEWORK_LIBRARIES[name];
        if (framework) frameworks.add(framework);
      }
    }
    const gemfile = this.readFile(path.join(root, "Gemfile"));
    if (gemfile && gemfile.includes("rails")) frameworks.add("Ruby on Rails");

    // Infrastructure files
    for (const [file, label] of Object.entries(INFRA_FILES)) {
      if (fs.existsSync(path.join(root, file))) infrastructure.add(label);
    }
    const tfFiles = await glob.glob("**/*.tf", {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores],
      maxDepth: 6,
      nodir: true,
    });
    if (tfFiles.length > 0) infrastructure.add("Terraform");
    const k8sFiles = await glob.glob("**/*.{yaml,yml}", {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores],
      maxDepth: 6,
      nodir: true,
    });
    for (const file of k8sFiles) {
      const content = this.readFile(path.join(root, file));
      if (content && /^apiVersion:\s*v1/m.test(content) && /kind:\s*(Deployment|Service|StatefulSet|Ingress)/.test(content)) {
        infrastructure.add("Kubernetes");
        break;
      }
    }
    const workflows = await glob.glob(".github/workflows/*.{yml,yaml}", {
      cwd: root,
      ignore: IGNORED_DIRS,
      maxDepth: 4,
      nodir: true,
    });
    if (workflows.length > 0) ciTools.add("GitHub Actions");

    // Databases from docker compose
    for (const composeFile of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
      const compose = this.readFile(path.join(root, composeFile));
      if (!compose) continue;
      infrastructure.add("Docker Compose");
      for (const [service, label] of Object.entries(DATABASE_SERVICES)) {
        if (new RegExp(`\\b${service}\\b`, "i").test(compose)) databases.add(label);
      }
    }

    // Database facet: sql files, migrations or ORM models
    const sqlFiles = await glob.glob("**/*.sql", {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores],
      maxDepth: 10,
      nodir: true,
    });
    if (sqlFiles.length > 0) {
      // Work out which SQL dialect the project uses
      const dialect = await this.detectSqlDialect(root, sqlFiles)
      databases.add(dialect)
    };
    const migrationDirs = await glob.glob("**/{migrations,migration,db/migrate,alembic}/**/*", {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores],
      maxDepth: 10,
      nodir: true,
    });
    if (migrationDirs.length > 0) databases.add("SQL migrations");
    const ormModels = await glob.glob(
      "**/{schema.prisma,models.py,models/**/*.py,entities/**/*.cs,schema.rb}",
      { cwd: root, ignore: [...IGNORED_DIRS, ...nestedIgnores], maxDepth: 8, nodir: true }
    );
    if (ormModels.length > 0) databases.add("ORM models");

    // Facets
    if (fileCount > 0) facets.add(Facet.CODE);
    if (sqlFiles.length > 0 || migrationDirs.length > 0 || ormModels.length > 0) {
      facets.add(Facet.DATABASE);
    }
    if (infrastructure.size > 0) facets.add(Facet.INFRA);
    if (manifestFiles.length > 0 || tfFiles.length > 0) facets.add(Facet.CONFIG);
    if (packageManagers.size > 0) facets.add(Facet.DEPENDENCIES);

    // Secret material
    const secretFiles = await glob.glob("**/{.env,.env.*,*.pem,*.key,id_rsa,credentials.json,*.p12,*.keystore}", {
      cwd: root,
      ignore: [...IGNORED_DIRS, ...nestedIgnores, "**/*.example", "**/*.sample", "**/*.template"],
      maxDepth: 8,
      nodir: true,
    });
    if (secretFiles.length > 0) facets.add(Facet.SECRETS);

    if (fileCount === 0 && manifests.length === 0 && infrastructure.size === 0 && facets.size === 0) {
      return null;
    }

    // The root component is the project itself - give it a stable name
    // instead of the (often meaningless) folder name it was uploaded into.
    const name = relativePath && relativePath !== "."
      ? relativePath.split("/").pop() || relativePath
      : "root";

    return {
      id: relativePath || "root",
      name,
      relativePath,
      languages: [...languages],
      frameworks: [...frameworks],
      databases: [...databases],
      infrastructure: [...infrastructure],
      packageManagers: [...packageManagers],
      ciTools: [...ciTools],
      facets: [...facets],
      manifests: manifests.slice(0, 12),
      fileCount,
    };
  }

  /**
   * Detect the SQL dialect from the migration and query files.
   */
  private async detectSqlDialect(
    root: string,
    sqlFiles: string[]
  ): Promise<string> {
    const signatures: Array<[string, RegExp]> = [
      ["PostgreSQL", /\b(SERIAL|BIGSERIAL|UUID|JSONB|ILIKE|RETURNING|CONCURRENTLY|bytea)\b/i],
      ["MySQL", /\b(ENGINE\s*=\s*InnoDB|AUTO_INCREMENT|UNSIGNED|TINYINT|MEDIUMINT|LONGTEXT|IFNULL)\b/i],
      ["SQLite", /\b(AUTOINCREMENT|sqlite_master|sqlite_sequence)\b/i],
      ["SQL Server", /\b(NVARCHAR|IDENTITY\s*\(|GETDATE\s*\(|SYSDATETIME)\b/i],
      ["Oracle", /\b(VARCHAR2|CONNECT\s+BY|SYSDATE|DBMS_|DUAL\b)\b/i],
    ]

    const scores = new Map<string, number>()
    for (const file of sqlFiles.slice(0, 40)) {
      let content = ""
      try {
        content = fs.readFileSync(path.join(root, file), "utf-8")
      } catch {
        continue
      }
      for (const [dialect, pattern] of signatures) {
        const matches = content.match(new RegExp(pattern.source, "gi"))
        if (matches) {
          scores.set(dialect, (scores.get(dialect) || 0) + matches.length)
        }
      }
    }

    let best = ""
    let bestScore = 0
    for (const [dialect, score] of scores) {
      if (score > bestScore) {
        bestScore = score
        best = dialect
      }
    }

    return best || "SQL"
  }

  /**
   * Combine the components into one project level stack.
   */
  private mergeTechStack(components: ComponentInfo[]): TechStack {
    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const databases = new Set<string>();
    const infrastructure = new Set<string>();
    const packageManagers = new Set<string>();
    const ciTools = new Set<string>();
    const facets = new Set<Facet>();

    for (const component of components) {
      component.languages.forEach(l => languages.add(l));
      component.frameworks.forEach(f => frameworks.add(f));
      component.databases.forEach(d => databases.add(d));
      component.infrastructure.forEach(i => infrastructure.add(i));
      component.packageManagers.forEach(p => packageManagers.add(p));
      component.ciTools.forEach(c => ciTools.add(c));
      component.facets.forEach(f => facets.add(f));
    }

    return {
      languages: [...languages],
      frameworks: [...frameworks],
      databases: [...databases],
      infrastructure: [...infrastructure],
      packageManagers: [...packageManagers],
      ciTools: [...ciTools],
      facets: [...facets],
    };
  }

  private readFile(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  private readJson(filePath: string): any {
    const content = this.readFile(filePath);
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}
