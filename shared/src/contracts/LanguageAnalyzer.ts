/**
 * Language Analyzer Contract
 * Every language-specific analyzer must implement this interface
 */

import { Category, Finding, AnalysisResult } from "../models/Finding";
import { Facet } from "../types/ProjectDetection.js";

export interface ProjectContext {
  projectPath: string;
  projectName: string;
  detectedLanguages: string[];
  /**
   * The frameworks that were found, such as React or Django. The framework
   * analyzer uses them to decide which rules apply.
   */
  detectedFrameworks?: string[];
  configuration?: Record<string, any>;
  /**
   * The components (services/packages) the project consists of. Analyzers use
   * this to tag each finding with the component it belongs to.
   */
  components?: {
    id: string;
    name: string;
    relativePath: string;
  }[];
  /**
   * The files of the project, listed once and shared by every analyzer so
   * the tree is not walked over and over.
   */
  files?: {
    path: string;
    absolutePath: string;
    extension: string;
    size: number;
  }[];
  /**
   * The files that were left out because a budget was reached.
   */
  skippedFiles?: number;
}

export interface AnalysisConfiguration {
  excludePaths?: string[];
  includePatterns?: string[];
  rules?: Record<string, any>;
  /** Findings to silence, optionally only in certain paths. */
  suppressions?: { ruleId: string; path?: string }[];
  severity?: string;
}

export interface LanguageAnalyzer {
  /**
   * Unique identifier for this analyzer
   */
  readonly id: string;

  /**
   * Language this analyzer targets (e.g., "java", "python", "javascript")
   */
  readonly language: string;

  /**
   * Friendly name for reporting
   */
  readonly displayName: string;

  /**
   * Version of the analyzer tool
   */
  readonly version: string;

  /**
   * Which facet of the project this analyzer covers. Findings inherit it so
   * the report can separate code issues from database, infra or secret ones.
   */
  readonly facet?: Facet;

  /**
   * The file types this analyzer reads.
   */
  readonly supportedExtensions?: string[];

  /**
   * The languages this analyzer covers, when it covers more than one.
   *
   * The infrastructure analyzer reads Dockerfiles, Terraform, Kubernetes
   * manifests and pipelines, so it covers all of those languages even
   * though it is not one of them itself.
   */
  readonly covers?: string[];

  /**
   * The frameworks this analyzer knows about. An analyzer with none of them
   * in the project is not needed.
   */
  readonly frameworks?: string[];

  /**
   * The programs this analyzer needs to be installed. When one of them is
   * missing the analyzer says so rather than pretending to have run.
   */
  readonly requires?: string[];

  /**
   * How long this analyzer may take, in milliseconds. The worker stops it
   * when the time is up, so one slow analyzer cannot hold the whole scan.
   */
  readonly timeoutMs?: number;

  /**
   * How much memory this analyzer may use, in megabytes.
   */
  readonly memoryLimitMb?: number;

  /**
   * What the analyzer reads and what it writes, for the record.
   */
  readonly inputFormat?: string;
  readonly outputFormat?: string;

  /**
   * The kinds of problem this analyzer looks for.
   */
  readonly categories?: Category[];

  /**
   * Is this analyzer ready to run?
   *
   * An analyzer that needs a program which is not installed says so here,
   * and the report says it was skipped. Nothing is ever pretended.
   */
  availability?(): AnalyzerAvailability;

  /**
   * Check if this analyzer supports the given project
   */
  supports(context: ProjectContext): boolean;

  /**
   * Execute analysis and return normalized findings
   */
  analyze(
    context: ProjectContext,
    config: AnalysisConfiguration
  ): Promise<Finding[]>;
}

/**
 * Whether an analyzer can run.
 */
export interface AnalyzerAvailability {
  /** Is it ready? */
  available: boolean;
  /** What is missing, when it is not. */
  missing?: string[];
  /** Why it is not ready, in words. */
  reason?: string;
}

export interface LanguageAdapterRegistry {
  /**
   * Get analyzer for a specific language
   */
  getAnalyzer(language: string): LanguageAnalyzer | undefined;

  /**
   * Get all available analyzers
   */
  getAllAnalyzers(): LanguageAnalyzer[];

  /**
   * Register a new analyzer
   */
  register(analyzer: LanguageAnalyzer): void;

  /**
   * Find supported analyzers for a project
   */
  findSupportedAnalyzers(context: ProjectContext): LanguageAnalyzer[];
}
