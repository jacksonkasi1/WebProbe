# WebProbe — OpenCode Integration

OpenCode supports [Custom Tools](https://opencode.ai/docs/custom-tools) and [Agent Skills](https://opencode.ai/docs/skills). You can integrate WebProbe directly into your OpenCode environment to give your AI agent native web auditing capabilities.

## Setup

### 1. Install WebProbe Globally
First, ensure WebProbe is installed globally so it can be called from any directory without hardcoding paths:

```bash
# Clone the repository
git clone https://github.com/your-repo/webprobe.git
cd webprobe

# Install dependencies and build
bun install
bun run build

# Install Playwright browsers
bunx playwright install chromium

# Link globally so the `webprobe` command is available everywhere
bun link
```

### 2. Add OpenCode Custom Tools

Create a file at `.opencode/tools/webprobe.ts` in your project (or globally in `~/.config/opencode/tools/webprobe.ts`):

```typescript
import { tool } from "@opencode-ai/plugin"

export const check = tool({
  description: "Audit a website for SEO, responsive, accessibility, performance, and code quality issues",
  args: {
    url: tool.schema.string().optional().describe("Website URL to check"),
    code: tool.schema.string().default(".").describe("Source code path to analyze")
  },
  async execute(args) {
    const argsList = [];
    if (args.url) {
      argsList.push("-u", args.url);
    }
    if (args.code) {
      argsList.push("-c", args.code);
    }

    try {
      // Execute the global webprobe binary and parse the JSON output directly
      const result = await Bun.$`webprobe check ${argsList} --no-interactive --format json`.json();
      return result;
    } catch (err: any) {
      return { error: "Failed to run WebProbe", details: err.message };
    }
  }
})

export const screenshot = tool({
  description: "Capture screenshots of a URL at mobile, tablet, and desktop viewports",
  args: {
    url: tool.schema.string().describe("URL to screenshot")
  },
  async execute(args) {
    try {
      const result = await Bun.$`webprobe screenshot ${args.url}`.text();
      return result;
    } catch (err: any) {
      return `Screenshot capture failed: ${err.message}`;
    }
  }
})

export const init = tool({
  description: "Generate a comprehensive web standards rules file (web-standards.md) for the project",
  args: {},
  async execute() {
    try {
      const result = await Bun.$`webprobe init --no-interactive`.text();
      return result;
    } catch (err: any) {
      return `Initialization failed: ${err.message}`;
    }
  }
})
```

*Note: Exporting these functions automatically exposes them to the LLM as `webprobe_check`, `webprobe_screenshot`, and `webprobe_init`.*

### 3. Add an OpenCode Agent Skill

OpenCode uses `SKILL.md` files to provide context and instructions to agents.

Create `.opencode/skills/webprobe/SKILL.md`:

```markdown
---
name: webprobe
description: Web standards auditor guidelines and procedures
---

You have access to WebProbe for web auditing via the `webprobe_check`, `webprobe_screenshot`, and `webprobe_init` custom tools.

## Agent Workflow

### Analyzing an existing website:
1. Run: `webprobe_check` with the relevant URL and/or code path.
2. Read the structured JSON output returned by the tool.
3. Review screenshots in the `webprobe-screenshots/` directory (if a URL was provided) to analyze mobile/tablet/desktop layouts.
4. Fix critical issues first, followed by warnings.
5. Re-run `webprobe_check` to verify the fixes.

### Setting up a new project:
1. Run: `webprobe_init`
2. Add the generated `web-standards.md` to the project root.
3. Follow all standards detailed in the document.

### Key standards to enforce:
- Mobile padding: 16-24px (NOT excessive)
- Touch targets: ≥ 44×44px
- Body font size: ≥ 16px on mobile
- Color contrast: ≥ 4.5:1 (normal text), ≥ 3:1 (large text)
- All images need alt text
- Every page needs: title (30-60 chars), meta description (120-160 chars), one H1
- No horizontal scroll on mobile
- No hardcoded localhost URLs in production code
- Canonical URLs on every page
- OG tags for social sharing
```

## Typical Usage Flow

1. Once the above setup is complete, simply tell OpenCode to audit your app.
2. **Prompt:** *"Please use your webprobe skill to audit my project and its live server at http://localhost:3000"*
3. OpenCode will:
   - Call `webprobe_check({ url: "http://localhost:3000", code: "." })`
   - Read the structured JSON directly into its context window.
   - Automatically determine a plan and fix code to meet the detected web standards.
