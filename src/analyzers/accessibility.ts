import type { Issue } from "../types.js";

interface A11yData {
  html: string;
  images: { src: string; alt: string | null }[];
  headings: { level: number; text: string }[];
  language: string | null;
  url?: string;
}

export function analyzeAccessibility(data: A11yData): Issue[] {
  const issues: Issue[] = [];
  const url = data.url || "";
  const html = data.html;

  // ─── Language ────────────────────────────────────────
  if (!data.language) {
    issues.push({
      id: "a11y-no-lang",
      category: "accessibility",
      severity: "critical",
      title: "Missing lang attribute on <html>",
      description: "Screen readers need the lang attribute to determine pronunciation rules.",
      fixSuggestion: '<html lang="en">',
      url,
    });
  }

  // ─── Skip Navigation ────────────────────────────────
  if (!html.includes("skip") || !html.includes("#main")) {
    const hasSkipLink =
      html.includes("skip-to") ||
      html.includes("skip-nav") ||
      html.includes("skip-link") ||
      html.includes("skipnav") ||
      html.includes("#content") ||
      html.includes("#main-content");

    if (!hasSkipLink) {
      issues.push({
        id: "a11y-no-skip-link",
        category: "accessibility",
        severity: "warning",
        title: "No skip navigation link found",
        description:
          "A skip navigation link helps keyboard users bypass repetitive navigation and jump to main content.",
        fixSuggestion:
          'Add <a href="#main-content" class="skip-link">Skip to content</a> as the first focusable element.',
        url,
      });
    }
  }

  // ─── Form Labels ────────────────────────────────────
  const inputPattern = /<input(?![^>]*type=["'](?:hidden|submit|button|reset|image)["'])[^>]*>/gi;
  const inputs = html.match(inputPattern) || [];
  const unlabeledInputs = inputs.filter((input) => {
    const hasAriaLabel = /aria-label\s*=/.test(input);
    const hasAriaLabelledBy = /aria-labelledby\s*=/.test(input);
    const hasTitle = /title\s*=/.test(input);
    const hasId = /id\s*=\s*["']([^"']+)["']/.exec(input);
    const hasAssociatedLabel = hasId && html.includes(`for="${hasId[1]}"`);
    const hasPlaceholder = /placeholder\s*=/.test(input);

    return !hasAriaLabel && !hasAriaLabelledBy && !hasTitle && !hasAssociatedLabel && !hasPlaceholder;
  });

  if (unlabeledInputs.length > 0) {
    issues.push({
      id: "a11y-unlabeled-inputs",
      category: "accessibility",
      severity: "critical",
      title: `${unlabeledInputs.length} form input(s) without accessible labels`,
      description:
        "Form inputs need labels for screen reader users. Use <label>, aria-label, or aria-labelledby.",
      actual: `${unlabeledInputs.length} unlabeled inputs`,
      expected: "All inputs should have accessible labels",
      url,
    });
  }

  // ─── ARIA Landmarks ─────────────────────────────────
  const hasMain =
    html.includes("<main") || html.includes('role="main"');
  const hasNav =
    html.includes("<nav") || html.includes('role="navigation"');

  if (!hasMain) {
    issues.push({
      id: "a11y-no-main-landmark",
      category: "accessibility",
      severity: "warning",
      title: "No main landmark found",
      description:
        "Use <main> or role='main' to identify the main content area for assistive technologies.",
      fixSuggestion: "Wrap your main content in a <main> element.",
      url,
    });
  }

  if (!hasNav) {
    issues.push({
      id: "a11y-no-nav-landmark",
      category: "accessibility",
      severity: "info",
      title: "No navigation landmark found",
      description: "Use <nav> or role='navigation' to identify navigation areas.",
      url,
    });
  }

  // ─── Color Contrast (basic detection) ──────────────
  // Note: Full contrast checking requires computed styles — this catches common inline issues
  const lightOnLight = html.match(/color:\s*#(?:f{3,6}|e{3,6}|d{3,6}).*?background(?:-color)?:\s*#(?:f{3,6}|e{3,6}|d{3,6})/gi);
  if (lightOnLight && lightOnLight.length > 0) {
    issues.push({
      id: "a11y-low-contrast-inline",
      category: "accessibility",
      severity: "warning",
      title: "Potential low contrast text detected in inline styles",
      description: "Light text on light backgrounds may fail WCAG contrast requirements (4.5:1 for normal text).",
      url,
    });
  }

  // ─── Focus Indicators ──────────────────────────────
  if (
    html.includes("outline: none") ||
    html.includes("outline:none") ||
    html.includes("outline: 0")
  ) {
    issues.push({
      id: "a11y-outline-removed",
      category: "accessibility",
      severity: "warning",
      title: "Focus outline may be removed",
      description:
        "Detected 'outline: none' or 'outline: 0' which removes keyboard focus indicators. Always provide an alternative focus style.",
      fixSuggestion:
        "Instead of removing outlines, restyle them: outline: 2px solid var(--focus-color); outline-offset: 2px;",
      url,
    });
  }

  // ─── Tab Index ──────────────────────────────────────
  const positiveTabIndex = html.match(/tabindex=["'][1-9]\d*["']/g);
  if (positiveTabIndex && positiveTabIndex.length > 0) {
    issues.push({
      id: "a11y-positive-tabindex",
      category: "accessibility",
      severity: "warning",
      title: "Positive tabindex values found",
      description:
        "Positive tabindex values create confusing tab orders. Use tabindex='0' or '-1' only.",
      actual: `${positiveTabIndex.length} elements with positive tabindex`,
      expected: "Only tabindex='0' or tabindex='-1'",
      url,
    });
  }

  // ─── Auto-playing Media ─────────────────────────────
  if (html.includes("autoplay") && (html.includes("<video") || html.includes("<audio"))) {
    issues.push({
      id: "a11y-autoplay",
      category: "accessibility",
      severity: "warning",
      title: "Auto-playing media detected",
      description:
        "Auto-playing audio or video can be disruptive. Ensure auto-playing media is muted and has controls.",
      url,
    });
  }

  return issues;
}

/**
 * Live accessibility checks using Playwright
 */
export async function analyzeAccessibilityLive(url: string): Promise<Issue[]> {
  const { chromium } = await import("playwright");
  const issues: Issue[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 20000 }).catch(() =>
      page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {})
    );

    // Check for color contrast issues via computed styles
    const contrastIssues = await page.evaluate(() => {
      const problems: string[] = [];

      function getLuminance(r: number, g: number, b: number): number {
        const [rs, gs, bs] = [r, g, b].map((c) => {
          c = c / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
      }

      function parseColor(color: string): [number, number, number] | null {
        const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (rgb) return [parseInt(rgb[1]), parseInt(rgb[2]), parseInt(rgb[3])];
        return null;
      }

      const textElements = document.querySelectorAll("p, span, a, li, h1, h2, h3, h4, h5, h6, label, td, th");

      textElements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const fg = parseColor(style.color);
        const bg = parseColor(style.backgroundColor);

        if (fg && bg) {
          const fgLum = getLuminance(...fg);
          const bgLum = getLuminance(...bg);
          const ratio =
            (Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05);

          const fontSize = parseFloat(style.fontSize);
          const isBold = parseInt(style.fontWeight) >= 700;
          const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && isBold);
          const minRatio = isLargeText ? 3 : 4.5;

          if (ratio < minRatio && el.textContent && el.textContent.trim().length > 2) {
            problems.push(
              `${el.tagName.toLowerCase()}: "${el.textContent.trim().substring(0, 30)}" — contrast ratio ${ratio.toFixed(1)}:1 (need ${minRatio}:1)`
            );
          }
        }
      });

      return problems.slice(0, 10);
    });

    if (contrastIssues.length > 0) {
      issues.push({
        id: "a11y-color-contrast",
        category: "accessibility",
        severity: "critical",
        title: `${contrastIssues.length}+ elements fail WCAG color contrast`,
        description:
          "WCAG 2.1 AA requires 4.5:1 contrast for normal text and 3:1 for large text.",
        actual: contrastIssues.join("\n"),
        expected: "4.5:1 for normal text, 3:1 for large text (18px+ bold or 24px+ regular)",
        url,
      });
    }

    await page.close();
  } finally {
    await browser.close();
  }

  return issues;
}
