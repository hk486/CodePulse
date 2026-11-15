import {
  LanguageAnalyzer,
  LanguageAdapterRegistry,
  ProjectContext,
  AnalysisConfiguration,
} from "@codepulse/shared";

export class DefaultLanguageAdapterRegistry implements LanguageAdapterRegistry {
  private analyzers: LanguageAnalyzer[] = [];

  getAnalyzer(language: string): LanguageAnalyzer | undefined {
    const wanted = language.toLowerCase();
    return this.analyzers.find(
      (analyzer) => analyzer.language.toLowerCase() === wanted
    );
  }

  getAllAnalyzers(): LanguageAnalyzer[] {
    return [...this.analyzers];
  }

  register(analyzer: LanguageAnalyzer): void {
    // More than one analyzer can look at the same language. The pattern
    // rules and the analyzer that reads the code both look at TypeScript,
    // and both of them have something to say.
    this.analyzers.push(analyzer);
  }

  findSupportedAnalyzers(context: ProjectContext): LanguageAnalyzer[] {
    return this.getAllAnalyzers().filter((analyzer) =>
      analyzer.supports(context)
    );
  }
}
