#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { initStandards } from "./init.js";
import { runCheck } from "./check.js";
import { captureScreenshots } from "./capture/screenshot.js";
import { VIEWPORTS } from "./types.js";

const program = new Command();

program
  .name("webprobe")
  .description(
    chalk.bold("🔍 WebProbe") +
      " — Web standards auditor for AI coding agents\n" +
      "  Checks SEO, responsive design, accessibility, performance & visual standards"
  )
  .version("1.0.0");

// ─── INIT ──────────────────────────────────────────────
program
  .command("init")
  .description("Generate a web standards rules file for your project")
  .option("-o, --output <path>", "Output file path", "./web-standards.md")
  .option("--no-interactive", "Skip interactive prompts")
  .action(async (options) => {
    try {
      await initStandards(options.output, options.interactive);
      console.log(
        chalk.green(`\n✅ Standards file created: ${options.output}`)
      );
      console.log(
        chalk.dim("   Add this to your project root and reference it in your AI agent config.\n")
      );
    } catch (err) {
      console.error(chalk.red("Error:"), err);
      process.exit(1);
    }
  });

// ─── CHECK ─────────────────────────────────────────────
program
  .command("check")
  .description("Audit a website and/or source code against web standards")
  .option("-u, --url <url>", "Website URL to check (localhost or deployed)")
  .option("-c, --code <path>", "Source code directory to analyze")
  .option("--auto-fix", "Attempt to auto-fix issues in source code", false)
  .option("--multi-language", "Site has multiple language versions (enables hreflang checks)", false)
  .option("-r, --report <path>", "Report output path", "./output/webprobe-report.md")
  .option("-f, --format <format>", "Output format: markdown or json", "markdown")
  .option("--no-interactive", "Skip confirmation prompts (for agent use)")
  .option("-s, --screenshots <dir>", "Screenshots directory", "./output/screenshots")
  .option("-v, --viewports <list>", "Viewports to capture (comma-separated)", "mobile,tablet,desktop")
  .action(async (options) => {
    try {
      if (!options.url && !options.code) {
        // If neither provided, ask interactively or default to current dir
        if (options.interactive !== false) {
          const inquirer = await import("inquirer");
          const answers = await inquirer.default.prompt([
            {
              type: "input",
              name: "url",
              message: "Website URL to check (leave empty to skip):",
              default: "",
            },
            {
              type: "input",
              name: "code",
              message: "Source code path (leave empty to skip, '.' for current dir):",
              default: ".",
            },
          ]);
          options.url = answers.url || undefined;
          options.code = answers.code || undefined;
        } else {
          console.error(
            chalk.red("Error: Provide --url and/or --code, or run in interactive mode.")
          );
          process.exit(1);
        }
      }

      await runCheck({
        url: options.url,
        code: options.code,
        autoFix: options.autoFix,
        report: options.report,
        format: options.format,
        interactive: options.interactive !== false,
        screenshots: options.screenshots,
        viewports: options.viewports,
        multiLanguage: options.multiLanguage,
      });
    } catch (err) {
      console.error(chalk.red("Error:"), err);
      process.exit(1);
    }
  });

// ─── SCREENSHOT (standalone) ───────────────────────────
program
  .command("screenshot <url>")
  .description("Capture screenshots at different viewports")
  .option("-o, --output <dir>", "Output directory", "./output/screenshots")
  .option("-v, --viewports <list>", "Viewports: mobile,tablet,desktop,wide", "mobile,tablet,desktop")
  .action(async (url, options) => {
    try {
      const viewportNames = options.viewports.split(",").map((v: string) => v.trim());
      const viewports = viewportNames
        .map((name: string) => VIEWPORTS[name])
        .filter(Boolean);

      const shots = await captureScreenshots(url, viewports, options.output);
      console.log(chalk.green(`\n✅ Captured ${shots.length} screenshots:`));
      shots.forEach((s) => console.log(chalk.dim(`   ${s.viewport}: ${s.path}`)));
      console.log();
    } catch (err) {
      console.error(chalk.red("Error:"), err);
      process.exit(1);
    }
  });

program.parse();
