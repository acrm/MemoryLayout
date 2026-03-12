# Project Roadmap

## Current Features
- [x] Linear memory row with fixed 16-column layout and address header
- [x] Editable named offset table with expression-based offsets
- [x] Editable instruction list (`mem[...] = ...`, assignment, `print(...)`)
- [x] Step-by-step and run-to-end execution
- [x] Execution trace (reads, writes, notes, errors)
- [x] Instruction-level visibility layer (`Instr` values / unknown `??`)
- [x] Distinct top memory area and two bottom editing panels

## Next Iteration
- [ ] Add breakpoints and continue-until-breakpoint mode
- [ ] Add rewind/history scrubber for step navigation
- [ ] Add preset scenarios and import/export as JSON
- [ ] Add memory inspector for multi-byte values (uint16/int32)
- [ ] Add address alignment helpers and allocation preview
- [ ] Add optional machine/ground-truth split-screen timeline

## Known Issues
- Offset expressions currently depend on declaration order.
- Read-before-write behavior is strict (runtime error), no warning mode yet.

## Technical Debt
- Extract parser and execution engine into standalone module with tests.
- Add deterministic unit tests for expression parsing and trace generation.
- Improve instruction syntax diagnostics with exact token positions.
