import {
  Severity,
  Category,
  Confidence,
  Facet,
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
} from '@codepulse/shared'
import * as fs from 'fs'
import * as path from 'path'
import { Rule } from '../base/RuleAnalyzer'

/**
 * The rules that only make sense for a particular framework.
 *
 * A React hook with a missing dependency, a Django view with raw SQL, an
 * Express app with no error handler. They are kept apart from the
 * language rules because they only apply when the framework is actually
 * in the project.
 */
interface FrameworkRuleSet {
  /** The framework, as the detector names it. */
  framework: string
  /** The languages the rules apply to. */
  languages: string[]
  /** The files the rules are read from. */
  extensions: string[]
  rules: Rule[]
}

const REACT: FrameworkRuleSet = {
  framework: 'React',
  languages: ['typescript', 'javascript'],
  extensions: ['ts', 'tsx', 'js', 'jsx'],
  rules: [
    {
      pattern: /useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{[\s\S]{0,400}?\bawait\b/,
      ruleId: 'REACT-001',
      title: 'Effect awaits without a cleanup',
      description:
        'An effect that awaits and then resolves can set state after the component is gone',
      action: 'Return a cleanup function, or check that the component is still mounted',
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /key=\{(?:i|idx|index)\}/,
      ruleId: 'REACT-002',
      title: 'List key is the index',
      description:
        'A key of the index makes React reuse the wrong element when the list is reordered',
      action: 'Key the element by something that identifies it',
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\buseEffect\s*\(\s*\(\s*\)\s*=>\s*\{/,
      ruleId: 'REACT-003',
      title: 'Effect with no dependency array',
      description:
        'An effect with no dependency array runs after every render, which is rarely what is wanted',
      action: 'Say what the effect depends on',
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.LOW,
    },
    {
      pattern: /setState\s*\(\s*\{[^}]*\}\s*\)/,
      ruleId: 'REACT-004',
      title: 'State object changed in place',
      description:
        'Changing the state object in place does not trigger a render, so the screen goes out of date',
      action: 'Build a new object instead of changing the old one',
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ],
}

const NEXT: FrameworkRuleSet = {
  framework: 'Next.js',
  languages: ['typescript', 'javascript'],
  extensions: ['ts', 'tsx', 'js', 'jsx'],
  rules: [
    {
      pattern: /export\s+(?:const|async\s+function)\s+getServerSideProps/,
      ruleId: 'NEXT-001',
      title: 'Server side props without a session check',
      description:
        'getServerSideProps runs on every request, so the session has to be checked in it',
      action: 'Check the session at the top of the function',
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.LOW,
    },
    {
      pattern: /export\s+(?:const|async\s+function)\s+getStaticProps/,
      ruleId: 'NEXT-002',
      title: 'Build time data without a revalidation',
      description:
        'getStaticProps is built once, so the page keeps serving the same data until it is rebuilt',
      action: 'Give the page a revalidate time, or use getServerSideProps',
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.LOW,
    },
  ],
}

const DJANGO: FrameworkRuleSet = {
  framework: 'Django',
  languages: ['python'],
  extensions: ['py'],
  rules: [
    {
      pattern: /\.raw\s*\(/,
      ruleId: 'DJANGO-001',
      title: 'Raw SQL in a queryset',
      description:
        'The raw SQL is not escaped for you, so a value in the data can change the query',
      action: 'Use the parameters of the queryset instead',
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\.cursor\s*\(\s*\)[\s\S]{0,200}?\.execute\s*\([^)]*\+/,
      ruleId: 'DJANGO-005',
      title: 'SQL built by concatenation',
      description:
        'The query is put together by hand, so a value in the data can change it',
      action: 'Pass the values to execute as parameters',
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /\.extra\s*\(/,
      ruleId: 'DJANGO-002',
      title: 'Extra fields selected',
      description:
        'extra() builds the SQL by hand, so the values are not escaped',
      action: 'Use annotate and alias instead',
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /@csrf_exempt/,
      ruleId: 'DJANGO-003',
      title: 'CSRF protection turned off',
      description:
        'Without the CSRF check, another site can make the user send this request',
      action: 'Leave the protection on unless the view is read only',
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /DEBUG\s*=\s*True/,
      ruleId: 'DJANGO-004',
      title: 'Debug mode turned on',
      description:
        'With DEBUG on, a mistake shows the settings and the whole traceback to whoever asked',
      action: 'Read DEBUG from the environment',
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ],
}

const FLASK: FrameworkRuleSet = {
  framework: 'Flask',
  languages: ['python'],
  extensions: ['py'],
  rules: [
    {
      pattern: /app\.run\s*\(/,
      ruleId: 'FLASK-001',
      title: 'Development server started',
      description:
        'The server Flask ships with is for development, and it does not survive a real workload',
      action: 'Run it behind a production server',
      severity: Severity.MEDIUM,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.HIGH,
    },
    {
      pattern: /debug\s*=\s*True/,
      ruleId: 'FLASK-002',
      title: 'Debug mode turned on',
      description:
        'With debug on, a mistake shows the settings and the whole traceback to whoever asked',
      action: 'Read the flag from the environment',
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
  ],
}

const EXPRESS: FrameworkRuleSet = {
  framework: 'Express',
  languages: ['typescript', 'javascript'],
  extensions: ['ts', 'js'],
  rules: [
    {
      pattern: /app\.use\s*\(\s*['"]\/['"]\s*,\s*(?:express\.static|serveStatic)/,
      ruleId: 'EXPRESS-001',
      title: 'Whole folder served',
      description:
        'Serving the project folder lets anybody read the files that are not meant to be public',
      action: 'Serve the folder with the static files only',
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /\.\s*listen\s*\(\s*process\.env\.PORT/,
      ruleId: 'EXPRESS-002',
      title: 'Server started without an address',
      description:
        'Listening on every address means the server is reachable from outside the machine',
      action: 'Listen on 127.0.0.1, or put a proxy in front of it',
      severity: Severity.MEDIUM,
      category: Category.SECURITY,
      confidence: Confidence.LOW,
    },
  ],
}

const SPRING: FrameworkRuleSet = {
  framework: 'Spring',
  languages: ['java', 'kotlin'],
  extensions: ['java', 'kt'],
  rules: [
    {
      pattern: /@Autowired\s*(?:\n\s*)?(?:private|protected)\s+(?!final)/,
      ruleId: 'SPRING-001',
      title: 'Field injected',
      description:
        'A field is filled in by the container, so the class cannot be built without it',
      action: 'Pass the dependency through the constructor',
      severity: Severity.LOW,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.MEDIUM,
    },
    {
      pattern: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']\/["']\s*\)/,
      ruleId: 'SPRING-002',
      title: 'Request mapping on the root path',
      description:
        'A mapping on the root path answers every path that is not matched by something else',
      action: 'Map a path of its own',
      severity: Severity.LOW,
      category: Category.BEST_PRACTICE,
      confidence: Confidence.LOW,
    },
  ],
}

const RULE_SETS: FrameworkRuleSet[] = [
  REACT,
  NEXT,
  DJANGO,
  FLASK,
  EXPRESS,
  SPRING,
]

/**
 * The framework analyzer.
 *
 * It reads the files of every framework that is actually in the project,
 * so a rule only fires where it means something.
 */
export class FrameworkAnalyzer implements LanguageAnalyzer {
  readonly id = 'framework-analyzer-v1';
  readonly language = 'framework';
  readonly displayName = 'Framework Analyzer';
  readonly version = '1.0.0';
  readonly facet: Facet = Facet.CODE;

  supports(context: ProjectContext): boolean {
    const frameworks = context.detectedFrameworks || []
    return RULE_SETS.some(
      set =>
        frameworks.includes(set.framework) &&
        set.languages.some(language => context.detectedLanguages.includes(language))
    )
  }

  async analyze(
    context: ProjectContext,
    config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = [];
    const frameworks = context.detectedFrameworks || [];
    const files = context.files || [];

    for (const set of RULE_SETS) {
      if (!frameworks.includes(set.framework)) continue;
      if (!set.languages.some(language => context.detectedLanguages.includes(language))) {
        continue
      }

      for (const file of files) {
        const extension = (file.extension || '').toLowerCase();
        if (!set.extensions.includes(extension)) continue;

        const content = await this.read(file.absolutePath);
        if (!content) continue;

        for (const rule of set.rules) {
          if (config.rules && config.rules[rule.ruleId]?.enabled === false) continue;
          const match = rule.pattern.exec(content);
          if (!match) continue;

          const line = this.lineOf(content, match.index);
          findings.push({
            id: `framework-${rule.ruleId}-${file.path}`,
            ruleId: rule.ruleId,
            language: this.languageOf(context),
            category: rule.category,
            severity: rule.severity,
            confidence: rule.confidence,
            title: rule.title,
            description: rule.description,
            suggestedAction: rule.action,
            location: {
              filePath: file.path,
              startLine: line,
              endLine: line,
            },
            tool: this.displayName,
            toolRuleId: rule.ruleId,
          });
        }
      }
    }

    return findings;
  }

  /** The language a finding is reported under. */
  private languageOf(context: ProjectContext): string {
    if (context.detectedLanguages.includes('typescript')) return 'typescript'
    if (context.detectedLanguages.includes('javascript')) return 'javascript'
    if (context.detectedLanguages.includes('python')) return 'python'
    if (context.detectedLanguages.includes('java')) return 'java'
    if (context.detectedLanguages.includes('kotlin')) return 'kotlin'
    return 'framework'
  }

  private async read(absolutePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(absolutePath, 'utf8')
    } catch {
      return null
    }
  }

  /** The line a match starts on, counting from one. */
  private lineOf(content: string, index: number): number {
    let line = 1
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === '\n') line++
    }
    return line
  }
}

export const FRAMEWORK_ANALYZER = new FrameworkAnalyzer()
