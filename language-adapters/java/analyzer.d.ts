import { LanguageAnalyzer, ProjectContext, AnalysisConfiguration, Finding } from "@codepulse/shared";
/**
 * Mock Java Analyzer - Placeholder for Phase 1
 * This demonstrates the analyzer contract. Real implementation would use PMD/SpotBugs/Checkstyle
 */
export declare class JavaAnalyzer implements LanguageAnalyzer {
    readonly id = "java-analyzer-v1";
    readonly language = "java";
    readonly displayName = "Java Analyzer";
    readonly version = "1.0.0";
    supports(context: ProjectContext): boolean;
    analyze(context: ProjectContext, config: AnalysisConfiguration): Promise<Finding[]>;
}
