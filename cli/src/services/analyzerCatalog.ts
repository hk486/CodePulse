import type { LanguageAnalyzer } from "@codepulse/shared";
import { JavaAnalyzer } from "../analyzers/java";
import { PythonAnalyzer } from "../analyzers/python";
import { TypeScriptAnalyzer } from "../analyzers/typescript";
import { ADDITIONAL_ANALYZERS } from "../analyzers/multi";
import { DatabaseAnalyzer } from "../analyzers/database";
import { OrmModelAnalyzer } from "../analyzers/orm";
import { InfraAnalyzer } from "../analyzers/infra";
import { SecretScanner } from "../analyzers/secrets";
import { DependencyAnalyzer } from "../analyzers/dependencies";
import { GenericSourceAnalyzer } from "../analyzers/generic";
import { FRAMEWORK_ANALYZER } from "../analyzers/frameworks";
import { AstAnalyzer } from "../analyzers/ast";

export function analyzerKey(analyzer: LanguageAnalyzer): string {
  return `${analyzer.id}::${analyzer.language}`;
}

export function buildAnalyzerCatalog(): LanguageAnalyzer[] {
  return [
    new JavaAnalyzer(),
    new PythonAnalyzer(),
    new TypeScriptAnalyzer(),
    ...ADDITIONAL_ANALYZERS,
    new DatabaseAnalyzer(),
    new OrmModelAnalyzer(),
    new InfraAnalyzer(),
    new SecretScanner(),
    new DependencyAnalyzer(),
    new GenericSourceAnalyzer(),
    FRAMEWORK_ANALYZER,
    new AstAnalyzer(),
  ];
}

let catalog: Map<string, LanguageAnalyzer> | null = null;

function catalogMap(): Map<string, LanguageAnalyzer> {
  if (!catalog) {
    catalog = new Map();
    for (const analyzer of buildAnalyzerCatalog()) {
      catalog.set(analyzerKey(analyzer), analyzer);
    }
  }
  return catalog;
}

export function createAnalyzerByKey(key: string): LanguageAnalyzer | undefined {
  return catalogMap().get(key);
}

export function allAnalyzers(): LanguageAnalyzer[] {
  return Array.from(catalogMap().values());
}
