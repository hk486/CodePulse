import {
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import {
  BaseRuleAnalyzer,
  Rule,
  FileFinding,
  FileContext,
} from "../base/RuleAnalyzer";

/**
 * Python analyzer.
 *
 * Covers the issues that actually show up in production Python: swallowed
 * exceptions, mutable default arguments, unsafe deserialisation, shell
 * injection, missing timeouts and hardcoded credentials.
 */
export class PythonAnalyzer extends BaseRuleAnalyzer {
  readonly id = "python-analyzer-v2";
  readonly language = "python";
  readonly displayName = "Python Analyzer";
  readonly facet = Facet.CODE;
  readonly extensions = ["py", "pyw"];
  readonly commentPrefixes = ["#"];

  readonly rules: Rule[] = [
    {
      ruleId: "PY-001",
      title: "Bare except clause",
      description:
        "A bare `except:` also swallows KeyboardInterrupt and SystemExit, so the program cannot be interrupted",
      action: "Catch the specific exception types you expect",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /^\s*except\s*:/,
    },
    {
      ruleId: "PY-003",
      title: "Mutable default argument",
      description:
        "A list or dict default is created once and shared between every call, which leaks state between requests",
      action: "Use None as the default and create the value inside the function",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\)|dict\(\))/,
    },
    {
      ruleId: "PY-004",
      title: "eval or exec used",
      description:
        "eval/exec run arbitrary code at runtime and are a remote code execution vector when the input is not trusted",
      action: "Replace with an explicit dispatch table or ast.literal_eval",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /(^|[^\w.])(eval|exec)\s*\(/,
    },
    {
      ruleId: "PY-005",
      title: "Shell command execution",
      description:
        "The command is passed to a shell, so untrusted input can inject extra commands",
      action: "Use a list of arguments and shell=False",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern: /subprocess\.(call|run|Popen|check_output|check_call)\s*\([^)]*shell\s*=\s*True/,
    },
    {
      ruleId: "PY-006",
      title: "Unsafe YAML load",
      description:
        "yaml.load without SafeLoader can construct arbitrary Python objects from the document",
      action: "Use yaml.safe_load instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /yaml\.load\s*\((?![^)]*Safe)/,
    },
    {
      ruleId: "PY-007",
      title: "Unsafe deserialisation",
      description:
        "pickle and marshal execute arbitrary code while loading, so an untrusted payload can compromise the process",
      action: "Use JSON or another safe format for untrusted data",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /(^|[^\w.])(pickle|cPickle|dill|marshal)\.(loads?|load)\s*\(/,
    },
    {
      ruleId: "PY-008",
      title: "HTTP request without a timeout",
      description:
        "A request without a timeout can hang forever and block the worker",
      action: "Pass an explicit timeout to the request",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
      pattern: /\b(requests|httpx)\.(get|post|put|patch|delete|head|request)\s*\((?![^)]*timeout)/,
    },
    {
      ruleId: "PY-009",
      // The credential itself is not written into the report.
      redact: true,
      title: "Hardcoded credential",
      description:
        "A credential is stored in the source, so it ends up in version control",
      action: "Read the value from an environment variable or a secret manager",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /\b(password|passwd|pwd|secret|api_key|apikey|access_token|auth_token|private_key|client_secret)\b\s*=\s*["'][^"'\s${}]{4,}["']/i,
    },
    {
      ruleId: "PY-010",
      title: "assert used for validation",
      description:
        "assert is removed when Python runs with -O, so the check silently disappears in production",
      action: "Raise an exception explicitly instead of asserting",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*assert\s+/,
    },
    {
      ruleId: "PY-011",
      title: "Equality compared to None",
      description:
        "== None also matches objects that only define __eq__, so `is None` is the correct check",
      action: "Use `is None` / `is not None`",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /[^=!<>]==\s*None\b/,
    },
    {
      ruleId: "PY-012",
      title: "Wildcard import",
      description:
        "`from x import *` hides where names come from and can silently overwrite your own",
      action: "Import the names you actually use",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /^\s*from\s+[\w.]+\s+import\s+\*/,
    },
    {
      ruleId: "PY-013",
      title: "Global statement used",
      description:
        "A global makes the function depend on shared state that is hard to follow and to test",
      action: "Pass the value in as an argument or return it instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*global\s+\w+/,
    },
    {
      ruleId: "PY-014",
      title: "Debug print left in the code",
      description: "A print statement usually means debugging output was left behind",
      action: "Remove it or route it through the logging module",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*print\s*\(/,
    },
    {
      ruleId: "PY-015",
      title: "Blocking sleep in async code",
      description:
        "time.sleep blocks the event loop, so every other coroutine waits with it",
      action: "Use asyncio.sleep in async code",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*time\.sleep\s*\(/,
    },
    {
      ruleId: "PY-016",
      title: "Unfinished work marker",
      description: "A TODO/FIXME marker was committed instead of being resolved",
      action: "Resolve it or track it in your issue tracker",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /#\s*(TODO|FIXME|HACK|XXX)\b/,
      once: true,
      matchComments: true,
    },
    {
      ruleId: "PY-017",
      title: "Disabled error check",
      description:
        "The exception class is marked as ignored, so the error is never reported",
      action: "Remove the noqa or handle the error properly",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /except\b[^:]*:\s*#\s*noqa/,
    },
    {
      ruleId: "PY-018",
      title: "Local variable shadows a builtin",
      description:
        "Shadowing a builtin such as id, list or str makes the original unusable inside that scope",
      action: "Rename the variable",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /^\s*(id|type|list|dict|set|str|int|float|bool|input|filter|map|sum|min|max|len|hash|next|object|bin|hex|format)\s*=\s*[^=]/,
    },
  ];

  /**
   * Whole file checks.
   */
  fileChecks = [
    // A handler that catches the error and then does nothing with it.
    // Python blocks are defined by indentation, not by braces.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = context.lines

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(\s*)except\b[^:]*:\s*$/)
        if (!match) continue

        const indent = match[1].length
        let body = ""
        for (let j = i + 1; j < lines.length; j++) {
          const trimmed = lines[j].trim()
          if (trimmed.length === 0) continue
          const lineIndent = lines[j].length - lines[j].trimStart().length
          if (lineIndent <= indent) break
          body = trimmed
          break
        }

        if (body === "pass" || body === "continue") {
          findings.push({
            ruleId: "PY-002",
            title: "Exception swallowed silently",
            description:
              "The handler catches the error but does nothing with it, so failures disappear without a trace",
            action: "Log the exception or re-raise it",
            severity: Severity.HIGH,
            category: Category.MAINTAINABILITY,
            confidence: Confidence.HIGH,
            line: i + 1,
          })
        }
      }

      return findings
    },
    // A function whose body is longer than 60 lines is hard to follow.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = context.lines

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*def\s+(\w+)\s*\(/)
        if (!match) continue

        const indent = lines[i].length - lines[i].trimStart().length
        let length = 0
        for (let j = i + 1; j < lines.length; j++) {
          const lineIndent = lines[j].length - lines[j].trimStart().length
          if (lines[j].trim().length === 0) continue
          if (lineIndent <= indent) break
          length++
        }

        if (length > 60) {
          findings.push({
            ruleId: "PY-100",
            title: "Long function",
            description: `The function "${match[1]}" spans ${length} lines, which makes it hard to follow and to test`,
            action: "Split the function into smaller, focused functions",
            severity: Severity.MEDIUM,
            category: Category.COMPLEXITY,
            confidence: Confidence.MEDIUM,
            line: i + 1,
          })
        }
      }

      return findings
    },
  ]
}
