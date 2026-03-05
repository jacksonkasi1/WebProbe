import type { Issue } from "../types.js";

interface LinkData {
  links: { href: string; text: string; isExternal: boolean }[];
  url?: string;
}

export function analyzeLinks(data: LinkData): Issue[] {
  const issues: Issue[] = [];
  const url = data.url || "";

  // ─── Empty Links ────────────────────────────────────
  const emptyLinks = data.links.filter(
    (link) =>
      !link.text.trim() &&
      !link.href.includes("#") // Anchor links can be empty (icons, etc.)
  );

  if (emptyLinks.length > 0) {
    issues.push({
      id: "links-empty-text",
      category: "links",
      severity: "warning",
      title: `${emptyLinks.length} link(s) with no text content`,
      description:
        "Links without text are not accessible to screen readers. Add aria-label or visible text.",
      actual: emptyLinks
        .slice(0, 5)
        .map((l) => l.href)
        .join("\n"),
      expected: "All links should have descriptive text or aria-label",
      url,
    });
  }

  // ─── Generic Link Text ─────────────────────────────
  const genericTexts = ["click here", "read more", "learn more", "here", "link", "more"];
  const genericLinks = data.links.filter((link) =>
    genericTexts.includes(link.text.toLowerCase().trim())
  );

  if (genericLinks.length > 3) {
    issues.push({
      id: "links-generic-text",
      category: "links",
      severity: "info",
      title: `${genericLinks.length} link(s) with generic text`,
      description:
        'Link text like "click here" or "read more" is not descriptive for screen readers or SEO.',
      actual: genericLinks
        .slice(0, 5)
        .map((l) => `"${l.text}" → ${l.href}`)
        .join("\n"),
      expected: "Use descriptive link text that makes sense out of context",
      url,
    });
  }

  // ─── Hash-only Links ───────────────────────────────
  const hashLinks = data.links.filter((link) => link.href === "#" || link.href.endsWith("/#"));
  if (hashLinks.length > 0) {
    issues.push({
      id: "links-hash-only",
      category: "links",
      severity: "warning",
      title: `${hashLinks.length} link(s) with href="#"`,
      description:
        "Links with href='#' scroll to top and don't navigate. Use a <button> for actions or a proper href.",
      actual: `${hashLinks.length} links with href="#"`,
      expected: "Use <button> for actions, or proper href for navigation",
      url,
    });
  }

  // ─── External Links without rel ────────────────────
  // Note: Can't fully check this from HTML string alone; this checks for obvious cases

  // ─── Duplicate Links ───────────────────────────────
  const linkCounts = new Map<string, number>();
  data.links.forEach((link) => {
    const count = linkCounts.get(link.href) || 0;
    linkCounts.set(link.href, count + 1);
  });

  const duplicateLinks = Array.from(linkCounts.entries()).filter(
    ([, count]) => count > 3
  );

  if (duplicateLinks.length > 0) {
    issues.push({
      id: "links-excessive-duplicates",
      category: "links",
      severity: "info",
      title: `${duplicateLinks.length} URL(s) linked more than 3 times`,
      description: "Excessive duplicate links on a page can dilute link equity and confuse users.",
      actual: duplicateLinks
        .slice(0, 5)
        .map(([href, count]) => `${href} (${count} times)`)
        .join("\n"),
      url,
    });
  }

  return issues;
}

/**
 * Check for broken links by making HTTP requests
 */
export async function checkBrokenLinks(
  links: { href: string; text: string; isExternal: boolean }[],
  baseUrl?: string
): Promise<Issue[]> {
  const issues: Issue[] = [];

  // Deduplicate links
  const uniqueHrefs = [...new Set(links.map((l) => l.href))].filter(
    (href) =>
      href.startsWith("http") &&
      !href.includes("javascript:") &&
      !href.includes("mailto:") &&
      !href.includes("tel:")
  );

  // Limit to 50 links to avoid hammering servers
  const toCheck = uniqueHrefs.slice(0, 50);
  const broken: { href: string; status: number | string }[] = [];

  const checkLink = async (href: string): Promise<void> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(href, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (response.status >= 400) {
        broken.push({ href, status: response.status });
      }
    } catch (err) {
      // Try GET if HEAD fails
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(href, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
        });

        clearTimeout(timeout);

        if (response.status >= 400) {
          broken.push({ href, status: response.status });
        }
      } catch {
        broken.push({ href, status: "timeout/error" });
      }
    }
  };

  // Check in batches of 5
  for (let i = 0; i < toCheck.length; i += 5) {
    const batch = toCheck.slice(i, i + 5);
    await Promise.all(batch.map(checkLink));
  }

  if (broken.length > 0) {
    issues.push({
      id: "links-broken",
      category: "links",
      severity: "critical",
      title: `${broken.length} broken link(s) detected`,
      description: "These links returned error status codes or timed out.",
      actual: broken
        .map((b) => `${b.status}: ${b.href}`)
        .join("\n"),
      expected: "All links should return 2xx status codes",
    });
  }

  return issues;
}
