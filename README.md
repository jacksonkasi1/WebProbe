# 🔍 WebProbe

**Web standards auditor for AI coding agents.** Checks SEO, responsive design,
accessibility, performance, and code quality — outputs reports that Claude Code,
OpenCode, and other AI agents can read and act on.

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-repo/webprobe.git
cd webprobe
bun install
bunx playwright install chromium

# Initialize standards for your project
bun run dev -- init

# Audit a website
bun run dev -- check --url http://localhost:3000 --code .

# Screenshots only
bun run dev -- screenshot http://localhost:3000
```

## Usage Modes

### 1. Initialize Standards
Generate a comprehensive web standards document for your project:
```bash
bun run check init --output ./web-standards.md
```

### 2. Audit a Live Site
```bash
bun run check --url https://mysite.com
```

### 3. Audit Source Code
```bash
bun run check --code ./my-project
```

### 4. Full Audit (URL + Code)
```bash
bun run check --url http://localhost:3000 --code . --report ./audit-report.md
```

### 5. Non-Interactive (for AI agents)
```bash
bun run check --url http://localhost:3000 --no-interactive --format json
```

## What It Checks

| Category | Checks |
|----------|--------|
| 🔍 SEO | Title, meta description, headings, alt text, canonical, OG tags, structured data |
| 📱 Responsive | Viewport, touch targets, padding, font sizes, horizontal overflow |
| ♿ Accessibility | Contrast, keyboard nav, ARIA, labels, focus indicators, landmarks |
| ⚡ Performance | TTFB, load time, image optimization, lazy loading, render-blocking resources |
| 🔗 Links | Broken links, empty links, generic text, hash-only links |
| 🧹 Code Quality | Inline styles, localhost URLs, missing files, TODO markers, console errors |

## AI Agent Integration

### Claude Code
Copy `CLAUDE.md` to your project root. Claude Code will automatically use
WebProbe commands when asked to audit or fix web standards.

### OpenCode
See `opencode.md` for configuration. Add WebProbe as a custom tool in your
OpenCode config.

### Any Agent
Use `--no-interactive --format json` for machine-readable output:
```bash
bun run check -u http://localhost:3000 -c . --no-interactive -f json -r audit.json
```

## Output

### Report (`webprobe-report.md`)
A structured markdown file with all issues grouped by category and severity.

### Screenshots (`webprobe-screenshots/`)
Full-page and above-fold screenshots at:
- Mobile (375×812)
- Tablet (768×1024)
- Desktop (1440×900)

### JSON (`--format json`)
Machine-readable output with all issue data for programmatic processing.

## License
MIT