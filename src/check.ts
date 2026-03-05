import chalk from "chalk";
import ora from "ora";
import { captureScreenshots, captureAndAnalyzePage } from "./capture/screenshot.js";
import { analyzeSEO } from "./analyzers/seo.js";
import { analyzeResponsive, analyzeResponsiveLive } from "./analyzers/responsive.js";
import { analyzeAccessibility, analyzeAccessibilityLive } from "./analyzers/accessibility.js";
import { analyzePerformance } from "./analyzers/performance.js";
import { analyzeLinks, checkBrokenLinks } from "./analyzers/links.js";
import { analyzeCodeQuality } from "./analyzers/code-quality.js";
import { confirmSiteInfo, confirmProceed } from "./prompts.js";
import { generateMarkdownReport } from "./report/markdown.js";
import { writeFileSync } from "fs";
import type { CheckOptions, CheckResult, Issue, SiteInfo, Category } from "./types.js";
import { VIEWPORTS } from "./types.js";

export async function runCheck(options: CheckOptions): Promise<void> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];
  let siteInfo: Partial<SiteInfo> = {};
  const screenshots: CheckResult["screenshots"] = [];

  console.log(chalk.bold("\n🔍 WebProbe — Web Standards Audit\n"));
  console.log(chalk.dim("─".repeat(50)));

  // ─── Step 1: Analyze URL ────────────────────────────
  if (options.url) {
    console.log(chalk.cyan(`\n📡 Target URL: ${options.url}\n`));

    // 1a: Capture page data
    const spinner = ora("Fetching and analyzing page...").start();
    let pageData: Awaited<ReturnType<typeof captureAndAnalyzePage>>;

    try {
      pageData = await captureAndAnalyzePage(options.url);
      spinner.succeed("Page analyzed");
    } catch (err) {
      spinner.fail(`Failed to load page: ${err}`);
      return;
    }

    // Extract site info
    siteInfo = {
      name: pageData.title || "Unknown",
      domain: new URL(options.url).hostname,
      language: pageData.language || "en",
      description: pageData.metaTags["description"] || "",
    };

    // 1b: Take screenshots
    const viewportNames = options.viewports.split(",").map((v) => v.trim());
    const viewports = viewportNames
      .map((name) => VIEWPORTS[name])
      .filter(Boolean);

    if (viewports.length > 0) {
      const screenshotSpinner = ora(
        `Capturing ${viewports.length} viewport screenshots...`
      ).start();

      try {
        const shots = await captureScreenshots(
          options.url,
          viewports,
          options.screenshots
        );
        screenshots.push(...shots);
        screenshotSpinner.succeed(
          `Captured ${shots.length} screenshots → ${options.screenshots}/`
        );
      } catch (err) {
        screenshotSpinner.fail(`Screenshot capture failed: ${err}`);
      }
    }

    // 1c: Run URL-based analyzers
    const analyzerSpinner = ora("Running SEO analysis...").start();
    allIssues.push(
      ...analyzeSEO(
        {
          title: pageData.title,
          metaTags: pageData.metaTags,
          headings: pageData.headings,
          images: pageData.images,
          canonical: pageData.canonical,
          language: pageData.language,
          html: pageData.html,
          url: options.url,
        },
        siteInfo.domain
      )
    );
    analyzerSpinner.text = "Running responsive analysis...";

    allIssues.push(
      ...analyzeResponsive({
        html: pageData.html,
        hasViewportMeta: pageData.hasViewportMeta,
        viewportMeta: pageData.viewportMeta,
        url: options.url,
      })
    );

    analyzerSpinner.text = "Running accessibility analysis...";
    allIssues.push(
      ...analyzeAccessibility({
        html: pageData.html,
        images: pageData.images,
        headings: pageData.headings,
        language: pageData.language,
        url: options.url,
      })
    );

    analyzerSpinner.text = "Running performance analysis...";
    allIssues.push(
      ...analyzePerformance({
        html: pageData.html,
        images: pageData.images,
        performanceMetrics: pageData.performanceMetrics,
        url: options.url,
      })
    );

    analyzerSpinner.text = "Checking links...";
    allIssues.push(
      ...analyzeLinks({
        links: pageData.links,
        url: options.url,
      })
    );

    analyzerSpinner.text = "Running live responsive checks...";
    try {
      allIssues.push(...(await analyzeResponsiveLive(options.url)));
    } catch (err) {
      // Non-fatal
    }

    analyzerSpinner.text = "Running live accessibility checks...";
    try {
      allIssues.push(...(await analyzeAccessibilityLive(options.url)));
    } catch (err) {
      // Non-fatal
    }

    analyzerSpinner.text = "Checking for broken links...";
    try {
      allIssues.push(
        ...(await checkBrokenLinks(pageData.links, options.url))
      );
    } catch (err) {
      // Non-fatal
    }

    analyzerSpinner.succeed("All URL-based analyzers complete");

    // Log console errors if any
    const errors = pageData.consoleLogs.filter((l) => l.type === "error");
    if (errors.length > 0) {
      allIssues.push({
        id: "code-console-errors",
        category: "code-quality",
        severity: "warning",
        title: `${errors.length} browser console error(s)`,
        description: "JavaScript errors were logged in the browser console.",
        actual: errors
          .slice(0, 5)
          .map((e) => e.text)
          .join("\n"),
        expected: "No console errors",
        url: options.url,
      });
    }
  }

  // ─── Step 2: Analyze Source Code ────────────────────
  if (options.code) {
    console.log(chalk.cyan(`\n📂 Source code: ${options.code}\n`));

    const codeSpinner = ora("Analyzing source code...").start();
    try {
      const codeIssues = analyzeCodeQuality(options.code);
      allIssues.push(...codeIssues);
      codeSpinner.succeed(
        `Code analysis complete — ${codeIssues.length} issue(s) found`
      );
    } catch (err) {
      codeSpinner.fail(`Code analysis failed: ${err}`);
    }
  }

  // ─── Step 3: Interactive Confirmation ───────────────
  if (options.interactive && options.url) {
    console.log(chalk.dim("\n─".repeat(50)));
    console.log(chalk.bold("\n📋 Please confirm detected information:\n"));

    siteInfo = await confirmSiteInfo(siteInfo);
  } else if (!siteInfo.name) {
    siteInfo = {
      name: "Unknown",
      domain: options.url ? new URL(options.url).hostname : "localhost",
      language: "en",
    };
  }

  // ─── Step 4: Deduplicate Issues ─────────────────────
  const deduped = deduplicateIssues(allIssues);

  // ─── Step 5: Display Summary ────────────────────────
  console.log(chalk.dim("\n" + "─".repeat(50)));
  console.log(chalk.bold("\n📊 Audit Results\n"));

  const critical = deduped.filter((i) => i.severity === "critical");
  const warnings = deduped.filter((i) => i.severity === "warning");
  const info = deduped.filter((i) => i.severity === "info");

  if (critical.length > 0) {
    console.log(chalk.red(`  🔴 Critical: ${critical.length}`));
    critical.forEach((i) =>
      console.log(chalk.red(`     • ${i.title}`))
    );
  }
  if (warnings.length > 0) {
    console.log(chalk.yellow(`  🟡 Warning:  ${warnings.length}`));
    warnings.forEach((i) =>
      console.log(chalk.yellow(`     • ${i.title}`))
    );
  }
  if (info.length > 0) {
    console.log(chalk.blue(`  🔵 Info:     ${info.length}`));
    info.forEach((i) =>
      console.log(chalk.blue(`     • ${i.title}`))
    );
  }
  if (deduped.length === 0) {
    console.log(chalk.green("  ✅ No issues found! Great job!"));
  }

  console.log(chalk.dim(`\n  Total: ${deduped.length} issue(s)`));
  console.log(
    chalk.dim(`  Time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
  );

  // ─── Step 6: Build Result ──────────────────────────
  const result: CheckResult = {
    url: options.url,
    codePath: options.code,
    siteInfo: siteInfo as SiteInfo,
    issues: deduped,
    screenshots,
    timestamp: new Date().toISOString(),
    summary: {
      total: deduped.length,
      critical: critical.length,
      warning: warnings.length,
      info: info.length,
      byCategory: categorize(deduped),
    },
  };

  // ─── Step 7: Confirm Next Steps ────────────────────
  if (options.interactive && deduped.length > 0) {
    const { proceed, autoFix } = await confirmProceed(deduped.length);

    if (!proceed) {
      console.log(chalk.dim("\n  Cancelled.\n"));
      return;
    }

    options.autoFix = autoFix;
  }

  // ─── Step 8: Generate Report ───────────────────────
  if (options.format === "json") {
    writeFileSync(options.report.replace(".md", ".json"), JSON.stringify(result, null, 2));
    console.log(chalk.green(`\n📄 JSON report saved: ${options.report.replace(".md", ".json")}`));
  } else {
    const markdown = generateMarkdownReport(result);
    writeFileSync(options.report, markdown);
    console.log(chalk.green(`\n📄 Report saved: ${options.report}`));
  }

  if (screenshots.length > 0) {
    console.log(chalk.green(`📸 Screenshots: ${options.screenshots}/`));
  }

  // ─── Step 9: Auto-Fix (if enabled) ────────────────
  if (options.autoFix && options.code) {
    console.log(
      chalk.yellow(
        "\n⚠️  Auto-fix mode: Issues have been documented in the report."
      )
    );
    console.log(
      chalk.yellow(
        "   Use your AI coding agent to apply fixes based on the report.\n"
      )
    );
    // In a full implementation, you could apply simple fixes here
    // (e.g., adding alt="", adding missing meta tags)
    // But for complex fixes, the AI agent is better suited.
  }

  console.log();
}

function deduplicateIssues(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issue.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function categorize(issues: Issue[]): Record<Category, number> {
  const counts: Record<string, number> = {};
  issues.forEach((i) => {
    counts[i.category] = (counts[i.category] || 0) + 1;
  });
  return counts as Record<Category, number>;
}
