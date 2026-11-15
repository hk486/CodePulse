/**
 * What the pipeline actually did.
 *
 * A report that says "14 findings" is only worth something if it also says
 * which files were read, which analyzers ran, which of them failed and
 * which languages were never looked at. These are the records that make
 * that possible.
 */

/**
 * Where a language stands after an analysis.
 *
 * The states are not the same thing. A language can be *detected* without
 * being *supported*, and it can be *supported* without an analyzer having
 * been *available* for it.
 */
export enum LanguageAnalysisState {
  /** The language was found in the project. */
  DETECTED = "detected",
  /** The language is one the scanner knows about. */
  SUPPORTED = "supported",
  /** There is an analyzer that can look at this language. */
  ANALYZER_AVAILABLE = "analyzer_available",
  /** The analyzers ran and finished. */
  ANALYSIS_COMPLETED = "analysis_completed",
  /** The analyzers ran, but some of the files or some of the rules were left out. */
  PARTIALLY_ANALYZED = "partially_analyzed",
  /** Nothing looked at this language beyond the generic rules. */
  UNSUPPORTED = "unsupported",
  /** An analyzer for this language was there and did not finish. */
  FAILED = "failed",
}

/**
 * What happened to one language.
 */
export interface LanguageCoverage {
  language: string;
  state: LanguageAnalysisState;
  /** The analyzers that were chosen for it. */
  analyzers: string[];
  /** How many files of this language were found. */
  filesDetected: number;
  /** How many of them were actually read. */
  filesAnalyzed: number;
  /** How many findings came from it. */
  findings: number;
  /** Why it is in this state, when the state is not the happy one. */
  reason?: string;
}

/** How a stage of the pipeline went. */
export enum PipelineStageStatus {
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
  RUNNING = "running",
}

/**
 * One stage of the pipeline.
 */
export interface PipelineStage {
  /** The name of the stage, in the order it happens. */
  name: string;
  status: PipelineStageStatus;
  startedAt: string;
  completedAt?: string;
  /** How long it took, in milliseconds. */
  durationMs?: number;
  /** What went wrong, when something did. */
  error?: string;
  /** Anything the stage wants to say about what it did. */
  detail?: Record<string, unknown>;
}

/** How an analyzer went. */
export enum AnalyzerStatus {
  /** It ran and finished. */
  COMPLETED = "completed",
  /** It ran and did not finish. */
  FAILED = "failed",
  /** It was not needed for this project. */
  SKIPPED = "skipped",
  /** It is not installed, so it could not run. */
  UNAVAILABLE = "unavailable",
}

/**
 * One analyzer's run.
 */
export interface AnalyzerExecution {
  /** The analyzer's own id. */
  id: string;
  /** The name a person recognises. */
  name: string;
  /** The version of the analyzer, so a result can be traced to a build. */
  version: string;
  /** The language it looks at. */
  language: string;
  status: AnalyzerStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  /** How many findings it produced. */
  findingCount: number;
  /** How many files it read. */
  filesAnalyzed: number;
  /** The files it read, so the coverage can be worked out from the record. */
  filesRead?: string[];
  /** The kinds of problem this analyzer looks for. */
  categories?: string[];
  /** The languages it covers, when it covers more than one. */
  covers?: string[];
  /** True when it ran on a thread of its own, beside the others. */
  parallel?: boolean;
  /**
   * The tail of what the analyzer wrote, kept so a person can see why it
   * said what it said. It is bounded, because a tool can write a lot.
   */
  log?: string;
  /** What went wrong, when something did. */
  error?: string;
  /** Why it did not run, when it did not run. */
  reason?: string;
}

/**
 * The whole record of one analysis.
 */
export interface PipelineRecord {
  stages: PipelineStage[];
  analyzers: AnalyzerExecution[];
  coverage: LanguageCoverage[];
  /** The languages that were found but have no analyzer of their own. */
  languagesWithoutAnalyzer: string[];
  /** How many files were found in total. */
  filesTotal: number;
  /**
   * How many of them were read by an analyzer or tool that was written
   * for that kind of file.
   */
  filesAnalyzed: number;
  /**
   * How many of them were read by anything at all, including the general
   * pass over the whole project.
   */
  filesScanned?: number;
  /** How many were left out, and why. */
  filesSkipped: number;
  /** Why they were left out. */
  skipReasons?: Record<string, number>;
  /** How long the whole thing took. */
  durationMs?: number;
}

/**
 * The stages, in the order they happen.
 *
 * The names are what the report shows, so they say what happened rather
 * than what the code is called.
 */
export const PIPELINE_STAGES = [
  "archive_validation",
  "safe_extraction",
  "file_discovery",
  "language_detection",
  "technology_identification",
  "project_manifest",
  "dependency_discovery",
  "analyzer_selection",
  "analyzer_execution",
  "result_collection",
  "finding_normalization",
  "duplicate_detection",
  "evidence_validation",
  "severity_classification",
  "report_generation",
] as const;

export type PipelineStageName = (typeof PIPELINE_STAGES)[number];

/**
 * A name for a stage, in words a person can read.
 */
export const PIPELINE_STAGE_NAMES: Record<string, string> = {
  archive_validation: "Checking the archive",
  safe_extraction: "Taking the archive apart",
  file_discovery: "Finding the files",
  language_detection: "Working out the languages",
  technology_identification: "Working out the stack",
  project_manifest: "Reading the manifests",
  dependency_discovery: "Finding the dependencies",
  analyzer_selection: "Choosing the analyzers",
  analyzer_execution: "Running the analyzers",
  result_collection: "Gathering the results",
  finding_normalization: "Putting the results in one shape",
  duplicate_detection: "Finding the duplicates",
  evidence_validation: "Checking the findings",
  severity_classification: "Rating the findings",
  report_generation: "Writing the report",
};
