import {
  PipelineStage,
  PipelineStageStatus,
  PipelineRecord,
  LanguageCoverage,
  LanguageAnalysisState,
  AnalyzerExecution,
  AnalyzerStatus,
  Finding,
} from "@codepulse/shared";

/**
 * The record of what a scan actually did.
 *
 * A report that says "14 findings" is only worth something if it also
 * says which files were read, which analyzers ran, which of them failed
 * and which languages were never looked at. This keeps that record.
 */
export class PipelineRecorder {
  private stages: PipelineStage[] = [];
  private startedAt = new Date();

  /**
   * A stage has begun.
   */
  start(name: string): void {
    this.stages.push({
      name,
      status: PipelineStageStatus.RUNNING,
      startedAt: new Date().toISOString(),
    });
  }

  /**
   * A stage has finished.
   */
  finish(name: string, detail?: Record<string, unknown>): void {
    const stage = this.stage(name);
    if (!stage) {
      this.start(name);
      return this.finish(name, detail);
    }
    stage.status = PipelineStageStatus.COMPLETED;
    stage.completedAt = new Date().toISOString();
    stage.durationMs = durationOf(stage);
    if (detail) stage.detail = detail;
  }

  /**
   * A stage did not finish.
   */
  fail(name: string, error: string): void {
    const stage = this.stage(name);
    if (!stage) {
      this.start(name);
      return this.fail(name, error);
    }
    stage.status = PipelineStageStatus.FAILED;
    stage.completedAt = new Date().toISOString();
    stage.durationMs = durationOf(stage);
    stage.error = error;
  }

  /**
   * A stage was not needed.
   */
  skip(name: string, reason: string): void {
    const now = new Date().toISOString();
    this.stages.push({
      name,
      status: PipelineStageStatus.SKIPPED,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      error: reason,
    });
  }

  private stage(name: string): PipelineStage | undefined {
    // The last one with this name, so a stage that happens twice keeps
    // the latest.
    for (let i = this.stages.length - 1; i >= 0; i--) {
      if (this.stages[i].name === name) return this.stages[i];
    }
    return undefined;
  }

  /**
   * The stages, in the order they happened.
   */
  getStages(): PipelineStage[] {
    return this.stages.map(stage => ({ ...stage }));
  }
}

function durationOf(stage: PipelineStage): number {
  if (!stage.startedAt || !stage.completedAt) return 0;
  return (
    new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime()
  );
}

/**
 * Where each language stands after the analysis.
 *
 * The state is the most specific one that applies. A language that has an
 * analyzer but no files of its own is "analyzer available" rather than
 * "analysed", because nothing was read.
 */
export function buildCoverage(options: {
  detectedLanguages: string[];
  executions: AnalyzerExecution[];
  /** How many files of each language were found. */
  filesPerLanguage: Record<string, number>;
  /** How many files of each language were read. */
  filesAnalyzedPerLanguage: Record<string, number>;
  findings: Finding[];
  /** The languages that have no analyzer of their own. */
  languagesWithoutAnalyzer: string[];
}): LanguageCoverage[] {
  const {
    detectedLanguages,
    executions,
    filesPerLanguage,
    filesAnalyzedPerLanguage,
    findings,
    languagesWithoutAnalyzer,
  } = options;

  const findingsPerLanguage: Record<string, number> = {};
  for (const finding of findings) {
    const language = finding.language || "unknown";
    findingsPerLanguage[language] = (findingsPerLanguage[language] || 0) + 1;
  }

  return detectedLanguages.map(language => {
    const forLanguage = executions.filter(
      (execution) =>
        execution.language === language ||
        (execution.covers || []).includes(language)
    );
    // The tools are extra eyes on a language. They do not decide whether
    // the language was analysed: an analyzer does.
    const analyzerRuns = forLanguage.filter(
      (execution) => !execution.id.startsWith("tool-")
    );
    const failed = analyzerRuns.find(
      execution => execution.status === AnalyzerStatus.FAILED
    );
    const unavailable = analyzerRuns.find(
      execution => execution.status === AnalyzerStatus.UNAVAILABLE
    );
    const completed = analyzerRuns.filter(
      execution => execution.status === AnalyzerStatus.COMPLETED
    );

    const filesDetected = filesPerLanguage[language] || 0;
    const filesAnalyzed = filesAnalyzedPerLanguage[language] || 0;
    let state: LanguageAnalysisState;
    let reason: string | undefined;

    if (failed) {
      state = LanguageAnalysisState.FAILED;
      reason = failed.error || "The analyzer did not finish.";
    } else if (filesAnalyzed > 0) {
      if (filesAnalyzed < filesDetected) {
        state = LanguageAnalysisState.PARTIALLY_ANALYZED;
        reason = `${filesDetected - filesAnalyzed} file(s) of this language were left out.`;
      } else {
        state = LanguageAnalysisState.ANALYSIS_COMPLETED;
      }
    } else if (unavailable) {
      state = LanguageAnalysisState.PARTIALLY_ANALYZED;
      reason =
        unavailable.reason || "The analyzer for this language could not run.";
    } else if (languagesWithoutAnalyzer.includes(language)) {
      state = LanguageAnalysisState.UNSUPPORTED;
      reason = "There is no analyzer for this language, so only the generic rules were used.";
    } else {
      state = LanguageAnalysisState.UNSUPPORTED;
      reason = "No analyzer read any file of this language.";
    }

    return {
      language,
      state,
      analyzers: forLanguage.map(execution => execution.name),
      filesDetected,
      filesAnalyzed,
      findings: findingsPerLanguage[language] || 0,
      reason,
    };
  });
}

/**
 * Put the whole record together.
 */
export function buildPipelineRecord(options: {
  stages: PipelineStage[];
  executions: AnalyzerExecution[];
  coverage: LanguageCoverage[];
  languagesWithoutAnalyzer: string[];
  filesTotal: number;
  filesAnalyzed: number;
  /** How many files were read by anything at all. */
  filesScanned?: number;
  filesSkipped: number;
  skipReasons?: Record<string, number>;
  startedAt: Date;
  completedAt: Date;
}): PipelineRecord {
  return {
    stages: options.stages,
    analyzers: options.executions,
    coverage: options.coverage,
    languagesWithoutAnalyzer: options.languagesWithoutAnalyzer,
    filesTotal: options.filesTotal,
    filesAnalyzed: options.filesAnalyzed,
    filesScanned: options.filesScanned ?? options.filesAnalyzed,
    filesSkipped: options.filesSkipped,
    skipReasons: options.skipReasons,
    durationMs: options.completedAt.getTime() - options.startedAt.getTime(),
  };
}
