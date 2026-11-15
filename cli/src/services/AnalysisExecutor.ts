import {
  Finding,
  AnalysisResult,
  Category,
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Severity,
  Confidence,
  Facet,
  AnalyzerExecution,
  AnalyzerStatus,
} from "@codepulse/shared";
import { DefaultLanguageAdapterRegistry } from "./AnalyzerRegistry";
import { matchesAny } from "./config";
import { runAnalyzers, type PoolOptions } from "./analyzerPool";


export class AnalysisExecutor {
  private registry: DefaultLanguageAdapterRegistry;

  constructor(registry: DefaultLanguageAdapterRegistry) {
    this.registry = registry;
  }

  async executeAnalysis(
    context: ProjectContext,
    config: AnalysisConfiguration,
    onProgress?: (completed: number, total: number, analyzerName: string) => void,
    poolOptions?: PoolOptions
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const analyzers = this.registry.findSupportedAnalyzers(context);
    const allFindings: Finding[] = [];
    const executedAnalyzers: string[] = [];
    const failedAnalyzers: string[] = [];
    /** What each analyzer actually did, for the report. */
    const executions: AnalyzerExecution[] = [];

    // An analyzer that is not ready to run says so, and it is recorded as
    // skipped rather than quietly pretended to have run. Those are not
    // given a thread: there is nothing for them to do.
    const ready: LanguageAnalyzer[] = [];
    for (const analyzer of analyzers) {
      const analyzerStarted = Date.now();
      const startedAt = new Date(analyzerStarted).toISOString();

      const availability = analyzer.availability?.();
      if (availability && !availability.available) {
        executions.push({
          id: analyzer.id,
          name: analyzer.displayName,
          version: analyzer.version,
          language: analyzer.language,
          status: AnalyzerStatus.UNAVAILABLE,
          startedAt,
          completedAt: startedAt,
          durationMs: 0,
          findingCount: 0,
          filesAnalyzed: 0,
          categories: analyzer.categories?.map(String),
          reason: availability.reason || `Missing: ${(availability.missing || []).join(", ")}`,
        });
        continue;
      }
      ready.push(analyzer);
    }

    // The analyzers that can run are run together, each on a thread of
    // its own where the machine allows it. One of them failing does not
    // stop the others.
    const outcomes = await runAnalyzers(
      ready,
      context,
      config,
      (completed) => {
        onProgress?.(completed, ready.length, "analyzers");
      },
      poolOptions
    );

    for (const outcome of outcomes) {
      const analyzer = outcome.analyzer;
      const analyzerStarted = Date.now();
      const startedAt = new Date(analyzerStarted).toISOString();

      if (outcome.error) {
        failedAnalyzers.push(analyzer.displayName);
        console.error(`Failed to run ${analyzer.displayName}:`, outcome.error);

        const finished = Date.now();
        executions.push({
          id: analyzer.id,
          name: analyzer.displayName,
          version: analyzer.version,
          language: analyzer.language,
          status: AnalyzerStatus.FAILED,
          startedAt,
          completedAt: new Date(finished).toISOString(),
          durationMs: finished - analyzerStarted,
          findingCount: 0,
          filesAnalyzed: 0,
          categories: analyzer.categories?.map(String),
          error: outcome.error,
        });
        continue;
      }

      // Every finding inherits the facet of its analyzer and the
      // component (service/package) it was found in.
      const facet = analyzer.facet ?? Facet.CODE;
      for (const finding of outcome.findings) {
        finding.facet = facet;
        finding.componentId = this.resolveComponent(
          finding.location?.filePath,
          context.components
        );
        finding.analyzerVersion = analyzer.version;
      }
      const kept = outcome.findings.filter(
        (finding) => !this.isSilenced(finding, config)
      );
      allFindings.push(...kept);
      executedAnalyzers.push(analyzer.displayName);

      const finished = Date.now();
      executions.push({
        id: analyzer.id,
        name: analyzer.displayName,
        version: analyzer.version,
        language: analyzer.language,
        status: AnalyzerStatus.COMPLETED,
        startedAt,
        completedAt: new Date(finished).toISOString(),
        durationMs: finished - analyzerStarted,
        findingCount: kept.length,
        filesAnalyzed: outcome.filesRead.length,
        filesRead: outcome.filesRead,
        categories: analyzer.categories?.map(String),
        covers: analyzer.covers,
        parallel: outcome.parallel,
      });
    }

    const executionTime = Date.now() - startTime;

    // Summarize findings
    const summary = this.summarizeFindings(allFindings, context.detectedLanguages);

    return {
      projectPath: context.projectPath,
      languages: context.detectedLanguages,
      findings: allFindings,
      summary,
      executionTime,
      analyzersRun: executedAnalyzers,
      failedAnalyzers: failedAnalyzers.length > 0 ? failedAnalyzers : undefined,
      // What each analyzer actually did, so the report can say so.
      analyzerExecutions: executions,
    };
  }

  /**
   * True when the project has asked for this finding to be left out.
   *
   * A rule can be turned off entirely, or silenced in some paths only.
   */
  private isSilenced(
    finding: Finding,
    config: AnalysisConfiguration
  ): boolean {
    const ruleId = finding.ruleId
    if (!ruleId) return false

    const rules = config.rules || {}
    const rule = rules[ruleId]
    if (rule && typeof rule === 'object' && (rule as any).enabled === false) {
      return true
    }

    for (const suppression of config.suppressions || []) {
      if (suppression.ruleId !== ruleId) continue
      if (!suppression.path) return true
      const filePath = finding.location?.filePath
      if (filePath && matchesAny(filePath, [suppression.path])) return true
    }

    return false
  }

  /**
   * Find the component a file belongs to. The component whose relative path
   * is the longest prefix of the file path wins.
   */
  private resolveComponent(
    filePath: string | undefined,
    components: ProjectContext["components"]
  ): string | undefined {
    if (!filePath || !components || components.length === 0) return undefined

    const normalized = filePath.replace(/\\/g, "/")
    let best: string | undefined

    for (const component of components) {
      const prefix = component.relativePath
      if (!prefix) {
        // the root component is the fallback
        if (!best) best = component.id
        continue
      }
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
        if (!best || prefix.length > best.length) {
          best = component.id
        }
      }
    }

    return best
  }

  private summarizeFindings(
    findings: Finding[],
    languages: string[]
  ): AnalysisResult["summary"] {
    const summary = {
      totalFindings: findings.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      byCategory: {} as Record<Category, number>,
      byLanguage: {} as Record<string, number>,
      byFacet: {} as Record<string, number>,
      byComponent: {} as Record<string, number>,
    };

    for (const finding of findings) {
      switch (finding.severity) {
        case Severity.CRITICAL:
          summary.critical++;
          break;
        case Severity.HIGH:
          summary.high++;
          break;
        case Severity.MEDIUM:
          summary.medium++;
          break;
        case Severity.LOW:
          summary.low++;
          break;
        case Severity.INFO:
          summary.info++;
          break;
      }

      // Count by category
      summary.byCategory[finding.category] =
        (summary.byCategory[finding.category] || 0) + 1;

      // Count by language
      summary.byLanguage[finding.language] =
        (summary.byLanguage[finding.language] || 0) + 1;

      // Count by facet (code, database, infra, secrets, ...)
      if (finding.facet) {
        summary.byFacet[finding.facet] =
          (summary.byFacet[finding.facet] || 0) + 1;
      }

      // Count by component (service/package)
      if (finding.componentId) {
        summary.byComponent[finding.componentId] =
          (summary.byComponent[finding.componentId] || 0) + 1;
      }
    }

    return summary;
  }
}
