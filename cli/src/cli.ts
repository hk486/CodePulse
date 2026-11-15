#!/usr/bin/env node

import { Command } from "commander";
import { scanCommand } from "./commands/scan";
import { compareCommand } from "./commands/compare";
import { pushCommand } from "./commands/push";
import { initCommand } from "./commands/init";
import { validateCommand } from "./commands/validate";

const program = new Command();

program
  .name("codepulse")
  .description("Universal Software Engineering Intelligence Platform")
  .version("0.1.0");

// Scan command
program
  .command("scan [path]")
  .description("Scan a project for code quality and security issues")
  .option("--format <format>", "Output format (json, html, text)", "text")
  .option("--output <file>", "Output file path")
  .option(
    "--config <file>",
    "Read the configuration from this file instead of the project's own"
  )
  .option(
    "--exclude <patterns>",
    "Leave out these paths, comma separated, on top of the project's own list"
  )
  .option("--fail-on <severity>", "Fail when a finding at or above this severity is found")
  .option("--baseline <file>", "Fail when a finding the baseline report did not have is found")
  .option(
    "--progress",
    "Write progress to stderr as JSON lines, one per step"
  )
  .action(scanCommand);

// Compare command
program
  .command("compare <old> <new>")
  .description("Compare two analysis reports")
  .option("--format <format>", "Output format (json, html, text)", "text")
  .option("--output <file>", "Output file path")
  .action(compareCommand);

// Push command
program
  .command("push [path]")
  .description("Push a local project to a running CodePulse instance")
  .option("--server <url>", "The CodePulse server address", process.env.CODEPULSE_SERVER)
  .option("--token <token>", "Your API token", process.env.CODEPULSE_TOKEN)
  .option("--name <name>", "The name of the project in CodePulse")
  .option("--fail-on <severity>", "Fail when a finding at or above this severity is found")
  .option("--baseline <mode>", "Fail when a finding the previous run did not have is found (previous)")
  .action(pushCommand);

// Init command: write a configuration file for a project
program
  .command("init [path]")
  .description("Write a .codepulse.yml for a project")
  .option("--force", "replace an existing configuration")
  .action(async (path: string | undefined, options: { force?: boolean }) => {
    await initCommand(path || ".", options);
  });

// Validate command: run the fixtures and measure the analyzers
program
  .command("validate")
  .description("Run the sample projects and measure how good the analyzers are")
  .option("--format <format>", "Output format (json, text)", "text")
  .option("--output <file>", "Write the measurements to a file")
  .option("--fixtures <folder>", "The folder the sample projects are in")
  .action(async (options: { format?: string; output?: string; fixtures?: string }) => {
    await validateCommand(options);
  });

program.parse(process.argv);