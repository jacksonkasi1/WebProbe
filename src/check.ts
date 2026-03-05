import chalk from "chalk";
import ora from "ora";
import { captureScreenshots, captureAndAnalyzePage } from "./capture/screenshot.js";
import { analyzeResponsiveLive } from "./analyzers/responsive.js";
import { analyzeAccessibilityLive } from "./analyzers/accessibility.js";
import { analyzeCodeQuality } from "./analyzers/code-quality.js";
import { confirmSiteInfo, confirmProceed, askMultiLanguage } from "./prompts.js";
import { generateMarkdownReport } from "./report/markdown.js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { CheckOptions, CheckResult, Issue, SiteInfo, Category } from "./types.js";
import { VIEWPORTS } from "./types.js";
import { crawlSite } from "./crawl/crawler.js";
import type { CrawlIssue, CrawlPageData } from "./crawl/types.js";

export async function runCheck(options: CheckOptions): Promise<void> {
  const startTime = Date.now();
  const allIssues: Issue[] = [];
  let siteInfo: Partial<SiteInfo> = {};
  const screenshots: CheckResult["screenshots"] = [];

  console.log(chalk.bold("\n🔍 WebProbe — Web Standards Audit\n"));
  console.log(chalk.dim("─".repeat(50)));

  // ─── Step 1: Crawl & Analyze URL ────────────────────
  if (options.url) {
    console.log(chalk.cyan(`\n📡 Target URL: ${options.url}\n`));

    // 1a: Ask multi-language question if not set via flag
    let multiLanguage = options.multiLanguage ?? false;
    if (options.interactive && options.multiLanguage === undefined) {
      multiLanguage = await askMultiLanguage();
    }

    // 1b: Crawl all pages using the fixseo-based crawler
    const crawlSpinner = ora("Starting site crawl...").start();
    let crawlResult: Awaited<ReturnType<typeof crawlSite>>;
    let pagesScanned = 0;

    try {
      crawlResult = await crawlSite({
        url: options.url,
        maxPages: 25,
        maxDepth: 10,
        includeSitemap: true,
        silent: true,
        multiLanguage,
        onProgress: (scanned, queue, currentUrl) => {
          pagesScanned = scanned;
          crawlSpinner.text = `Crawling... ${scanned} pages scanned | ${queue} in queue`;
        },
      });
      crawlSpinner.succeed(
        `Crawl complete — ${crawlResult.pages.length} pages scanned`
      );
    } catch (err) {
      crawlSpinner.fail(`Crawl failed: ${err}`);
      return;
    }

    // Map crawl issues to WebProbe issues
    for (const cIssue of crawlResult.topIssues) {
      allIssues.push(mapCrawlIssue(cIssue));
    }

    // Also map grouped issues not in topIssues for full coverage
    const topCodes = new Set(crawlResult.topIssues.map(i => `${i.severity}-${i.code}-${i.url}`));
    for (const grouped of crawlResult.groupedIssues) {
      for (const url of grouped.urls) {
        const key = `${grouped.severity}-${grouped.code}-${url}`;
        if (!topCodes.has(key)) {
          allIssues.push(mapCrawlIssue({ ...grouped, url }));
        }
      }
    }

    // Set site info from first crawled page
    const firstPage = crawlResult.pages[0];
    if (firstPage) {
      siteInfo = {
        name: firstPage.title || "Unknown",
        domain: new URL(options.url).hostname,
        language: firstPage.lang || "en",
        description: firstPage.metaDescription || "",
      };
    }

    // 1c: Capture screenshots using Playwright (single page, fixed hang)
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

    // 1d: Run Playwright-based live checks (responsive + accessibility)
    // These only run on the entry URL since they need a real browser
    // Hard 45s timeout prevents hangs on sites with persistent network activity
    const liveSpinner = ora("Running live browser checks...").start();
    try {
      const liveTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 90000));
      const liveChecks = Promise.allSettled([
        analyzeResponsiveLive(options.url, viewports),
        analyzeAccessibilityLive(options.url),
      ]);

      const liveResult = await Promise.race([liveChecks, liveTimeout]);

      if (liveResult !== null) {
        const [responsiveIssues, accessibilityIssues] = liveResult;
        if (responsiveIssues.status === "fulfilled") {
          allIssues.push(...responsiveIssues.value);
        }
        if (accessibilityIssues.status === "fulfilled") {
          allIssues.push(...accessibilityIssues.value);
        }
        liveSpinner.succeed("Live browser checks complete");
      } else {
        liveSpinner.warn("Live browser checks timed out — skipped");
      }
    } catch (err) {
      liveSpinner.fail(`Live checks failed: ${err}`);
    }

    // 1e: Console errors from Playwright on entry page (with hard timeout guard)
    try {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 25000));
      const capture = captureAndAnalyzePage(options.url);
      const pageData = await Promise.race([capture, timeout]);
      if (pageData) {
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
    } catch {
      // Non-fatal
    }

    // Print crawl summary per-page
    console.log(chalk.dim(`\n  Pages crawled:`));
    for (const page of crawlResult.pages.slice(0, 10)) {
      const pageIssueCount = crawlResult.groupedIssues.reduce((n, g) => {
        return n + (g.urls.includes(page.url) ? 1 : 0);
      }, 0);
      const icon = pageIssueCount === 0 ? chalk.green("✓") : chalk.yellow("!");
      console.log(chalk.dim(`    ${icon} ${page.url} — ${pageIssueCount} issue(s)`));
    }
    if (crawlResult.pages.length > 10) {
      console.log(chalk.dim(`    … and ${crawlResult.pages.length - 10} more pages`));
    }

    if (crawlResult.sitemap) {
      const sm = crawlResult.sitemap;
      console.log(chalk.dim(`\n  Sitemap: ${sm.url ?? "none"}`));
      console.log(chalk.dim(`    URLs in sitemap: ${sm.urlsInSitemap}`));
      console.log(chalk.dim(`    URLs tested: ${sm.urlsTested}`));
      if (sm.urlsWithErrors > 0) {
        console.log(chalk.red(`    URLs with errors: ${sm.urlsWithErrors}`));
      }
      if (!sm.referencedInRobots) {
        console.log(chalk.yellow(`    ⚠ Sitemap not referenced in robots.txt`));
      }
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
    critical.slice(0, 10).forEach((i) =>
      console.log(chalk.red(`     • ${i.title}${i.url ? chalk.dim(` [${i.url}]`) : ""}`))
    );
    if (critical.length > 10) {
      console.log(chalk.red(`     … and ${critical.length - 10} more`));
    }
  }
  if (warnings.length > 0) {
    console.log(chalk.yellow(`  🟡 Warning:  ${warnings.length}`));
    warnings.slice(0, 10).forEach((i) =>
      console.log(chalk.yellow(`     • ${i.title}${i.url ? chalk.dim(` [${i.url}]`) : ""}`))
    );
    if (warnings.length > 10) {
      console.log(chalk.yellow(`     … and ${warnings.length - 10} more`));
    }
  }
  if (info.length > 0) {
    console.log(chalk.blue(`  🔵 Info:     ${info.length}`));
    info.slice(0, 5).forEach((i) =>
      console.log(chalk.blue(`     • ${i.title}`))
    );
    if (info.length > 5) {
      console.log(chalk.blue(`     … and ${info.length - 5} more`));
    }
  }
  if (deduped.length === 0) {
    console.log(chalk.green("  ✅ No issues found!"));
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
  // Ensure the output directory exists
  mkdirSync(dirname(options.report), { recursive: true });

  if (options.format === "json") {
    const jsonPath = options.report.replace(/\.md$/, ".json");
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    console.log(chalk.green(`\n📄 JSON report saved: ${jsonPath}`));
  } else {
    const markdown = generateMarkdownReport(result, options.report);
    writeFileSync(options.report, markdown);
    console.log(chalk.green(`\n📄 Report saved: ${options.report}`));

    // Save responsive report in a separate file
    const responsiveIssues = result.issues.filter(i => i.category === "responsive");
    if (responsiveIssues.length > 0) {
      const responsiveResult: CheckResult = {
        ...result,
        issues: responsiveIssues,
        summary: {
          total: responsiveIssues.length,
          critical: responsiveIssues.filter((i) => i.severity === "critical").length,
          warning: responsiveIssues.filter((i) => i.severity === "warning").length,
          info: responsiveIssues.filter((i) => i.severity === "info").length,
          byCategory: { responsive: responsiveIssues.length } as any,
        }
      };
      const responsivePath = options.report.replace(/\.md$/, "-responsive.md");
      const responsiveMarkdown = generateMarkdownReport(responsiveResult, responsivePath);
      writeFileSync(responsivePath, responsiveMarkdown);
      console.log(chalk.green(`📄 Responsive Report saved: ${responsivePath}`));
    }
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
  }

  console.log();
}

function mapCrawlIssue(cIssue: CrawlIssue): Issue {
  let severity: "critical" | "warning" | "info" = "info";
  if (cIssue.severity === "high") severity = "critical";
  else if (cIssue.severity === "medium") severity = "warning";

  return {
    id: `seo-${cIssue.code}-${cIssue.url ?? "global"}`,
    category: "seo",
    severity,
    title: cIssue.message,
    description: cIssue.recommendation || "",
    url: cIssue.url,
    fixSuggestion: cIssue.recommendation,
  };
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
