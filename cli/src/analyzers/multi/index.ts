import {
  FindingValidation,
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
import { filesFor } from "../../services/fileIndex";
import { withEvidence } from "../../services/evidence";

/**
 * Rule definition: a regular expression plus the finding metadata.
 */
export interface Rule {
  pattern: RegExp;
  ruleId: string;
  title: string;
  description: string;
  action: string;
  severity: Severity;
  category: Category;
  confidence: Confidence;
  /** How sure the analyzer is, when the category alone does not say. */
  validation?: FindingValidation;
  /** Where to read more about this. */
  documentation?: string;
  /** The snippet must not quote what it found. */
  redact?: boolean;
}

/**
 * Shared implementation for every language that is not covered by the
 * dedicated Java / Python / TypeScript analyzers.
 */
export abstract class BaseLanguageAnalyzer implements LanguageAnalyzer {
  abstract readonly language: string;
  abstract readonly displayName: string;
  abstract readonly extensions: string[];
  abstract readonly rules: Rule[];

  /** The file types this analyzer reads. */
  get supportedExtensions(): string[] {
    return this.extensions;
  }

  readonly id = "multi-language-analyzer-v1";
  readonly version = "1.0.0";

  supports(context: ProjectContext): boolean {
    return context.detectedLanguages.includes(this.language);
  }

  async analyze(
    context: ProjectContext,
    config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      // The files come from the shared index, so the tree is walked only once
      const entries = await filesFor(context, this.extensions, context.projectPath);

      for (const entry of entries) {
        const file = entry.path;
        try {
          const content = fs.readFileSync(entry.absolutePath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith("//") || line.trim().startsWith("#")) {
              continue;
            }

            for (const rule of this.rules) {
              if (!rule.pattern.test(line)) continue;

              findings.push(
                withEvidence(
                  {
                    id: `${this.language}-${rule.ruleId}-${i}-${file}`,
                    ruleId: rule.ruleId,
                    language: this.language,
                    category: rule.category,
                    severity: rule.severity,
                    confidence: rule.confidence,
                    title: rule.title,
                    description: rule.description,
                    suggestedAction: rule.action,
                    location: {
                      filePath: file,
                      startLine: i + 1,
                      endLine: i + 1,
                    },
                    tool: this.displayName,
                    toolRuleId: rule.ruleId,
                    validation: rule.validation,
                    documentation: rule.documentation,
                  },
                  { lines, redact: rule.redact }
                )
              );
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    } catch (error) {
      console.error(`Error analyzing ${this.language} files:`, error);
    }

    return findings;
  }
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
export class GoAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "go";
  readonly displayName = "Go Analyzer";
  readonly extensions = ["go"];
  readonly rules: Rule[] = [
    {
      pattern: /\bfmt\.(Print|Printf|Println)\s*\(/,
      ruleId: "GO-001",
      title: "Console output found",
      description:
        "fmt.Print* writes directly to stdout, which is discouraged in production code",
      action: "Use a structured logger instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\binterface\s*\{\s*\}|interface\{\}/,
      ruleId: "GO-002",
      title: "Empty interface used",
      description:
        "interface{} disables compile-time type checking and hides real bugs",
      action: "Use a concrete type or generics instead",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bpanic\s*\(/,
      ruleId: "GO-003",
      title: "Panic used for error handling",
      description:
        "panic() terminates the program and should not be used for recoverable errors",
      action: "Return an error instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\b_+\s*=\s*|\b_\s*:=/,
      ruleId: "GO-004",
      title: "Error ignored with blank identifier",
      description:
        "Assigning an error to _ silently discards a potential failure",
      action: "Handle or explicitly log the error",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\b(?:Query|Exec)\s*\(\s*"[^"]*"\s*\+/,
      ruleId: "GO-005",
      title: "SQL built by concatenation",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a parameterised query instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bhttp\.(?:Get|Post|Head)\s*\(/,
      ruleId: "GO-006",
      title: "HTTP request without a timeout",
      description:
        "The default client has no timeout, so a slow server holds the request open for ever",
      action: "Use a client with a timeout",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /exec\.Command\s*\(\s*"(?:sh|bash|cmd)"/,
      ruleId: "GO-007",
      title: "Shell command with a concatenated argument",
      description:
        "A value that reaches the shell changes the command that runs",
      action: "Pass the arguments as a list instead of a string",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bos\.Chdir\s*\(/,
      ruleId: "GO-008",
      title: "Working directory changed",
      description:
        "os.Chdir moves the whole process, so every relative path after it is wrong",
      action: "Use an absolute path instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bfor\b[^{]*\{[^}]*\bdefer\b/,
      ruleId: "GO-009",
      title: "Deferred call inside a loop",
      description:
        "The deferred call waits until the function returns, so the resources pile up",
      action: "Move the loop into its own function",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\.Lock\s*\(\s*\)[^;]*\.await/,
      ruleId: "GO-010",
      title: "Mutex locked across a wait",
      description:
        "Holding the lock while waiting for something else can deadlock the program",
      action: "Take the lock after the wait, or use a channel",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------
export class RustAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "rust";
  readonly displayName = "Rust Analyzer";
  readonly extensions = ["rs"];
  readonly rules: Rule[] = [
    {
      pattern: /\.unwrap\s*\(\s*\)/,
      ruleId: "RS-001",
      title: "Unwrap on a Result or Option",
      description:
        "unwrap() panics on failure and should only be used when the failure is impossible",
      action: "Handle the error with match or the ? operator",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\.expect\s*\(/,
      ruleId: "RS-002",
      title: "expect() used on a Result",
      description: "expect() panics with the given message on failure",
      action: "Propagate the error with the ? operator",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprintln!|\bprint!|\beprintln!/,
      ruleId: "RS-003",
      title: "Console output found",
      description: "println!/print! write directly to stdout",
      action: "Use the log crate instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\.clone\s*\(\s*\)/,
      ruleId: "RS-004",
      title: "Unnecessary clone",
      description:
        "clone() copies the value and can be a hidden performance cost",
      action: "Borrow the value instead of cloning it",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bunsafe\s*\{/,
      ruleId: "RS-005",
      title: "Unsafe block",
      description:
        "unsafe turns off the checks the compiler would otherwise make",
      action: "Keep the unsafe part as small as possible and document why it is safe",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b(?:mem::forget|Box::leak|String::leak)\s*\(/,
      ruleId: "RS-006",
      title: "Memory deliberately leaked",
      description:
        "mem::forget and Box::leak never give the memory back",
      action: "Drop the value normally instead",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b(?:todo|unimplemented)!?\s*\(/,
      ruleId: "RS-007",
      title: "Unfinished code",
      description:
        "todo! and unimplemented! stop the program when they are reached",
      action: "Finish the code or return an error instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /std::process::exit\s*\(/,
      ruleId: "RS-008",
      title: "Process exits without unwinding",
      description:
        "std::process::exit skips the destructors, so anything that is still open is left behind",
      action: "Return from main instead",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\.await[^;]*\bstd::thread::sleep\s*\(/,
      ruleId: "RS-009",
      title: "Blocking call in async code",
      description:
        "A blocking call inside an async task stops every other task on the thread",
      action: "Use the async version of the call",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// C / C++
// ---------------------------------------------------------------------------
export class CppAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "cpp";
  readonly displayName = "C/C++ Analyzer";
  readonly extensions = ["c", "cc", "cpp", "cxx", "h", "hpp"];
  readonly rules: Rule[] = [
    {
      pattern: /\bprintf\s*\(|\bfprintf\s*\(/,
      ruleId: "CPP-001",
      title: "Console output found",
      description: "printf writes directly to stdout",
      action: "Use a logging library instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bmalloc\s*\(|\bcalloc\s*\(|\brealloc\s*\(/,
      ruleId: "CPP-002",
      title: "Manual memory allocation",
      description:
        "Manual malloc/calloc requires a matching free on every path, which is error prone",
      action: "Use RAII containers such as std::vector or smart pointers",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bgets\s*\(|\bstrcpy\s*\(|\bsprintf\s*\(/,
      ruleId: "CPP-003",
      title: "Unsafe string function",
      description:
        "gets/strcpy/sprintf can overflow the destination buffer",
      action: "Use strncpy, snprintf or std::string",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /^\s*#include\s*<\s*bits\//,
      ruleId: "CPP-004",
      title: "Non-portable include",
      description: "bits/stdc++.h is a GCC specific header and is not portable",
      action: "Include the specific standard headers you need",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b(?:strcpy|strcat|sprintf|gets)\s*\(/,
      ruleId: "CPP-005",
      title: "Unsafe string copy",
      description:
        "strcpy and strcat write past the end of the buffer when the source is longer",
      action: "Use a function that takes the size of the buffer",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bmalloc\s*\(|\bcalloc\s*\(|\brealloc\s*\(/,
      ruleId: "CPP-006",
      title: "Memory allocated without a matching free",
      description:
        "malloc hands the memory over and nothing gives it back",
      action: "Use a smart pointer, or pair the allocation with a free",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\b(?:atoi|atof|atol)\s*\(/,
      ruleId: "CPP-007",
      title: "Conversion without an error check",
      description:
        "atoi and atof cannot tell you that the string was not a number",
      action: "Use strtol or std::from_chars and check the result",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b\w+\s*\*\s*\w+\s*=\s*new\s+/,
      ruleId: "CPP-008",
      title: "Raw pointer used",
      description:
        "A raw pointer has no idea when the memory it points at is gone",
      action: "Use a smart pointer",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// C#
// ---------------------------------------------------------------------------
export class CSharpAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "csharp";
  readonly displayName = "C# Analyzer";
  readonly extensions = ["cs"];
  readonly rules: Rule[] = [
    {
      pattern: /Console\.(Write|WriteLine)\s*\(/,
      ruleId: "CS-001",
      title: "Console output found",
      description: "Console.Write writes directly to the standard output",
      action: "Use an ILogger implementation instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bcatch\s*\(\s*Exception\s+\w+\s*\)\s*\{\s*\}/,
      ruleId: "CS-002",
      title: "Empty catch block",
      description:
        "An empty catch block silently swallows every exception",
      action: "Log the exception or rethrow it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\basync\s+void\b/,
      ruleId: "CS-003",
      title: "async void method",
      description:
        "async void methods cannot be awaited, so exceptions are lost",
      action: "Return Task instead of void",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bpublic\s+.*\b(get|set)\s*;/,
      ruleId: "CS-004",
      title: "Auto-property without accessors",
      description: "Auto-properties expose mutable state without validation",
      action: "Use an explicit backing field when validation is needed",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\.Wait\s*\(\s*\)|\.Result\b/,
      ruleId: "CS-005",
      title: "Task result waited on",
      description:
        "Waiting for a task blocks the thread, which deadlocks in a synchronisation context",
      action: "Await the task instead",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\basync\s+void\b/,
      ruleId: "CS-006",
      title: "async void method",
      description:
        "An async void method cannot be awaited, so an exception in it takes the whole process down",
      action: "Return Task instead of void",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /catch\s*\(\s*(?:System\.)?Exception\s+\w+\s*\)/,
      ruleId: "CS-007",
      title: "Catch of Exception",
      description:
        "Catching Exception catches everything, including the problems that should stop the program",
      action: "Catch the exception you can actually handle",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /new\s+(?:HttpClient|SqlConnection|StreamReader|FileStream)\s*\(/,
      ruleId: "CS-008",
      title: "Disposable not disposed",
      description:
        "A resource that is never disposed stays open until the finaliser runs",
      action: "Use a using statement, or dispose it in a finally block",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// PHP
// ---------------------------------------------------------------------------
export class PhpAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "php";
  readonly displayName = "PHP Analyzer";
  readonly extensions = ["php"];
  readonly rules: Rule[] = [
    {
      pattern: /\bvar_dump\s*\(|\bprint_r\s*\(/,
      ruleId: "PHP-001",
      title: "Debug output found",
      description: "var_dump/print_r dump runtime data to the output",
      action: "Remove the debug call before committing",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\beval\s*\(/,
      ruleId: "PHP-002",
      title: "eval() used",
      description:
        "eval executes arbitrary code and is a common remote code execution vector",
      action: "Remove eval and use a safe alternative",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /error_reporting\s*\(\s*E_ALL\s*\)/,
      ruleId: "PHP-003",
      title: "Verbose error reporting enabled",
      description:
        "E_ALL exposes internal paths and sensitive data in production responses",
      action: "Disable detailed errors in production",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bexec\s*\(|\bshell_exec\s*\(|\bpassthru\s*\(/,
      ruleId: "PHP-004",
      title: "Shell command execution",
      description:
        "exec/shell_exec run shell commands and are risky with untrusted input",
      action: "Validate inputs and prefer safer APIs",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\beval\s*\(/,
      ruleId: "PHP-005",
      title: "eval used",
      description:
        "eval runs a string as code, so anything that reaches it runs as code too",
      action: "Remove the eval",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bextract\s*\(/,
      ruleId: "PHP-006",
      title: "extract used",
      description:
        "extract writes the keys of an array into variables, so a key can overwrite anything",
      action: "Read the values out of the array by name",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /(?:mysqli?_query|->query)\s*\(\s*["\'][^"\']*["\']\s*\./,
      ruleId: "PHP-007",
      title: "SQL built by concatenation",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a prepared statement with bound values",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b(?:system|exec|shell_exec|passthru|popen)\s*\(/,
      ruleId: "PHP-008",
      title: "Command run through the shell",
      description:
        "A value that reaches the shell changes the command that runs",
      action: "Pass the arguments as a list instead of a string",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
  ];
}

// ---------------------------------------------------------------------------
// Ruby
// ---------------------------------------------------------------------------
export class RubyAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "ruby";
  readonly displayName = "Ruby Analyzer";
  readonly extensions = ["rb"];
  readonly rules: Rule[] = [
    {
      pattern: /\bbinding\.pry\b|\bdebugger\b/,
      ruleId: "RB-001",
      title: "Debugger left in code",
      description:
        "A debugger breakpoint left in committed code stops the process at runtime",
      action: "Remove the debugger statement",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bputs\s+|\bprint\s+["']/,
      ruleId: "RB-002",
      title: "Console output found",
      description: "puts/print write directly to stdout",
      action: "Use a logger instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\brescue\s*=>\s*nil\b|\brescue\s+Exception\s*=>\s*nil\b/,
      ruleId: "RB-003",
      title: "Exception silently swallowed",
      description: "Rescuing and returning nil hides the failure from callers",
      action: "Log the error or re-raise it",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /==\s*nil\b/,
      ruleId: "RB-004",
      title: "Equality compared to nil",
      description: "Comparing with == nil misses false values",
      action: "Use nil? or present? instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\b(?:eval|instance_eval|class_eval|module_eval)\s*[\s(]/,
      ruleId: "RB-005",
      title: "Code run from a string",
      description:
        "eval and the eval family run a string as code, so anything that reaches it runs as code too",
      action: "Remove the eval",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b(?:system|exec|spawn)\s*\(|\bKernel\.system\s*\(/,
      ruleId: "RB-006",
      title: "Command run through the shell",
      description:
        "A value that reaches the shell changes the command that runs",
      action: "Pass the arguments as a list instead of a string",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /rescue\s+Exception\b/,
      ruleId: "RB-007",
      title: "Rescue of Exception",
      description:
        "Rescuing Exception catches everything, including the problems that should stop the program",
      action: "Rescue the class of error you can actually handle",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /params\.permit!|\bpermit!\s*\(/,
      ruleId: "RB-008",
      title: "Mass assignment",
      description:
        "params.permit! lets every field of the request through, including the ones you did not think about",
      action: "Permit the fields you actually want",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Kotlin
// ---------------------------------------------------------------------------
export class KotlinAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "kotlin";
  readonly displayName = "Kotlin Analyzer";
  readonly extensions = ["kt", "kts"];
  readonly rules: Rule[] = [
    {
      pattern: /!!\s*[;)\]]/,
      ruleId: "KT-001",
      title: "Unsafe null assertion",
      description: "The !! operator throws a NullPointerException when the value is null",
      action: "Use the safe call operator ?.",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bprintln\s*\(/,
      ruleId: "KT-002",
      title: "Console output found",
      description: "println writes directly to stdout",
      action: "Use a logging framework instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /catch\s*\(\s*\w+\s*:?\s*\w*\s*\)\s*\{\s*\}/,
      ruleId: "KT-003",
      title: "Empty catch block",
      description: "An empty catch block hides every failure",
      action: "Log the exception or handle it explicitly",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bGlobalScope\b/,
      ruleId: "KT-004",
      title: "GlobalScope coroutine used",
      description:
        "GlobalScope jobs are not tied to any lifecycle and can leak",
      action: "Use a structured concurrency scope instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /!!\s*[.,;)\]]/,
      ruleId: "KT-005",
      title: "Non-null assertion",
      description:
        "A !! throws when the value is null, which is exactly the case the type said could not happen",
      action: "Use a safe call or handle the null",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /GlobalScope\s*\.\s*\w+\s*\{/,
      ruleId: "KT-006",
      title: "Coroutine outside a lifecycle",
      description:
        "GlobalScope is not tied to anything, so the work keeps going after the screen is gone",
      action: "Use a scope that is tied to the lifecycle",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /Thread\.sleep\s*\(/,
      ruleId: "KT-007",
      title: "Blocking sleep",
      description:
        "Thread.sleep blocks the thread instead of letting it do something else",
      action: "Use delay, which is a coroutine",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprintln\s*\(/,
      ruleId: "KT-008",
      title: "Console output found",
      description:
        "A print left in the code ends up in the logs of a user",
      action: "Use a logger instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
  ];
}

// ---------------------------------------------------------------------------
// Swift
// ---------------------------------------------------------------------------
export class SwiftAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "swift";
  readonly displayName = "Swift Analyzer";
  readonly extensions = ["swift"];
  readonly rules: Rule[] = [
    {
      pattern: /\bprint\s*\(|\bdebugPrint\s*\(/,
      ruleId: "SW-001",
      title: "Console output found",
      description: "print/debugPrint write directly to stdout",
      action: "Use os_log or a logging framework instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /try\?|\bas!\s/,
      ruleId: "SW-002",
      title: "Error handling skipped",
      description:
        "try? discards the error and as! crashes when the cast fails",
      action: "Handle the error explicitly with do/catch",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /catch\s*\{\s*\}/,
      ruleId: "SW-003",
      title: "Empty catch block",
      description: "An empty catch hides every error",
      action: "Log or handle the error",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /Thread\.sleep\s*\(/,
      ruleId: "SW-004",
      title: "Blocking sleep on a thread",
      description: "Thread.sleep blocks the calling thread and wastes CPU cycles",
      action: "Use an async sleep or a scheduler instead",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\btry!/,
      ruleId: "SW-005",
      title: "try! used",
      description:
        "try! stops the program when the call fails",
      action: "Handle the error, or use try? and deal with the optional",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bfatalError\s*\(/,
      ruleId: "SW-006",
      title: "fatalError used",
      description:
        "fatalError stops the program, and it cannot be caught",
      action: "Throw an error the caller can handle",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /[A-Za-z0-9_\)\]]!(?![=])/,
      ruleId: "SW-007",
      title: "Force unwrap",
      description:
        "A force unwrap stops the program when the value is nil",
      action: "Use a guard or an if let",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\.detach\s*\(\s*\)/,
      ruleId: "SW-008",
      title: "Thread detached",
      description:
        "A detached thread keeps running after the screen that started it is gone",
      action: "Keep a reference to it and cancel it",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Dart
// ---------------------------------------------------------------------------
export class DartAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "dart";
  readonly displayName = "Dart Analyzer";
  readonly extensions = ["dart"];
  readonly rules: Rule[] = [
    {
      pattern: /\bprint\s*\(/,
      ruleId: "DART-001",
      title: "Console output found",
      description: "print writes directly to stdout",
      action: "Use the logging package instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,
      ruleId: "DART-002",
      title: "Empty catch block",
      description: "An empty catch block hides every error",
      action: "Log the error or rethrow it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bdynamic\b/,
      ruleId: "DART-003",
      title: "Dynamic type used",
      description: "dynamic disables compile-time type checking",
      action: "Use a concrete type instead",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bprint\s*\(/,
      ruleId: "DART-004",
      title: "Console output found",
      description:
        "A print left in the code ends up in the logs of a user",
      action: "Use a logger instead",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /await[^;]*setState\s*\(/,
      ruleId: "DART-005",
      title: "setState after an await",
      description:
        "The widget can be gone by the time the await finishes, and setState then throws",
      action: "Check that the widget is still mounted before calling setState",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /catch\s*\([^)]*\)\s*\{\s*\}/,
      ruleId: "DART-006",
      title: "Empty catch block",
      description:
        "An error that is caught and thrown away looks like the code worked",
      action: "Handle the error or say what you are doing with it",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /Timer\s*\(\s*(?:Duration|[0-9])/,
      ruleId: "DART-007",
      title: "Timer never cancelled",
      description:
        "A timer that is not cancelled keeps firing after the screen is gone",
      action: "Cancel the timer when the screen is closed",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
export class ShellAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "shell";
  readonly displayName = "Shell Analyzer";
  readonly extensions = ["sh", "bash", "zsh"];
  readonly rules: Rule[] = [
    {
      pattern: /\beval\s+/,
      ruleId: "SH-001",
      title: "eval used in shell script",
      description: "eval executes arbitrary code and is a command injection risk",
      action: "Avoid eval and pass arguments directly",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /rm\s+(-[a-zA-Z]*\s+)*-?[rf]{1,2}[a-zA-Z]*\s+\/(\s|$)/,
      ruleId: "SH-002",
      title: "Recursive delete of the filesystem root",
      description: "rm -rf / destroys the entire system",
      action: "Scope the delete to a specific directory",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\becho\s+.*\$\(/,
      ruleId: "SH-003",
      title: "Unquoted command substitution",
      description:
        "Unquoted command substitution breaks on values containing spaces",
      action: "Quote the substitution: \"$(...)\"",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /^\s*set\s+-e\s*$/,
      ruleId: "SH-004",
      title: "Shell runs with errexit enabled",
      description: "set -e aborts the script on any error, which can hide failures",
      action: "Handle errors explicitly instead of relying on set -e",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /(?:^|[;&|]\s*)eval\s+/,
      ruleId: "SH-005",
      title: "eval used",
      description:
        "eval runs a string as a command, so anything that reaches it runs as a command too",
      action: "Remove the eval",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /rm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*r[a-zA-Z]*f/,
      ruleId: "SH-006",
      title: "Destructive delete",
      description:
        "rm -rf with an unquoted variable removes whatever the variable happens to be",
      action: "Quote the path, and check it before you delete it",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?(?![\w"\'])/,
      ruleId: "SH-007",
      title: "Unquoted variable",
      description:
        "An unquoted variable is split into words and expanded, so a value with a space becomes two arguments",
      action: 'Quote the variable: "$var"',
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/,
      ruleId: "SH-008",
      title: "Download piped into a shell",
      description:
        "Running whatever was downloaded means the server decides what runs on your machine",
      action: "Download it, look at it, then run it",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
  ];
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// All analyzers, for easy registration
// ---------------------------------------------------------------------------
import { MORE_ANALYZERS } from "./languages";

export const ADDITIONAL_ANALYZERS = [
  new GoAnalyzer(),
  new RustAnalyzer(),
  new CppAnalyzer(),
  new CSharpAnalyzer(),
  new PhpAnalyzer(),
  new RubyAnalyzer(),
  new KotlinAnalyzer(),
  new SwiftAnalyzer(),
  new DartAnalyzer(),
  new ShellAnalyzer(),
  // The languages that had nothing but the generic rules.
  ...MORE_ANALYZERS,
];
