import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import * as fs from "fs";
import { parse } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { filesFor } from "../../services/fileIndex";

/**
 * Analysis that reads the code rather than the text.
 *
 * The rules everywhere else are patterns over lines. That finds the
 * problems that look the same wherever they are, and misses the ones that
 * depend on what the code means: a value that came from the request
 * reaching a shell command is only a problem if the value really did come
 * from the request.
 *
 * So this analyzer parses the file and follows the values.
 */

/**
 * Where a value that does not belong comes from.
 *
 * These are the places a program takes something from outside itself: the
 * request, the command line, the browser's address.
 */
const SOURCES: {
  match: (node: t.Node) => boolean
  describe: string
}[] = [
  {
    // req.body, request.query, event.pathParameters
    match: node =>
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      ['req', 'request'].includes(node.object.name) &&
      t.isIdentifier(node.property) &&
      ['body', 'query', 'params', 'headers', 'cookies'].includes(node.property.name),
    describe: 'the request',
  },
  {
    // event.body, event.queryStringParameters (a serverless handler)
    match: node =>
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      ['event', 'ctx', 'context'].includes(node.object.name) &&
      t.isIdentifier(node.property) &&
      ['body', 'query', 'queryStringParameters', 'pathParameters', 'headers'].includes(
        node.property.name
      ),
    describe: 'the request',
  },
  {
    match: node =>
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      node.object.name === 'process' &&
      t.isIdentifier(node.property) &&
      ['argv', 'env'].includes(node.property.name),
    describe: 'the process',
  },
  {
    match: node =>
      t.isMemberExpression(node) &&
      t.isIdentifier(node.object) &&
      ['window', 'document', 'location'].includes(node.object.name) &&
      t.isIdentifier(node.property) &&
      ['location', 'href', 'search', 'hash', 'URL'].includes(node.property.name),
    describe: 'the address bar',
  },
]

/**
 * Where a value that does not belong must not go.
 */
const SINKS: {
  match: (node: t.CallExpression | t.NewExpression) => boolean
  describe: string
  severity: Severity
  confidence: Confidence
}[] = [
  {
    match: node =>
      t.isIdentifier(node.callee) &&
      ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'].includes(
        node.callee.name
      ),
    describe: 'a shell command',
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
  },
  {
    match: node =>
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.property) &&
      ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'].includes(
        node.callee.property.name
      ),
    describe: 'a shell command',
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
  },
  {
    match: node => t.isIdentifier(node.callee) && node.callee.name === 'eval',
    describe: 'eval',
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
  },
  {
    match: node =>
      t.isIdentifier(node.callee) && node.callee.name === 'Function',
    describe: 'a function built from a string',
    severity: Severity.CRITICAL,
    confidence: Confidence.HIGH,
  },
  {
    match: node =>
      t.isIdentifier(node.callee) &&
      ['query', 'execute', 'raw'].includes(node.callee.name),
    describe: 'a query',
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
  },
  {
    match: node =>
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.property) &&
      ['query', 'execute', 'raw'].includes(node.callee.property.name),
    describe: 'a query',
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
  },
  {
    match: node =>
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.property) &&
      ['redirect'].includes(node.callee.property.name),
    describe: 'a redirect',
    severity: Severity.MEDIUM,
    confidence: Confidence.MEDIUM,
  },
  {
    match: node =>
      t.isIdentifier(node.callee) &&
      [
        'readFile',
        'readFileSync',
        'createReadStream',
        'writeFile',
        'writeFileSync',
        'unlink',
        'unlinkSync',
        'readdir',
        'readdirSync',
      ].includes(node.callee.name),
    describe: 'a file',
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
  },
  {
    match: node =>
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.property) &&
      ['readFile', 'readFileSync', 'createReadStream', 'writeFile', 'writeFileSync'].includes(
        node.callee.property.name
      ),
    describe: 'a file',
    severity: Severity.HIGH,
    confidence: Confidence.MEDIUM,
  },
]

/** The calls that return a promise. */
const ASYNC_CALLS = [
  'fetch',
  'axios',
  'request',
  'query',
  'execute',
  'raw',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'sendFile',
  'render',
  'send',
  'sendMail',
  'upload',
  'download',
]

/**
 * The values that are known to be outside, and the names that hold them.
 */
class Taint {
  /** The names of the variables that hold a value from outside. */
  readonly variables = new Set<string>()

  /**
   * Is this expression made of something from outside?
   */
  isTainted(node: t.Node | null | undefined): boolean {
    if (!node) return false

    if (t.isIdentifier(node)) {
      return this.variables.has(node.name)
    }

    if (t.isMemberExpression(node)) {
      // A property of a tainted object is tainted.
      if (this.isTainted(node.object)) return true
      // A property of something from outside is tainted.
      for (const source of SOURCES) {
        if (source.match(node)) return true
      }
      return false
    }

    if (t.isTemplateLiteral(node)) {
      return node.expressions.some(expression => this.isTainted(expression))
    }

    if (t.isBinaryExpression(node)) {
      return this.isTainted(node.left) || this.isTainted(node.right)
    }

    if (t.isLogicalExpression(node)) {
      return this.isTainted(node.left) || this.isTainted(node.right)
    }

    if (t.isConditionalExpression(node)) {
      return (
        this.isTainted(node.test) ||
        this.isTainted(node.consequent) ||
        this.isTainted(node.alternate)
      )
    }

    if (t.isCallExpression(node)) {
      // A value that came back from a call on something tainted is tainted.
      return this.isTainted(node.callee)
    }

    if (t.isAwaitExpression(node)) {
      return this.isTainted(node.argument)
    }

    if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
      return this.isTainted(node.expression)
    }

    if (t.isParenthesizedExpression(node)) {
      return this.isTainted(node.expression)
    }

    return false
  }

  /**
   * Where does this expression come from?
   */
  sourceOf(node: t.Node | null | undefined): string | null {
    if (!node) return null

    if (t.isMemberExpression(node)) {
      for (const source of SOURCES) {
        if (source.match(node)) return source.describe
      }
      if (this.isTainted(node.object)) return this.sourceOf(node.object)
      return null
    }

    if (t.isIdentifier(node) && this.variables.has(node.name)) {
      return this.variablesWithSource.get(node.name) ?? 'outside'
    }

    if (t.isTemplateLiteral(node)) {
      for (const expression of node.expressions) {
        const found = this.sourceOf(expression)
        if (found) return found
      }
      return null
    }

    if (t.isBinaryExpression(node)) {
      return this.sourceOf(node.left) || this.sourceOf(node.right)
    }

    if (t.isLogicalExpression(node)) {
      return this.sourceOf(node.left) || this.sourceOf(node.right)
    }

    if (t.isCallExpression(node)) {
      return this.sourceOf(node.callee)
    }

    if (t.isAwaitExpression(node)) {
      return this.sourceOf(node.argument)
    }

    if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
      return this.sourceOf(node.expression)
    }

    if (t.isParenthesizedExpression(node)) {
      return this.sourceOf(node.expression)
    }

    return null
  }

  /** The variables hold a value and where it came from. */
  readonly variablesWithSource = new Map<string, string>()

  /**
   * Remember that a name holds a value from outside.
   */
  mark(name: string, source: string) {
    this.variables.add(name)
    this.variablesWithSource.set(name, source)
  }
}

export class AstAnalyzer implements LanguageAnalyzer {
  readonly supportedExtensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
  readonly id = "ast-analyzer-v1";
  readonly language = "typescript";
  readonly displayName = "AST Analyzer";
  readonly version = "1.0.0";
  readonly facet = Facet.CODE;
  readonly extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

  supports(context: ProjectContext): boolean {
    return (
      context.detectedLanguages.includes("typescript") ||
      context.detectedLanguages.includes("javascript")
    );
  }

  async analyze(
    context: ProjectContext,
    config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];

    try {
      const entries = await filesFor(context, this.extensions, context.projectPath);

      for (const entry of entries) {
        const file = entry.path;
        try {
          const content = fs.readFileSync(entry.absolutePath, "utf-8");
          findings.push(...this.analyzeFile(content, file));
        } catch (error) {
          // A file that cannot be parsed is not a finding. It may not be
          // JavaScript at all, or it may use a syntax this parser does not
          // know yet.
        }
      }
    } catch (error) {
      console.error("Error analyzing files with the AST analyzer:", error);
    }

    return findings;
  }

  /**
   * Read one file and say what is wrong with it.
   */
  analyzeFile(content: string, file: string): Finding[] {
    const findings: Finding[] = [];

    let ast: t.File;
    try {
      ast = parse(content, {
        sourceType: "unambiguous",
        allowReturnOutsideFunction: true,
        errorRecovery: true,
        plugins: [
          "typescript",
          "jsx",
          "decorators-legacy",
          "classProperties",
          "objectRestSpread",
          "optionalChaining",
          "nullishCoalescingOperator",
          "dynamicImport",
          "topLevelAwait",
        ],
      });
    } catch {
      return findings;
    }

    const taint = new Taint();
    const add = (
      ruleId: string,
      title: string,
      description: string,
      action: string,
      severity: Severity,
      category: Category,
      confidence: Confidence,
      line: number,
      column: number
    ) => {
      findings.push({
        id: `ast-${ruleId}-${line}-${file}`,
        ruleId,
        language: this.languageFor(file),
        category,
        severity,
        confidence,
        title,
        description,
        suggestedAction: action,
        location: {
          filePath: file,
          startLine: line,
          endLine: line,
          startColumn: column,
          endColumn: column,
        },
        tool: this.displayName,
        toolRuleId: ruleId,
      });
    };

    // The values that come from outside are remembered by name, so a
    // variable that holds one is known later on.
    const taintOf = (node: t.Node | null | undefined) => {
      if (!node) return null;
      if (t.isIdentifier(node)) {
        return taint.variables.has(node.name) ? "outside" : null;
      }
      for (const source of SOURCES) {
        if (source.match(node)) return source.describe;
      }
      return null;
    };

    traverse(ast, {
      VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
        const name = path.node.id;
        if (!t.isIdentifier(name)) return;

        const source = taintOf(path.node.init);
        if (source) {
          taint.mark(name.name, source);
        } else if (path.node.init && taint.isTainted(path.node.init)) {
          taint.mark(name.name, taint.sourceOf(path.node.init) || "outside");
        }
      },

      AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
        const node = path.node;
        const left = node.left;

        // Putting a value from outside into the page as HTML is how cross
        // site scripting happens.
        if (t.isMemberExpression(left) && t.isIdentifier(left.property)) {
          if (['innerHTML', 'outerHTML'].includes(left.property.name)) {
            const htmlSource = taint.sourceOf(node.right);
            if (htmlSource) {
              add(
                "TSA-003",
                `A value from ${htmlSource} is put into the page as HTML`,
                `The value comes from ${htmlSource} and is written into the page, so it can carry a script`,
                "Use textContent, or sanitise the value first",
                Severity.HIGH,
                Category.SECURITY,
                Confidence.HIGH,
                node.loc?.start.line ?? 0,
                node.loc?.start.column ?? 0
              );
            }
          }
          return;
        }

        if (!t.isIdentifier(left)) return;
        const source = taintOf(node.right);
        if (source) {
          taint.mark(left.name, source);
        } else if (taint.isTainted(node.right)) {
          taint.mark(left.name, taint.sourceOf(node.right) || "outside");
        }
      },

      CallExpression(path: NodePath<t.CallExpression>) {
        const node = path.node;

        // A value from outside reaching a place it must not go.
        for (const sink of SINKS) {
          if (!sink.match(node)) continue;

          for (const argument of node.arguments) {
            if (!t.isSpreadElement(argument)) {
              const source = taint.sourceOf(argument);
              if (source) {
                add(
                  "TSA-001",
                  `A value from ${source} reaches ${sink.describe}`,
                  `The value comes from ${source} and is used in ${sink.describe}, so whoever ` +
                    `controls that value controls what runs`,
                  "Check the value before using it, or use a form that takes the parts separately",
                  sink.severity,
                  Category.SECURITY,
                  sink.confidence,
                  node.loc?.start.line ?? 0,
                  node.loc?.start.column ?? 0
                );
                break;
              }
            }
          }
        }

        // A promise that is never waited for. The work happens, but
        // nothing knows when it finished, and an error in it is lost.
        if (
          path.parentPath.isExpressionStatement() &&
          t.isIdentifier(node.callee) &&
          ASYNC_CALLS.includes(node.callee.name)
        ) {
          add(
            "TSA-007",
            "A promise is never waited for",
            "The call is made and its result is thrown away, so an error in it is never seen",
            "Await it, or handle the rejection",
            Severity.MEDIUM,
            Category.BEST_PRACTICE,
            Confidence.MEDIUM,
            node.loc?.start.line ?? 0,
            node.loc?.start.column ?? 0
          );
        }
      },

      NewExpression(path: NodePath<t.NewExpression>) {
        const node = path.node;
        for (const sink of SINKS) {
          if (!sink.match(node)) continue;
          for (const argument of node.arguments) {
            if (!t.isSpreadElement(argument)) {
              const source = taint.sourceOf(argument);
              if (source) {
                add(
                  "TSA-002",
                  `A value from ${source} reaches ${sink.describe}`,
                  `The value comes from ${source} and is used in ${sink.describe}`,
                  "Check the value before using it",
                  sink.severity,
                  Category.SECURITY,
                  sink.confidence,
                  node.loc?.start.line ?? 0,
                  node.loc?.start.column ?? 0
                );
                break;
              }
            }
          }
        }
      },

      JSXAttribute(path: NodePath<t.JSXAttribute>) {
        const node = path.node;
        if (!t.isJSXIdentifier(node.name)) return;
        if (node.name.name !== "dangerouslySetInnerHTML") return;
        if (!node.value || !t.isJSXExpressionContainer(node.value)) return;

        const source = taint.sourceOf(node.value.expression);
        if (!source) return;

        add(
          "TSA-004",
          `A value from ${source} is put into the page as HTML`,
          `The value comes from ${source} and is written into the page, so it can carry a script`,
          "Use textContent, or sanitise the value first",
          Severity.HIGH,
          Category.SECURITY,
          Confidence.HIGH,
          node.loc?.start.line ?? 0,
          node.loc?.start.column ?? 0
        );
      },

      // Awaiting inside a loop means one after another, however many
      // there are.
      AwaitExpression(path: NodePath<t.AwaitExpression>) {
        const line = path.node.loc?.start.line ?? 0;
        let inLoop = false;
        let current: NodePath | null = path.parentPath;
        while (current) {
          if (
            current.isForStatement() ||
            current.isForOfStatement() ||
            current.isForInStatement() ||
            current.isWhileStatement() ||
            current.isDoWhileStatement()
          ) {
            inLoop = true;
            break;
          }
          if (current.isFunction()) break;
          current = current.parentPath;
        }
        if (!inLoop) return;

        add(
          "TSA-005",
          "A wait inside a loop",
          "Each round waits for the one before it, so the loop takes as long as the sum of them all",
          "Do the work together and wait once, if the work can be done together",
          Severity.LOW,
          Category.PERFORMANCE,
          Confidence.MEDIUM,
          line,
          path.node.loc?.start.column ?? 0
        );
      },

      // A switch without a default leaves the reader guessing.
      SwitchStatement(path: NodePath<t.SwitchStatement>) {
        const hasDefault = path.node.cases.some(
          switchCase => t.isSwitchCase(switchCase) && switchCase.test === null
        );
        if (hasDefault) return;

        add(
          "TSA-006",
          "A switch without a default",
          "Nothing says what should happen when none of the cases match, and the reader has to work it out",
          "Add a default case, even if it only says what should not happen",
          Severity.LOW,
          Category.BEST_PRACTICE,
          Confidence.MEDIUM,
          path.node.loc?.start.line ?? 0,
          path.node.loc?.start.column ?? 0
        );
      },

      // `var` inside a block is not what it looks like.
      VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
        if (path.node.kind !== "var") return;
        if (!path.parentPath.isBlockStatement() && !path.parentPath.isForStatement()) return;

        add(
          "TSA-007",
          "A var inside a block",
          "var belongs to the function, not the block, so two blocks that both declare it share one variable",
          "Use let or const, which belong to the block they are in",
          Severity.MEDIUM,
          Category.BEST_PRACTICE,
          Confidence.HIGH,
          path.node.loc?.start.line ?? 0,
          path.node.loc?.start.column ?? 0
        );
      },
    });

    return findings;
  }

  languageFor(file: string): string {
    return /\.(js|jsx|mjs|cjs)$/i.test(file) ? "javascript" : "typescript";
  }
}
