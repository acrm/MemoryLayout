# Repository Copilot Workflow

## Operational Rules
- User-facing chat replies must be in Russian.
- File content (code/docs/config) must be in English.
- After tracked file changes, run exactly one version bump command:
  - `npm run bump:build -- --desc "Short English summary"` for regular updates
  - `npm run bump:minor -- --desc "Short English summary"` for minor release milestones
- Keep version synchronized in `version.json` and `package.json`.
- Ensure `build-notes.md` gets appended on each bump.
- Bump commands auto-create git commit with format: `<version>: <description>`.
- Auto-commit stages current working tree changes (`git add -A`), so run bump only when ready to commit.
- Standard sequence: change files -> verify -> run one bump command (auto-commit).
- After any source change, review and update domain docs if impacted.

## Key Documentation
- `README.md` — project overview
- `docs/GAME_LOGIC.md` — memory execution model
- `docs/TODO.md` — roadmap
- `src/components/MemoryLayoutSimulator.tsx` — memory visualization component

## Development Commands
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm run test`
- Lint: `npm run lint`
- Dev: `npm run dev`
- Bump build + auto-commit: `npm run bump:build -- --desc "Short English summary"`
- Bump minor + auto-commit: `npm run bump:minor -- --desc "Short English summary"`
