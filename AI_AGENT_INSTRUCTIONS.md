# AI Agent Instructions

## Language Policy
- User-facing chat replies: **Russian**
- File content (code/docs/config): **English only**

## Versioning Strategy

Version format: `<weekCode>-<minor>.<build>`
- `weekCode`: current ISO week (e.g., `2026w10`)
- `minor`: minor version (reset on week change)
- `build`: incremental build number

### Mandatory Version Bump After Any Tracked File Change

After modifying ANY tracked file (except docs, README updates):
1. Run exactly one bump command:
	- `npm run bump:build -- --desc "Short English summary"` for regular updates
	- `npm run bump:minor -- --desc "Short English summary"` for minor release milestones
2. Verify version in `version.json` and `package.json`
3. Run: `npm run typecheck` or `npm run build` to validate
4. Bump command auto-creates commit with format: `<version>: <description>`
5. Auto-commit stages current working tree changes (`git add -A`), so run bump only when ready to commit.

### Commands Reference

- `npm run dev` — start development server
- `npm run build` — production build
- `npm run typecheck` — validate TypeScript
- `npm run lint` — check code style
- `npm run test` — run tests (if configured)
- `npm run bump:build -- --desc "..."` — bump build version + auto-commit
- `npm run bump:minor -- --desc "..."` — bump minor version + auto-commit

## Project Documentation Synchronization

After code changes, review and update:
- `docs/GAME_LOGIC.md` — memory execution model and rules
- `docs/TODO.md` — roadmap and known issues
- `README.md` — project overview

Keep docs in English, concise, and factual.

## Git Workflow

1. Make code changes
2. Verify: `npm run typecheck && npm run build`
3. Run one bump command with description (auto-commit)
4. Push to GitHub

## File Locations to Know

- Memory simulator component: `src/components/MemoryLayoutSimulator.tsx`
- Main app: `src/App.tsx`
- Logic docs: `docs/GAME_LOGIC.md`
- Vite config: `vite.config.ts`
- Version files: `version.json`, `package.json` (sync both)
