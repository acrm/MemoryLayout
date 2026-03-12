# Memory Execution Model

## Overview

Memory Layout Lab visualizes low-level memory access over a linear byte array.

The model contains:
- Linear memory displayed with fixed 16 columns per row
- Named offsets resolved from integer expressions
- Editable Low-Level instructions executed one line at a time
- Read-only High-Level code view synchronized with execution progress
- Immediate per-step memory highlighting

## Data Model

### Physical Memory
- Backing array of byte values (`0..255`)
- Separate initialization map
- Uninitialized cells have no readable value

### Named Offsets
- Mapping `name -> numeric offset`
- Expressions can reference previously declared offset names
- Offsets must resolve to integer values in `0..memorySize-1`

### Instruction-Level Visibility
For each executed instruction:
- Read set: only explicitly read cells are known
- Write set: target cells get new values, but previous values are unknown unless read in that instruction
- Non-touched cells are unknown to current instruction (`??`)

This preserves the distinction between:
- Programmer mental model (global expected state)
- Machine local model (per-instruction visibility)

## Supported Statements

- `mem[offset_expr] = value_expr`
- `name = expr`
- `print(expr)`

Expressions support:
- Integer literals
- Named offsets and local names
- Memory reads: `mem[...]`
- Arithmetic: `+ - * / // %`
- Parentheses

## Runtime Rules

- Reads from uninitialized cells produce runtime error.
- Memory indexes outside bounds produce runtime error.
- Written values are normalized to byte range (`0..255`).
- Lines that are empty or comments (`#` or `//`) are treated as no-op.

## UI Mapping

- 2x2 equal quadrants:
	- Top-left: memory row and execution controls.
	- Top-right: multiline offset editor.
	- Bottom-left: Low-Level instruction editor.
	- Bottom-right: High-Level read-only code pane with example selector.
- Memory row details:
	- Header columns show low address parts (`00..15`).
	- Row prefix shows the high address part (currently `00`).
	- Each cell is rendered as a two-character token (`??` by default).
	- Selected cell replaces surrounding spacing with bracket emphasis (`[??]`).
- Offset editor:
	- Uses `name: expression` lines without numbering.
	- Cursor line selects the resolved memory cell.
- Low-Level editor:
	- Lines are numbered and editable.
	- Cursor line highlights referenced offsets with per-offset colors.
	- Matching memory cells reuse the same colors.
- High-Level pane:
	- Read-only code with line numbering.
	- Current execution line is highlighted in sync with the Low-Level program counter.
