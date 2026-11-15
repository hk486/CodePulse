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

/**
 * The SQL dialects CodePulse recognises.
 */
export type SqlDialect =
  | "postgresql"
  | "mysql"
  | "sqlite"
  | "sqlserver"
  | "oracle"
  | "generic";

interface DialectSignature {
  dialect: SqlDialect;
  pattern: RegExp;
}

/**
 * Signatures that identify the dialect of a SQL file.
 */
const DIALECT_SIGNATURES: DialectSignature[] = [
  { dialect: "postgresql", pattern: /\b(SERIAL|BIGSERIAL|UUID|JSONB|ILIKE|RETURNING|CONCURRENTLY|plpgsql|pg_catalog|bytea)\b/i },
  { dialect: "postgresql", pattern: /\bCREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|EXTENSION)\b/i },
  { dialect: "mysql", pattern: /\b(ENGINE\s*=\s*InnoDB|AUTO_INCREMENT|UNSIGNED|MySQL|TINYINT|MEDIUMINT|LONGTEXT)\b/i },
  { dialect: "mysql", pattern: /\b(IFNULL|ON\s+DUPLICATE\s+KEY\s+UPDATE)\b/i },
  { dialect: "sqlite", pattern: /\b(AUTOINCREMENT|sqlite_master|sqlite_sequence)\b/i },
  { dialect: "sqlserver", pattern: /\b(NVARCHAR|IDENTITY\s*\(|GETDATE\s*\(|TOP\s+\d+\s+PERCENT|SYSDATETIME)\b/i },
  { dialect: "sqlserver", pattern: /\bEXEC\s+(sp_|xp_)\w+/i },
  { dialect: "oracle", pattern: /\b(VARCHAR2|NUMBER\s*\(\d|CONNECT\s+BY|SYSDATE|DBMS_|DUAL\b)/i },
];

export interface DatabaseContext {
  dialect: SqlDialect;
  dialectName: string;
  isMigration: boolean;
}

const DIALECT_LABELS: Record<SqlDialect, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  oracle: "Oracle",
  generic: "SQL",
};

/**
 * Detects the dialect of a SQL file and whether it is a migration.
 */
export function detectSqlDialect(content: string, filePath: string): DatabaseContext {
  let dialect: SqlDialect = "generic"
  let bestScore = 0

  for (const signature of DIALECT_SIGNATURES) {
    const matches = content.match(new RegExp(signature.pattern.source, "gi"))
    if (matches && matches.length > bestScore) {
      bestScore = matches.length
      dialect = signature.dialect
    }
  }

  const lower = filePath.toLowerCase()
  const isMigration =
    /migrat|schema|seed|alembic|flyway|liquibase|\/db\//.test(lower) ||
    /^\s*(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX)/im.test(content)

  return { dialect, dialectName: DIALECT_LABELS[dialect], isMigration }
}

/**
 * Database analyzer.
 *
 * Beyond the classic query problems it understands the things that break
 * production databases: adding a NOT NULL column to a table that already has
 * rows, dropping columns, adding a foreign key without an index and
 * granting every permission.
 */
export class DatabaseAnalyzer implements LanguageAnalyzer {
  readonly id = "database-analyzer-v1";
  /** The files this analyzer reads. */
  readonly supportedExtensions = ["sql"];
  readonly language = "sql";
  readonly displayName = "Database Analyzer";
  readonly facet = Facet.DATABASE;
  readonly version = "1.0.0";

  /**
   * The analyzer is always available. When a project has no SQL files it
   * simply produces no findings.
   */
  supports(_context: ProjectContext): boolean {
    return true
  }

  async analyze(
    context: ProjectContext,
    _config: AnalysisConfiguration
  ): Promise<Finding[]> {
    const findings: Finding[] = []

    const entries = await filesFor(context, ["sql"], context.projectPath);

    for (const entry of entries) {
      const file = entry.path;

      let content: string
      try {
        content = fs.readFileSync(entry.absolutePath, "utf-8")
      } catch {
        continue
      }

      const db = detectSqlDialect(content, file)
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trimmed = line.trim()
        if (trimmed.length === 0 || trimmed.startsWith("--")) continue

        for (const rule of this.rules) {
          if (rule.dialects && !rule.dialects.includes(db.dialect)) continue
          if (!rule.pattern.test(trimmed)) continue

          findings.push({
            id: `db-${rule.ruleId}-${i + 1}-${file}`,
            ruleId: rule.ruleId,
            language: "sql",
            category: rule.category,
            severity: rule.severity,
            confidence: rule.confidence,
            title: rule.title,
            description: rule.dialectHint
              ? `${rule.description} (${db.dialectName})`
              : rule.description,
            suggestedAction: rule.action,
            location: {
              filePath: file,
              startLine: i + 1,
              endLine: i + 1,
            },
            tool: this.displayName,
            toolRuleId: rule.ruleId,
          })
        }
      }

      // Rules that need the whole statement, not a single line
      findings.push(...this.statementRules(content, lines, file, db))
    }

    return findings
  }

  /**
   * Rules that look at a whole statement.
   */
  private statementRules(
    content: string,
    lines: string[],
    file: string,
    db: DatabaseContext
  ): Finding[] {
    const findings: Finding[] = []
    const statements = content.split(";")

    let lineOffset = 0
    for (const statement of statements) {
      const statementLines = statement.split("\n")
      const firstLine = lineOffset + 1
      lineOffset += statementLines.length

      const trimmed = statement.trim()
      if (trimmed.length === 0) continue

      const push = (
        ruleId: string,
        title: string,
        description: string,
        action: string,
        severity: Severity,
        category: Category,
        confidence: Confidence,
        line: number
      ) => {
        findings.push({
          id: `db-${ruleId}-${line}-${file}`,
          ruleId,
          language: "sql",
          category,
          severity,
          confidence,
          title,
          description: db.dialectName ? `${description} (${db.dialectName})` : description,
          suggestedAction: action,
          location: { filePath: file, startLine: line, endLine: line },
          tool: this.displayName,
          toolRuleId: ruleId,
        })
      }

      // Adding a NOT NULL column without a default breaks every existing row
      const addsColumn = /ALTER\s+TABLE\s+[\s\S]*?\bADD\b/i.test(trimmed)
      const hasNotNull = /\bNOT\s+NULL\b/i.test(trimmed)
      const hasDefault = /\bDEFAULT\b/i.test(trimmed)
      if (addsColumn && hasNotNull && !hasDefault) {
        push(
          "DB-010",
          "NOT NULL column added without a default",
          "Existing rows get NULL for the new column, so the constraint fails or the data is lost",
          "Add a DEFAULT, or add the column as nullable and backfill it in a later migration",
          Severity.HIGH,
          Category.MAINTAINABILITY,
          Confidence.HIGH,
          firstLine
        )
      }

      // Dropping a column destroys the data in it
      if (/ALTER\s+TABLE\s+[\s\S]*?DROP\s+(COLUMN\s+)?[\w"]+/i.test(trimmed)) {
        push(
          "DB-011",
          "Column dropped",
          "Dropping a column removes the data it holds and cannot be undone without a backup",
          "Rename the column and stop using it first, then drop it in a later release",
          Severity.HIGH,
          Category.MAINTAINABILITY,
          Confidence.HIGH,
          firstLine
        )
      }

      // A foreign key without an index makes every join slow
      const addForeignKey = trimmed.match(
        /ALTER\s+TABLE\s+([\w"]+)[\s\S]*?ADD\s+(CONSTRAINT\s+[\w"]+\s+)?FOREIGN\s+KEY/i
      )
      if (addForeignKey) {
        const table = addForeignKey[1].replace(/["`]/g, "")
        // Is there an index for this table anywhere in the file?
        const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const indexed = new RegExp(
          "CREATE\\s+(UNIQUE\\s+)?INDEX[^;]*\\bON\\s+[\"\u0060]?" + escaped + "\\b",
          "i"
        ).test(content)
        if (!indexed) {
          push(
            "DB-012",
            "Foreign key added without an index",
            "Without an index on the referencing column every join has to scan the whole table",
            "Create an index on the foreign key column in the same migration",
            Severity.MEDIUM,
            Category.PERFORMANCE,
            Confidence.MEDIUM,
            firstLine
          )
        }
      }

      // Creating an index without CONCURRENTLY locks the table in Postgres.
      // That only matters when the table already exists, so the migration
      // must not create it itself.
      const createIndex = trimmed.match(
        /CREATE\s+(UNIQUE\s+)?INDEX\b[\s\S]*?\bON\s+["\u0060]?([\w]+)/i
      )
      const indexesExistingTable =
        createIndex !== null &&
        !new RegExp(
          "CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?[\"`]?" +
            createIndex[2].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            "\\b",
          "i"
        ).test(content)

      // CONCURRENTLY only exists in PostgreSQL (and compatible engines), so
      // the rule does not apply to the dialects that have no such option.
      const supportsConcurrently =
        db.dialect === "postgresql" || db.dialect === "generic"

      if (
        supportsConcurrently &&
        indexesExistingTable &&
        !/\bCONCURRENTLY\b/i.test(trimmed) &&
        !/IF\s+NOT\s+EXISTS/i.test(trimmed)
      ) {
        push(
          "DB-013",
          "Index created without CONCURRENTLY",
          "In PostgreSQL a plain CREATE INDEX takes a write lock, so writes block until it finishes",
          "Use CREATE INDEX CONCURRENTLY for tables that are already in use",
          Severity.MEDIUM,
          Category.PERFORMANCE,
          Confidence.MEDIUM,
          firstLine
        )
      }

      // A table without a primary key
      if (
        /CREATE\s+TABLE\b/i.test(trimmed) &&
        !/PRIMARY\s+KEY\b/i.test(trimmed) &&
        !/REFERENCES\b/i.test(trimmed)
      ) {
        push(
          "DB-014",
          "Table created without a primary key",
          "Rows cannot be addressed reliably and replication tools have nothing to key on",
          "Add a primary key, or an id column with a unique constraint",
          Severity.MEDIUM,
          Category.MAINTAINABILITY,
          Confidence.MEDIUM,
          firstLine
        )
      }

      // Granting everything
      if (/GRANT\s+ALL\b/i.test(trimmed) && !/\bWITH\b/i.test(trimmed)) {
        push(
          "DB-015",
          "All permissions granted",
          "GRANT ALL gives the grantee far more access than the application needs",
          "Grant only the specific privileges that are required",
          Severity.HIGH,
          Category.SECURITY,
          Confidence.HIGH,
          firstLine
        )
      }

      // TRUNCATE without a filter is as destructive as DELETE without WHERE
      if (/^\s*TRUNCATE\b/i.test(trimmed) && !/\bRESTART\s+IDENTITY\b/i.test(trimmed)) {
        push(
          "DB-016",
          "TRUNCATE without RESTART IDENTITY",
          "The identity counter is not reset, so the ids keep growing after the truncate",
          "Add RESTART IDENTITY when the table should start over",
          Severity.LOW,
          Category.MAINTAINABILITY,
          Confidence.MEDIUM,
          firstLine
        )
      }

      // A transaction that rolls back the whole migration
      if (/BEGIN|COMMIT|ROLLBACK/i.test(trimmed) && db.isMigration) {
        // informational only, not reported
      }
    }

    return findings
  }

  readonly rules = [
    {
      ruleId: "SQL-001",
      title: "SELECT * used",
      description:
        "Selecting every column reads unused data and breaks when the schema changes",
      action: "List the columns you need explicitly",
      severity: Severity.MEDIUM,
      category: Category.PERFORMANCE,
      confidence: Confidence.HIGH,
      pattern: /SELECT\s+\*/i,
    },
    {
      ruleId: "SQL-002",
      title: "DELETE without a WHERE clause",
      description: "A DELETE without WHERE removes every row in the table",
      action: "Always add a WHERE clause",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i,
    },
    {
      ruleId: "SQL-003",
      title: "UPDATE without a WHERE clause",
      description: "An UPDATE without WHERE modifies every row in the table",
      action: "Always add a WHERE clause",
      severity: Severity.CRITICAL,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /\bUPDATE\s+\w+\s+SET\b(?![^;]*\bWHERE\b)/i,
    },
    {
      ruleId: "SQL-004",
      title: "DROP TABLE statement",
      description: "Dropping a table destroys its data permanently",
      action: "Use migrations to manage schema changes safely",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /\bDROP\s+TABLE\b/i,
    },
    {
      ruleId: "SQL-005",
      title: "Truncate without a filter",
      description: "TRUNCATE empties the whole table and cannot be rolled back row by row",
      action: "Use DELETE with a WHERE clause if you only need to clear some rows",
      severity: Severity.HIGH,
      category: Category.SECURITY,
      confidence: Confidence.HIGH,
      pattern: /^\s*TRUNCATE\s+(TABLE\s+)?[\w"]+/i,
    },
    {
      ruleId: "SQL-006",
      title: "INSERT without a column list",
      description:
        "Without a column list the insert depends on the column order of the table, which breaks when the schema changes",
      action: "Name the columns explicitly",
      severity: Severity.MEDIUM,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.HIGH,
      pattern: /^\s*INSERT\s+INTO\s+[\w"]+\s+VALUES/i,
    },
    {
      ruleId: "SQL-007",
      title: "Query without a LIMIT",
      description:
        "A query that reads a whole table can exhaust the memory when the table grows",
      action: "Add a LIMIT, or paginate the result",
      severity: Severity.LOW,
      category: Category.PERFORMANCE,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*SELECT\s+(?!.*\bLIMIT\b)(?!.*\bTOP\b)(?!.*\bFETCH\s+FIRST\b)[\w"*\s,.]+\s+FROM\s+[\w"]+/i,
    },
    {
      ruleId: "SQL-008",
      title: "COMMENT ON is not portable",
      description:
        "COMMENT ON is supported by PostgreSQL and Oracle but not by MySQL or SQL Server",
      action: "Keep the comment in the migration tool instead of the SQL file",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /^\s*COMMENT\s+ON\b/i,
      dialects: ["postgresql", "oracle"] as SqlDialect[],
    },
    {
      ruleId: "SQL-009",
      title: "Non standard syntax used",
      description:
        "The syntax is specific to one database and will not run on another one",
      action: "Keep the vendor specific query in a separate migration, or guard it by dialect",
      severity: Severity.LOW,
      category: Category.MAINTAINABILITY,
      confidence: Confidence.MEDIUM,
      pattern: /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b|\bILIKE\b|\bRETURNING\b|\bTOP\s+\d+\s+PERCENT\b/i,
    },
  ] as Array<{
    ruleId: string
    title: string
    description: string
    action: string
    severity: Severity
    category: Category
    confidence: Confidence
    pattern: RegExp
    dialects?: SqlDialect[]
    dialectHint?: boolean
  }>
}
