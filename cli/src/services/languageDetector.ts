import * as fs from "fs";
import * as path from "path";
import { EXTENSION_LANGUAGES, type FileEntry } from "./fileIndex";

export interface LanguageDetection {
  byPath: Map<string, string>;
  languages: string[];
  counts: Record<string, number>;
  dialects: Record<string, string>;
  technologies: string[];
  evidence: Record<string, string[]>;
  /** The files that are manifests rather than source. */
  manifestPaths: Set<string>;
}

const SIGNATURES: {
  language: string;
  test: (head: string, name: string) => boolean;
  via: string;
}[] = [
  { language: "php", test: (h) => /<\?php/i.test(h), via: "content" },
  { language: "xml", test: (h) => /^\s*<\?xml/i.test(h), via: "content" },
  { language: "html", test: (h) => /<!doctype html/i.test(h), via: "content" },
  { language: "perl", test: (h) => /^#!.*\bperl\b/m.test(h), via: "shebang" },
  { language: "ruby", test: (h) => /^#!.*\bruby\b/m.test(h), via: "shebang" },
  { language: "python", test: (h) => /^#!.*\bpython[0-9.]*\b/m.test(h), via: "shebang" },
  { language: "shell", test: (h) => /^#!.*\b(bash|sh|zsh|ksh)\b/m.test(h), via: "shebang" },
  { language: "javascript", test: (h) => /^#!.*\bnode\b/m.test(h), via: "shebang" },
  { language: "erlang", test: (h) => /^-module\s*\(/m.test(h), via: "content" },
  { language: "clojure", test: (h) => /^\(ns\s+/m.test(h), via: "content" },
  { language: "haskell", test: (h) => /^(module|import)\s+[A-Z][\w.]*\s+where/m.test(h), via: "content" },
  { language: "elixir", test: (h) => /^\s*defmodule\s+[A-Z]/m.test(h), via: "content" },
  { language: "lua", test: (h) => /^\s*local\s+function\b/m.test(h), via: "content" },
  { language: "solidity", test: (h) => /^\s*(pragma solidity|contract\s+\w+\s+is)/m.test(h), via: "content" },
  { language: "protobuf", test: (h) => /^\s*(syntax\s*=\s*"proto[23]"|package\s+[\w.]+;|message\s+\w+\s*\{)/m.test(h), via: "content" },
  { language: "graphql", test: (h) => /^\s*(type|input|enum|interface|schema)\s+\w+.*\{/m.test(h), via: "content" },
  { language: "assembly", test: (h) => /^\s*(\.section|\.global|\.text)\b/m.test(h), via: "content" },
  { language: "matlab", test: (h) => /^\s*function\s+[^\n]*\n[\s\S]{0,400}?end\s*$/m.test(h), via: "content" },
  { language: "r", test: (h) => /^\s*(library\(|require\(|[A-Za-z.]+\s*<-\s*function)/m.test(h), via: "content" },
  { language: "powershell", test: (h) => /^\s*(param\s*\(|\$ErrorActionPreference\s*=)/m.test(h), via: "content" },
  { language: "julia", test: (h) => /^\s*function\s+\w+\([^\n]*\)\s*$/m.test(h) && /^\s*using\s+[A-Z]/m.test(h), via: "content" },
];

const FILENAMES: { language: string; match: (base: string) => boolean }[] = [
  { language: "docker", match: (b) => b === "dockerfile" || b === "containerfile" || b.endsWith(".dockerfile") },
  { language: "docker-compose", match: (b) => /^(docker-)?compose(?:[.-].+)?\.ya?ml$/.test(b) },
  { language: "make", match: (b) => b === "makefile" || b === "gnumakefile" },
  { language: "cmake", match: (b) => b === "cmakelists.txt" },
  { language: "terraform", match: (b) => b.endsWith(".tfvars") },
  { language: "groovy", match: (b) => b === "jenkinsfile" },
  { language: "bazel", match: (b) => b.endsWith(".bzl") || b === "build" || b === "workspace" },
  { language: "nix", match: (b) => b === "default.nix" || b === "shell.nix" },
];

const MANIFESTS: { language: string; match: (base: string) => boolean }[] = [
  { language: "go", match: (b) => b === "go.mod" || b === "go.sum" || b === "go.work" },
  { language: "python", match: (b) => b === "requirements.txt" || b === "pipfile" || b === "pyproject.toml" || b === "setup.py" || b === "setup.cfg" },
  { language: "rust", match: (b) => b === "cargo.toml" || b === "cargo.lock" },
  { language: "ruby", match: (b) => b === "gemfile" || b === "gemfile.lock" || b === "rakefile" },
  { language: "php", match: (b) => b === "composer.json" || b === "composer.lock" },
  { language: "java", match: (b) => b === "pom.xml" || b === "build.gradle" || b === "build.gradle.kts" },
  { language: "typescript", match: (b) => b === "tsconfig.json" || b.startsWith("tsconfig.") },
  { language: "elixir", match: (b) => b === "mix.exs" },
  { language: "dart", match: (b) => b === "pubspec.yaml" },
  { language: "swift", match: (b) => b === "package.swift" },
  { language: "csharp", match: (b) => b.endsWith(".csproj") || b.endsWith(".sln") },
  { language: "haskell", match: (b) => b === "stack.yaml" || b === "cabal.project" },
];

const SQL_DIALECTS: {
  dialect: string;
  test: (text: string) => boolean;
}[] = [
  { dialect: "tsql", test: (t) => /\b(NVARCHAR|VARCHAR\s*\(\s*MAX\b|GETDATE\s*\(|IDENTITY\s*\(|dbo\.|\[dbo\])/i.test(t) || /^\s*GO\s*$/im.test(t) },
  { dialect: "plsql", test: (t) => /\b(CREATE\s+OR\s+REPLACE\s+(PROCEDURE|FUNCTION|PACKAGE)|DBMS_|%\s*TYPE\b|NVL\s*\()/i.test(t) },
  { dialect: "postgresql", test: (t) => /\b(SERIAL|BIGSERIAL|JSONB|TIMESTAMPTZ|RETURNING\b|ILIKE\b|CREATE\s+EXTENSION)\b/i.test(t) || /::[a-z_]+\[\]?/i.test(t) },
  { dialect: "mysql", test: (t) => /`[^`]+`\s*\.\s*`|AUTO_INCREMENT|ENGINE\s*=\s*InnoDB|\bUNSIGNED\b/i.test(t) },
  { dialect: "sqlite", test: (t) => /\bAUTOINCREMENT\b|\bINTEGER\s+PRIMARY\s+KEY\b|\bPRAGMA\b/i.test(t) },
];

const MIGRATION_MARKERS: { pattern: RegExp; technology: string }[] = [
  { pattern: /(^|\/)migrations?\/V\d+__[^/]+\.sql$/i, technology: "Flyway" },
  { pattern: /(^|\/)db\/migrate\/\d+_/i, technology: "Rails migrations" },
  { pattern: /(^|\/)alembic\/versions\//i, technology: "Alembic" },
  { pattern: /(^|\/)migrations\/.*\.py$/i, technology: "Django migrations" },
  { pattern: /(^|\/)prisma\/migrations\//i, technology: "Prisma migrations" },
  { pattern: /(^|\/)liquibase\//i, technology: "Liquibase" },
];

export function detectLanguages(
  projectPath: string,
  entries: FileEntry[]
): LanguageDetection {
  const byPath = new Map<string, string>();
  const counts: Record<string, number> = {};
  const evidence: Record<string, string[]> = {};
  const technologies: string[] = [];
  const dialects: Record<string, string> = {};

  const note = (language: string, via: string) => {
    if (!evidence[language]) evidence[language] = [];
    if (!evidence[language].includes(via)) evidence[language].push(via);
  };

  const sqlText: string[] = [];
  const manifestPaths = new Set<string>();

  for (const entry of entries) {
    const base = path.basename(entry.path).toLowerCase();
    const extension = entry.extension.toLowerCase();

    let language: string | undefined;
    let via = "extension";

    for (const candidate of FILENAMES) {
      if (candidate.match(base)) {
        language = candidate.language;
        via = "filename";
        break;
      }
    }

    if (!language) {
      for (const candidate of MANIFESTS) {
        if (candidate.match(base)) {
          language = candidate.language;
          via = "manifest";
          manifestPaths.add(entry.path);
          break;
        }
      }
    }

    if (!language) {
      language = EXTENSION_LANGUAGES[extension];
    }

    // The C family needs the content: a header can be either.
    if (extension === "h" || extension === "hpp" || extension === "hh") {
      const head = readHead(projectPath, entry.absolutePath);
      if (head) {
        const looksCpp =
          /\b(class|namespace|template\s*<|public:|private:|protected:)\b/.test(head) ||
          /\bstd::/.test(head);
        language = looksCpp ? "cpp" : "c";
        via = "content";
      }
    }

    // Files with no extension, or an extension that says nothing, are
    // looked at.
    if (!language || language === "unknown") {
      const head = readHead(projectPath, entry.absolutePath);
      if (head) {
        for (const signature of SIGNATURES) {
          if (signature.test(head, base)) {
            language = signature.language;
            via = signature.via;
            break;
          }
        }
      }
    }

    if (!language) continue;

    byPath.set(entry.path, language);
    counts[language] = (counts[language] || 0) + 1;
    note(language, via);

    if (extension === "sql" || language === "sql") {
      const text = readHead(projectPath, entry.absolutePath, 20000);
      if (text) sqlText.push(text);
    }

    for (const marker of MIGRATION_MARKERS) {
      if (marker.pattern.test(entry.path) && !technologies.includes(marker.technology)) {
        technologies.push(marker.technology);
      }
    }
  }

  if (sqlText.length > 0) {
    const whole = sqlText.join("\n").slice(0, 200000);
    for (const candidate of SQL_DIALECTS) {
      if (candidate.test(whole)) {
        dialects.sql = candidate.dialect;
        note("sql", `dialect:${candidate.dialect}`);
        break;
      }
    }
  }

  const languages = Object.keys(counts).sort();
  return {
    byPath,
    languages,
    counts,
    dialects,
    technologies,
    evidence,
    manifestPaths,
  };
}

export function languageOfPath(
  detection: LanguageDetection | undefined,
  relativePath: string
): string | undefined {
  if (!detection) {
    return languageForFileName(relativePath);
  }
  const found = detection.byPath.get(relativePath);
  if (found) return found;
  return languageForFileName(relativePath);
}

export function languageForFileName(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  for (const candidate of FILENAMES) {
    if (candidate.match(base)) return candidate.language;
  }
  for (const candidate of MANIFESTS) {
    if (candidate.match(base)) return candidate.language;
  }
  const extension = path.extname(filePath).replace(/^\./, "").toLowerCase();
  return EXTENSION_LANGUAGES[extension] || "unknown";
}

function readHead(
  projectPath: string,
  absolutePath: string,
  bytes = 4096
): string | undefined {
  try {
    const handle = fs.openSync(absolutePath, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const read = fs.readSync(handle, buffer, 0, bytes, 0);
      return buffer.subarray(0, read).toString("utf-8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return undefined;
  }
}
