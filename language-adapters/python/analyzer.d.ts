import { LanguageAnalyzer, ProjectContext, AnalysisConfiguration, Finding } from "@codepulse/shared";
/**
 * Mock Python Analyzer - Placeholder for Phase 1
 * Real implementation would integrate with Ruff, Bandit, etc.
 */
export declare class PythonAnalyzer implements LanguageAnalyzer {
    readonly id = "python-analyzer-v1";
    readonly language = "python";
    readonly displayName = "Python Analyzer";
    readonly version = "1.0.0";
    supports(context: ProjectContext): boolean;
    analyze(context: ProjectContext, config: AnalysisConfiguration): Promise<Finding[]>;
}
