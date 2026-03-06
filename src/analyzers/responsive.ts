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
  return analyzeResponsiveLiveBatch([url], viewports);
}

/**
 * Check responsive behavior for multiple URLs reusing the same browser instance
 */
export async function analyzeResponsiveLiveBatch(
  urls: string[], 
  viewports: Viewport[], 
  concurrency: number = 3,
  onProgress?: (url: string) => void
): Promise<Issue[]> {
  const { chromium } = await import("playwright");
  const allIssues: Issue[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    // Process in chunks to avoid overwhelming the browser/memory
    for (let i = 0; i < urls.length; i += concurrency) {
      const chunk = urls.slice(i, i + concurrency);
      
      const chunkPromises = chunk.map(async (url) => {
        if (onProgress) onProgress(url);
        const context = await browser.newContext();
        const page = await context.newPage();
        const issues: Issue[] = [];
        
        try {
          // Hard timeout wrapper for the entire page evaluation
          const evaluatePage = async () => {
            try {
              await page.goto(url, { waitUntil: "load", timeout: 15000 });
            } catch {
              await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
            }

            for (const vp of viewports) {
              await page.setViewportSize({ width: vp.width, height: vp.height });
              await page.waitForTimeout(200); // reduced timeout to speed up
              
              const viewportName = vp.name;

            // Check horizontal overflow
            const hasHorizontalOverflow = await page.evaluate(() => {
              return document.documentElement.scrollWidth > document.documentElement.clientWidth;
            });

            if (hasHorizontalOverflow) {
              issues.push({
                id: `responsive-mobile-overflow-${vp.width}-${url}`,
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
                  id: `responsive-width-culprits-${vp.width}-${url}`,
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

            // Bleeding Elements Detector (elements bleeding out of the right edge, causing layout break or hidden content)
            const bleedingElements = await page.evaluate((viewportWidth) => {
              const body = document.body;
              // Check all elements to see if they bleed off the right edge significantly
              const elements = body.querySelectorAll("*");
              const bleeding: { tag: string; class: string; left: number; right: number; width: number }[] = [];
              
              elements.forEach((el) => {
                if (['SCRIPT', 'STYLE', 'META', 'HEAD', 'NOSCRIPT', 'LINK', 'BR'].includes(el.tagName)) return;
                
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                  // If it bleeds off the right edge (more than 5px to avoid subpixel rounding)
                  // AND its left edge is visible (so it's not completely off-screen, which is caught by offscreen detector)
                  // AND it's not a full-width container (e.g. 100vw) that's just a tiny bit wider due to scrollbars
                  if (rect.right > viewportWidth + 5 && rect.left >= 0 && rect.left < viewportWidth) {
                    const style = window.getComputedStyle(el);
                    // Ignore elements that are meant to scroll
                    if (style.overflowX !== 'auto' && style.overflowX !== 'scroll' && style.overflowX !== 'hidden') {
                       bleeding.push({
                         tag: el.tagName.toLowerCase(),
                         class: typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '',
                         left: Math.round(rect.left),
                         right: Math.round(rect.right),
                         width: Math.round(rect.width)
                       });
                    }
                  }
                }
              });
              
              // Filter out children if their parent is already bleeding
              const filtered = bleeding.filter((b, index, arr) => {
                 // basic heuristic: if another element has very similar left/right, it might be a parent
                 for (let i = 0; i < index; i++) {
                    if (Math.abs(arr[i].left - b.left) < 10 && Math.abs(arr[i].right - b.right) < 10) {
                       return false;
                    }
                 }
                 return true;
              });
              
              return filtered.slice(0, 5);
            }, vp.width);

            if (bleedingElements.length > 0) {
              issues.push({
                id: `responsive-bleeding-elements-${vp.width}-${url}`,
                category: "responsive",
                severity: "critical",
                title: `Elements bleeding out of viewport on ${viewportName}`,
                description: "These elements are partially off-screen, breaking the layout and causing visual bugs.",
                actual: bleedingElements.map(b => `<${b.tag}${b.class}> (extends to ${b.right}px)`).join(", "),
                expected: `Elements should be fully contained within ${vp.width}px`,
                url,
              });
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
                  id: `responsive-small-touch-targets-${vp.width}-${url}`,
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
                  id: `responsive-excessive-padding-${vp.width}-${url}`,
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
                let processed = 0;
                for (const el of Array.from(textElements)) {
                  if (processed > 200) break; // Hard limit
                  processed++;
                  const styles = window.getComputedStyle(el);
                  const fontSize = parseFloat(styles.fontSize);
                  if (fontSize < 14 && el.textContent && el.textContent.trim().length > 5) {
                    smallCount++;
                  }
                }
                return smallCount;
              });

              if (smallText > 5) {
                issues.push({
                  id: `responsive-small-text-${vp.width}-${url}`,
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
                id: `responsive-offscreen-elements-${vp.width}-${url}`,
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
              }).slice(0, 100); // HARD LIMIT to prevent O(N^2) hang

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
                id: `responsive-overlapping-header-${vp.width}-${url}`,
                category: "responsive",
                severity: "warning",
                title: `Overlapping elements detected in header area on ${viewportName}`,
                description: "Elements like navigation links and logos are smashing into each other, likely due to a flexbox wrapping issue.",
                actual: overlappingElements.join("\n"),
                expected: "Elements should have clear separation without intersection",
                url,
              });
            }

            // ─── NEW CATEGORY 1 AUDITS ──────────────────────────

            // 1. Uncentered Modals/Popups
            const uncenteredModals = await page.evaluate((viewportWidth) => {
              const floatingElements = document.querySelectorAll("div, dialog, section");
              const uncentered: { tag: string; class: string; leftGap: number; rightGap: number }[] = [];
              
              floatingElements.forEach((el) => {
                const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'absolute') {
                  const rect = el.getBoundingClientRect();
                  // Check if it's acting like a modal (relatively large, taking up a good chunk of screen)
                  if (rect.width > 200 && rect.height > 100 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    const leftGap = rect.left;
                    const rightGap = viewportWidth - rect.right;
                    
                    // If it's supposed to be centered, the gaps should be roughly equal
                    // If difference is more than 10px and it's not anchored to a specific side (e.g. left: 0 or right: 0)
                    if (Math.abs(leftGap - rightGap) > 10 && leftGap > 0 && rightGap > 0) {
                      // Ignore elements that are 100% width
                      if (rect.width < viewportWidth - 20) {
                        uncentered.push({
                          tag: el.tagName.toLowerCase(),
                          class: typeof el.className === 'string' && el.className ? `.${el.className.split(' ').join('.')}` : '',
                          leftGap: Math.round(leftGap),
                          rightGap: Math.round(rightGap)
                        });
                      }
                    }
                  }
                }
              });
              return uncentered.slice(0, 5);
            }, vp.width);

            if (uncenteredModals.length > 0) {
              issues.push({
                id: `responsive-uncentered-modals-${vp.width}-${url}`,
                category: "responsive",
                severity: "warning",
                title: `Uncentered floating elements/modals on ${viewportName}`,
                description: "Elements that appear to be modals or popups are not centrally aligned.",
                actual: uncenteredModals.map(m => `<${m.tag}${m.class}> (Left gap: ${m.leftGap}px, Right gap: ${m.rightGap}px)`).join("\n"),
                expected: "Equal left and right gaps for centered modals",
                url,
              });
            }

            // 2. Invisible Text & Basic Contrast Ratio
            const contrastIssues = await page.evaluate(() => {
              const parseRGB = (color: string) => {
                const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                return match ? [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])] : [0,0,0];
              };
              const getLuminance = (r: number, g: number, b: number) => {
                const a = [r, g, b].map(v => {
                  v /= 255;
                  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
                });
                return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
              };

              const elements = document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span, a, button, li");
              const issues: { type: string; text: string; color: string; bg: string; ratio?: number }[] = [];
              
              const styleCache = new Map<Element, CSSStyleDeclaration>();
              const getStyle = (el: Element) => {
                if (!styleCache.has(el)) {
                  styleCache.set(el, window.getComputedStyle(el));
                }
                return styleCache.get(el)!;
              };

              const bgCache = new Map<Element, string>();
              const getResolvedBackground = (el: Element, depth = 0): string => {
                if (depth > 5) return 'rgb(255, 255, 255)'; // safety escape
                if (bgCache.has(el)) return bgCache.get(el)!;
                
                const style = getStyle(el);
                const bg = style.backgroundColor;
                if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                  bgCache.set(el, bg);
                  return bg;
                }
                
                if (el.parentElement) {
                  const parentBg = getResolvedBackground(el.parentElement, depth + 1);
                  bgCache.set(el, parentBg);
                  return parentBg;
                }
                
                return 'rgb(255, 255, 255)';
              };

              let elementsProcessed = 0;

              for (const el of Array.from(elements)) {
                if (elementsProcessed > 150) break; // VERY HARD limit to avoid hangs
                
                if (!el.textContent || el.textContent.trim().length === 0) continue;
                
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;

                elementsProcessed++;
                
                const style = getStyle(el);
                const color = style.color;
                const bgColor = getResolvedBackground(el);

                if (color === bgColor) {
                   issues.push({
                     type: 'Invisible Text',
                     text: el.textContent.trim().substring(0, 20),
                     color,
                     bg: bgColor
                   });
                } else {
                  const textRGB = parseRGB(color);
                  const bgRGB = parseRGB(bgColor);
                  const l1 = getLuminance(textRGB[0], textRGB[1], textRGB[2]);
                  const l2 = getLuminance(bgRGB[0], bgRGB[1], bgRGB[2]);
                  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
                  
                  const fontSize = parseFloat(style.fontSize);
                  const isLarge = fontSize >= 24 || (fontSize >= 18 && style.fontWeight >= '700');
                  const requiredRatio = isLarge ? 3 : 4.5;
                  
                  if (ratio < requiredRatio && ratio < 2.5) {
                     let parent: Element | null = el;
                     let hasBgImage = false;
                     let depth = 0;
                     while (parent && depth < 2) { 
                       const pStyle = getStyle(parent);
                       if (pStyle.backgroundImage !== 'none' && pStyle.backgroundImage !== 'initial') {
                         hasBgImage = true;
                         break;
                       }
                       parent = parent.parentElement;
                       depth++;
                     }
                     
                     if (!hasBgImage) {
                       issues.push({
                         type: 'Low Contrast',
                         text: el.textContent.trim().substring(0, 20),
                         color,
                         bg: bgColor,
                         ratio: Math.round(ratio * 10) / 10
                       });
                     }
                  }
                }
              }
              return issues.slice(0, 5);
            });

            const invisibleText = contrastIssues.filter(i => i.type === 'Invisible Text');
            if (invisibleText.length > 0) {
              issues.push({
                id: `responsive-invisible-text-${vp.width}-${url}`,
                category: "responsive",
                severity: "critical",
                title: `Invisible text detected on ${viewportName}`,
                description: "Text color exactly matches the background color, rendering it invisible.",
                actual: invisibleText.map(i => `"${i.text}" (Color: ${i.color})`).join("\n"),
                expected: "Text color must contrast with background",
                url,
              });
            }

            const lowContrast = contrastIssues.filter(i => i.type === 'Low Contrast');
            if (lowContrast.length > 0) {
              issues.push({
                id: `responsive-low-contrast-${vp.width}-${url}`,
                category: "responsive",
                severity: "warning",
                title: `Low contrast text detected on ${viewportName}`,
                description: "Text contrast ratio falls below WCAG recommendations.",
                actual: lowContrast.map(i => `"${i.text}" (Ratio: ${i.ratio}:1)`).join("\n"),
                expected: "Contrast ratio of at least 4.5:1 for normal text (3:1 for large text)",
                url,
              });
            }

            // 3. Container Text Overflow
            const overflowText = await page.evaluate(() => {
              const elements = document.querySelectorAll("p, span, h1, h2, h3, h4, h5, h6, div");
              const overflows: { tag: string; text: string; scrollWidth: number; clientWidth: number }[] = [];
              
              let processed = 0;
              for (const el of Array.from(elements)) {
                if (processed > 200) break;
                processed++;
                if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
                  const style = window.getComputedStyle(el);
                  if (style.overflow !== 'hidden' && style.overflowX !== 'auto' && style.overflowX !== 'scroll') {
                     let hasText = false;
                     el.childNodes.forEach(n => {
                       if (n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0) hasText = true;
                     });
                     
                     if (hasText) {
                       overflows.push({
                         tag: el.tagName.toLowerCase(),
                         text: (el.textContent || "").trim().substring(0, 30),
                         scrollWidth: Math.round(el.scrollWidth),
                         clientWidth: Math.round(el.clientWidth)
                       });
                     }
                  }
                }
              }
              return overflows.slice(0, 5);
            });

            if (overflowText.length > 0) {
              issues.push({
                id: `responsive-text-overflow-${vp.width}-${url}`,
                category: "responsive",
                severity: "warning",
                title: `Text overflowing container on ${viewportName}`,
                description: "Text content is spilling out of its container bounding box without proper overflow handling.",
                actual: overflowText.map(o => `<${o.tag}> "${o.text}" (Content: ${o.scrollWidth}px, Container: ${o.clientWidth}px)`).join("\n"),
                expected: "Text should wrap or use text-overflow: ellipsis",
                url,
              });
            }

            // 4. Proximity Violations
            const proximityViolations = await page.evaluate(() => {
              const interactiveElements = Array.from(document.querySelectorAll(
                "a, button, input, select, textarea, [role='button']"
              )).filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              
              const violations: string[] = [];
              
              // Limit number of interactive elements to check to avoid O(N^2) hang
              const elementsToCheck = interactiveElements.slice(0, 50); // HARD LIMIT
              
              for (let i = 0; i < elementsToCheck.length; i++) {
                for (let j = i + 1; j < elementsToCheck.length; j++) {
                  const el1 = elementsToCheck[i];
                  const el2 = elementsToCheck[j];
                  
                  if (el1.contains(el2) || el2.contains(el1)) continue;
                  
                  const r1 = el1.getBoundingClientRect();
                  const r2 = el2.getBoundingClientRect();
                  
                  const distanceX = Math.max(0, Math.max(r1.left - r2.right, r2.left - r1.right));
                  const distanceY = Math.max(0, Math.max(r1.top - r2.bottom, r2.top - r1.bottom));
                  const distance = Math.max(distanceX, distanceY);
                  
                  if (distance > 0 && distance < 8) {
                    const text1 = (el1.textContent?.trim() || el1.tagName).substring(0, 15);
                    const text2 = (el2.textContent?.trim() || el2.tagName).substring(0, 15);
                    violations.push(`"${text1}" is too close to "${text2}" (${Math.round(distance)}px gap)`);
                  }
                }
              }
              return Array.from(new Set(violations)).slice(0, 5);
            });

            if (proximityViolations.length > 0) {
              issues.push({
                id: `responsive-proximity-violations-${vp.width}-${url}`,
                category: "responsive",
                severity: "warning",
                title: `Interactive elements too close together on ${viewportName}`,
                description: "Tap targets should have at least 8px of space between them to prevent accidental clicks.",
                actual: proximityViolations.join("\n"),
                expected: "Minimum 8px gap between interactive elements",
                url,
              });
            }
          }
        }; // End of evaluatePage
        
        await Promise.race([
          evaluatePage(),
          new Promise(r => setTimeout(r, 45000)) // 45s hard timeout per page
        ]);
        
        } finally {
          await context.close(); // Close the specific context for this page
        }
        return issues;
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      for (const issues of chunkResults) {
        allIssues.push(...issues);
      }
    }
  } finally {
    await browser.close();
  }

  return allIssues;
}
