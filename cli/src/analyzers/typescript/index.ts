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
 * TypeScript / JavaScript analyzer.
 *
 * The same rules apply to both, the only difference is the language that is
 * reported for the finding.
 */
export class TypeScriptAnalyzer extends BaseRuleAnalyzer {
  readonly id = "typescript-analyzer-v2";
  readonly language = "typescript";
  readonly displayName = "TypeScript Analyzer";
  readonly facet = Facet.CODE;
  readonly extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
  readonly covers = ["javascript"];
  readonly commentPrefixes = ["//", "*", "/*"];

  readonly rules: Rule[] = [
    {
      ruleId: "TS-001",
      title: "Console statement found",
      description:
        "Console output is usually debug output and is noisy in production",
      action: "Use a proper logger or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /console\.(log|debug|info|trace)\s*\(/,
      once: true,
    },
    {
      ruleId: "TS-002",
      title: "Use of 'any' type",
      description:
        "'any' disables the type checker, so bugs in that value are no longer caught",
      action: "Use a precise type, a generic or 'unknown' instead",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /:\s*any\b|\bas\s+any\b|<any>|any\[\]/,
    },
    {
      ruleId: "TS-003",
      title: "Loose equality",
      description:
        "== coerces the types, so '0' == 0 is true and values compare unexpectedly",
      action: "Use === and compare the types explicitly",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /[^=!<>]==[^=]|[^!]!=[^=]/,
    },
    {
      ruleId: "TS-004",
      title: "Type error suppressed",
      description:
        "@ts-ignore hides every type error on the next line, including real bugs",
      action: "Fix the type error or use @ts-expect-error with a reason",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /@ts-ignore(?![\s\S]*@ts-expect-error)/,
      matchComments: true,
    },
    {
      ruleId: "TS-005",
      title: "Non-null assertion",
      description:
        "The ! tells the compiler to skip the null check, so a null value crashes at runtime",
      action: "Handle the null case or use an optional chain",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /\w+!\s*[.,;)\]]/,
    },
    {
      ruleId: "TS-007",
      title: "var declaration used",
      description:
        "var is function scoped and hoisted, which makes the value harder to reason about",
      action: "Use let or const instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /(^|[^\w.$])var\s+[A-Za-z_$][\w$]*\s*[=;]/,
    },
    {
      ruleId: "TS-008",
      title: "Equality compared to null",
      description:
        "== null also matches undefined and 0, so it is not a null check",
      action: "Use === null or === undefined explicitly",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /[^=!<>]==\s*null\b/,
    },
    {
      ruleId: "TS-009",
      title: "Debugger statement left in the code",
      description:
        "A breakpoint pauses the program in the browser and blocks the thread in Node",
      action: "Remove the debugger statement before committing",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
      pattern: /(^|[^\w.])debugger\b/,
      once: true,
    },
    {
      ruleId: "TS-010",
      title: "Floating promise",
      description:
        "The promise is created but never awaited, so rejections are not handled and the code continues before it finishes",
      action: "Await the promise, or handle it with .catch()",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
      pattern: /^\s*(fetch|axios\.\w+|\w+\.(post|put|patch|delete|save|send|submit|upload|create|update))\s*\(/,
    },
    {
      ruleId: "TS-011",
      title: "Hardcoded credential",
      description:
        "A credential is stored in the source, so it ends up in version control",
      action: "Read the value from an environment variable",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /\b(password|passwd|secret|apiKey|api_key|accessToken|access_token|privateKey|clientSecret)\b\s*[:=]\s*["'][^"'\s${}]{6,}["']/i,
    },
    {
      ruleId: "TS-012",
      title: "Dynamic code execution",
      description:
        "eval and new Function execute code at runtime and are a common injection vector",
      action: "Replace with an explicit lookup",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /(^|[^\w.])(eval|new\s+Function)\s*\(/,
    },
    {
      ruleId: "TS-013",
      title: "setTimeout with a string",
      description:
        "A string argument to setTimeout is evaluated as code, which is an injection vector",
      action: "Pass a function instead of a string",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /setTimeout\s*\(\s*["'`]/,
    },
    {
      ruleId: "TS-014",
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
      ruleId: "TS-015",
      title: "Empty function body",
      description:
        "The function does nothing, which is usually an unfinished implementation",
      action: "Implement it or remove it",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /=>\s*\{\s*\}\s*$/,
    },
    {
      ruleId: "TS-016",
      title: "Loose null comparison",
      description:
        "The comparison relies on coercion, so empty strings and 0 match as well",
      action: "Compare the types explicitly",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
      pattern: /[^=!<>]=\s*(null|undefined)\b/,
    },
    {
      ruleId: "TS-017",
      title: "Dangerously set inner HTML",
      description:
        "Assigning HTML enables cross site scripting when the value contains user input",
      action: "Use textContent, or sanitise the value first",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern: /\.innerHTML\s*=/,
    },
    {
      ruleId: "TS-018",
      title: "Shell command execution",
      description:
        "child_process runs shell commands, so anything that reaches the argument runs as a command",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /\b(?:child_process\.)?(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/,
    },
    {
      ruleId: "TS-019",
      title: "Shell command built by concatenation",
      description:
        "A value that reaches the shell changes the command that runs, so a name like '; rm -rf /' runs as well",
      action: "Pass the arguments as a list instead of building a string",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern:
        /\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/,
    },
    {
      ruleId: "TS-020",
      title: "SQL built by concatenation",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a parameterised query instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern:
        /\b(?:query|execute|raw|prepare)\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/i,
    },
    {
      ruleId: "TS-021",
      title: "eval used",
      description:
        "eval runs a string as code, so anything that reaches it runs as code too",
      action: "Remove the eval",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /\beval\s*\(/,
    },
    {
      ruleId: "TS-022",
      title: "Code built from a string",
      description:
        "new Function compiles a string into code, so anything that reaches it runs as code too",
      action: "Remove it, or build the function from real code",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /\bnew\s+Function\s*\(/,
    },
    {
      ruleId: "TS-023",
      title: "React's dangerous HTML prop",
      description:
        "dangerouslySetInnerHTML puts HTML into the page, which enables cross site scripting",
      action: "Use textContent, or sanitise the value first",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /dangerouslySetInnerHTML/,
    },
    {
      ruleId: "TS-024",
      title: "A file read from a path that is built at runtime",
      description:
        "A path assembled from data can reach outside the folder the program meant to read",
      action: "Check the path is inside the folder you meant before reading it",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /\b(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync)\s*\(\s*(?:`[^`]*\$\{|[^)]*\+)/,
    },
    {
      ruleId: "TS-025",
      title: "A redirect to a URL that is built at runtime",
      description:
        "A redirect built from data sends the person wherever the data says, which is how open redirects happen",
      action: "Check the address against a list of the ones you mean",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern:
        /\b(?:redirect|res\.redirect|window\.location(?:\.href)?\s*=)\s*\(?\s*(?:`[^`]*\$\{|[^)]*\+)/,
    },
    {
      ruleId: "TS-026",
      title: "The whole environment handed to a child process",
      description:
        "Spreading the environment into a child process passes every secret the program holds",
      action: "Pass only the variables the child actually needs",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /env\s*:\s*\{\s*\.\.\.\s*process\.env/,
    },
    {
      ruleId: "TS-027",
      title: "A prototype is changed",
      description:
        "Changing the prototype affects every object of that kind, which is how prototype pollution works",
      action: "Use a Map, or own the object rather than the prototype",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
      pattern: /\.__proto__\s*=|Object\.prototype\s*\[/,
    },
  ];

  /**
   * JavaScript files are reported as JavaScript, TypeScript files as
   * TypeScript, even though one analyzer covers both.
   */
  protected languageForFile(file: string): string {
    return /\.(js|jsx|mjs|cjs)$/i.test(file) ? "javascript" : "typescript"
  }

  fileChecks = [
    // A catch block that is empty swallows the error without a trace.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = this.findEmptyBlocks(context, /catch\s*(\([^)]*\))?\s*\{/)
      for (const line of lines) {
        findings.push({
          ruleId: "TS-006",
          title: "Empty error handler",
          description:
            "The catch block is empty, so the error is swallowed without a trace",
          action: "Log the error or re-throw it",
          severity: Severity.HIGH,
          category: Category.MAINTAINABILITY,
          confidence: Confidence.HIGH,
          line,
        })
      }
      return findings
    },
    // A function whose body is longer than 60 lines is hard to follow.
    (context: FileContext): FileFinding[] => {
      const findings: FileFinding[] = []
      const lines = context.lines

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(
          /^\s*(export\s+)?(async\s+)?function\s+(\w+)|^\s*(export\s+)?const\s+(\w+)\s*=\s*(async\s*)?\(/
        )
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
            ruleId: "TS-100",
            title: "Long function",
            description: `The function spans ${length} lines, which makes it hard to follow and to test`,
            action: "Split it into smaller, focused functions",
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
