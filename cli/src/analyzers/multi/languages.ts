import {
  Severity,
  Category,
  Confidence,
} from "@codepulse/shared";
import { BaseLanguageAnalyzer, type Rule } from "./index";

/**
 * The languages that had nothing but the generic rules.
 *
 * A language with no rules of its own gets the eight generic ones, which
 * catch very little. The languages here are the ones that turn up in real
 * projects often enough to be worth writing proper rules for.
 */

// ---------------------------------------------------------------------------
// Lua
// ---------------------------------------------------------------------------
export class LuaAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "lua";
  readonly displayName = "Lua Analyzer";
  readonly extensions = ["lua"];
  readonly rules: Rule[] = [
    {
      pattern: /\bloadstring\s*\(|\bload\s*\(/,
      ruleId: "LUA-001",
      title: "Code built from a string",
      description:
        "loadstring runs a string as code, so anything that reaches it runs as code too",
      action: "Remove it, or build the function from real code",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bos\.execute\s*\(|\bio\.popen\s*\(/,
      ruleId: "LUA-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprint\s*\(/,
      ruleId: "LUA-003",
      title: "Print statement",
      description: "Print output is usually debug output and is noisy in production",
      action: "Use a proper logger or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bsetfenv\s*\(|\bsetmetatable\s*\(/,
      ruleId: "LUA-004",
      title: "The environment of a function is changed",
      description:
        "Changing the environment changes what every name inside the function means",
      action: "Pass the values in as arguments instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bundefined\b|\bnil\s*==/,
      ruleId: "LUA-005",
      title: "A value that is not there",
      description:
        "Reading a field of nil is an error at runtime, not at compile time",
      action: "Check the value before reading through it",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\.\.\s*\.\./,
      ruleId: "LUA-006",
      title: "The table is unpacked",
      description:
        "Unpacking a table of unknown size can blow the stack when it is large",
      action: "Pass the table itself and let the other side unpack it",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bpcall\s*\(/,
      ruleId: "LUA-007",
      title: "An error is caught and ignored",
      description:
        "pcall without checking the result swallows the error without a trace",
      action: "Check the result and handle the error",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Scala
// ---------------------------------------------------------------------------
export class ScalaAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "scala";
  readonly displayName = "Scala Analyzer";
  readonly extensions = ["scala", "sc"];
  readonly rules: Rule[] = [
    {
      pattern: /System\.(?:out|err)\.print(?:ln)?\s*\(/,
      ruleId: "SCALA-001",
      title: "Print statement",
      description: "Print output is usually debug output and is noisy in production",
      action: "Use a proper logger or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bRuntime\.getRuntime\s*\(\)\.exec\s*\(/,
      ruleId: "SCALA-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bsql\s*\(\s*(?:s?"[^"]*"\s*\+|s?f?"[^"]*\{)/,
      ruleId: "SCALA-003",
      title: "SQL built by interpolation",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a parameterised query instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprintln\s*\(/,
      ruleId: "SCALA-004",
      title: "Print statement",
      description: "Print output is usually debug output and is noisy in production",
      action: "Use a proper logger or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bvar\s+\w+\s*[:=]/,
      ruleId: "SCALA-005",
      title: "A variable with no type",
      description:
        "var takes the type from the first value, so a later value of another type does not fit",
      action: "Name the type, so the mistake is caught where it is made",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bnull\s*==|\s==\s*null/,
      ruleId: "SCALA-006",
      title: "Compared with null",
      description:
        "Scala has no null, so a comparison with it is always false and the branch never runs",
      action: "Use Option and compare it with None",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bcatch\s*\{\s*case\s+\w+\s*=>\s*\}/,
      ruleId: "SCALA-007",
      title: "An error is caught and ignored",
      description:
        "The case does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Elixir
// ---------------------------------------------------------------------------
export class ElixirAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "elixir";
  readonly displayName = "Elixir Analyzer";
  readonly extensions = ["ex", "exs"];
  readonly rules: Rule[] = [
    {
      pattern: /Code\.eval_string\s*\(|Code\.eval_quoted\s*\(/,
      ruleId: "ELIXIR-001",
      title: "Code built from a string",
      description:
        "eval_string runs a string as code, so anything that reaches it runs as code too",
      action: "Remove it, or build the module from real code",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /:os\.cmd\s*\(|System\.cmd\s*\(/,
      ruleId: "ELIXIR-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /IO\.inspect\s*\(/,
      ruleId: "ELIXIR-003",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /Ecto\.query\s*\(\s*"/,
      ruleId: "ELIXIR-004",
      title: "A query written in one piece",
      description:
        "A query with no placeholders cannot be checked before it runs",
      action: "Use a query with placeholders, so the values are bound",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bProcess\.sleep\s*\(/,
      ruleId: "ELIXIR-005",
      title: "The process is put to sleep",
      description:
        "Sleeping holds a worker for no reason, and the usual reason to sleep is a race",
      action: "Wait for the thing you are waiting for instead",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\btry\s+do\b[\s\S]*?rescue\s*_->\s*nil\b/,
      ruleId: "ELIXIR-006",
      title: "An error is caught and ignored",
      description:
        "The rescue does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bString\.to_atom\s*\(/,
      ruleId: "ELIXIR-007",
      title: "A string turned into an atom",
      description:
        "Every atom stays in memory, so atoms made from data fill it up for ever",
      action: "Use a string, or a fixed set of atoms",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Erlang
// ---------------------------------------------------------------------------
export class ErlangAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "erlang";
  readonly displayName = "Erlang Analyzer";
  readonly extensions = ["erl", "hrl"];
  readonly rules: Rule[] = [
    {
      pattern: /\bos:cmd\s*\(/,
      ruleId: "ERLANG-001",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\berlang:binary_to_term\s*\(/,
      ruleId: "ERLANG-002",
      title: "A term read from outside",
      description:
        "binary_to_term makes any term, so untrusted bytes can become anything at all",
      action: "Use binary_to_term with the safe option",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bio:format\s*\(\s*"[^"]*"[^)]*~/,
      ruleId: "ERLANG-003",
      title: "A format string that is built",
      description:
        "A format built from data can read and write memory it should not",
      action: "Build the format from a fixed list of arguments",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bio:format\s*\(\s*"[^"]*"/,
      ruleId: "ERLANG-004",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\btimer:sleep\s*\(/,
      ruleId: "ERLANG-005",
      title: "The process is put to sleep",
      description:
        "Sleeping holds a worker for no reason, and the usual reason to sleep is a race",
      action: "Wait for the message you are waiting for instead",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bcatch\s+\w+\s*:\s*\w+\s*->/,
      ruleId: "ERLANG-006",
      title: "An error is caught and ignored",
      description:
        "The catch does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bfile:consult\s*\(\s*"/,
      ruleId: "ERLANG-007",
      title: "A file read as code",
      description:
        "consult reads a file as Erlang terms and runs them, so a file that changes is code that runs",
      action: "Read the file as data, and never run what it holds",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Haskell
// ---------------------------------------------------------------------------
export class HaskellAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "haskell";
  readonly displayName = "Haskell Analyzer";
  readonly extensions = ["hs", "lhs"];
  readonly rules: Rule[] = [
    {
      pattern: /\bunsafePerformIO\b/,
      ruleId: "HASKELL-001",
      title: "An effect outside the monad",
      description:
        "unsafePerformIO does an effect when the language says it cannot, so the order of the work is not what it looks like",
      action: "Move the effect into the monad and let the caller run it",
      severity: Severity.HIGH,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bread\s*\(\s*(?:"[^"]*"\s*\+|[a-z]\w*\s*\+)/,
      ruleId: "HASKELL-002",
      title: "A value read from outside",
      description:
        "read reads a value that is not part of the program, so a mistake in it is only found at runtime",
      action: "Take the value as an argument instead",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bundefined\b|\berror\s+"/,
      ruleId: "HASKELL-003",
      title: "The program stops on purpose",
      description:
        "error and undefined stop the program, and the message says nothing about what went wrong",
      action: "Return a value that says what went wrong, or throw an exception with one",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\btrace\s*\(/,
      ruleId: "HASKELL-004",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the trace",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bfromJust\s*\(|\bhead\s*\(|\blast\s*\(/,
      ruleId: "HASKELL-005",
      title: "A value that may not be there",
      description:
        "These throw when the value is missing, and there is nothing in the type that says so",
      action: "Match on the value and handle the case where it is missing",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bshow\s+.*\$\(|\binteract\b/,
      ruleId: "HASKELL-006",
      title: "The whole program is one expression",
      description:
        "A program built from one expression is hard to read and hard to test",
      action: "Break it into named functions",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bSystem\.IO\b|\bunsafeCoerce\b/,
      ruleId: "HASKELL-007",
      title: "The type system is turned off",
      description:
        "unsafeCoerce pretends one type is another, so a mistake is found far from where it was made",
      action: "Use a type that says what is really going on",
      severity: Severity.HIGH,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
  ];
}

// ---------------------------------------------------------------------------
// Clojure
// ---------------------------------------------------------------------------
export class ClojureAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "clojure";
  readonly displayName = "Clojure Analyzer";
  readonly extensions = ["clj", "cljs", "cljc"];
  readonly rules: Rule[] = [
    {
      pattern: /\(eval\b|\beval\s*\(/,
      ruleId: "CLOJURE-001",
      title: "Code built from a string",
      description:
        "eval runs a string as code, so anything that reaches it runs as code too",
      action: "Remove it, or use a macro instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\(shell\s+"/,
      ruleId: "CLOJURE-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprintln\s*\(|\bprn\s*\(/,
      ruleId: "CLOJURE-003",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bread-string\s*\(/,
      ruleId: "CLOJURE-004",
      title: "A value read from outside",
      description:
        "read-string reads a value that is not part of the program, so a mistake in it is only found at runtime",
      action: "Take the value as an argument instead",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bjs\/eval\s*\(|\bloadString\s*\(/,
      ruleId: "CLOJURE-005",
      title: "Code built from a string",
      description:
        "The string runs as code, so anything that reaches it runs as code too",
      action: "Remove it, or build the function from real code",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\b\(ns\s+\S+\s*\)[\s\S]*?\(:require\s+:reload/,
      ruleId: "CLOJURE-006",
      title: "A namespace is reloaded at runtime",
      description:
        "Reloading a namespace at runtime changes the meaning of the code while it runs",
      action: "Restart the process instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bwith-open\s+\[[^\]]*\]\s*\(\.readLine\s*System\/in/,
      ruleId: "CLOJURE-007",
      title: "Input read from the console",
      description:
        "Reading the console stops the program until somebody types, which never happens in a service",
      action: "Take the input as an argument",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// Objective-C
// ---------------------------------------------------------------------------
export class ObjectiveCAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "objective-c";
  readonly displayName = "Objective-C Analyzer";
  readonly extensions = ["m", "mm"];
  readonly rules: Rule[] = [
    {
      pattern: /\bNSLog\s*\(/,
      ruleId: "OBJC-001",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logging framework, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bstringWithFormat\s*:\s*@"/,
      ruleId: "OBJC-002",
      title: "A format string that is built",
      description:
        "A format built from data can read and write memory it should not",
      action: "Build the format from a fixed list of arguments",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bperformSelector\s*\(/,
      ruleId: "OBJC-003",
      title: "A method called by name",
      description:
        "The name can be anything, so a mistake in it is only found when the call runs",
      action: "Call the method directly",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bNSClassFromString\s*\(|\bNSSelectorFromString\s*\(/,
      ruleId: "OBJC-004",
      title: "A class or method looked up by name",
      description:
        "The name can be anything, so a mistake in it is only found when the call runs",
      action: "Use the class or method directly",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bdictionaryWithFormat\s*\(|\bappendFormat\s*:/,
      ruleId: "OBJC-005",
      title: "A format string that is built",
      description:
        "A format built from data can read and write memory it should not",
      action: "Build the format from a fixed list of arguments",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /@try\s*\{[\s\S]*?@catch\s*\([^)]*\)\s*\{\s*\}/,
      ruleId: "OBJC-006",
      title: "An error is caught and ignored",
      description:
        "The catch does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bretain\s*\]|\brelease\s*\]/,
      ruleId: "OBJC-007",
      title: "Memory is managed by hand",
      description:
        "A retained object that is never released stays in memory for ever",
      action: "Use ARC, or make sure every retain has a release",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// PowerShell
// ---------------------------------------------------------------------------
export class PowerShellAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "powershell";
  readonly displayName = "PowerShell Analyzer";
  readonly extensions = ["ps1", "psm1", "psd1"];
  readonly rules: Rule[] = [
    {
      pattern: /\bInvoke-Expression\b|\biex\b|\bInvoke-Command\b/,
      ruleId: "PS-001",
      title: "A string run as a command",
      description:
        "The string runs as code, so anything that reaches it runs as code too",
      action: "Call the command directly, or use a script block",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\|\s*iex\b|Invoke-Expression\s*\(\s*\$/,
      ruleId: "PS-002",
      title: "What was downloaded is run",
      description:
        "Running whatever was downloaded means the server decides what runs on your machine",
      action: "Download it, look at it, then run it",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bInvoke-WebRequest\b|\bInvoke-RestMethod\b/,
      ruleId: "PS-003",
      title: "Something is fetched from the network",
      description:
        "The address decides what comes back, so it decides what the machine does next",
      action: "Check the address, and check what came back",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bSet-ExecutionPolicy\b/,
      ruleId: "PS-004",
      title: "The execution policy is changed",
      description:
        "The policy is there to stop scripts running, so turning it off takes that away",
      action: "Sign the script instead, and leave the policy alone",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bWrite-Host\b|\bWrite-Output\b/,
      ruleId: "PS-005",
      title: "Output written to the screen",
      description: "Output written to the screen is noisy in a pipeline",
      action: "Write the object, and let the pipeline carry it",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bConvertFrom-SecureString\b[\s\S]{0,80}\|\s*ConvertTo-SecureString/,
      ruleId: "PS-006",
      title: "A secret is turned back into plain text",
      description:
        "A secret that is decrypted and then used as text is a secret that can end up in a log",
      action: "Keep the secret encrypted, and pass it on as it is",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bRemove-Item\b[\s\S]{0,60}-Recurse[\s\S]{0,40}-Force/,
      ruleId: "PS-007",
      title: "A folder removed without a second thought",
      description:
        "A recursive forced remove takes everything under the path, and there is nothing to ask twice",
      action: "Look at the path before you remove it",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Groovy
// ---------------------------------------------------------------------------
export class GroovyAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "groovy";
  readonly displayName = "Groovy Analyzer";
  readonly extensions = ["groovy", "gvy"];
  readonly rules: Rule[] = [
    {
      pattern: /\beval\s*\(/,
      ruleId: "GROOVY-001",
      title: "Code built from a string",
      description:
        "eval runs a string as code, so anything that reaches it runs as code too",
      action: "Remove it, or use a closure instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bRuntime\.getRuntime\s*\(\)\.exec\s*\(|\bexecute\s*\(/,
      ruleId: "GROOVY-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bprintln\s*\(|\bprint\s*\(/,
      ruleId: "GROOVY-003",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bexecuteSql\s*\(\s*"/,
      ruleId: "GROOVY-004",
      title: "SQL built by interpolation",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a parameterised query instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bdef\s+\w+\s*=\s*null\b/,
      ruleId: "GROOVY-005",
      title: "A value that is not there",
      description:
        "Reading a field of null is an error at runtime, not at compile time",
      action: "Check the value before reading through it",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bcatch\s*\([^)]*\)\s*\{\s*\}/,
      ruleId: "GROOVY-006",
      title: "An error is caught and ignored",
      description:
        "The catch does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /as\s+String\b/,
      ruleId: "GROOVY-007",
      title: "Everything turned into a string",
      description:
        "Casting to a string hides the type of a value, so a mistake is only found later",
      action: "Leave the type as it is, and let the compiler check it",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// Perl
// ---------------------------------------------------------------------------
export class PerlAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "perl";
  readonly displayName = "Perl Analyzer";
  readonly extensions = ["pl", "pm"];
  readonly rules: Rule[] = [
    {
      pattern: /\bsystem\s*\(|\bexec\s*\(/,
      ruleId: "PERL-001",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /`[^`]*\$\w+/,
      ruleId: "PERL-002",
      title: "A command built from a variable",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Use a list form, and never build the command from data",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bopen\s*\(\s*[^\)]*\|/,
      ruleId: "PERL-003",
      title: "A pipe opened",
      description:
        "A pipe that opens a command runs it, and the command can be anything",
      action: "Use a list form, and check what you are opening",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\beval\b(?!\s*\{)/,
      ruleId: "PERL-004",
      title: "Code built from a string",
      description:
        "eval runs a string as code, so anything that reaches it runs as code too",
      action: "Remove it, or use a regular expression instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bprint\s+STDERR\b|\bwarn\s+["']/,
      ruleId: "PERL-005",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bmy\s+\$\w+\s*;\s*$/,
      ruleId: "PERL-006",
      title: "A variable with no value",
      description:
        "An undefined value is an error at the point it is used, not where it is declared",
      action: "Give the variable a value, or check it before using it",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bqx\s*[\/\(\{]/,
      ruleId: "PERL-007",
      title: "A command built into a string",
      description:
        "qx runs the string as a command, so anything that reaches it runs too",
      action: "Use a list form, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// R
// ---------------------------------------------------------------------------
export class RAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "r";
  readonly displayName = "R Analyzer";
  readonly extensions = ["r", "rex"];
  readonly rules: Rule[] = [
    {
      pattern: /\bsystem\s*\(\s*"?\s*[a-z]/i,
      ruleId: "R-001",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Use system2 with a list of arguments, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bsource\s*\(\s*"/,
      ruleId: "R-002",
      title: "A file run as code",
      description:
        "source runs the file, so a file that changes is code that runs",
      action: "Read the file as data, or check where it comes from first",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\beval\s*\(\s*parse\s*\(/,
      ruleId: "R-003",
      title: "Code built from a string",
      description:
        "The string runs as code, so anything that reaches it runs as code too",
      action: "Remove it, or use a function instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprint\s*\(/,
      ruleId: "R-004",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bsetwd\s*\(/,
      ruleId: "R-005",
      title: "The working directory is changed",
      description:
        "setwd moves the whole session, so every relative path after it is somewhere else",
      action: "Use an absolute path instead",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bpaste0\s*\([^)]*SELECT|\bpaste\s*\([^)]*SELECT/i,
      ruleId: "R-006",
      title: "SQL built by pasting",
      description:
        "A query assembled from a string lets a value in the data change the query",
      action: "Use a parameterised query instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\btryCatch\s*\(\s*error\s*=\s*function\s*\([^)]*\)\s*\{\s*\}/,
      ruleId: "R-007",
      title: "An error is caught and ignored",
      description:
        "The handler does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// Julia
// ---------------------------------------------------------------------------
export class JuliaAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "julia";
  readonly displayName = "Julia Analyzer";
  readonly extensions = ["jl"];
  readonly rules: Rule[] = [
    {
      pattern: /\beval\s*\(|\bMeta\.parse\s*\(/,
      ruleId: "JULIA-001",
      title: "Code built from a string",
      description:
        "The string runs as code, so anything that reaches it runs as code too",
      action: "Remove it, or build the function from real code",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bCmd\s*\(|\bopen\s*\(\s*`|\brun\s*\(\s*`/,
      ruleId: "JULIA-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bprintln\s*\(|\b@show\b/,
      ruleId: "JULIA-003",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\binclude\s*\(\s*"/,
      ruleId: "JULIA-004",
      title: "A file run as code",
      description:
        "include runs the file, so a file that changes is code that runs",
      action: "Check where the file comes from first",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bunsafe_\w+\s*\(/,
      ruleId: "JULIA-005",
      title: "A rule of the language turned off",
      description:
        "These do things the compiler is not allowed to check, so a mistake is only found at runtime",
      action: "Keep the check, and pay the little it costs",
      severity: Severity.HIGH,
      category: Category.CODE_QUALITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bcatch\s*\n?\s*end\b/,
      ruleId: "JULIA-006",
      title: "An error is caught and ignored",
      description:
        "The catch does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.HIGH,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bparse\s*\(\s*Int\b|\bparse\s*\(\s*Float/,
      ruleId: "JULIA-007",
      title: "A value parsed without a check",
      description:
        "parse throws when the text is not a number, so the error is only found at runtime",
      action: "Use tryparse, which says when it could not read the value",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Solidity
// ---------------------------------------------------------------------------
export class SolidityAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "solidity";
  readonly displayName = "Solidity Analyzer";
  readonly extensions = ["sol"];
  readonly rules: Rule[] = [
    {
      pattern: /\bdelegatecall\s*\(/,
      ruleId: "SOL-001",
      title: "A call that keeps the storage of the other contract",
      description:
        "delegatecall runs the other code with your storage, so a mistake in it takes your funds",
      action: "Use call, and check what the other contract does",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bselfdestruct\s*\(|\bsuicide\s*\(/,
      ruleId: "SOL-002",
      title: "The contract can be destroyed",
      description:
        "A contract that can be destroyed takes its funds with it, and the rule has been taken away",
      action: "Remove it, or gate it behind a multisig",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\btx\.origin\b/,
      ruleId: "SOL-003",
      title: "The first caller is trusted",
      description:
        "tx.origin is whoever started the whole transaction, which is not the person you meant",
      action: "Use msg.sender",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bblock\.timestamp\b|\bblock\.number\b/,
      ruleId: "SOL-004",
      title: "The block is used as a clock",
      description:
        "The miner moves the timestamp a little, so anything that depends on it can be moved",
      action: "Use a clock that a caller cannot move",
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bpragma\s+solidity\s*\^?0\.[0-8]\./,
      ruleId: "SOL-005",
      title: "An old version of the compiler",
      description:
        "The old compiler misses whole classes of mistake, and the old one is the one that has them",
      action: "Use a current compiler, and pin it exactly",
      severity: Severity.MEDIUM,
      category: Category.DEPENDENCY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\busing\s+for\s+/,
      ruleId: "SOL-006",
      title: "A function attached to a type",
      description:
        "The function is called on every value of that type, so it is easy to call without meaning to",
      action: "Use a plain function, and call it when you mean it",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bassembly\s*\{/,
      ruleId: "SOL-007",
      title: "Inline assembly",
      description:
        "The compiler does not check anything inside it, so a mistake there is not found at all",
      action: "Keep it as small as possible, and have it read closely",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
  ];
}

// ---------------------------------------------------------------------------
// Tcl
// ---------------------------------------------------------------------------
export class TclAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "tcl";
  readonly displayName = "Tcl Analyzer";
  readonly extensions = ["tcl"];
  readonly rules: Rule[] = [
    {
      pattern: /\bexec\s+[^;]*\$/,
      ruleId: "TCL-001",
      title: "A command built from a variable",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Use exec with a list of arguments, and never build the command from data",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bexec\s+/,
      ruleId: "TCL-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Use exec with a list of arguments",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bputs\s+(?:stdout|stderr)\b/,
      ruleId: "TCL-003",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logger, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\beval\s+\$/,
      ruleId: "TCL-004",
      title: "Code built from a string",
      description:
        "The string runs as code, so anything that reaches it runs as code too",
      action: "Remove it, or use a procedure instead",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bopen\s+\|\s*/,
      ruleId: "TCL-005",
      title: "A pipe opened",
      description:
        "A pipe that opens a command runs it, and the command can be anything",
      action: "Use exec, and check what you are opening",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bcatch\s*\{[^}]*\}\s*$/,
      ruleId: "TCL-006",
      title: "An error is caught and ignored",
      description:
        "The catch does nothing, so the error is swallowed without a trace",
      action: "Handle the error, or log it",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /\bglob\s+-\s*/,
      ruleId: "TCL-007",
      title: "The file system is walked",
      description:
        "A glob over a directory the program does not control can be very slow",
      action: "Walk only the directory you meant, and check how much is in it",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.LOW,
    },
  ];
}

// ---------------------------------------------------------------------------
// Fortran
// ---------------------------------------------------------------------------
export class FortranAnalyzer extends BaseLanguageAnalyzer {
  readonly language = "fortran";
  readonly displayName = "Fortran Analyzer";
  readonly extensions = ["f", "f90", "f95", "for"];
  readonly rules: Rule[] = [
    {
      pattern: /\bcall\s+system\s*\(/,
      ruleId: "F-001",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bexecute_command_line\s*\(/,
      ruleId: "F-002",
      title: "Shell command execution",
      description:
        "The command runs through a shell, so a value that reaches it changes what runs",
      action: "Pass the arguments as a list, and never build the command from data",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\bwrite\s*\(\s*[^)]*,\s*\*\s*['"]/i,
      ruleId: "F-003",
      title: "Output written with a format that is built",
      description:
        "A format built from data can read and write memory it should not",
      action: "Build the format from a fixed list of arguments",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bprint\s*\*|\bwrite\s*\(\s*\*\s*\)/i,
      ruleId: "F-004",
      title: "Debug output",
      description: "Debug output is noisy in production and can leak data",
      action: "Use the logging library, or remove the statement",
      severity: Severity.LOW,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bstop\b|\bstop\s+\d/i,
      ruleId: "F-005",
      title: "The program stops on purpose",
      description:
        "stop ends the run without saying what went wrong",
      action: "Return an error that says what happened",
      severity: Severity.MEDIUM,
      category: Category.CODE_QUALITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bcommon\s+\/\w/,
      ruleId: "F-006",
      title: "Storage shared between files",
      description:
        "A common block is shared by every file that names it, so the two files have to be changed together",
      action: "Use a module, which the compiler checks",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\bimplicit\s+none\b/,
      ruleId: "F-007",
      title: "Types are declared",
      description:
        "implicit none is the right thing to write, so this is here to keep it in mind",
      action: "Keep implicit none in every file",
      severity: Severity.INFO,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.HIGH,
    },
  ];
}

// ---------------------------------------------------------------------------
// All of them
// ---------------------------------------------------------------------------
export const MORE_ANALYZERS = [
  new LuaAnalyzer(),
  new ScalaAnalyzer(),
  new ElixirAnalyzer(),
  new ErlangAnalyzer(),
  new HaskellAnalyzer(),
  new ClojureAnalyzer(),
  new ObjectiveCAnalyzer(),
  new PowerShellAnalyzer(),
  new GroovyAnalyzer(),
  new PerlAnalyzer(),
  new RAnalyzer(),
  new JuliaAnalyzer(),
  new SolidityAnalyzer(),
  new TclAnalyzer(),
  new FortranAnalyzer(),
];
