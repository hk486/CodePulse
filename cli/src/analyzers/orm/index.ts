import {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisConfiguration,
  Finding,
  Severity,
  Category,
  Confidence,
  Facet,
} from "@codepulse/shared";
import * as path from "path";
import * as fs from "fs";
import { filesFor } from "../../services/fileIndex";
import { languageForFileName } from "../../services/languageDetector";

/**
 * ORM model analyzer.
 *
 * Data models are where most of the schema lives in an application, so they
 * deserve the same attention as the SQL files. This covers Prisma, Django,
 * SQLAlchemy and Entity Framework models.
 */
export class OrmModelAnalyzer implements LanguageAnalyzer {
  readonly id = "orm-model-analyzer-v1";
  /** The files this analyzer reads. */
  readonly supportedExtensions = ["prisma", "py", "cs", "ts", "java"];
  readonly language = "orm";
  readonly displayName = "ORM Model Analyzer";
  readonly facet = Facet.DATABASE;
  readonly version = "1.0.0";

  supports(context: ProjectContext): boolean {
    return (
      context.detectedLanguages.includes("python") ||
      context.detectedLanguages.includes("typescript") ||
      context.detectedLanguages.includes("javascript") ||
      context.detectedLanguages.includes("csharp")
    )
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = []

    const entries = await filesFor(context, ["prisma", "py", "cs", "ts"], context.projectPath)
    const files = entries
      .filter(entry => {
        const lower = entry.path.toLowerCase()
        if (lower.endsWith(".prisma")) return true
        if (!/\.(py|cs|ts)$/.test(lower)) return false
        return (
          lower.includes("/models/") ||
          lower.includes("/entities/") ||
          lower.includes("models.") ||
          lower.includes("entities.")
        )
      })
      .map(entry => entry.path)

    for (const file of files) {
      let content: string
      try {
        content = fs.readFileSync(path.join(context.projectPath, file), "utf-8")
      } catch {
        continue
      }

      const kind = this.modelKind(file, content)
      if (!kind) continue

      findings.push(...this.analyzePrisma(content, file))
      findings.push(...this.analyzeDjango(content, file))
      findings.push(...this.analyzeSqlAlchemy(content, file))
      findings.push(...this.analyzeEntityFramework(content, file))
    }

    return findings
  }

  /**
   * Which kind of model file is this?
   */
  private modelKind(file: string, content: string): string | null {
    const lower = file.toLowerCase()
    if (lower.endsWith(".prisma")) return "prisma"
    if (lower.endsWith(".cs") && /DbContext|EntityType|OnModelCreating/.test(content)) {
      return "efcore"
    }
    if (lower.endsWith(".py") && /class\s+\w+\s*\(\s*(models\.Model|db\.Model)/.test(content)) {
      return "django"
    }
    if (
      lower.endsWith(".ts") &&
      /(Column|Table|Entity|Schema)\s*\(/.test(content) &&
      /@(Entity|Column|Table)\b/.test(content)
    ) {
      return "typeorm"
    }
    if (
      lower.endsWith(".py") &&
      /(Column|relationship)\s*\(/.test(content) &&
      /declarative_base|Column\s*\(/.test(content)
    ) {
      return "sqlalchemy"
    }
    return null
  }

  /**
   * Prisma schema models.
   */
  private analyzePrisma(content: string, file: string): Finding[] {
    if (!file.toLowerCase().endsWith(".prisma")) return []

    const findings: Finding[] = []
    const lines = content.split("\n")

    // Split into model blocks
    let modelName = ""
    let modelStart = 0
    let block: string[] = []

    const flush = () => {
      if (!modelName) return

      const blockText = block.join("\n")
      const fields = blockText.split("\n").filter(line => /^\s+\w+\s+\w+/.test(line))

      // A model without an id or a primary key
      if (
        !/@@id/.test(blockText) &&
        !fields.some(field => /@id\b/.test(field)) &&
        !/\bid\s+/.test(blockText)
      ) {
        findings.push(
          this.finding(
            "ORM-001",
            `Model "${modelName}" has no primary key`,
            "Without a primary key the rows cannot be addressed reliably and the generated client cannot update them",
            "Add an @id field or a @@id([...]) block",
            Severity.MEDIUM,
            Category.MAINTAINABILITY,
            Confidence.HIGH,
            file,
            modelStart
          )
        )
      }

      // Every relation needs an index on the foreign key
      const relations = fields.filter(field => /\w+\s+\w+(\[\])?\s+(\?)?\s*$/.test(field) && !/@/.test(field.split(/\s+/).slice(2).join(" ")))
      for (const relation of relations) {
        const name = relation.trim().split(/\s+/)[0]
        if (!/@relation/.test(relation) && !/@relation/.test(blockText)) continue
        findings.push(
          this.finding(
            "ORM-002",
            `Relation field "${name}" has no index`,
            "Without an index every query that joins this relation has to scan the table",
            "Add @@index([name]) to the model",
            Severity.LOW,
            Category.PERFORMANCE,
            Confidence.LOW,
            file,
            modelStart
          )
        )
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const modelMatch = lines[i].match(/^model\s+(\w+)\s*\{/)
      if (modelMatch) {
        flush()
        modelName = modelMatch[1]
        modelStart = i + 1
        block = []
        continue
      }
      if (lines[i].trim() === "}") {
        flush()
        modelName = ""
        block = []
        continue
      }
      if (modelName) block.push(lines[i])
    }
    flush()

    // Relations without an index, at the schema level
    lines.forEach((line, index) => {
      if (/@@index/.test(line)) return
    })

    return findings
  }

  /**
   * Django models.
   */
  private analyzeDjango(content: string, file: string): Finding[] {
    if (!/class\s+\w+\s*\(\s*(models\.Model|db\.Model)/.test(content)) return []

    const findings: Finding[] = []
    const lines = content.split("\n")

    let className = ""
    let classStart = 0
    let block: string[] = []

    const flush = () => {
      if (!className) return
      const blockText = block.join("\n")

      // No primary key declared
      if (!/primary_key\s*=\s*True/.test(blockText) && !/\bid\s*=\s*models\./.test(blockText)) {
        findings.push(
          this.finding(
            "ORM-010",
            `Model "${className}" has no explicit primary key`,
            "Django adds an implicit id column, which is easy to forget when the model is mapped to an existing table",
            "Declare the primary key explicitly with primary_key=True",
            Severity.LOW,
            Category.MAINTAINABILITY,
            Confidence.MEDIUM,
            file,
            classStart
          )
        )
      }

      // A nullable foreign key without a related name
      const foreignKeys = blockText.split("\n").filter(line => /ForeignKey\s*\(/.test(line))
      for (const foreignKey of foreignKeys) {
        if (/on_delete\s*=/.test(foreignKey)) continue
        findings.push(
          this.finding(
            "ORM-011",
            `Foreign key without on_delete in "${className}"`,
            "Django raises an error for a foreign key without on_delete, and the default hides the intent",
            "Set on_delete=models.CASCADE or the behaviour you want",
            Severity.MEDIUM,
            Category.MAINTAINABILITY,
            Confidence.HIGH,
            file,
            classStart
          )
        )
      }

      // A CharField without a max_length
      const charFields = blockText.split("\n").filter(line => /CharField\s*\(\s*\)/.test(line))
      for (const charField of charFields) {
        findings.push(
          this.finding(
            "ORM-012",
            `CharField without max_length in "${className}"`,
            "An unlimited CharField cannot be indexed on some databases and silently becomes a text column",
            "Give the field an explicit max_length",
            Severity.LOW,
            Category.MAINTAINABILITY,
            Confidence.HIGH,
            file,
            classStart
          )
        )
      }
    }

    lines.forEach((line, index) => {
      const classMatch = line.match(/^class\s+(\w+)\s*\(\s*(models\.Model|db\.Model)/)
      if (classMatch) {
        flush()
        className = classMatch[1]
        classStart = index + 1
        block = []
        return
      }
      if (className) block.push(line)
    })
    flush()

    return findings
  }

  /**
   * SQLAlchemy declarative models.
   */
  private analyzeSqlAlchemy(content: string, file: string): Finding[] {
    if (!/Column\s*\(/.test(content)) return []

    const findings: Finding[] = []
    const lines = content.split("\n")

    lines.forEach((line, index) => {
      // A Column without a type
      if (/=\s*Column\s*\(\s*\)/.test(line)) {
        findings.push(
          this.finding(
            "ORM-020",
            "Column without a type",
            "A column with no type cannot be mapped to the database",
            "Give the column an explicit type",
            Severity.MEDIUM,
            Category.MAINTAINABILITY,
            Confidence.HIGH,
            file,
            index + 1
          )
        )
      }
      // A nullable column that is not marked as such
      if (/=\s*Column\s*\(\s*[\w.]+\s*(,\s*nullable\s*=\s*True)?\s*\)/.test(line) && !/primary_key/.test(line)) {
        findings.push(
          this.finding(
            "ORM-021",
            "Nullable column without an explicit default",
            "The column allows NULL, so every read has to handle the missing value",
            "Mark the column as not nullable or give it a default",
            Severity.LOW,
            Category.MAINTAINABILITY,
            Confidence.LOW,
            file,
            index + 1
          )
        )
      }
    })

    return findings
  }

  /**
   * Entity Framework models.
   */
  private analyzeEntityFramework(content: string, file: string): Finding[] {
    if (!/EntityType|OnModelCreating|DbContext/.test(content)) return []

    const findings: Finding[] = []
    const lines = content.split("\n")

    lines.forEach((line, index) => {
      if (/public\s+\w+\s+\w+\s*\{\s*get;\s*set;\s*\}/.test(line) && !/Id\b/.test(line)) {
        // handled by the key rule below
      }
    })

    // A model class without a key
    const classMatches = [...content.matchAll(/public\s+(?:partial\s+)?class\s+(\w+)\s*\{/g)]
    for (const classMatch of classMatches) {
      const start = content.slice(0, classMatch.index).split("\n").length
      const body = content.slice(classMatch.index)
      const end = body.indexOf("\n}")
      const classBody = end > 0 ? body.slice(0, end) : body

      if (/DbContext/.test(classBody)) continue

      const hasKey = /\[Key\]/.test(classBody) || /\bId\s*\{\s*get;\s*set;\s*\}/.test(classBody)
      if (!hasKey && /public\s+(?:partial\s+)?class/.test(classBody)) {
        findings.push(
          this.finding(
            "ORM-030",
            `Entity "${classMatch[1]}" has no key`,
            "Entity Framework cannot track an entity without a key",
            "Add an Id property or mark one with [Key]",
            Severity.MEDIUM,
            Category.MAINTAINABILITY,
            Confidence.MEDIUM,
            file,
            start
          )
        )
      }
    }

    return findings
  }

  private finding(
    ruleId: string,
    title: string,
    description: string,
    action: string,
    severity: Severity,
    category: Category,
    confidence: Confidence,
    file: string,
    line: number
  ): Finding {
    return {
      id: `orm-${ruleId}-${line}-${file}`,
      ruleId,
      language: languageForFileName(file),
      category,
      severity,
      confidence,
      title,
      description,
      suggestedAction: action,
      location: {
        filePath: file,
        startLine: line,
        endLine: line,
      },
      tool: this.displayName,
      toolRuleId: ruleId,
    }
  }
}
