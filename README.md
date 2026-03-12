# Memory Layout Lab

Interactive visualizer for explaining how high-level variables map onto byte offsets in linear memory.

The app focuses on a constrained machine model:
- Fixed-size linear memory with `16` visible cells per row
- Named offsets (`a_offset`, `b_offset`, etc.) defined by expressions
- Instruction list with editable memory operations and `print(...)`
- Step-by-step execution with direct memory highlighting

## Core Idea

Each instruction only knows what it explicitly touches.

- Read visibility: values are known only for addresses in the instruction's read set.
- Write visibility: for write targets, previous values are treated as unknown unless read explicitly.
- Programmer model vs machine model: the full memory state exists, but instruction-level visibility is intentionally limited.

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Install and Run

```bash
git clone https://github.com/acrm/MemoryLayout.git
cd MemoryLayout
npm install
npm run dev
```

Open `http://localhost:5173`.

### Build

```bash
npm run build
```

## UI Layout

- 2x2 layout with four equal zones.
- Top-left zone: compact monospace memory row with 16 columns (`00..15`), row prefix (`00`), and execution controls.
- Top-right zone: single multiline offset editor (`name: expression`) without line numbering.
- Bottom-left zone: multiline instruction editor with line numbering.
- Bottom-right zone: instruction continuation editor with line numbering.
- Cursor interactions: active offset line selects its memory cell; active instruction line colors referenced offsets and matching memory cells.

## Supported Instruction Syntax

- `mem[offset_expr] = value_expr`
- `name = expr`
- `print(expr)`

Expression support includes integer arithmetic (`+ - * / // %`), parentheses, named offsets, local names, and `mem[...]` reads.

## Project Structure

```
src/
  components/
    MemoryLayoutSimulator.tsx
  App.tsx
  App.css
  index.css
docs/
  GAME_LOGIC.md
  TODO.md
scripts/
  update-version.js
```

## Development Commands

- `npm run dev`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `npm run test`

## Version Workflow

This repository uses weekly semantic versioning:
- Format: `<weekCode>-<minor>.<build>`
- Example: `2026w11-1.1`

After tracked file changes, run exactly one command:

```bash
npm run bump:build -- --desc "Short English summary"  # regular updates
npm run bump:minor -- --desc "Short English summary"  # minor release milestones
```

Each bump command updates `version.json`, `package.json`, appends `build-notes.md`, and creates
an automatic git commit with message format `<version>: <description>`.
The command stages current working tree changes via `git add -A`.

## License

MIT
