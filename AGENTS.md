# WebProbe Agent Instructions

You have access to the WebProbe CLI tool for auditing websites against web standards.

## Quick Reference

| Task | Command |
|------|---------|
| Full audit (URL + code) | `bun run dev -- check -u <url> -c . --no-interactive` |
| URL-only audit | `bun run dev -- check -u <url> --no-interactive` |
| Code-only audit | `bun run dev -- check -c . --no-interactive` |
| Screenshots only | `bun run dev -- screenshot <url>` |
| Init standards | `bun run dev -- init -o web-standards.md` |

## Agent Workflow

### Analyzing an existing website:
1. Run: `bun run dev -- check -u <url> -c <code_path> --no-interactive -f json -r audit.json`
2. Read `audit.json` for structured issue data
3. View screenshots in `webprobe-screenshots/` — analyze mobile/tablet/desktop
4. Fix critical issues first, then warnings
5. Re-run audit to verify

### Setting up a new project:
1. Run: `bun run dev -- init -o web-standards.md --no-interactive`
2. Add `web-standards.md` to project root
3. Follow all standards in the document

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

## Output Formats
- `--format markdown` → Human-readable `webprobe-report.md`
- `--format json` → Machine-parseable `webprobe-report.json`
