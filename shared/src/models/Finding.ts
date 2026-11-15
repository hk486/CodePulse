/**
 * Unified Finding Model
 * Represents a single finding (issue, observation) from any analyzer
 */
import {
  Facet,
  ComponentInfo,
  TechStack,
} from "../types/ProjectDetection.js";
import type { AnalyzerExecution, PipelineRecord } from "../contracts/pipeline.js";
export enum Severity {
  CRITICAL = "CRITICAL",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
  INFO = "INFO",
}

export enum Category {
  CODE_QUALITY = "CODE_QUALITY",
  COMPLEXITY = "COMPLEXITY",
  DUPLICATION = "DUPLICATION",
  SECURITY = "SECURITY",
  DEPENDENCY = "DEPENDENCY",
  TEST_COVERAGE = "TEST_COVERAGE",
  ARCHITECTURE = "ARCHITECTURE",
  PERFORMANCE = "PERFORMANCE",
  MAINTAINABILITY = "MAINTAINABILITY",
  BEST_PRACTICE = "BEST_PRACTICE",
  /**
   * The code does not parse: a missing bracket, a declaration that is not
   * valid, a malformed expression.
   */
  SYNTAX_ERROR = "SYNTAX_ERROR",
  /**
   * The code parses but does not type-check: a type mismatch, an undefined
   * reference, a call that does not fit, a missing import.
   */
  TYPE_ERROR = "TYPE_ERROR",
  /**
   * The code would not compile at all.
   */
  COMPILATION_ERROR = "COMPILATION_ERROR",
  /**
   * The code is valid but can fail at run time: a null dereference, a
   * division by zero, an unhandled exception, a leaked resource.
   */
  RUNTIME_RISK = "RUNTIME_RISK",
  /**
   * The code runs but does the wrong thing: a condition that is inverted,
   * an unreachable branch, a loop that never ends.
   */
  LOGIC_ERROR = "LOGIC_ERROR",
  /**
   * The database layer: schemas, migrations, queries, indexes,
   * transactions.
   */
  DATABASE = "DATABASE",
  /**
   * Low level and systems code: buffers, pointers, ownership, undefined
   * behaviour.
   */
  LOW_LEVEL = "LOW_LEVEL",
  /**
   * The infrastructure and the pipeline: Dockerfiles, Kubernetes manifests,
   * Terraform, CI.
   */
  INFRASTRUCTURE = "INFRASTRUCTURE",
}

export enum Confidence {
  VERY_HIGH = "VERY_HIGH",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
}

export interface CodeLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
}

/**
 * How sure the analyzer is, and what kind of thing it found.
 *
 * The difference matters: a command that is built from a request is a
 * confirmed defect, and a function that is longer than sixty lines is a
 * suggestion. Reporting them the same way makes the serious ones harder
 * to find.
 */
export enum FindingValidation {
  /** It is definitely there. The evidence proves it. */
  CONFIRMED = "confirmed",
  /** Very likely there. The evidence points at it. */
  STRONGLY_SUPPORTED = "strongly_supported",
  /** It might be there. Worth a look. */
  POTENTIAL = "potential",
  /** A security warning. */
  SECURITY_WARNING = "security_warning",
  /** A suggestion about the code, not a defect. */
  RECOMMENDATION = "recommendation",
}

export interface Finding {
  // Identity
  id: string;
  ruleId: string;

  /**
   * A stable name for this finding.
   *
   * It is worked out from the rule, the place and the code, so the same
   * problem has the same fingerprint in every run. That is what makes it
   * possible to tell a new finding from an old one, and to remove the
   * duplicates when two rules find the same thing.
   */
  fingerprint?: string;

  // Classification
  language: string;
  category: Category;
  severity: Severity;
  confidence?: Confidence;

  // Description
  title: string;
  description: string;
  suggestedAction?: string;

  // Location
  location: CodeLocation;

  /**
   * The line of code the finding is about. It is what the person reads
   * first, so it is part of the finding rather than something to look up.
   */
  snippet?: string;

  /**
   * How sure the analyzer is, and what kind of thing it found.
   */
  validation?: FindingValidation;

  /**
   * The reason the finding is what it is. The evidence for it.
   */
  evidence?: string;

  /**
   * What went wrong, underneath the finding.
   */
  rootCause?: string;

  /**
   * What it costs if it is left alone.
   */
  impact?: string;

  /**
   * Where to read more about it.
   */
  documentation?: string;

  /**
   * When it was found.
   */
  detectedAt?: string;

  /**
   * Was this finding in the previous run?
   *
   * It is what makes "what is new" answerable without reading the two
   * reports side by side.
   */
  isNew?: boolean;

  /**
   * The other rules that found the same thing, when two of them did.
   */
  alsoFoundBy?: string[];

  // Context
  /** Which part of the project this finding belongs to. */
  facet?: Facet;
  /** The component (service/package) the finding was found in. */
  componentId?: string;

  // Evidence
  tool: string; // Original analyzer name (PMD, ESLint, etc.)
  /** The version of the analyzer that produced it, so a result is traceable. */
  analyzerVersion?: string;
  toolRuleId: string; // Original rule identifier
  toolOutput?: string; // Raw tool output for inspection

  // Metadata
  tags?: string[];
  createdAt?: Date;
}

export interface AnalysisResult {
  projectPath: string;
  languages: string[];
  findings: Finding[];
  summary: {
    totalFindings: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    byCategory: Record<Category, number>;
    byLanguage: Record<string, number>;
    /** Findings grouped by the part of the project they belong to. */
    byFacet?: Record<string, number>;
    /** Findings grouped by the component (service/package) they were found in. */
    byComponent?: Record<string, number>;
  };
  executionTime?: number;
  analyzersRun: string[];
  failedAnalyzers?: string[];
  /** What each analyzer actually did, for the report. */
  analyzerExecutions?: AnalyzerExecution[];
}

/**
 * What the project is made of.
 *
 * It says what was found, how each language was worked out, and what
 * state each language ended in, so the report never claims more than was
 * actually done.
 */
export interface TechnologyInventory {
  languages: {
    language: string;
    /** How many files of this language were found. */
    files: number;
    /** How it was worked out: extension, content, filename, manifest. */
    detectedBy: string[];
    /** The dialect, for the languages that have more than one. */
    dialect?: string;
    /** The analyzers that were chosen for it. */
    analyzers: string[];
    /** Where it ended up: analysed, partly analysed, unsupported. */
    state: string;
    findings: number;
  }[];
  technologies: string[];
  frameworks: string[];
  databases: string[];
  infrastructure: string[];
  packageManagers: string[];
  ciTools: string[];
}

export interface QualityScore {  overall: number;
  dimensions: {
    codeQuality: number;
    complexity: number;
    duplication: number;
    security: number;
    testCoverage: number;
    dependencyHealth: number;
  };
  confidence: number; // 0-100, based on analysis coverage
  coverage: {
    codeQuality: boolean;
    complexity: boolean;
    duplication: boolean;
    security: boolean;
    testCoverage: boolean;
    dependencyHealth: boolean;
  };
}

export interface ProjectReport {
  id: string;
  projectPath: string;
  projectName: string;
  detectedLanguages: string[];
  /**
   * What the analysis actually did: the stages, the analyzers that ran,
   * and where each language stands.
   */
  pipeline?: PipelineRecord;
  /** Frameworks and libraries detected across the project. */
  detectedFrameworks?: string[];
  /** The services/packages the project is made of. */
  components?: ComponentInfo[];
  /** The grouped technical stack of the project. */
  techStack?: TechStack;
  /**
   * The project technology inventory: every language that was found, how
   * it was worked out, and what state it ended in.
   */
  technologyInventory?: TechnologyInventory;
  /** Whether the project is an app, a library, a monorepo, ... */
  projectType?: string;
  /**
   * How much of the project was actually analysed, so a report is honest
   * about what was left out.
   */
  coverage?: {
    /** How many files were indexed. */
    totalFiles: number;
    /** How many bytes were indexed. */
    totalBytes: number;
    /** How many files were left out because of a budget. */
    skippedByBudget: number;
    /** How many files were left out because they were too big. */
    skippedBySize: number;
    /** True when a budget stopped the analysis. */
    truncated: boolean;
    /** The languages that were found, with the number of files each. */
    languages: Record<string, number>;
    /** The languages that were found but have no dedicated analyzer yet. */
    languagesWithoutAnalyzer?: string[];
  };
  analysis: AnalysisResult;
  qualityScore?: QualityScore;
  generatedAt: Date;
  cliVersion?: string;
}
