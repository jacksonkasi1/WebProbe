import type { Issue } from "../types.js";

interface ResponsiveData {
  html: string;
  hasViewportMeta: boolean;
  viewportMeta: string | null;
  url?: string;
}

export function analyzeResponsive(data: ResponsiveData): Issue[] {
  const issues: Issue[] = [];
  const url = data.url || "";

  // ─── Viewport Meta ──────────────────────────────────
  if (!data.hasViewportMeta) {
    issues.push({
      id: "responsive-no-viewport",
      category: "responsive",
      severity: "critical",
      title: "Missing viewport meta tag",
      description:
        "Without a viewport meta tag, mobile devices will render the page at desktop width.",
      fixSuggestion:
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
      url,
    });
  } else if (data.viewportMeta) {
    if (!data.viewportMeta.includes("width=device-width")) {
      issues.push({
        id: "responsive-viewport-width",
        category: "responsive",
        severity: "critical",
        title: "Viewport meta missing width=device-width",
        description: `Current viewport: "${data.viewportMeta}"`,
        actual: data.viewportMeta,
        expected: "width=device-width, initial-scale=1",
        url,
      });
    }

    if (data.viewportMeta.includes("maximum-scale=1") || data.viewportMeta.includes("user-scalable=no")) {
      issues.push({
        id: "responsive-viewport-no-zoom",
        category: "responsive",
        severity: "warning",
        title: "Viewport prevents user zoom",
        description:
          "Using maximum-scale=1 or user-scalable=no prevents users from zooming in, which is an accessibility issue.",
        actual: data.viewportMeta,
        expected: "Don't restrict user zooming",
        url,
      });
    }
  }

  // ─── Fixed Width Detection ──────────────────────────
  const fixedWidthPatterns = [
    /width:\s*\d{4,}px/g,         // width: 1200px+
    /min-width:\s*\d{4,}px/g,     // min-width: 1200px+
    /max-width:\s*none/g,         // max-width: none on containers
  ];

  for (const pattern of fixedWidthPatterns) {
    const matches = data.html.match(pattern);
    if (matches && matches.length > 0) {
      issues.push({
        id: "responsive-fixed-width",
        category: "responsive",
        severity: "warning",
        title: "Potential fixed-width elements detected in inline styles",
        description: `Found ${matches.length} instance(s) of large fixed-width declarations that may break on mobile.`,
        actual: matches.slice(0, 3).join(", "),
        expected: "Use relative units (%, vw, rem) or max-width instead of fixed px widths",
        url,
      });
      break;
    }
  }

  // ─── Small Text Detection ──────────────────────────
  const smallFontPatterns = [
    /font-size:\s*([0-9]|1[0-1])px/g,  // font-size < 12px
  ];

  for (const pattern of smallFontPatterns) {
    const matches = data.html.match(pattern);
    if (matches && matches.length > 0) {
      issues.push({
        id: "responsive-small-font",
        category: "responsive",
        severity: "warning",
        title: "Very small font sizes detected in inline styles",
        description:
          "Font sizes below 12px are hard to read on mobile. Minimum recommended is 14-16px for body text.",
        actual: matches.slice(0, 3).join(", "),
        expected: "Minimum 14px for body text, 12px absolute minimum",
        url,
      });
      break;
    }
  }

  // ─── Horizontal Overflow ────────────────────────────
  if (data.html.includes("overflow-x: scroll") || data.html.includes("overflow-x:scroll")) {
    issues.push({
      id: "responsive-horizontal-scroll",
      category: "responsive",
      severity: "info",
      title: "Horizontal scroll detected in inline styles",
      description: "Horizontal scrolling should be avoided on mobile unless intentional (e.g., tables, carousels).",
      url,
    });
  }

  return issues;
}

/**
 * Check responsive behavior using Playwright at different viewport sizes
 */
export async function analyzeResponsiveLive(url: string): Promise<Issue[]> {
  const { chromium } = await import("playwright");
  const issues: Issue[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    // Check for horizontal overflow at mobile viewport
    const page = await browser.newPage();
    await page.setViewportSize({ width: 375, height: 812 });

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    }

    // Check horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });

    if (hasHorizontalOverflow) {
      issues.push({
        id: "responsive-mobile-overflow",
        category: "responsive",
        severity: "critical",
        title: "Horizontal overflow on mobile viewport",
        description:
          "The page content extends beyond the viewport width on mobile (375px), causing horizontal scrolling.",
        actual: "Content overflows horizontally",
        expected: "All content fits within the viewport width",
        url,
      });
    }

    // Check touch target sizes
    const smallTargets = await page.evaluate(() => {
      const interactiveElements = document.querySelectorAll(
        "a, button, input, select, textarea, [role='button'], [tabindex]"
      );
      const small: { tag: string; text: string; width: number; height: number }[] = [];

      interactiveElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          (rect.width < 44 || rect.height < 44)
        ) {
          small.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent?.trim() || "").substring(0, 30),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      });

      return small.slice(0, 10); // Limit to 10
    });

    if (smallTargets.length > 0) {
      issues.push({
        id: "responsive-small-touch-targets",
        category: "responsive",
        severity: "warning",
        title: `${smallTargets.length}+ interactive elements below minimum touch target size`,
        description:
          "Touch targets should be at least 44×44px for comfortable tapping on mobile devices.",
        actual: smallTargets
          .slice(0, 5)
          .map((t) => `<${t.tag}> "${t.text}" (${t.width}×${t.height}px)`)
          .join("\n"),
        expected: "Minimum 44×44px touch targets",
        url,
      });
    }

    // Check excessive padding on mobile
    const excessivePadding = await page.evaluate(() => {
      const body = document.body;
      const elements = body.querySelectorAll("section, main, .container, [class*='container'], [class*='wrapper']");
      const excessive: { selector: string; paddingLeft: number; paddingRight: number }[] = [];

      elements.forEach((el) => {
        const styles = window.getComputedStyle(el);
        const pl = parseFloat(styles.paddingLeft);
        const pr = parseFloat(styles.paddingRight);

        // On a 375px viewport, >40px side padding is excessive
        if (pl > 40 || pr > 40) {
          excessive.push({
            selector: el.tagName.toLowerCase() + (el.className ? `.${el.className.split(' ')[0]}` : ''),
            paddingLeft: Math.round(pl),
            paddingRight: Math.round(pr),
          });
        }
      });

      return excessive.slice(0, 5);
    });

    if (excessivePadding.length > 0) {
      issues.push({
        id: "responsive-excessive-padding",
        category: "responsive",
        severity: "warning",
        title: "Excessive padding on mobile viewport",
        description:
          "Too much padding on mobile wastes valuable screen space. On a 375px screen, side padding should be 16-24px.",
        actual: excessivePadding
          .map((p) => `${p.selector}: padding-left: ${p.paddingLeft}px, padding-right: ${p.paddingRight}px`)
          .join("\n"),
        expected: "16-24px side padding on mobile",
        url,
      });
    }

    // Check text readability on mobile
    const smallText = await page.evaluate(() => {
      const textElements = document.querySelectorAll("p, span, li, td, th, label, a");
      let smallCount = 0;

      textElements.forEach((el) => {
        const styles = window.getComputedStyle(el);
        const fontSize = parseFloat(styles.fontSize);
        if (fontSize < 14 && el.textContent && el.textContent.trim().length > 5) {
          smallCount++;
        }
      });

      return smallCount;
    });

    if (smallText > 5) {
      issues.push({
        id: "responsive-small-text-mobile",
        category: "responsive",
        severity: "warning",
        title: `${smallText} text elements below recommended size on mobile`,
        description: "Text smaller than 14px is difficult to read on mobile devices without zooming.",
        actual: `${smallText} elements with font-size < 14px`,
        expected: "Minimum 14px for readable text, 16px recommended for body text",
        url,
      });
    }

    await page.close();
  } finally {
    await browser.close();
  }

  return issues;
}
