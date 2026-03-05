# WebProbe — Claude Code Agent Configuration

## What is WebProbe?
WebProbe is a web standards auditor. Use it to check websites for SEO, responsive design,
accessibility, performance, and code quality issues.

## Available Commands

### Initialize standards for a new project:
```bash
bun run dev -- init --output ./web-standards.md
```

### Audit a live website:
```bash
bun run dev -- check --url https://example.com --no-interactive --format markdown --report ./webprobe-report.md
```

### Audit localhost during development:
```bash
bun run dev -- check --url http://localhost:3000 --code . --no-interactive --format markdown
```

### Audit source code only:
```bash
bun run dev -- check --code . --no-interactive --format markdown
```

### Take screenshots at all viewports:
```bash
bun run dev -- screenshot http://localhost:3000 --viewports mobile,tablet,desktop --output ./screenshots
```

### Full audit (URL + code):
```bash
bun run dev -- check --url http://localhost:3000 --code . --no-interactive --format json --report ./audit.json
```

## Workflow for Claude Code

When asked to check or audit a website:

1. **First**, run the WebProbe check command to get a structured report
2. **Review** the screenshots in the `webprobe-screenshots/` directory
3. **Read** the generated report file
4. **Fix** issues in order of severity: critical → warning → info
5. **Re-run** the check to verify fixes

When asked to set up web standards for a new project:

1. Run `webprobe init` to generate the standards file
2. Reference `web-standards.md` as the source of truth for all web development

## Important Notes

- Always use `--no-interactive` when running programmatically
- Use `--format json` when you need to parse the output
- Use `--format markdown` for human-readable reports
- Screenshots are saved to `./webprobe-screenshots/` by default
- The tool checks: SEO, responsive design, accessibility, performance, links, and code quality
- Review screenshots at mobile (375px), tablet (768px), and desktop (1440px) viewports
- When fixing responsive issues, pay special attention to:
  - Excessive padding on mobile (should be 16-24px, not 40px+)
  - Touch targets too small (minimum 44×44px)
  - Horizontal overflow
  - Font sizes too small on mobile (minimum 16px for body)
