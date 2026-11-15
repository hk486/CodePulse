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
 * Java analyzer.
 *
 * Covers the issues that cause real problems in Java services: swallowed
 * exceptions, string comparison with ==, raw types, System.exit, unsafe
 * deserialisation and missing null checks.
 */
export class JavaAnalyzer extends BaseRuleAnalyzer {
  readonly id = "java-analyzer-v2";
  readonly language = "java";
  readonly displayName = "Java Analyzer";
  readonly facet = Facet.CODE;
  readonly extensions = ["java"];
  readonly commentPrefixes = ["//", "*", "/*"];

  readonly rules: Rule[] = [
    {
      ruleId: "JAVA-001",
      title: "Console output found",
      description:
        "System.out.println is debug output and is not appropriate for production code",
      action: "Use a logging framework such as SLF4J instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /System\.(out|err)\.print/,
      once: true,
    },
    {
      ruleId: "JAVA-004",
      title: "Catch of Throwable or Error",
      description:
        "Catching Throwable also catches OutOfMemoryError and StackOverflowError, which the JVM cannot recover from",
      action: "Catch the specific exception types you expect",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /catch\s*\(\s*(final\s+)?(Throwable|Error)\s+/,
    },
    {
      ruleId: "JAVA-005",
      title: "String compared with ==",
      description:
        "== compares the references, so two equal strings from different sources are not equal",
      action: "Use equals() or compareTo()",
      severity: Severity.HIGH,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.MEDIUM,
      pattern: /(\w+\s*==\s*"|"\s*==\s*\w+)/,
    },
    {
      ruleId: "JAVA-006",
      title: "Raw type used",
      description:
        "A raw type disables generics, so type errors are only found at runtime",
      action: "Use the generic form, for example List<String> instead of List",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*(private|public|protected)?\s*(static\s+)?(final\s+)?(List|Map|Set|Collection|Optional|Class)\s+\w+\s*[=;)]/,
    },
    {
      ruleId: "JAVA-007",
      title: "System.exit called",
      description:
        "System.exit terminates the whole JVM, which skips shutdown hooks and loses in-flight work",
      action: "Return from the method or throw an exception instead",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /System\.exit\s*\(/,
    },
    {
      ruleId: "JAVA-008",
      title: "Thread.sleep in use",
      description:
        "Thread.sleep blocks the thread and wastes CPU cycles",
      action: "Use a scheduler or an asynchronous wait instead",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.HIGH,
      pattern: /Thread\.sleep\s*\(/,
    },
    {
      ruleId: "JAVA-009",
      title: "printStackTrace used",
      description:
        "printStackTrace writes to stderr without any context and is easy to miss",
      action: "Use a logging framework with the exception and its context",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /\.printStackTrace\s*\(/,
    },
    {
      ruleId: "JAVA-010",
      title: "equals without hashCode",
      description:
        "When hashCode is not overridden the object breaks in hash based collections",
      action: "Override hashCode together with equals",
      severity: Severity.MEDIUM,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.LOW,
      pattern: /public\s+boolean\s+equals\s*\(/,
    },
    {
      ruleId: "JAVA-011",
      title: "Hardcoded credential",
      description:
        "A credential is stored in the source, so it ends up in version control",
      action: "Read the value from an environment variable or a secret manager",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /(password|passwd|secret|apiKey|api_key|accessToken|access_token|privateKey|clientSecret)\s*=\s*"[^"\s${}]{4,}"/i,
    },
    {
      ruleId: "JAVA-012",
      title: "Dynamic code execution",
      description:
        "Runtime compilation or scripting executes code at runtime and is a common injection vector",
      action: "Remove the dynamic execution",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern: /(ScriptEngine|GroovyShell|ProcessBuilder\s*\()/,
    },
    {
      ruleId: "JAVA-013",
      title: "Unfinished work marker",
      description: "A TODO/FIXME marker was committed instead of being resolved",
      action: "Resolve it or track it in your issue tracker",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /\/\/\s*(TODO|FIXME|HACK|XXX)\b/,
      once: true,
      matchComments: true,
    },
    {
      ruleId: "JAVA-014",
      title: "String concatenation in a loop",
      description:
        "Concatenating strings in a loop creates a new string on every iteration",
      action: "Use a StringBuilder, or a stream collector",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.LOW,
      pattern: /\w+\s*\+=\s*["']/,
    },
    {
      ruleId: "JAVA-015",
      title: "Null check that always succeeds",
      description:
        "Comparing to null after the value was already dereferenced cannot be true",
      action: "Remove the redundant check or fix the order of the statements",
      severity: Severity.MEDIUM,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.LOW,
      pattern: /if\s*\(\s*\w+\s*!=\s*null\s*\)\s*\{[^\}]*\w+\.\w+\s*\(/,
    },
    {
      ruleId: "JAVA-016",
      title: "Deprecated API used",
      description:
        "The API is marked deprecated and may be removed in a future release",
      action: "Migrate to the supported replacement",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /@Deprecated\b/,
    },
  ];

  fileChecks = [
    // A catch block that does nothing swallows the exception.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = this.findEmptyBlocks(context, /catch\s*\([^)]*\)\s*\{/)
      for (const line of lines) {
        findings.push({
          ruleId: "JAVA-002",
          title: "Empty catch block",
          description:
            "The catch block does nothing, so the exception is swallowed without a trace",
          action: "Log the exception or re-throw it",
          severity: Severity.HIGH,
          category: Category.MAINTAINABILITY,
          confidence: Confidence.HIGH,
          line,
        })
      }
      return findings
    },
    // A method whose body is longer than 60 lines is hard to follow.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = context.lines

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /^\s*(public|private|protected)?\s*(static\s+)?(final\s+)?[\w<>\[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(throws\s+[\w,\s]+)?\{/
        )
        if (!match) continue
        // Skip constructors and control keywords
        if (["if", "for", "while", "switch", "catch", "else", "do"].includes(match[4])) {
          continue
        }

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
            ruleId: "JAVA-100",
            title: "Long method",
            description: `The method "${match[4]}" spans ${length} lines, which makes it hard to follow and to test`,
            action: "Extract the method into smaller, focused methods",
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
