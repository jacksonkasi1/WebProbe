import { relative, dirname } from "path";
import type { CheckResult, Issue, Category } from "../types.js";

const CATEGORY_LABELS: Record<Category, { emoji: string; label: string }> = {
  seo: { emoji: "🔍", label: "SEO" },
  responsive: { emoji: "📱", label: "Responsive Design" },
  accessibility: { emoji: "♿", label: "Accessibility" },
  performance: { emoji: "⚡", label: "Performance" },
  links: { emoji: "🔗", label: "Links" },
  visual: { emoji: "🎨", label: "Visual Standards" },
  "code-quality": { emoji: "🧹", label: "Code Quality" },
  security: { emoji: "🔒", label: "Security" },
  meta: { emoji: "📋", label: "Meta & Social" },
};

const SEVERITY_ICONS = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

export function generateMarkdownReport(result: CheckResult, reportPath?: string): string {
  const lines: string[] = [];

  // Header
  lines.push(`# WebProbe Audit Report — ${result.siteInfo.name}`);
  lines.push("");
  lines.push(`> Generated: ${new Date(result.timestamp).toLocaleString()}`);
  if (result.url) lines.push(`> URL: ${result.url}`);
  if (result.codePath) lines.push(`> Source: \`${result.codePath}\``);
  lines.push(`> Domain: ${result.siteInfo.domain}`);
  lines.push(`> Language: ${result.siteInfo.language}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  lines.push(
    `| 🔴 Critical | ${result.summary.critical} |`
  );
  lines.push(
    `| 🟡 Warning | ${result.summary.warning} |`
  );
  lines.push(
    `| 🔵 Info | ${result.summary.info} |`
  );
  lines.push(
    `| **Total** | **${result.summary.total}** |`
  );
  lines.push("");

  // Category breakdown
  lines.push("### By Category");
  lines.push("");
  lines.push("| Category | Issues |");
  lines.push("|----------|--------|");
  for (const [cat, count] of Object.entries(result.summary.byCategory)) {
    const label = CATEGORY_LABELS[cat as Category];
    if (label && count > 0) {
      lines.push(`| ${label.emoji} ${label.label} | ${count} |`);
    }
  }
  lines.push("");

  // Screenshots
  if (result.screenshots.length > 0) {
    lines.push("## Screenshots");
    lines.push("");
    
    // Group screenshots by page/url if possible, otherwise just list them
    const screenshotsByUrl = new Map<string, typeof result.screenshots>();
    
    for (const screenshot of result.screenshots) {
       // Extract URL slug from filename if possible (e.g. index--mobile...)
       const filename = screenshot.path.split('/').pop() || "";
       const parts = filename.split('--');
       const page = parts.length > 1 ? parts[0] : "Home";
       
       if (!screenshotsByUrl.has(page)) {
         screenshotsByUrl.set(page, []);
       }
       screenshotsByUrl.get(page)!.push(screenshot);
    }
    
    for (const [page, shots] of Array.from(screenshotsByUrl.entries())) {
      lines.push(`### Page: /${page === 'index' ? '' : page}`);
      lines.push("");
      
      for (const screenshot of shots) {
        // Use a path relative to the report file so images render correctly
        const imgPath = reportPath
          ? relative(dirname(reportPath), screenshot.path)
          : screenshot.path;
        lines.push(
          `#### ${screenshot.viewport}`
        );
        lines.push(
          `![${screenshot.viewport}](${imgPath})`
        );
        lines.push(
          `*${screenshot.width}×${screenshot.height}${screenshot.fullPage ? " (full page)" : " (above fold)"}*`
        );
        lines.push("");
      }
    }
  }

  // Issues by category
  lines.push("## Issues");
  lines.push("");

  // Group issues by category
  const byCategory = new Map<Category, Issue[]>();
  for (const issue of result.issues) {
    const existing = byCategory.get(issue.category) || [];
    existing.push(issue);
    byCategory.set(issue.category, existing);
  }

  // Sort categories: critical first
  const sortedCategories = Array.from(byCategory.entries()).sort(
    (a, b) => {
      const aCritical = a[1].filter((i) => i.severity === "critical").length;
      const bCritical = b[1].filter((i) => i.severity === "critical").length;
      return bCritical - aCritical;
    }
  );

  for (const [category, issues] of sortedCategories) {
    const label = CATEGORY_LABELS[category] || {
      emoji: "📌",
      label: category,
    };

    lines.push(`### ${label.emoji} ${label.label}`);
    lines.push("");

    // Sort by severity within category
    const sorted = issues.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    });

    for (const issue of sorted) {
      const icon = SEVERITY_ICONS[issue.severity];
      lines.push(`#### ${icon} ${issue.title}`);
      lines.push("");
      if (issue.url) {
        lines.push(`**Page:** \`${issue.url}\``);
        lines.push("");
      }
      lines.push(issue.description);
      lines.push("");

      if (issue.actual) {
        lines.push(`**Found:** \`${issue.actual}\``);
        lines.push("");
      }
      if (issue.expected) {
        lines.push(`**Expected:** ${issue.expected}`);
        lines.push("");
      }
      if (issue.filePath) {
        const loc = issue.line ? `${issue.filePath}:${issue.line}` : issue.filePath;
        lines.push(`**File:** \`${loc}\``);
        lines.push("");
      }
      if (issue.element) {
        lines.push(`**Element:** \`${issue.element}\``);
        lines.push("");
      }
      if (issue.fixSuggestion) {
        lines.push(`**Fix:** ${issue.fixSuggestion}`);
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  // No issues congratulation
  if (result.issues.length === 0) {
    lines.push("### ✅ No issues found!");
    lines.push("");
    lines.push("Your website passes all web standards checks. Great job!");
    lines.push("");
  }

  // Footer
  lines.push("---");
  lines.push("");
  lines.push(
    "*Report generated by [WebProbe](https://github.com/your-repo/webprobe) — Web Standards Auditor for AI Coding Agents*"
  );

  return lines.join("\n");
}
