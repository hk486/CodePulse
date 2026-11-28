import * as path from "path";
import * as crypto from "crypto";
import { Writable } from "stream";
import ora from "ora";
import chalk from "chalk";
import { ProjectReport, AnalyzerStatus, Category } from "@codepulse/shared";
import { DefaultProjectDetector } from "../services/ProjectDetector";
import { DefaultLanguageAdapterRegistry } from "../services/AnalyzerRegistry";
import { AnalysisExecutor } from "../services/AnalysisExecutor";
import { ReportGenerator } from "../services/ReportGenerator";
import { buildAnalyzerCatalog } from "../services/analyzerCatalog";
import { FileIndex, EXTENSION_LANGUAGES } from "../services/fileIndex";
import { detectLanguages, languageOfPath } from "../services/languageDetector";
import { readConfig } from "../services/config";
import { evaluateGate, readBaseline } from "../services/gate";
import { ProgressReporter, stderrReporter } from "../services/progress";
import { PipelineRecorder, buildCoverage, buildPipelineRecord } from "../services/pipeline";
import { ToolRunner } from "../services/tools/runner";
import { TOOLS } from "../services/tools/definitions";
import {
  classifyFindings,
  deduplicateFindings,
  normalizeFindings,
  summariseFindings,
  validateEvidence,
} from "../services/findingPipeline";

interface ScanOptions {
  format: string;
  output?: string;
  config?: string;
  exclude?: string;
  /** Fail the build when a finding at or above this severity is found. */
  failOn?: string;
  /** Fail the build when a finding the baseline did not have is found. */
  baseline?: string;
  /** Write progress lines to stderr, one JSON object per line. */
  progress?: boolean;
}

export async function scanCommand(
  projectPath: string = ".",
  options: ScanOptions
) {
  try {
    const resolvedPath = path.resolve(projectPath);
    const projectName = path.basename(resolvedPath);

    // Progress is off unless somebody asks for it, so a person running the
    // scan in a terminal sees the same clean output as before.
    const progress = options.progress ? stderrReporter() : ProgressReporter.silent;

    // When the progress lines are wanted, the spinner steps aside: they
    // both write to stderr, and a machine reading them needs each line to
    // be a whole event.
    const spinnerStream = options.progress
      ? new Writable({
          write(_chunk, _encoding, callback) {
            callback();
          },
        })
      : process.stderr;

    // The record of what this scan actually did, so the report can say
    // what was covered and what was not.
    const pipeline = new PipelineRecorder();
    const scanStartedAt = new Date();

    // Step 0: Read the project's own configuration, so it can say what to
    // leave out and which findings to silence.
    pipeline.start("project_manifest");
    const { config: projectConfig, found: configFile, error: configError } =
      await readConfig(resolvedPath, options.config);

    // The --exclude flag adds paths to leave out on top of whatever the
    // project already said.
    const extraExcludes = (options.exclude || "")
      .split(",")
      .map(pattern => pattern.trim())
      .filter(Boolean);
    const ignorePaths = [...projectConfig.ignore, ...extraExcludes];

    if (extraExcludes.length > 0) {
      console.error(
        chalk.gray(`! ${extraExcludes.length} path(s) left out by --exclude`)
      );
    }
    pipeline.finish("project_manifest", {
      configFile: configFile || null,
      excluded: extraExcludes.length,
      configError: configError || null,
    });

    // Step 0b: Index the project once. Every analyzer uses this list, so the
    // tree is walked a single time no matter how many analyzers run.
    pipeline.start("file_discovery");
    progress.report("indexing", 2, "Walking the project");
    let spinner = ora({ text: "Indexing project...", stream: spinnerStream }).start();
    const index = await FileIndex.build(resolvedPath, {}, ignorePaths);
    spinner.succeed(
      `Indexed ${index.entries.length} files` +
        (index.truncated ? ` (${index.skippedByBudget + index.skippedBySize} left out)` : "") +
        (index.skippedByConfig > 0 ? ` (${index.skippedByConfig} ignored by the project)` : "")
    );
    progress.report(
      "indexing",
      20,
      `Indexed ${index.entries.length} files`
    );
    pipeline.finish("file_discovery", {
      files: index.entries.length,
      skippedByBudget: index.skippedByBudget,
      skippedBySize: index.skippedBySize,
      skippedByConfig: index.skippedByConfig,
      truncated: index.truncated,
    });
    if (configError) {
      console.error(
        chalk.yellow(`! ${configFile} could not be read, it was ignored: ${configError}`)
      );
    }

    // Step 1: Detect project
    pipeline.start("language_detection");
    progress.report("detecting", 25, "Working out what the project is");
    spinner = ora({ text: "Detecting project...", stream: spinnerStream }).start();
    const detector = new DefaultProjectDetector();
    const detectionResult = await detector.detect(resolvedPath, index);
    const languageDetection = detectLanguages(resolvedPath, index.entries);
    spinner.succeed(
      `Project detected: ${detectionResult.metadata.languages.join(", ")}`
    );
    progress.report(
      "detecting",
      32,
      `Detected ${detectionResult.metadata.languages.join(", ") || "no languages"}`
    );
    pipeline.finish("language_detection", {
      languages: detectionResult.metadata.languages,
    });

    // Step 2: Initialize analyzers
    spinner = ora({ text: "Initializing analyzers...", stream: spinnerStream }).start();
    const registry = new DefaultLanguageAdapterRegistry();

    // Every analyzer CodePulse has. They are built from one list so that
    // the worker thread can build them too.
    for (const analyzer of buildAnalyzerCatalog()) {
      registry.register(analyzer);
    }

    pipeline.start("analyzer_selection");
    const analyzers = registry.findSupportedAnalyzers({
      projectPath: resolvedPath,
      projectName,
      detectedLanguages: detectionResult.metadata.languages,
    });
    pipeline.finish("analyzer_selection", {
      analyzers: analyzers.map(analyzer => ({
        id: analyzer.id,
        name: analyzer.displayName,
        version: analyzer.version,
        language: analyzer.language,
      })),
    });

    if (analyzers.length === 0) {
      spinner.warn(
        "No analyzers available for detected languages. Skipping analysis."
      );

      // Still emit a well-formed report so machine consumers (e.g. the REST
      // API) always receive parseable output, even when nothing was analysed.
      const emptyReport: ProjectReport = {
        id: crypto.randomUUID(),
        projectPath: resolvedPath,
        projectName,
        detectedLanguages: detectionResult.metadata.languages,
        analysis: {
          projectPath: resolvedPath,
          languages: detectionResult.metadata.languages,
          findings: [],
          summary: {
            totalFindings: 0,
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
            byCategory: Object.fromEntries(
              Object.values(Category).map((category) => [category, 0])
            ) as Record<Category, number>,
            byLanguage: {},
          },
          analyzersRun: [],
        },
        generatedAt: new Date(),
        cliVersion: "0.1.0",
      };

      if (options.format === "json" && !options.output) {
        console.log(new ReportGenerator().generateJSONReport(emptyReport));
      } else if (options.output) {
        const outputPath = path.resolve(options.output);
        new ReportGenerator().saveReport(
          emptyReport,
          outputPath,
          options.format || "text"
        );
        console.log(chalk.green(`✓ Report saved to ${outputPath}`));
      }
      progress.report("done", 100, "Nothing to analyse in this project");
    } else {
      spinner.succeed(`${analyzers.length} analyzer(s) available`);

      // Step 3: Execute analysis
      pipeline.start("analyzer_execution");
      progress.report("analyzing", 36, `Running ${analyzers.length} analyzer(s)`);
      spinner = ora({ text: "Running analysis...", stream: spinnerStream }).start();
      const executor = new AnalysisExecutor(registry);
      const components = detectionResult.metadata.components || [];
      const analysisResult = await executor.executeAnalysis(
        {
          projectPath: resolvedPath,
          projectName,
          detectedLanguages: detectionResult.metadata.languages,
          detectedFrameworks: detectionResult.metadata.frameworks,
          components: components.map(c => ({
            id: c.id,
            name: c.name,
            relativePath: c.relativePath,
          })),
          files: index.entries,
        },
        {
          excludePaths: ignorePaths,
          rules: Object.fromEntries(
            projectConfig.exclude.map(ruleId => [ruleId, { enabled: false }])
          ),
          suppressions: projectConfig.suppress,
        },
        (completed, total, analyzerName) => {
          // The analyzers are the bulk of the work, so they carry most of
          // the progress bar.
          const share = total > 0 ? completed / total : 1;
          progress.report(
            "analyzing",
            36 + share * 52,
            `${analyzerName} (${completed}/${total})`
          );
        }
      );
      spinner.succeed(
        `Analysis complete: ${analysisResult.summary.totalFindings} findings`
      );
      progress.report(
        "analyzing",
        90,
        `${analysisResult.summary.totalFindings} findings found`
      );
      pipeline.finish("analyzer_execution", {
        analyzers: analysisResult.analyzerExecutions?.length || 0,
        findings: analysisResult.summary.totalFindings,
      });

      // Step 4: Generate report
      progress.report("reporting", 94, "Writing the report");
      spinner = ora({ text: "Generating report...", stream: spinnerStream }).start();
      // The established tools. They know the things the rules do not: the
      // types, the shape of a language, and what a secret looks like.
      // A tool that is not installed says so and is skipped.
      pipeline.start("external_tool_execution");
      progress.report("tools", 92, "Running the established tools");

      const toolRunner = new ToolRunner();
      const toolContext = {
        projectPath: resolvedPath,
        files: index.entries.map((entry) => ({
          path: entry.path,
          absolutePath: entry.absolutePath,
          extension: entry.extension,
        })),
        languageOf: (file: string) => languageOfPath(languageDetection, file),
      };

      const toolFindings: typeof analysisResult.findings = [];
      const toolExecutions: typeof analysisResult.analyzerExecutions = [];

      // The tools are separate programs, so they run at the same time as
      // one another. Each one is on its own, and one of them failing
      // does not affect the others.
      const toolLimit = Math.max(
        1,
        Math.min(Number(process.env.CODEPULSE_TOOL_CONCURRENCY || 4), TOOLS.length)
      );
      const toolResults: Array<{
        tool: (typeof TOOLS)[number];
        run: Awaited<ReturnType<ToolRunner["analyze"]>>["run"];
        findings: typeof toolFindings;
      }> = [];

      let toolCursor = 0;
      const toolWorkers = Array.from(
        { length: Math.min(toolLimit, TOOLS.length) },
        async () => {
          while (toolCursor < TOOLS.length) {
            const tool = TOOLS[toolCursor++];
            const result = await toolRunner.analyze(tool, toolContext);
            toolResults.push({ tool, run: result.run, findings: result.findings });
          }
        }
      );
      await Promise.all(toolWorkers);

      // The results are put back in the order the tools are listed in, so
      // the report reads the same way every time.
      toolResults.sort(
        (a, b) => TOOLS.indexOf(a.tool) - TOOLS.indexOf(b.tool)
      );

      for (const { tool, run, findings } of toolResults) {
        toolExecutions.push({
          id: `tool-${tool.id}`,
          name: tool.name,
          version: run.version || "unknown",
          language: tool.languages?.join(", ") || "any",
          status: analyzerStatusFor(run.status),
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: run.durationMs,
          findingCount: run.findingCount,
          filesAnalyzed: run.filesAnalyzed,
          error: run.error,
          reason: run.reason,
          log: run.log,
        });

        toolFindings.push(...findings);

        if (run.status === "completed") {
          console.error(
            chalk.gray(`  ${tool.name}: ${run.findingCount} finding(s)`)
          );
        } else if (run.status === "unavailable") {
          console.error(chalk.gray(`  ${tool.name}: not installed, skipped`));
        } else if (run.status === "failed") {
          console.error(chalk.yellow(`  ${tool.name}: ${run.error}`));
        }
      }

      analysisResult.findings.push(...toolFindings);
      analysisResult.analyzerExecutions = [
        ...(analysisResult.analyzerExecutions || []),
        ...toolExecutions,
      ];

      pipeline.finish("external_tool_execution", {
        tools: toolExecutions.length,
        findings: toolFindings.length,
        completed: toolExecutions.filter(
          (execution) => execution.status === AnalyzerStatus.COMPLETED
        ).length,
        unavailable: toolExecutions.filter(
          (execution) => execution.status === AnalyzerStatus.UNAVAILABLE
        ).length,
        failed: toolExecutions.filter(
          (execution) => execution.status === AnalyzerStatus.FAILED
        ).length,
      });

      // How many files of each language were found, and how many of them
      // were really read by an analyzer or a tool.
      const filesPerLanguage: Record<string, number> = {};
      for (const entry of index.entries) {
        if (languageDetection.manifestPaths.has(entry.path)) continue;
        const language = languageOfPath(languageDetection, entry.path);
        if (language) filesPerLanguage[language] = (filesPerLanguage[language] || 0) + 1;
      }

      // Count files read by analyzers that cover a language. Generic
      // analyzer provides baseline coverage for every language, so its
      // reads count too.
      const readByLanguage = new Map<string, Set<string>>();
      for (const execution of analysisResult.analyzerExecutions || []) {
        if (execution.status !== AnalyzerStatus.COMPLETED) continue;
        const covers = [execution.language, ...(execution.covers || [])];
        for (const file of execution.filesRead || []) {
          const language = languageOfPath(languageDetection, file);
          if (!language) continue;
          if (execution.language !== "generic" && !covers.includes(language)) continue;
          if (!readByLanguage.has(language)) readByLanguage.set(language, new Set());
          readByLanguage.get(language)!.add(file);
        }
      }

      const filesAnalyzedPerLanguage: Record<string, number> = {};
      for (const [language, files] of readByLanguage) {
        filesAnalyzedPerLanguage[language] = files.size;
      }

      // The languages that have no analyzer of their own, so the report
      // can say which detected languages were only given the general
      // rules.
      const coveredLanguages = new Set<string>();
      for (const analyzer of registry.getAllAnalyzers()) {
        if (analyzer.language === "generic") continue;
        coveredLanguages.add(analyzer.language);
        for (const covered of analyzer.covers || []) coveredLanguages.add(covered);
      }
      const languagesWithoutAnalyzer = Object.keys(filesPerLanguage).filter(
        (language) => !coveredLanguages.has(language)
      );

      const coverage = buildCoverage({
        detectedLanguages: detectionResult.metadata.languages,
        executions: analysisResult.analyzerExecutions || [],
        filesPerLanguage,
        filesAnalyzedPerLanguage,
        findings: analysisResult.findings,
        languagesWithoutAnalyzer,
      });

      // ------------------------------------------------------------------
      // The last five stages. These are the ones that make the report
      // worth believing, and each one does real work.
      // ------------------------------------------------------------------

      // Gather the results. Everything the analyzers and the tools found,
      // in one place.
      pipeline.start("result_collection");
      const collected = [...analysisResult.findings];
      pipeline.finish("result_collection", {
        findings: collected.length,
        analyzers: (analysisResult.analyzerExecutions || []).length,
      });

      // Put them in one shape. Every finding answers the same questions,
      // whatever produced it.
      pipeline.start("finding_normalization");
      const normalized = normalizeFindings(collected);
      analysisResult.findings = normalized.findings;
      pipeline.finish("finding_normalization", {
        repaired: normalized.repaired,
        issues: normalized.issues.slice(0, 10),
      });

      // Find the duplicates. Two rules can find the same thing; the
      // report says it once and says which rules agreed.
      pipeline.start("duplicate_detection");
      const deduped = deduplicateFindings(analysisResult.findings);
      analysisResult.findings = deduped.findings;
      pipeline.finish("duplicate_detection", {
        removed: deduped.removed,
        groups: deduped.groups,
      });

      // Check the evidence. A finding that names a file and a line is
      // making a claim; the claim is checked against the file.
      pipeline.start("evidence_validation");
      const evidence = validateEvidence(
        analysisResult.findings,
        resolvedPath
      );
      analysisResult.findings = evidence.findings;
      pipeline.finish("evidence_validation", {
        verified: evidence.verified,
        unverified: evidence.unverified,
        problems: evidence.problems.slice(0, 10),
      });

      // Rate the findings. Every finding says how bad it is and how sure
      // the analyzer is.
      pipeline.start("severity_classification");
      const classified = classifyFindings(analysisResult.findings);
      analysisResult.findings = classified.findings;
      pipeline.finish("severity_classification", {
        bySeverity: classified.bySeverity,
        byValidation: classified.byValidation,
      });

      // The summary is worked out from the findings that are really in
      // the report, so the totals and the list always agree.
      analysisResult.summary = summariseFindings(analysisResult.findings) as any;

      // How many files were really read. The generic analyzer looks at
      // everything, so the number that means something is the number read
      // by an analyzer or tool that was written for that kind of file.
      const filesScanned = new Set<string>();
      for (const execution of analysisResult.analyzerExecutions || []) {
        if (execution.status !== AnalyzerStatus.COMPLETED) continue;
        for (const file of execution.filesRead || []) filesScanned.add(file);
      }
      const filesScannedCount = filesScanned.size;
      const filesAnalyzedCount = Array.from(readByLanguage.values()).reduce(
        (total, files) => total + files.size,
        0
      );

      pipeline.start("report_generation");

      // Everything the report holds is assembled, so the stage is done.
      pipeline.finish("report_generation");

      const report: ProjectReport = {
        id: crypto.randomUUID(),
        projectPath: resolvedPath,
        projectName,
        detectedLanguages: detectionResult.metadata.languages,
        detectedFrameworks: detectionResult.metadata.frameworks,
        components,
        techStack: detectionResult.metadata.techStack,
        projectType: detectionResult.metadata.projectType,
        technologyInventory: {
          languages: coverage.map((entry) => ({
            language: entry.language,
            files: entry.filesDetected,
            detectedBy: detectionResult.metadata.languageEvidence?.[entry.language] || [],
            dialect: detectionResult.metadata.dialects?.[entry.language],
            analyzers: entry.analyzers,
            state: entry.state,
            findings: entry.findings,
          })),
          technologies: detectionResult.metadata.detectedTechnologies || [],
          frameworks: detectionResult.metadata.frameworks || [],
          databases: detectionResult.metadata.techStack?.databases || [],
          infrastructure: detectionResult.metadata.techStack?.infrastructure || [],
          packageManagers: detectionResult.metadata.techStack?.packageManagers || [],
          ciTools: detectionResult.metadata.techStack?.ciTools || [],
        },
        coverage: {
          ...index.summary(),
          languages: filesPerLanguage,
          languagesWithoutAnalyzer,
        },
        analysis: analysisResult,
        generatedAt: new Date(),
        cliVersion: "0.1.0",
        pipeline: buildPipelineRecord({
          stages: pipeline.getStages(),
          executions: analysisResult.analyzerExecutions || [],
          coverage,
          languagesWithoutAnalyzer,
          filesTotal: index.entries.length,
          filesAnalyzed: filesAnalyzedCount,
          filesScanned: filesScannedCount,
          filesSkipped:
            index.skippedByBudget + index.skippedBySize + index.skippedByConfig,
          skipReasons: {
            budget: index.skippedByBudget,
            size: index.skippedBySize,
            projectRules: index.skippedByConfig,
          },
          startedAt: scanStartedAt,
          completedAt: new Date(),
        }),
      };

      const generator = new ReportGenerator();

      // Output report
      if (options.format === 'json' && !options.output) {
        // Output JSON to stdout when format is json without output file
        console.log(generator.generateJSONReport(report));
      } else {
        // Display text report to console
        const textReport = generator.generateTextReport(report);
        spinner.stop();
        console.log(textReport);
      }

      progress.report(
        "done",
        100,
        `Analysis finished with ${analysisResult.summary.totalFindings} findings`
      );

      // Save to file if specified
      if (options.output) {
        const outputPath = path.resolve(options.output);
        const format = options.format || "text";
        generator.saveReport(report, outputPath, format);
        console.log(chalk.green(`✓ Report saved to ${outputPath}`));
      }

      // The gate. A build can be held to what is already there, so a
      // project with findings does not have to reach zero before it can
      // start failing on new ones.
      if (options.failOn || options.baseline) {
        let baseline = null;
        if (options.baseline) {
          try {
            baseline = readBaseline(path.resolve(options.baseline));
          } catch (error) {
            console.error(
              chalk.red(`✗ Could not read the baseline: ${
                error instanceof Error ? error.message : "unknown error"
              }`)
            );
            process.exit(1);
          }
        }

        const gate = evaluateGate(analysisResult.findings, {
          failOn: options.failOn,
          baseline,
        });

        if (gate.failed) {
          console.error(chalk.red(`✗ ${gate.reason}`));
          for (const finding of gate.offenders.slice(0, 10)) {
            const file = finding.location?.filePath || "";
            const line = finding.location?.startLine
              ? `:${finding.location.startLine}`
              : "";
            console.error(
              chalk.red(`  ${finding.severity} ${finding.ruleId || ""} ${
                finding.title || ""
              }`) + chalk.gray(`  ${file}${line}`)
            );
          }
          if (gate.offenders.length > 10) {
            console.error(chalk.gray(`  and ${gate.offenders.length - 10} more`));
          }
          process.exit(1);
        }

        const held = [
          options.failOn ? `nothing at ${options.failOn} or above` : "",
          options.baseline ? "nothing the baseline did not have" : "",
        ].filter(Boolean).join(", ");
        console.log(chalk.green(`✓ The gate passed: ${held}.`));
      }
    }
  } catch (error) {
    console.error(chalk.red("Error during analysis:"), error);
    process.exit(1);
  }
}

/**
 * The status of a tool, in the words the record uses.
 */
function analyzerStatusFor(
  status: "completed" | "failed" | "unavailable" | "skipped"
): AnalyzerStatus {
  if (status === "completed") return AnalyzerStatus.COMPLETED;
  if (status === "failed") return AnalyzerStatus.FAILED;
  if (status === "unavailable") return AnalyzerStatus.UNAVAILABLE;
  return AnalyzerStatus.SKIPPED;
}
