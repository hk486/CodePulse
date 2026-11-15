import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  Severity,
  Category,
  Confidence,
  FindingValidation,
  Facet,
  type Finding,
} from "@codepulse/shared";
import { withEvidence, redactSnippet } from "../evidence";

/**
 * The established tools.
 *
 * CodePulse's own rules find the problems it knows about. The established
 * tools find the ones it does not: a type checker knows the types, a
 * linter knows the style of a language, and a secret scanner knows what a
 * secret looks like.
 *
 * Every tool here is optional. When the program is not installed the tool
 * says so and the report says it was skipped. Nothing is ever pretended.
 */

export interface ToolContext {
  /** The folder the project is in. */
  projectPath: string;
  /** The files of the project, with their paths relative to the root. */
  files: { path: string; absolutePath: string; extension: string }[];
  /** The language each file is in, when it is known. */
  languageOf: (file: string) => string | undefined;
}

export interface ToolDefinition {
  /** The tool's own name, as it is installed. */
  id: string;
  /** The name a person recognises. */
  name: string;
  /** The program to run. */
  command: string;
  /** The arguments, worked out for the project. */
  args: (context: ToolContext) => string[];
  /** The languages this tool is for. Empty means every language. */
  languages?: string[];
  /** The file types this tool reads. */
  extensions?: string[];
  /** How long it may take. */
  timeoutMs?: number;
  /**
   * How much memory it may use, in megabytes.
   *
   * It is off by default: a limit on the address space stops a tool that
   * reserves a lot of memory for itself long before it stops a tool that
   * is using too much.
   */
  memoryLimitMb?: number;
  /** Where to read more about it. */
  documentation?: string;
  /**
   * The snippet must not quote what it found. A finding about a secret
   * must not repeat the secret.
   */
  redact?: boolean;
  /** What it found. */
  parse: (output: string, context: ToolContext) => Finding[];
}

export type ToolStatus = "completed" | "failed" | "unavailable" | "skipped";

export interface ToolRun {
  id: string;
  name: string;
  status: ToolStatus;
  durationMs: number;
  findingCount: number;
  filesAnalyzed: number;
  error?: string;
  reason?: string;
  version?: string;
  /** The tail of what the tool wrote, kept for the record. */
  log?: string;
}

/**
 * Runs a tool and reads what it says.
 */
export class ToolRunner {
  private available = new Map<string, boolean>();
  private versions = new Map<string, string>();

  /**
   * Is the program installed?
   */
  isAvailable(command: string): boolean {
    if (this.available.has(command)) return this.available.get(command)!;
    const found = Boolean(this.resolve(command));
    this.available.set(command, found);
    return found;
  }

  /**
   * Where the program is.
   *
   * The tools that came with the scanner are in its own node_modules, so
   * they are found there as well as on the path.
   */
  resolve(command: string): string | null {
    // The tools that came with the scanner are in its own node_modules,
    // or hoisted to the one above it.
    const roots = [
      path.join(__dirname, "..", "..", ".."),
      path.join(__dirname, "..", "..", "..", ".."),
    ];
    for (const root of roots) {
      const local = path.join(root, "node_modules", ".bin", command);
      try {
        fs.accessSync(local, fs.constants.X_OK);
        return local;
      } catch {
        // Not there. Look in the next place.
      }
    }
    return searchPath(command);
  }

  /**
   * The version of the tool, when it can be worked out cheaply.
   */
  async version(tool: ToolDefinition): Promise<string | undefined> {
    if (this.versions.has(tool.id)) return this.versions.get(tool.id);
    const program = this.resolve(tool.command);
    if (!program) return undefined;
    try {
      const { stdout } = await this.exec(program, ["--version"], 10000);
      const version = stdout.split("\n")[0]?.trim();
      if (version) this.versions.set(tool.id, version);
      return version;
    } catch {
      return undefined;
    }
  }

  /**
   * Run one tool over the project.
   */
  async run(tool: ToolDefinition, context: ToolContext): Promise<ToolRun> {
    const started = Date.now();

    if (!this.isAvailable(tool.command)) {
      return {
        id: tool.id,
        name: tool.name,
        status: "unavailable",
        durationMs: 0,
        findingCount: 0,
        filesAnalyzed: 0,
        reason: `${tool.command} is not installed, so this tool did not run.`,
      };
    }

    // Only the files this tool is for.
    const files = this.filesFor(tool, context);
    if (files.length === 0) {
      return {
        id: tool.id,
        name: tool.name,
        status: "skipped",
        durationMs: 0,
        findingCount: 0,
        filesAnalyzed: 0,
        reason: "There was nothing of the kind this tool reads.",
      };
    }

    try {
      const { stdout, stderr } = await this.exec(
        tool.command,
        tool.args(context),
        tool.timeoutMs ?? 120000,
        context.projectPath,
        tool
      );

      // Some tools write their report to stdout and their notes to
      // stderr, and some do it the other way round. The report is
      // whichever one parses.
      const findings = this.parseSafely(tool, stdout, context);
      const fromStderr = findings.length === 0 ? this.parseSafely(tool, stderr, context) : [];

      return {
        id: tool.id,
        name: tool.name,
        status: "completed",
        durationMs: Date.now() - started,
        findingCount: findings.length + fromStderr.length,
        filesAnalyzed: files.length,
        version: await this.version(tool),
        log: tailOf(stdout, stderr),
      };
    } catch (error) {
      return {
        id: tool.id,
        name: tool.name,
        status: "failed",
        durationMs: Date.now() - started,
        findingCount: 0,
        filesAnalyzed: files.length,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Run a tool and hand back what it found.
   */
  async analyze(
    tool: ToolDefinition,
    context: ToolContext
  ): Promise<{ run: ToolRun; findings: Finding[] }> {
    const started = Date.now();

    if (!this.isAvailable(tool.command)) {
      return {
        run: {
          id: tool.id,
          name: tool.name,
          status: "unavailable",
          durationMs: 0,
          findingCount: 0,
          filesAnalyzed: 0,
          reason: `${tool.command} is not installed, so this tool did not run.`,
        },
        findings: [],
      };
    }

    const files = this.filesFor(tool, context);
    if (files.length === 0) {
      return {
        run: {
          id: tool.id,
          name: tool.name,
          status: "skipped",
          durationMs: 0,
          findingCount: 0,
          filesAnalyzed: 0,
          reason: "There was nothing of the kind this tool reads.",
        },
        findings: [],
      };
    }

    const program = this.resolve(tool.command);
    if (!program) {
      return {
        run: {
          id: tool.id,
          name: tool.name,
          status: "unavailable",
          durationMs: 0,
          findingCount: 0,
          filesAnalyzed: 0,
          reason: `${tool.command} is not installed, so this tool did not run.`,
        },
        findings: [],
      };
    }

    try {
      const { stdout, stderr } = await this.exec(
        program,
        tool.args(context),
        tool.timeoutMs ?? 120000,
        context.projectPath,
        tool
      );

      let findings = this.parseSafely(tool, stdout, context);
      if (findings.length === 0) {
        findings = this.parseSafely(tool, stderr, context);
      }

      return {
        run: {
          id: tool.id,
          name: tool.name,
          status: "completed",
          durationMs: Date.now() - started,
          findingCount: findings.length,
          filesAnalyzed: files.length,
          version: await this.version(tool),
          log: tailOf(stdout, stderr),
        },
        findings,
      };
    } catch (error) {
      return {
        run: {
          id: tool.id,
          name: tool.name,
          status: "failed",
          durationMs: Date.now() - started,
          findingCount: 0,
          filesAnalyzed: files.length,
          error: error instanceof Error ? error.message : String(error),
        },
        findings: [],
      };
    }
  }

  /**
   * The files a tool should be given.
   */
  private filesFor(tool: ToolDefinition, context: ToolContext) {
    let files = context.files;

    if (tool.extensions && tool.extensions.length > 0) {
      const wanted = new Set(tool.extensions.map((e) => e.toLowerCase()));
      files = files.filter((file) => wanted.has(file.extension.toLowerCase()));
    }

    if (tool.languages && tool.languages.length > 0) {
      files = files.filter((file) => {
        const language = context.languageOf(file.path);
        return !language || tool.languages!.includes(language);
      });
    }

    return files;
  }

  /**
   * Read what a tool said, without letting a broken report stop the scan.
   */
  private parseSafely(
    tool: ToolDefinition,
    output: string,
    context: ToolContext
  ): Finding[] {
    if (!output || !output.trim()) return [];
    try {
      return tool.parse(output, context) || [];
    } catch (error) {
      console.error(
        `[tool] could not read the output of ${tool.name}:`,
        error instanceof Error ? error.message : error
      );
      return [];
    }
  }

  /**
   * Run a program and collect what it says.
   *
   * The program is run through the shell so that the limits are set
   * before it starts: the tool and everything it starts share them. The
   * project's own scripts are never run — only the named program, with
   * the arguments worked out here.
   */
  private exec(
    command: string,
    args: string[],
    timeoutMs: number,
    cwd?: string,
    tool?: ToolDefinition
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      // The limits. The clock is the same as the timeout, so a tool that
      // spins is stopped by the kernel as well as by the timer.
      const cpuSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
      const limits = [`ulimit -t ${cpuSeconds} 2>/dev/null || true`];
      if (tool?.memoryLimitMb) {
        limits.push(`ulimit -v ${tool.memoryLimitMb * 1024} 2>/dev/null || true`);
      }
      // "$0" is the program and "$@" are its arguments, so nothing has to
      // be quoted into the text of the command.
      const script = `${limits.join("; ")}; exec "$0" "$@"`;

      const child = spawn("/bin/sh", ["-c", script, command, ...args], {
        cwd,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        // The tool reads the project, and nothing else.
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // It is already gone.
        }
        reject(new Error(`${command} took too long and was stopped.`));
      }, timeoutMs);
      if (timer.unref) timer.unref();

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        // A tool that writes a lot must not fill the memory.
        if (stdout.length > 64 * 1024 * 1024) {
          try {
            child.kill("SIGTERM");
          } catch {
            // It is already gone.
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // A tool that found problems exits with a number that is not
        // zero. That is not a failure, so the code is passed back rather
        // than thrown.
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  }
}

/**
 * The tail of what a tool wrote.
 *
 * It is kept so a person can see why a tool said what it said. It is
 * bounded, because a tool can write a great deal.
 */
function tailOf(stdout: string, stderr: string, limit = 4000): string | undefined {
  const text = [stderr, stdout]
    .filter((part) => part && part.trim())
    .join("\n")
    .trim();
  if (!text) return undefined;
  return text.length > limit ? `…${text.slice(-limit)}` : text;
}

/**
 * Is the program on the path?
 */
function searchPath(command: string): string | null {
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const dir of paths) {
    if (!dir) continue;
    const full = path.join(dir, command);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch {
      // Keep looking.
    }
  }
  return null;
}

/**
 * The line of code a finding is about.
 */
export function lineOf(
  context: ToolContext,
  relativePath: string,
  line: number | undefined
): string | undefined {
  if (!line || line < 1) return undefined;
  try {
    const full = path.join(context.projectPath, relativePath);
    const content = fs.readFileSync(full, "utf-8");
    const lines = content.split("\n");
    const text = lines[line - 1];
    return text === undefined ? undefined : text.trim().slice(0, 240);
  } catch {
    return undefined;
  }
}

/**
 * Put a finding together the way every tool's finding is put together.
 */
export function toolFinding(options: {
  tool: ToolDefinition;
  ruleId: string;
  title: string;
  description: string;
  action?: string;
  severity: Severity;
  category: Category;
  confidence: Confidence;
  filePath: string;
  line?: number;
  context: ToolContext;
  validation?: FindingValidation;
  documentation?: string;
  /** Which layer of the project the finding belongs to. */
  facet?: Facet;
}): Finding {
  let snippet = lineOf(options.context, options.filePath, options.line);

  // A finding about a secret must not repeat the secret.
  if (options.tool.redact && snippet) {
    snippet = redactSnippet(snippet);
  }

  return withEvidence(
    {
      id: `${options.tool.id}-${options.ruleId}-${options.filePath}-${options.line || 0}`,
      ruleId: options.ruleId,
      language: options.context.languageOf(options.filePath) || "unknown",
      category: options.category,
      severity: options.severity,
      confidence: options.confidence,
      title: options.title,
      description: options.description,
      suggestedAction: options.action,
      location: {
        filePath: options.filePath,
        startLine: options.line || 1,
        endLine: options.line || 1,
      },
      tool: options.tool.name,
      toolRuleId: options.ruleId,
      validation: options.validation,
      documentation: options.documentation || options.tool.documentation,
      facet: options.facet,
      // The line of code the finding is about.
      snippet,
    },
    {}
  );
}
