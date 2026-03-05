import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, relative } from "path";
import type { Issue } from "../types.js";

const WEB_EXTENSIONS = new Set([
  ".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte",
  ".astro", ".php", ".erb", ".ejs", ".hbs", ".njk",
  ".css", ".scss", ".sass", ".less",
  ".js", ".ts", ".mjs", ".mts",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".next", ".nuxt", ".output", "dist", "build",
  ".git", ".svelte-kit", ".astro", "__pycache__", ".cache",
  "coverage", ".turbo", ".vercel",
]);

export function analyzeCodeQuality(codePath: string): Issue[] {
  const issues: Issue[] = [];
  const files = getWebFiles(codePath);

  for (const filePath of files) {
    const relPath = relative(codePath, filePath);
    const ext = extname(filePath);
    let content: string;

    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // ─── HTML / Template Files ────────────────────────
    if ([".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".astro"].includes(ext)) {
      // Check for inline styles
      const inlineStyleCount = (content.match(/style=["']\{?[^"']+\}?["']/g) || []).length;
      if (inlineStyleCount > 10) {
        issues.push({
          id: `code-excessive-inline-styles-${relPath}`,
          category: "code-quality",
          severity: "info",
          title: `Excessive inline styles in ${relPath}`,
          description: `Found ${inlineStyleCount} inline style attributes. Consider using CSS classes.`,
          filePath: relPath,
          actual: `${inlineStyleCount} inline styles`,
          expected: "Use CSS classes or CSS-in-JS instead of inline styles",
        });
      }

      // Check for missing alt attributes on img tags
      const imgTags = content.match(/<img[^>]*>/gi) || [];
      const imgsMissingAlt = imgTags.filter(
        (img) => !img.includes("alt=") && !img.includes("alt =")
      );
      if (imgsMissingAlt.length > 0) {
        issues.push({
          id: `code-img-no-alt-${relPath}`,
          category: "code-quality",
          severity: "critical",
          title: `${imgsMissingAlt.length} <img> without alt in ${relPath}`,
          description: "All images must have alt attributes for accessibility and SEO.",
          filePath: relPath,
          actual: imgsMissingAlt.slice(0, 3).join("\n"),
          expected: 'All <img> tags should have alt="descriptive text"',
        });
      }

      // Check for hardcoded localhost URLs
      const localhostUrls = content.match(/https?:\/\/localhost[:\d]*/g) || [];
      if (localhostUrls.length > 0) {
        issues.push({
          id: `code-localhost-url-${relPath}`,
          category: "code-quality",
          severity: "critical",
          title: `Hardcoded localhost URL in ${relPath}`,
          description: "Localhost URLs will break in production.",
          filePath: relPath,
          actual: [...new Set(localhostUrls)].join(", "),
          expected: "Use environment variables or relative URLs",
          fixSuggestion: "Replace with process.env.NEXT_PUBLIC_URL or relative paths.",
        });
      }

      // Check for hardcoded http:// URLs (should be https://)
      const httpUrls = content.match(/http:\/\/(?!localhost)[^\s"'<>]+/g) || [];
      if (httpUrls.length > 0) {
        issues.push({
          id: `code-http-url-${relPath}`,
          category: "code-quality",
          severity: "warning",
          title: `Non-HTTPS URL(s) in ${relPath}`,
          description: "Use HTTPS for all external URLs.",
          filePath: relPath,
          actual: [...new Set(httpUrls)].slice(0, 5).join("\n"),
          expected: "All URLs should use https://",
        });
      }

      // Check for TODO/FIXME/HACK comments
      const lines = content.split("\n");
      lines.forEach((line, lineNum) => {
        if (/\b(TODO|FIXME|HACK|XXX|BUG)\b/.test(line)) {
          const match = line.match(/\b(TODO|FIXME|HACK|XXX|BUG)\b:?\s*(.*)/);
          issues.push({
            id: `code-todo-${relPath}-${lineNum}`,
            category: "code-quality",
            severity: "info",
            title: `${match?.[1] || "TODO"} comment in ${relPath}:${lineNum + 1}`,
            description: match?.[2]?.trim() || "Unresolved TODO/FIXME marker.",
            filePath: relPath,
            line: lineNum + 1,
          });
        }
      });
    }

    // ─── CSS Files ────────────────────────────────────
    if ([".css", ".scss", ".sass", ".less"].includes(ext)) {
      // Check for !important usage
      const importantCount = (content.match(/!important/g) || []).length;
      if (importantCount > 5) {
        issues.push({
          id: `code-too-many-important-${relPath}`,
          category: "code-quality",
          severity: "warning",
          title: `Excessive !important in ${relPath}`,
          description: `Found ${importantCount} uses of !important. This indicates specificity issues.`,
          filePath: relPath,
          actual: `${importantCount} uses of !important`,
          expected: "Avoid !important — fix specificity issues instead",
        });
      }

      // Check for very deep nesting (SCSS/SASS)
      if ([".scss", ".sass"].includes(ext)) {
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const indentLevel = lines[i].search(/\S/);
          if (indentLevel > 16) {
            // ~4 levels of nesting at 4 spaces
            issues.push({
              id: `code-deep-nesting-${relPath}-${i}`,
              category: "code-quality",
              severity: "info",
              title: `Deep CSS nesting in ${relPath}:${i + 1}`,
              description: "Deep nesting creates overly specific selectors. Try to keep nesting to 3 levels max.",
              filePath: relPath,
              line: i + 1,
            });
            break; // Report only first occurrence
          }
        }
      }
    }
  }

  // ─── Project-Level Checks ──────────────────────────

  // Check for robots.txt
  if (!existsSync(join(codePath, "public", "robots.txt")) &&
      !existsSync(join(codePath, "static", "robots.txt")) &&
      !existsSync(join(codePath, "robots.txt"))) {
    issues.push({
      id: "code-no-robots-txt",
      category: "seo",
      severity: "warning",
      title: "No robots.txt found",
      description: "A robots.txt file helps search engines understand which pages to crawl.",
      fixSuggestion: "Create public/robots.txt with appropriate directives.",
    });
  }

  // Check for sitemap
  const hasSitemap = files.some((f) => f.includes("sitemap")) ||
    existsSync(join(codePath, "public", "sitemap.xml")) ||
    existsSync(join(codePath, "static", "sitemap.xml"));

  if (!hasSitemap) {
    issues.push({
      id: "code-no-sitemap",
      category: "seo",
      severity: "warning",
      title: "No sitemap.xml found",
      description: "A sitemap helps search engines discover all your pages.",
      fixSuggestion: "Generate a sitemap.xml and place it in your public directory.",
    });
  }

  // Check for favicon
  const hasFavicon =
    existsSync(join(codePath, "public", "favicon.ico")) ||
    existsSync(join(codePath, "static", "favicon.ico")) ||
    existsSync(join(codePath, "app", "favicon.ico")) ||
    existsSync(join(codePath, "src", "app", "favicon.ico"));

  if (!hasFavicon) {
    issues.push({
      id: "code-no-favicon",
      category: "code-quality",
      severity: "warning",
      title: "No favicon.ico found",
      description: "A favicon helps users identify your site in browser tabs and bookmarks.",
      fixSuggestion: "Add a favicon.ico to your public directory.",
    });
  }

  // Check for .env.example
  if (existsSync(join(codePath, ".env")) && !existsSync(join(codePath, ".env.example"))) {
    issues.push({
      id: "code-no-env-example",
      category: "code-quality",
      severity: "info",
      title: "No .env.example file",
      description: ".env exists but no .env.example for other developers to reference.",
      fixSuggestion: "Create .env.example with placeholder values.",
    });
  }

  return issues;
}

function getWebFiles(dir: string, depth: number = 0): string[] {
  if (depth > 8) return [];

  const files: string[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...getWebFiles(fullPath, depth + 1));
      } else if (WEB_EXTENSIONS.has(extname(entry))) {
        files.push(fullPath);
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return files;
}
