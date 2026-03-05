import type { SiteInfo } from "./types.js";

export async function confirmSiteInfo(
  detected: Partial<SiteInfo>
): Promise<SiteInfo> {
  const inquirer = await import("inquirer");

  const answers = await inquirer.default.prompt([
    {
      type: "input",
      name: "name",
      message: `Website name detected as "${detected.name || "Unknown"}". Correct? (Enter to confirm, or type the correct name):`,
      default: detected.name || "",
    },
    {
      type: "input",
      name: "domain",
      message: `Website domain detected as "${detected.domain || "Unknown"}". Correct?:`,
      default: detected.domain || "",
    },
    {
      type: "input",
      name: "language",
      message: `Language detected as "${detected.language || "en"}". Correct?:`,
      default: detected.language || "en",
    },
    {
      type: "input",
      name: "description",
      message: "Brief site description (for context):",
      default: detected.description || "",
    },
  ]);

  return {
    name: answers.name,
    domain: answers.domain,
    language: answers.language,
    description: answers.description,
  };
}

export async function confirmProceed(
  issueCount: number
): Promise<{ proceed: boolean; autoFix: boolean }> {
  const inquirer = await import("inquirer");

  console.log(); // spacing
  const answers = await inquirer.default.prompt([
    {
      type: "list",
      name: "action",
      message: `Found ${issueCount} issues. What would you like to do?`,
      choices: [
        { name: "📄 Save report only (don't modify code)", value: "report" },
        { name: "🔧 Auto-fix what's possible and save report", value: "fix" },
        { name: "❌ Cancel", value: "cancel" },
      ],
    },
  ]);

  return {
    proceed: answers.action !== "cancel",
    autoFix: answers.action === "fix",
  };
}
