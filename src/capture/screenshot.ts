import { chromium } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { Viewport, Screenshot } from "../types.js";

export async function captureScreenshots(
  url: string,
  viewports: Viewport[],
  outputDir: string
): Promise<Screenshot[]> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const screenshots: Screenshot[] = [];

  try {
    for (const vp of viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.width <= 375 ? 2 : 1,
      });

      const page = await context.newPage();

      try {
        await page.goto(url, { waitUntil: "load", timeout: 20000 });
      } catch {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        } catch {
          // best-effort: continue with whatever was loaded
        }
      }

      // Brief pause for late-rendering JS
      await page.waitForTimeout(500);

      // Extract a safe URL path to make unique filenames per page
      try {
        const parsedUrl = new URL(url);
        let pathSlug = parsedUrl.pathname.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-");
        if (pathSlug === "-" || pathSlug === "") pathSlug = "index";
        if (pathSlug.startsWith("-")) pathSlug = pathSlug.substring(1);
        if (pathSlug.endsWith("-")) pathSlug = pathSlug.substring(0, pathSlug.length - 1);
        
        const slug = vp.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        
        // Structure: index--mobile--375x812.png OR about-us--desktop--1440x900.png
        const filename = `${pathSlug}--${slug}--${vp.width}x${vp.height}.png`;
        const filepath = join(outputDir, filename);

        await page.screenshot({
          path: filepath,
          fullPage: true,
        });

        // Also take above-the-fold screenshot
        const foldFilename = `${pathSlug}--${slug}--${vp.width}x${vp.height}-fold.png`;
        const foldPath = join(outputDir, foldFilename);
        await page.screenshot({
          path: foldPath,
          fullPage: false,
        });

        screenshots.push(
          {
            viewport: vp.name,
            width: vp.width,
            height: vp.height,
            path: filepath,
            fullPage: true,
          },
          {
            viewport: `${vp.name} (above fold)`,
            width: vp.width,
            height: vp.height,
            path: foldPath,
            fullPage: false,
          }
        );
      } catch (e) {
        // Fallback if URL parsing fails
        const slug = vp.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const filename = `${slug}-${vp.width}x${vp.height}.png`;
        await page.screenshot({ path: join(outputDir, filename), fullPage: true });
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  return screenshots;
}

/**
 * Capture a page and extract metadata via Playwright
 */
export async function captureAndAnalyzePage(url: string): Promise<{
  html: string;
  title: string;
  metaTags: Record<string, string>;
  headings: { level: number; text: string }[];
  images: { src: string; alt: string | null; width: number; height: number }[];
  links: { href: string; text: string; isExternal: boolean; statusCode?: number }[];
  consoleLogs: { type: string; text: string }[];
  performanceMetrics: Record<string, number>;
  viewportMeta: string | null;
  language: string | null;
  canonical: string | null;
  hasViewportMeta: boolean;
}> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleLogs: { type: string; text: string }[] = [];
  page.on("console", (msg) => {
    consoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  try {
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    } catch {
      // best-effort
    }
  }

  const result = await page.evaluate(() => {
    const getMeta = (name: string): string => {
      const el =
        document.querySelector(`meta[name="${name}"]`) ||
        document.querySelector(`meta[property="${name}"]`);
      return el?.getAttribute("content") || "";
    };

    const metaTags: Record<string, string> = {};
    document.querySelectorAll("meta").forEach((meta) => {
      const key =
        meta.getAttribute("name") ||
        meta.getAttribute("property") ||
        meta.getAttribute("http-equiv") ||
        "";
      if (key) metaTags[key] = meta.getAttribute("content") || "";
    });

    const headings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, h5, h6")
    ).map((h) => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim() || "",
    }));

    const images = Array.from(document.querySelectorAll("img")).map((img) => ({
      src: img.src,
      alt: img.getAttribute("alt"),
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));

    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => {
      const href = (a as HTMLAnchorElement).href;
      return {
        href,
        text: a.textContent?.trim() || "",
        isExternal: !href.startsWith(window.location.origin),
      };
    });

    const viewportMeta =
      document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content") || null;

    const canonical =
      document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
      null;

    return {
      html: document.documentElement.outerHTML,
      title: document.title,
      metaTags,
      headings,
      images,
      links,
      viewportMeta,
      language: document.documentElement.lang || null,
      canonical,
      hasViewportMeta: !!viewportMeta,
    };
  });

  // Performance metrics
  const perfMetrics = await page.evaluate(() => {
    const perf = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming;
    if (!perf) return {};
    return {
      domContentLoaded: perf.domContentLoadedEventEnd - perf.startTime,
      loadComplete: perf.loadEventEnd - perf.startTime,
      ttfb: perf.responseStart - perf.startTime,
      domInteractive: perf.domInteractive - perf.startTime,
      transferSize: perf.transferSize,
    };
  });

  await browser.close();

  return {
    ...result,
    consoleLogs,
    performanceMetrics: perfMetrics as Record<string, number>,
  };
}
