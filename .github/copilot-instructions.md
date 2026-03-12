# Repository Copilot Workflow

## Operational Rules
- User-facing chat replies must be in Russian.
- File content (code/docs/config) must be in English.
- After any tracked file change, run version bump:
  - `npm run bump:build -- --desc "Short English summary"`
  - `npm run bump:minor -- --desc "Short English summary"`
- Keep version synchronized in `version.json` and `package.json`.
- Ensure `build-notes.md` gets appended on each bump.
- Use commit message format: `<version>: <description>`.
- Standard sequence: change files -> bump version -> verify -> commit.
- After any source change, review and update domain docs if impacted.

## Key Documentation
- `README.md` — project overview
- `docs/GAME_LOGIC.md` — game mechanics
- `docs/TODO.md` — roadmap
- `src/components/BallGame.tsx` — game component

## Development Commands
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm run test`
- Lint: `npm run lint`
- Dev: `npm run dev`
- Bump build: `npm run bump:build -- --desc "Short English summary"`
- Bump minor: `npm run bump:minor -- --desc "Short English summary"`
