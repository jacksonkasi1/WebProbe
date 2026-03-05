import type { Issue, Viewport } from "../types.js";

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
export async function analyzeResponsiveLive(url: string, viewports: Viewport[]): Promise<Issue[]> {
  const { chromium } = await import("playwright");
  const issues: Issue[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: "load", timeout: 20000 });
    } catch {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    }

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(500); // Allow time for reflow/resize events
      
      const viewportName = vp.name;

      // Check horizontal overflow
      const hasHorizontalOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > document.documentElement.clientWidth;
      });

      if (hasHorizontalOverflow) {
        issues.push({
          id: `responsive-mobile-overflow-${vp.width}`,
          category: "responsive",
          severity: "critical",
          title: `Horizontal overflow on ${viewportName} viewport`,
          description:
            `The page content extends beyond the viewport width on ${viewportName} (${vp.width}px), causing horizontal scrolling.`,
          actual: "Content overflows horizontally",
          expected: "All content fits within the viewport width",
          url,
        });

        // Width Culprit Detector
        const widthCulprits = await page.evaluate((viewportWidth) => {
          const body = document.body;
          const elements = body.querySelectorAll("*");
          const culprits: { tag: string; class: string; width: number }[] = [];
          
          elements.forEach((el) => {
            if (['SCRIPT', 'STYLE', 'META', 'HEAD', 'NOSCRIPT', 'LINK'].includes(el.tagName)) return;
            
            const rect = el.getBoundingClientRect();
            if (rect.width > viewportWidth) {
              const style = window.getComputedStyle(el);
              if (style.overflowX !== 'auto' && style.overflowX !== 'scroll' && style.overflowX !== 'hidden') {
                culprits.push({
                  tag: el.tagName.toLowerCase(),
                  class: typeof el.className === 'string' && el.className ? `.${el.className.split(' ').join('.')}` : '',
                  width: Math.round(rect.width)
                });
              }
            }
          });
          return culprits.slice(0, 5); // Limit to top 5
        }, vp.width);

        if (widthCulprits.length > 0) {
          issues.push({
            id: `responsive-width-culprits-${vp.width}`,
            category: "responsive",
            severity: "critical",
            title: `Elements forcing horizontal scroll on ${viewportName}`,
            description: "These elements are wider than the viewport, breaking the layout.",
            actual: widthCulprits.map(c => `<${c.tag}${c.class}> (${c.width}px)`).join(", "),
            expected: `Maximum width of ${vp.width}px`,
            url,
          });
        }
      }

      // Check touch target sizes & padding (more relevant on smaller screens)
      if (vp.width <= 1024) {
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

          return small.slice(0, 10);
        });

        if (smallTargets.length > 0) {
          issues.push({
            id: `responsive-small-touch-targets-${vp.width}`,
            category: "responsive",
            severity: "warning",
            title: `${smallTargets.length}+ interactive elements below minimum touch target size on ${viewportName}`,
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
      }

      if (vp.width <= 768) {
        // Check excessive padding on mobile
        const excessivePadding = await page.evaluate((viewportWidth) => {
          const body = document.body;
          const elements = body.querySelectorAll("section, main, .container, [class*='container'], [class*='wrapper']");
          const excessive: { selector: string; paddingLeft: number; paddingRight: number }[] = [];

          elements.forEach((el) => {
            const styles = window.getComputedStyle(el);
            const pl = parseFloat(styles.paddingLeft);
            const pr = parseFloat(styles.paddingRight);

            const maxPadding = viewportWidth <= 400 ? 40 : 60;
            if (pl > maxPadding || pr > maxPadding) {
              excessive.push({
                selector: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''),
                paddingLeft: Math.round(pl),
                paddingRight: Math.round(pr),
              });
            }
          });

          return excessive.slice(0, 5);
        }, vp.width);

        if (excessivePadding.length > 0) {
          issues.push({
            id: `responsive-excessive-padding-${vp.width}`,
            category: "responsive",
            severity: "warning",
            title: `Excessive padding on ${viewportName} viewport`,
            description:
              "Too much side padding on small screens wastes valuable space.",
            actual: excessivePadding
              .map((p) => `${p.selector}: padding-left: ${p.paddingLeft}px, padding-right: ${p.paddingRight}px`)
              .join("\n"),
            expected: "16-32px side padding on mobile/tablet",
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
            id: `responsive-small-text-${vp.width}`,
            category: "responsive",
            severity: "warning",
            title: `${smallText} text elements below recommended size on ${viewportName}`,
            description: "Text smaller than 14px is difficult to read on smaller devices without zooming.",
            actual: `${smallText} elements with font-size < 14px`,
            expected: "Minimum 14px for readable text",
            url,
          });
        }
      }

      // Off-Screen Detector
      const offscreenElements = await page.evaluate((viewportWidth) => {
        const interactiveElements = document.querySelectorAll(
          "a, button, input, select, textarea, [role='button'], [tabindex]"
        );
        const offscreen: { tag: string; text: string; right: number; left: number }[] = [];
        
        interactiveElements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
             if (rect.left >= viewportWidth || rect.right <= 0) {
                offscreen.push({
                  tag: el.tagName.toLowerCase(),
                  text: (el.textContent?.trim() || "").substring(0, 30),
                  left: Math.round(rect.left),
                  right: Math.round(rect.right)
                });
             }
          }
        });
        return offscreen.slice(0, 5);
      }, vp.width);

      if (offscreenElements.length > 0) {
        issues.push({
          id: `responsive-offscreen-elements-${vp.width}`,
          category: "responsive",
          severity: "critical",
          title: `Interactive elements rendered off-screen on ${viewportName}`,
          description: "These elements are pushed completely outside the visible viewport.",
          actual: offscreenElements.map(e => `<${e.tag}> "${e.text}" (X: ${e.left}px)`).join("\n"),
          expected: `Elements should be visible between 0 and ${vp.width}px`,
          url,
        });
      }

      // Overlapping Elements Detector
      const overlappingElements = await page.evaluate(() => {
        const header = document.querySelector("header") || document.querySelector("nav") || document.body;
        const elements = Array.from(header.querySelectorAll("a, button, img, svg, h1, h2, h3, p")).filter((el) => {
          const rect = el.getBoundingClientRect();
          // Filter to elements near the top of the page with some size
          return rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < 300;
        });

        const overlaps: string[] = [];

        for (let i = 0; i < elements.length; i++) {
          for (let j = i + 1; j < elements.length; j++) {
            const el1 = elements[i];
            const el2 = elements[j];
            
            // Check if one is a descendant of the other
            if (el1.contains(el2) || el2.contains(el1)) continue;

            const r1 = el1.getBoundingClientRect();
            const r2 = el2.getBoundingClientRect();

            // Strict intersection check
            const isOverlapping = !(
              r1.right <= r2.left || 
              r1.left >= r2.right || 
              r1.bottom <= r2.top || 
              r1.top >= r2.bottom
            );

            if (isOverlapping) {
              const t1 = el1.tagName.toLowerCase();
              const t2 = el2.tagName.toLowerCase();
              const txt1 = (el1.textContent?.trim() || t1).substring(0, 15);
              const txt2 = (el2.textContent?.trim() || t2).substring(0, 15);
              
              // Only consider an overlap significant if they intersect significantly (e.g. at least 5px)
              const overlapWidth = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
              const overlapHeight = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
              
              if (overlapWidth > 5 && overlapHeight > 5) {
                overlaps.push(`"${txt1}" (${t1}) overlaps "${txt2}" (${t2})`);
              }
            }
          }
        }
        return Array.from(new Set(overlaps)).slice(0, 5);
      });

      if (overlappingElements.length > 0) {
        issues.push({
          id: `responsive-overlapping-header-${vp.width}`,
          category: "responsive",
          severity: "warning",
          title: `Overlapping elements detected in header area on ${viewportName}`,
          description: "Elements like navigation links and logos are smashing into each other, likely due to a flexbox wrapping issue.",
          actual: overlappingElements.join("\n"),
          expected: "Elements should have clear separation without intersection",
          url,
        });
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  return issues;
}
