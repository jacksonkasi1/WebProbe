import type { Issue } from "../types.js";

interface PerformanceData {
  html: string;
  images: { src: string; width: number; height: number }[];
  performanceMetrics: Record<string, number>;
  url?: string;
}

export function analyzePerformance(data: PerformanceData): Issue[] {
  const issues: Issue[] = [];
  const url = data.url || "";

  // ─── Page Load Metrics ──────────────────────────────
  const { domContentLoaded, loadComplete, ttfb } = data.performanceMetrics;

  if (ttfb && ttfb > 800) {
    issues.push({
      id: "perf-slow-ttfb",
      category: "performance",
      severity: ttfb > 1800 ? "critical" : "warning",
      title: "Slow Time to First Byte (TTFB)",
      description: `TTFB is ${Math.round(ttfb)}ms. This indicates server-side performance issues.`,
      actual: `${Math.round(ttfb)}ms`,
      expected: "Under 800ms, ideally under 200ms",
      url,
    });
  }

  if (domContentLoaded && domContentLoaded > 3000) {
    issues.push({
      id: "perf-slow-dcl",
      category: "performance",
      severity: domContentLoaded > 5000 ? "critical" : "warning",
      title: "Slow DOMContentLoaded",
      description: `DOMContentLoaded at ${Math.round(domContentLoaded)}ms.`,
      actual: `${Math.round(domContentLoaded)}ms`,
      expected: "Under 3000ms",
      url,
    });
  }

  if (loadComplete && loadComplete > 5000) {
    issues.push({
      id: "perf-slow-load",
      category: "performance",
      severity: loadComplete > 10000 ? "critical" : "warning",
      title: "Slow page load",
      description: `Full page load at ${Math.round(loadComplete)}ms.`,
      actual: `${Math.round(loadComplete)}ms`,
      expected: "Under 5000ms, ideally under 3000ms",
      url,
    });
  }

  // ─── Image Optimization ─────────────────────────────
  const unoptimizedImages = data.images.filter((img) => {
    const isRaster = /\.(jpg|jpeg|png|gif|bmp)(\?|$)/i.test(img.src);
    return isRaster && !img.src.includes("data:"); // Skip data URIs
  });

  const modernFormatImages = data.images.filter((img) =>
    /\.(webp|avif)(\?|$)/i.test(img.src)
  );

  if (unoptimizedImages.length > 0 && modernFormatImages.length === 0) {
    issues.push({
      id: "perf-no-modern-images",
      category: "performance",
      severity: "warning",
      title: "No modern image formats detected",
      description: `Found ${unoptimizedImages.length} raster images but none using WebP or AVIF.`,
      actual: "Using JPEG/PNG only",
      expected: "Use WebP or AVIF for 30-80% smaller file sizes",
      fixSuggestion: "Convert images to WebP format or use <picture> with WebP/AVIF sources.",
      url,
    });
  }

  // ─── Large Images ───────────────────────────────────
  const oversizedImages = data.images.filter(
    (img) => img.width > 2000 || img.height > 2000
  );
  if (oversizedImages.length > 0) {
    issues.push({
      id: "perf-oversized-images",
      category: "performance",
      severity: "warning",
      title: `${oversizedImages.length} potentially oversized image(s)`,
      description: "Images larger than 2000px may be unnecessarily large for web display.",
      actual: oversizedImages
        .slice(0, 3)
        .map((i) => `${i.width}×${i.height}: ${i.src.substring(0, 60)}`)
        .join("\n"),
      expected: "Size images appropriately — typically max 1920px wide for full-width images",
      url,
    });
  }

  // ─── Lazy Loading ──────────────────────────────────
  const totalImages = data.images.length;
  const lazyLoadedCount = (data.html.match(/loading=["']lazy["']/gi) || []).length;

  if (totalImages > 5 && lazyLoadedCount === 0) {
    issues.push({
      id: "perf-no-lazy-loading",
      category: "performance",
      severity: "warning",
      title: "No lazy-loaded images detected",
      description: `${totalImages} images found but none use loading="lazy". Images below the fold should be lazy-loaded.`,
      actual: "0 lazy-loaded images",
      expected: "Off-screen images should use loading='lazy'",
      fixSuggestion: 'Add loading="lazy" to images below the fold.',
      url,
    });
  }

  // ─── Render-Blocking Resources ─────────────────────
  const renderBlockingCSS = (data.html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi) || [])
    .filter((link) => !link.includes("media=") || link.includes('media="all"'));

  if (renderBlockingCSS.length > 3) {
    issues.push({
      id: "perf-render-blocking-css",
      category: "performance",
      severity: "info",
      title: `${renderBlockingCSS.length} render-blocking CSS files`,
      description: "Multiple CSS files block rendering. Consider inlining critical CSS or using media queries.",
      actual: `${renderBlockingCSS.length} blocking stylesheets`,
      expected: "Minimize render-blocking CSS — inline critical CSS, defer non-critical",
      url,
    });
  }

  const renderBlockingJS = (data.html.match(/<script[^>]*src=["'][^"']+["'][^>]*>/gi) || [])
    .filter(
      (script) => !script.includes("async") && !script.includes("defer") && !script.includes("type=\"module\"")
    );

  if (renderBlockingJS.length > 0) {
    issues.push({
      id: "perf-render-blocking-js",
      category: "performance",
      severity: "warning",
      title: `${renderBlockingJS.length} render-blocking JavaScript file(s)`,
      description: "Scripts without async or defer block page rendering.",
      actual: `${renderBlockingJS.length} blocking scripts`,
      expected: "Add 'async' or 'defer' to script tags, or use type='module'",
      url,
    });
  }

  // ─── HTML Size ──────────────────────────────────────
  const htmlSizeKB = Math.round(new Blob([data.html]).size / 1024);
  if (htmlSizeKB > 100) {
    issues.push({
      id: "perf-large-html",
      category: "performance",
      severity: htmlSizeKB > 500 ? "critical" : "warning",
      title: "Large HTML document",
      description: `HTML document is ${htmlSizeKB}KB.`,
      actual: `${htmlSizeKB}KB`,
      expected: "Under 100KB for the HTML document",
      url,
    });
  }

  // ─── Inline Styles / Scripts ────────────────────────
  const inlineStyles = (data.html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []);
  const totalInlineStyleSize = inlineStyles.reduce((sum, s) => sum + s.length, 0);

  if (totalInlineStyleSize > 50000) {
    issues.push({
      id: "perf-large-inline-css",
      category: "performance",
      severity: "info",
      title: "Large amount of inline CSS",
      description: `${Math.round(totalInlineStyleSize / 1024)}KB of inline CSS. Consider extracting to external files for caching.`,
      actual: `${Math.round(totalInlineStyleSize / 1024)}KB inline CSS`,
      expected: "Keep inline CSS minimal — only critical above-the-fold styles",
      url,
    });
  }

  return issues;
}
