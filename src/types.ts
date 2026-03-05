export type Severity = "critical" | "warning" | "info";

export type Category =
  | "seo"
  | "responsive"
  | "accessibility"
  | "performance"
  | "links"
  | "visual"
  | "code-quality"
  | "security"
  | "meta";

export interface Issue {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  element?: string;        // CSS selector or file path
  actual?: string;         // What was found
  expected?: string;       // What was expected
  fixSuggestion?: string;  // How to fix it
  filePath?: string;       // Source code file (for code checks)
  line?: number;           // Line number in source
  url?: string;            // Page URL where found
}

export interface Screenshot {
  viewport: string;
  width: number;
  height: number;
  path: string;
  fullPage: boolean;
}

export interface SiteInfo {
  name: string;
  domain: string;
  language: string;
  framework?: string;
  description?: string;
}

export interface CheckOptions {
  url?: string;
  code?: string;
  autoFix: boolean;
  report: string;
  format: "markdown" | "json";
  interactive: boolean;
  screenshots: string;
  viewports: string;
}

export interface CheckResult {
  url?: string;
  codePath?: string;
  siteInfo: SiteInfo;
  issues: Issue[];
  screenshots: Screenshot[];
  timestamp: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    byCategory: Record<Category, number>;
  };
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export const VIEWPORTS: Record<string, Viewport> = {
  mobile: { name: "Mobile (375×812)", width: 375, height: 812 },
  tablet: { name: "Tablet (768×1024)", width: 768, height: 1024 },
  desktop: { name: "Desktop (1440×900)", width: 1440, height: 900 },
  wide: { name: "Wide (1920×1080)", width: 1920, height: 1080 },
};
