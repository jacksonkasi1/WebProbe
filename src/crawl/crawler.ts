import { XMLParser } from "fast-xml-parser";
import { chromium, type Browser } from "playwright";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = require("robots-parser") as (url: string, txt: string) => { isAllowed(url: string, ua?: string): boolean | undefined };
import { parseHTML } from "linkedom";
import type { CrawlScanResult, CrawlPageData, CrawlIssue, CrawlArgs } from "./types.js";
import { RECOMMENDATIONS } from "./types.js";
import { normalizeUrl, normalizeUrlKey, sameOrigin, getDepth } from "./utils.js";
import { createEmptyPageData, parsePageHtml } from "./parser.js";
import {
  analyzePage,
  findDuplicateIssues,
  findBrokenCanonicalIssues,
  findSitemapIssues,
  groupIssues,
  prioritizeIssues,
} from "./analyzer.js";

const REQUEST_TIMEOUT = 10000;
const SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/en/sitemap.xml",
  "/en-us/sitemap.xml",
];

export async function fetchSitemapUrls(
  origin: string,
  maxPages: number,
  maxDepth: number,
  startUrl: string,
  signal?: AbortSignal,
): Promise<{ urls: string[]; sitemapUrl?: string }> {
  const urls: string[] = [];
  let sitemapUrl: string | undefined;

  for (const path of SITEMAP_PATHS) {
    try {
      const res = await fetch(`${origin}${path}`, { signal });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || typeof xml !== "string" || !xml.trim().startsWith("<"))
        continue;

      const parser = new XMLParser({ ignoreAttributes: false });
      const parsed = parser.parse(xml);

      const sitemapUrls: string[] =
        parsed?.urlset?.url?.map((u: any) => u.loc).filter(Boolean) ??
        parsed?.sitemapindex?.sitemap?.map((s: any) => s.loc).filter(Boolean) ??
        [];

      sitemapUrl = `${origin}${path}`;
      for (const u of sitemapUrls.slice(0, maxPages)) {
        const nu = normalizeUrl(u);
        if (sameOrigin(nu, startUrl) && getDepth(nu, startUrl) <= maxDepth)
          urls.push(nu);
      }
      break;
    } catch {
      continue;
    }
  }

  return { urls, sitemapUrl };
}

export async function crawlSite(args: CrawlArgs): Promise<CrawlScanResult> {
  const abortController = new AbortController();
  const startUrl = normalizeUrl(args.url);
  const maxPages = args.maxPages ?? 25;
  const maxDepth = args.maxDepth ?? 10;
  const includeSitemap = args.includeSitemap ?? true;
  const silent = args.silent ?? false;
  const multiLanguage = args.multiLanguage ?? false;
  const onProgress = args.onProgress;

  const cacheKey = `_=${Date.now()}`;
  const origin = new URL(startUrl).origin;
  const isHttps = origin.startsWith("https://");
  const visited = new Set<string>();

  const queue: { url: string; depth: number }[] = [
    {
      url:
        startUrl +
        (cacheKey ? (startUrl.includes("?") ? "&" : "?") + cacheKey : ""),
      depth: 0,
    },
  ];

  let robots: ReturnType<typeof robotsParser> | null = null;
  let robotsTxtContent = "";
  try {
    const robotsRes = await fetch(`${origin}/robots.txt`);
    if (robotsRes.ok) {
      robotsTxtContent = await robotsRes.text();
      robots = robotsParser(`${origin}/robots.txt`, robotsTxtContent);
    }
  } catch {
    // robots.txt is optional
  }

  const referencedInRobots = /^Sitemap:/mi.test(robotsTxtContent);

  let sitemapUrl: string | undefined;
  const sitemapUrlsFromDiscovery = new Set<string>();
  if (includeSitemap) {
    const { urls, sitemapUrl: smUrl } = await fetchSitemapUrls(
      origin,
      maxPages,
      maxDepth,
      startUrl,
      abortController.signal,
    );
    sitemapUrl = smUrl;
    for (const url of urls) {
      sitemapUrlsFromDiscovery.add(normalizeUrlKey(url));
      queue.push({ url, depth: getDepth(url, startUrl) });
    }
  }

  const pages: CrawlPageData[] = [];
  const issues: CrawlIssue[] = [];
  const sitemapUrlsTested = new Set<string>();
  const sitemapUrlsWithErrors: string[] = [];

  let browser: Browser | null = null;
  let isSpaDetected = false;

  while (queue.length && visited.size < maxPages) {
    const { url, depth } = queue.shift()!;
    const key = normalizeUrlKey(url);
    if (visited.has(key)) continue;
    if (!sameOrigin(url, startUrl)) continue;
    if (depth > maxDepth) continue;

    visited.add(key);

    if (onProgress) {
      onProgress(visited.size, queue.length, url);
    } else if (!silent) {
      process.stdout.write(
        `\r📄 Scanned: ${visited.size} pages | Queue: ${queue.length}    `,
      );
    }

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "TimeoutError") {
        issues.push({
          severity: "high",
          code: "fetch_timeout",
          message: "Request timed out",
          url,
          recommendation: RECOMMENDATIONS.fetch_timeout,
        });
      } else {
        issues.push({
          severity: "high",
          code: "fetch_failed",
          message: "Failed to fetch URL",
          url,
          recommendation: RECOMMENDATIONS.fetch_failed,
        });
      }
      continue;
    }

    const status = res.status;
    const contentType = res.headers.get("content-type") ?? "";
    const cacheControl = res.headers.get("cache-control") ?? null;
    const xRobotsTag = res.headers.get("x-robots-tag") ?? null;
    const isHtml = contentType.includes("text/html");
    const robotsBlocked = robots ? !robots.isAllowed(url, "Googlebot") : false;

    if (status >= 400) {
      issues.push({
        severity: "high",
        code: "http_error",
        message: `HTTP ${status}`,
        url,
        recommendation: RECOMMENDATIONS.http_error,
      });
      pages.push(createEmptyPageData(url, status, contentType, cacheControl, xRobotsTag, robotsBlocked));
      continue;
    }

    if (!isHtml) {
      pages.push(createEmptyPageData(url, status, contentType, cacheControl, xRobotsTag, robotsBlocked));
      continue;
    }

    const html = await res.text();
    if (!html || html.length < 10) {
      pages.push(createEmptyPageData(url, status, contentType, cacheControl, xRobotsTag, robotsBlocked));
      continue;
    }

    let finalHtml = html;

    if (visited.size === 1) {
      const { document: testDoc } = parseHTML(html);
      const linkCount = testDoc.querySelectorAll("a[href]").length;
      const hasRoot = html.includes('id="root"') || html.includes('id="__next"') || html.includes('id="app"');
      if (linkCount < 3 || hasRoot) {
        isSpaDetected = true;
      }
    }

    if (isSpaDetected) {
      if (!browser) {
        browser = await chromium.launch({ headless: true });
      }
      try {
        const context = await browser.newContext();
        const pwPage = await context.newPage();
        await pwPage.goto(url, { waitUntil: "load", timeout: 15000 }).catch(() => {});
        await pwPage.waitForTimeout(1000);
        const spaHtml = await pwPage.content();
        await context.close();
        if (spaHtml && spaHtml.length > html.length) {
          finalHtml = spaHtml;
        }
      } catch (e) {
        // Fallback to original html
      }
    }

    const page = parsePageHtml(finalHtml, url);
    if (!page) continue;

    page.status = status;
    page.contentType = contentType;
    page.cacheControl = cacheControl;
    page.xRobotsTag = xRobotsTag;
    page.robotsBlocked = robotsBlocked;

    if (sitemapUrlsFromDiscovery.has(normalizeUrlKey(url))) {
      sitemapUrlsTested.add(url);
      if (status >= 400) {
        sitemapUrlsWithErrors.push(url);
      }
    }

    const pageIssues = analyzePage(page, isHttps, multiLanguage);
    issues.push(...pageIssues);

    try {
      const { document } = parseHTML(finalHtml);
      document.querySelectorAll("a[href]").forEach((el: any) => {
        const href = el.getAttribute("href");
        if (!href) return;
        try {
          const next = new URL(href, url).toString();
          const nextDepth = getDepth(next, startUrl);
          if (
            sameOrigin(next, startUrl) &&
            !visited.has(normalizeUrlKey(next)) &&
            nextDepth <= maxDepth
          )
            queue.push({ url: next, depth: nextDepth });
        } catch {}
      });
    } catch {}

    pages.push(page);
  }

  if (!silent && !onProgress) {
    process.stdout.write("\n");
  }

  if (browser) {
    await browser.close().catch(() => {});
  }

  const duplicateIssues = findDuplicateIssues(pages);
  issues.push(...duplicateIssues);

  const brokenCanonicalIssues = findBrokenCanonicalIssues(pages);
  issues.push(...brokenCanonicalIssues);

  const hasSitemap = !!sitemapUrl;
  const sitemapIssues = findSitemapIssues(
    hasSitemap,
    referencedInRobots,
    sitemapUrlsFromDiscovery.size,
    sitemapUrlsTested.size,
    sitemapUrlsWithErrors,
    pages.map(p => normalizeUrlKey(p.url)),
    startUrl,
  );
  issues.push(...sitemapIssues);

  const prioritizedIssues = prioritizeIssues(issues);

  const crawledUrls = new Set(pages.map(p => normalizeUrlKey(p.url)));
  const orphanUrls = [...sitemapUrlsFromDiscovery].filter(
    url => !crawledUrls.has(url)
  );

  return {
    scanned: {
      startUrl,
      pagesScanned: pages.length,
      maxPages,
      scannedAt: new Date().toISOString(),
    },
    summary: {
      high: prioritizedIssues.filter((i) => i.severity === "high").length,
      medium: prioritizedIssues.filter((i) => i.severity === "medium").length,
      low: prioritizedIssues.filter((i) => i.severity === "low").length,
    },
    groupedIssues: groupIssues(prioritizedIssues),
    topIssues: prioritizedIssues.slice(0, 20),
    pages,
    sitemap: {
      url: sitemapUrl,
      urlsInSitemap: sitemapUrlsFromDiscovery.size,
      urlsTested: sitemapUrlsTested.size,
      urlsWithErrors: sitemapUrlsWithErrors.length,
      referencedInRobots,
      orphanUrls,
    },
  };
}
