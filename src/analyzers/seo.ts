import type { Issue } from "../types.js";
import { analyzePage } from "./fixseo/analyzer.js";
import type { PageData } from "./fixseo/types.js";

interface PageDataLocal {
  title: string;
  metaTags: Record<string, string>;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null }[];
  canonical: string | null;
  language: string | null;
  html: string;
  url?: string;
}

export function analyzeSEO(data: PageDataLocal, domain?: string): Issue[] {
  const issues: Issue[] = [];
  const url = data.url || "http://localhost";
  
  // Calculate word count approximately from HTML
  const textContent = data.html.replace(/<[^>]*>?/gm, ' ');
  const wordCount = textContent.split(/\s+/).filter(w => w.length > 0).length;

  const fixseoPageData: PageData = {
    url,
    status: 200,
    contentType: "text/html",
    title: data.title || null,
    metaDescription: data.metaTags["description"] || null,
    canonical: data.canonical,
    h1: data.headings.find(h => h.level === 1)?.text || null,
    robotsMeta: data.metaTags["robots"] || null,
    xRobotsTag: null, // would need headers
    ogTitle: data.metaTags["og:title"] || null,
    ogDescription: data.metaTags["og:description"] || null,
    ogImage: data.metaTags["og:image"] || null,
    twitterCard: data.metaTags["twitter:card"] || null,
    twitterTitle: data.metaTags["twitter:title"] || null,
    twitterDescription: data.metaTags["twitter:description"] || null,
    twitterImage: data.metaTags["twitter:image"] || null,
    jsonLd: data.html.includes("application/ld+json") ? ["has_json_ld"] : null,
    imagesTotal: data.images.length,
    imagesWithAlt: data.images.filter(img => img.alt !== null && img.alt !== undefined).length,
    h2Count: data.headings.filter(h => h.level === 2).length,
    cacheControl: null,
    hreflangs: null,
    robotsBlocked: false,
    isPagination: false,
    isFeed: false,
    lang: data.language,
    appleTouchIcon: data.html.includes("apple-touch-icon") ? "yes" : null,
    wordCount
  };

  const isHttps = url.startsWith("https://");

  const fixseoIssues = analyzePage(fixseoPageData, isHttps);

  // Map fixseo issues to WebProbe issues
  for (const fIssue of fixseoIssues) {
    let severity: "critical" | "warning" | "info" = "info";
    if (fIssue.severity === "high") severity = "critical";
    if (fIssue.severity === "medium") severity = "warning";
    if (fIssue.severity === "low") severity = "info";

    issues.push({
      id: `seo-${fIssue.code}`,
      category: "seo",
      severity,
      title: fIssue.message,
      description: fIssue.recommendation || "",
      url: fIssue.url,
      fixSuggestion: fIssue.recommendation
    });
  }

  // Also do WebProbe's heading hierarchy check, since fixseo doesn't do this specific one
  const levels = data.headings.map((h) => h.level);
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) {
      issues.push({
        id: `seo-heading-skip-${i}`,
        category: "seo",
        severity: "warning",
        title: "Heading hierarchy skip",
        description: `H${levels[i - 1]} followed by H${levels[i]}. Don't skip heading levels.`,
        element: `h${levels[i]}`,
        actual: `H${levels[i - 1]} → H${levels[i]}`,
        expected: `H${levels[i - 1]} → H${levels[i - 1] + 1}`,
        url: data.url,
      });
      break; 
    }
  }

  return issues;
}
