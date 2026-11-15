import { LanguageAnalyzer, ProjectContext, AnalysisConfiguration, Finding } from "@codepulse/shared";
/**
 * Mock TypeScript Analyzer - Placeholder for Phase 1
 * Real implementation would integrate with ESLint, TypeScript Compiler API, etc.
 */
export declare class TypeScriptAnalyzer implements LanguageAnalyzer {
    readonly id = "typescript-analyzer-v1";
    readonly language = "typescript";
    readonly displayName = "TypeScript Analyzer";
    readonly version = "1.0.0";
    supports(context: ProjectContext): boolean;
    analyze(context: ProjectContext, config: AnalysisConfiguration): Promise<Finding[]>;
}
