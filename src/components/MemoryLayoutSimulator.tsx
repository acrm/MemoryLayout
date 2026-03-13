import React, { useEffect, useMemo, useRef, useState } from 'react'

interface MemoryRead {
  offset: number
  value: number
}

interface MemoryWrite {
  offset: number
  newValue: number
  previousKnown: boolean
  previousValue?: number
}

interface TraceEntry {
  step: number
  instruction: string
  reads: MemoryRead[]
  writes: MemoryWrite[]
  printed: string[]
  note: string
  error?: string
}

interface MachineSnapshot {
  memory: number[]
  initialized: boolean[]
  locals: Record<string, number>
}

interface ParsedOffsets {
  values: Record<string, number>
  errors: string[]
  lineToOffset: Array<number | null>
}

interface ExecutionResult {
  nextSnapshot: MachineSnapshot
  trace: TraceEntry
  succeeded: boolean
}

interface HighLevelExample {
  id: string
  label: string
  highLevelCode: string
  offsetsText: string
  lowLevelCode: string
  lowToHighMap: number[]
  structLayout?: string
}

type TokenKind =
  | 'number'
  | 'identifier'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'eof'

interface Token {
  kind: TokenKind
  value: string
}

interface ExpressionContext {
  resolveIdentifier: (name: string) => number
  readMemory: (offset: number) => number
  allowMemoryAccess: boolean
}

const DEFAULT_MEMORY_SIZE = 16
const MEMORY_COLUMNS = 16

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const OFFSET_COLOR_PALETTE = ['#d9480f', '#1c7ed6', '#2b8a3e', '#c92a2a', '#5f3dc4', '#0b7285']

const HIGH_LEVEL_EXAMPLES: HighLevelExample[] = [
  {
    id: 'sum-two-values',
    label: 'sum two values',
    highLevelCode: ['a = 2', 'b = 3', 'c = a + b', 'print(c)'].join('\n'),
    offsetsText: ['a_offset: 0', 'b_offset: 1', 'c_offset: 3'].join('\n'),
    lowLevelCode: [
      'mem[a_offset] = 2',
      'mem[b_offset] = 3',
      'mem[c_offset] = mem[a_offset] + mem[b_offset]',
      'print(mem[c_offset])',
    ].join('\n'),
    lowToHighMap: [0, 1, 2, 3],
  },
  {
    id: 'difference-and-product',
    label: 'difference and product',
    highLevelCode: ['x = 9', 'y = 4', 'd = x - y', 'p = x * y', 'print(d)', 'print(p)'].join('\n'),
    offsetsText: ['x_offset: 0', 'y_offset: 1', 'd_offset: 2', 'p_offset: 3'].join('\n'),
    lowLevelCode: [
      'mem[x_offset] = 9',
      'mem[y_offset] = 4',
      'mem[d_offset] = mem[x_offset] - mem[y_offset]',
      'mem[p_offset] = mem[x_offset] * mem[y_offset]',
      'print(mem[d_offset])',
      'print(mem[p_offset])',
    ].join('\n'),
    lowToHighMap: [0, 1, 2, 3, 4, 5],
  },
  {
    id: 'reuse-offset-expression',
    label: 'reuse offset expression',
    highLevelCode: ['base = 7', 'next_value = base + 1', 'print(next_value)'].join('\n'),
    offsetsText: ['base_offset: 0', 'next_offset: base_offset + 1'].join('\n'),
    lowLevelCode: [
      'mem[base_offset] = 7',
      'mem[next_offset] = mem[base_offset] + 1',
      'print(mem[next_offset])',
    ].join('\n'),
    lowToHighMap: [0, 1, 2],
  },
  {
    id: 'point-distance',
    label: 'struct: point distance',
    highLevelCode: [
      'p1.x = 3',
      'p1.y = 4',
      'p2.x = 6',
      'p2.y = 8',
      'dx = p2.x - p1.x',
      'dy = p2.y - p1.y',
      'dist_sq = dx*dx + dy*dy',
      'print(dist_sq)',
    ].join('\n'),
    offsetsText: [
      'p1_x: 0',
      'p1_y: 1',
      'p2_x: 2',
      'p2_y: 3',
      'dx: 4',
      'dy: 5',
      'dist_sq: 6',
    ].join('\n'),
    lowLevelCode: [
      'mem[p1_x] = 3',
      'mem[p1_y] = 4',
      'mem[p2_x] = 6',
      'mem[p2_y] = 8',
      'mem[dx] = mem[p2_x] - mem[p1_x]',
      'mem[dy] = mem[p2_y] - mem[p1_y]',
      'mem[dist_sq] = mem[dx] * mem[dx] + mem[dy] * mem[dy]',
      'print(mem[dist_sq])',
    ].join('\n'),
    lowToHighMap: [0, 1, 2, 3, 4, 5, 6, 7],
    structLayout: [
      'Point (2 bytes)',
      '  .x  +0',
      '  .y  +1',
      '',
      'p1  at offset 0',
      'p2  at offset 2',
    ].join('\n'),
  },
]

class ExpressionParser {
  private readonly tokens: Token[]

  private readonly context: ExpressionContext

  private index = 0

  constructor(tokens: Token[], context: ExpressionContext) {
    this.tokens = tokens
    this.context = context
  }

  parse(): number {
    const value = this.parseExpression()
    this.expect('eof')
    return value
  }

  private parseExpression(): number {
    let left = this.parseTerm()

    while (this.isOperator('+') || this.isOperator('-')) {
      const operator = this.consume('operator').value
      const right = this.parseTerm()
      left = operator === '+' ? left + right : left - right
    }

    return left
  }

  private parseTerm(): number {
    let left = this.parseUnary()

    while (
      this.isOperator('*') ||
      this.isOperator('/') ||
      this.isOperator('//') ||
      this.isOperator('%')
    ) {
      const operator = this.consume('operator').value
      const right = this.parseUnary()

      if (operator === '*') {
        left *= right
      } else if (operator === '/') {
        if (right === 0) {
          throw new Error('Division by zero is not allowed.')
        }
        left = Math.trunc(left / right)
      } else if (operator === '//') {
        if (right === 0) {
          throw new Error('Division by zero is not allowed.')
        }
        left = Math.floor(left / right)
      } else {
        if (right === 0) {
          throw new Error('Modulo by zero is not allowed.')
        }
        left %= right
      }
    }

    return left
  }

  private parseUnary(): number {
    if (this.isOperator('-')) {
      this.consume('operator')
      return -this.parseUnary()
    }

    return this.parsePrimary()
  }

  private parsePrimary(): number {
    const token = this.current()

    if (token.kind === 'number') {
      this.consume('number')
      return Number.parseInt(token.value, 10)
    }

    if (token.kind === 'identifier') {
      const identifier = this.consume('identifier').value

      if (identifier === 'mem' && this.match('lbracket')) {
        if (!this.context.allowMemoryAccess) {
          throw new Error('Memory access is not allowed in this expression.')
        }
        const rawIndex = this.parseExpression()
        this.expect('rbracket')
        const offset = asInteger(rawIndex, 'Memory index')
        return this.context.readMemory(offset)
      }

      return this.context.resolveIdentifier(identifier)
    }

    if (this.match('lparen')) {
      const value = this.parseExpression()
      this.expect('rparen')
      return value
    }

    throw new Error(`Unexpected token "${token.value || token.kind}" in expression.`)
  }

  private current(): Token {
    return this.tokens[this.index]
  }

  private isOperator(value: string): boolean {
    const token = this.current()
    return token.kind === 'operator' && token.value === value
  }

  private match(kind: TokenKind): boolean {
    if (this.current().kind !== kind) {
      return false
    }
    this.index += 1
    return true
  }

  private expect(kind: TokenKind): Token {
    const token = this.current()
    if (token.kind !== kind) {
      throw new Error(`Expected ${kind}, received ${token.kind}.`)
    }
    this.index += 1
    return token
  }

  private consume(kind: TokenKind): Token {
    return this.expect(kind)
  }
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      index += 1
      continue
    }

    if (char >= '0' && char <= '9') {
      let end = index + 1
      while (end < source.length && source[end] >= '0' && source[end] <= '9') {
        end += 1
      }
      tokens.push({ kind: 'number', value: source.slice(index, end) })
      index = end
      continue
    }

    if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_') {
      let end = index + 1
      while (end < source.length) {
        const next = source[end]
        const isAlphaNumeric =
          (next >= 'a' && next <= 'z') ||
          (next >= 'A' && next <= 'Z') ||
          (next >= '0' && next <= '9') ||
          next === '_'
        if (!isAlphaNumeric) {
          break
        }
        end += 1
      }
      tokens.push({ kind: 'identifier', value: source.slice(index, end) })
      index = end
      continue
    }

    const nextTwoChars = source.slice(index, index + 2)
    if (nextTwoChars === '//') {
      tokens.push({ kind: 'operator', value: '//' })
      index += 2
      continue
    }

    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '%') {
      tokens.push({ kind: 'operator', value: char })
      index += 1
      continue
    }

    if (char === '(') {
      tokens.push({ kind: 'lparen', value: char })
      index += 1
      continue
    }

    if (char === ')') {
      tokens.push({ kind: 'rparen', value: char })
      index += 1
      continue
    }

    if (char === '[') {
      tokens.push({ kind: 'lbracket', value: char })
      index += 1
      continue
    }

    if (char === ']') {
      tokens.push({ kind: 'rbracket', value: char })
      index += 1
      continue
    }

    throw new Error(`Unsupported character "${char}" in expression.`)
  }

  tokens.push({ kind: 'eof', value: '' })
  return tokens
}

const evaluateExpression = (expression: string, context: ExpressionContext): number => {
  const tokens = tokenize(expression)
  const parser = new ExpressionParser(tokens, context)
  return parser.parse()
}

const asInteger = (value: number, label: string): number => {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer.`)
  }
  return value
}

const normalizeByte = (value: number): number => {
  const truncated = Math.trunc(value)
  return ((truncated % 256) + 256) % 256
}

const splitEditorLines = (text: string): string[] => {
  const normalized = text.replace(/\r/g, '')
  const lines = normalized.split('\n')
  return lines.length > 0 ? lines : ['']
}

const getLineIndexFromCursor = (text: string, cursorPosition: number): number => {
  return text.slice(0, cursorPosition).split('\n').length - 1
}

const getLineStartPosition = (lines: string[], lineIndex: number): number => {
  let total = 0
  for (let index = 0; index < lineIndex; index += 1) {
    total += lines[index].length + 1
  }
  return total
}

const parseOffsetEditorText = (text: string, memorySize: number): ParsedOffsets => {
  const lines = splitEditorLines(text)
  const values: Record<string, number> = {}
  const errors: string[] = []
  const lineToOffset: Array<number | null> = Array(lines.length).fill(null)

  lines.forEach((rawLine, lineIndex) => {
    const trimmed = rawLine.trim()
    if (trimmed.length === 0) {
      return
    }

    const colonIndex = rawLine.indexOf(':')
    if (colonIndex < 0) {
      errors.push(`Line ${lineIndex + 1}: use "name: expression" format.`)
      return
    }

    const name = rawLine.slice(0, colonIndex).trim()
    const expression = rawLine.slice(colonIndex + 1).trim()

    if (!IDENTIFIER_PATTERN.test(name)) {
      errors.push(`Line ${lineIndex + 1}: invalid name "${name}".`)
      return
    }

    if (Object.prototype.hasOwnProperty.call(values, name)) {
      errors.push(`Line ${lineIndex + 1}: duplicate offset name "${name}".`)
      return
    }

    if (expression.length === 0) {
      errors.push(`Line ${lineIndex + 1}: expression is required.`)
      return
    }

    try {
      const value = evaluateExpression(expression, {
        resolveIdentifier: (identifier: string) => {
          if (Object.prototype.hasOwnProperty.call(values, identifier)) {
            return values[identifier]
          }
          throw new Error(`Unknown identifier "${identifier}".`)
        },
        readMemory: () => {
          throw new Error('Memory access is not allowed in offset definitions.')
        },
        allowMemoryAccess: false,
      })

      const numericOffset = asInteger(value, `Line ${lineIndex + 1}`)
      if (numericOffset < 0 || numericOffset >= memorySize) {
        errors.push(
          `Line ${lineIndex + 1}: offset ${numericOffset} is outside memory range 0..${memorySize - 1}.`,
        )
        return
      }

      values[name] = numericOffset
      lineToOffset[lineIndex] = numericOffset
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      errors.push(`Line ${lineIndex + 1}: ${message}`)
    }
  })

  return {
    values,
    errors,
    lineToOffset,
  }
}

const suggestNextOffsetValue = (text: string, targetLine: number, memorySize: number): number => {
  const lines = splitEditorLines(text)
  const previewText = lines.slice(0, targetLine).join('\n')
  const preview = parseOffsetEditorText(previewText, memorySize)
  const resolved = Object.values(preview.values)
  if (resolved.length === 0) {
    return 0
  }
  return Math.max(...resolved) + 1
}

const extractOffsetNames = (line: string, offsetValues: Record<string, number>): string[] => {
  const names: string[] = []
  const seen = new Set<string>()
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_]*/g
  let match: RegExpExecArray | null = tokenPattern.exec(line)

  while (match) {
    const token = match[0]
    if (Object.prototype.hasOwnProperty.call(offsetValues, token) && !seen.has(token)) {
      names.push(token)
      seen.add(token)
    }
    match = tokenPattern.exec(line)
  }

  return names
}

const renderLineWithColors = (
  line: string,
  colorByOffsetName: Map<string, string>,
  lineKey: string,
): React.ReactNode => {
  const tokenPattern = /[A-Za-z_][A-Za-z0-9_]*/g
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let tokenCounter = 0
  let match: RegExpExecArray | null = tokenPattern.exec(line)

  while (match) {
    const token = match[0]
    const tokenStart = match.index

    if (tokenStart > lastIndex) {
      nodes.push(line.slice(lastIndex, tokenStart))
    }

    const color = colorByOffsetName.get(token)
    if (color) {
      nodes.push(
        <span key={`${lineKey}-token-${tokenCounter}`} style={{ color }}>
          {token}
        </span>,
      )
    } else {
      nodes.push(token)
    }

    lastIndex = tokenStart + token.length
    tokenCounter += 1
    match = tokenPattern.exec(line)
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex))
  }

  if (nodes.length === 0) {
    return ' '
  }

  return nodes
}

const findTopLevelAssignment = (line: string): number => {
  let parenDepth = 0
  let bracketDepth = 0

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]

    if (char === '(') {
      parenDepth += 1
      continue
    }
    if (char === ')') {
      parenDepth -= 1
      continue
    }
    if (char === '[') {
      bracketDepth += 1
      continue
    }
    if (char === ']') {
      bracketDepth -= 1
      continue
    }

    const previous = index > 0 ? line[index - 1] : ''
    const next = index < line.length - 1 ? line[index + 1] : ''

    if (char === '=' && parenDepth === 0 && bracketDepth === 0 && previous !== '=' && next !== '=') {
      return index
    }
  }

  return -1
}

const executeInstruction = (
  line: string,
  stepIndex: number,
  snapshot: MachineSnapshot,
  offsetScope: Record<string, number>,
  memorySize: number,
): ExecutionResult => {
  const trimmed = line.trim()
  const readsMap = new Map<number, number>()
  const writes: MemoryWrite[] = []

  const memory = [...snapshot.memory]
  const initialized = [...snapshot.initialized]
  const locals = { ...snapshot.locals }

  const trace: TraceEntry = {
    step: stepIndex + 1,
    instruction: trimmed.length > 0 ? trimmed : '(empty)',
    reads: [],
    writes: [],
    printed: [],
    note: '',
  }

  const readMemory = (offset: number): number => {
    if (offset < 0 || offset >= memorySize) {
      throw new Error(`Memory index out of bounds: mem[${offset}]`)
    }
    if (!initialized[offset]) {
      throw new Error(`Read from uninitialized cell mem[${offset}]`)
    }
    const value = memory[offset]
    if (!readsMap.has(offset)) {
      readsMap.set(offset, value)
    }
    return value
  }

  const resolveIdentifier = (identifier: string): number => {
    if (Object.prototype.hasOwnProperty.call(locals, identifier)) {
      return locals[identifier]
    }
    if (Object.prototype.hasOwnProperty.call(offsetScope, identifier)) {
      return offsetScope[identifier]
    }
    throw new Error(`Unknown symbol "${identifier}".`)
  }

  const evaluateRuntime = (expression: string): number =>
    evaluateExpression(expression, {
      resolveIdentifier,
      readMemory,
      allowMemoryAccess: true,
    })

  try {
    if (trimmed.length === 0 || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      trace.note = 'No operation.'
      return {
        nextSnapshot: snapshot,
        trace,
        succeeded: true,
      }
    }

    const printMatch = trimmed.match(/^print\s*\((.*)\)\s*$/)

    if (printMatch) {
      const printedValue = evaluateRuntime(printMatch[1])
      trace.printed = [String(printedValue)]
      trace.note = 'print'
    } else {
      const assignmentIndex = findTopLevelAssignment(trimmed)
      if (assignmentIndex === -1) {
        throw new Error('Instruction must be an assignment or print(...) statement.')
      }

      const leftHandSide = trimmed.slice(0, assignmentIndex).trim()
      const rightHandSide = trimmed.slice(assignmentIndex + 1).trim()

      if (leftHandSide.length === 0 || rightHandSide.length === 0) {
        throw new Error('Assignment statement is incomplete.')
      }

      if (leftHandSide.startsWith('mem[') && leftHandSide.endsWith(']')) {
        const offsetExpression = leftHandSide.slice(4, -1).trim()
        const computedOffset = asInteger(evaluateRuntime(offsetExpression), 'Memory index')

        if (computedOffset < 0 || computedOffset >= memorySize) {
          throw new Error(`Memory index out of bounds: mem[${computedOffset}]`)
        }

        const rawValue = evaluateRuntime(rightHandSide)
        const nextValue = normalizeByte(rawValue)
        const previousKnown = readsMap.has(computedOffset)
        const previousValue = previousKnown ? readsMap.get(computedOffset) : undefined

        memory[computedOffset] = nextValue
        initialized[computedOffset] = true
        writes.push({
          offset: computedOffset,
          newValue: nextValue,
          previousKnown,
          previousValue,
        })
      } else {
        if (!IDENTIFIER_PATTERN.test(leftHandSide)) {
          throw new Error(`Invalid assignment target "${leftHandSide}".`)
        }

        if (Object.prototype.hasOwnProperty.call(offsetScope, leftHandSide)) {
          throw new Error(`"${leftHandSide}" is a named offset and cannot be reassigned.`)
        }

        const value = Math.trunc(evaluateRuntime(rightHandSide))
        locals[leftHandSide] = value
      }
    }

    trace.reads = [...readsMap.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([offset, value]) => ({ offset, value }))
    trace.writes = [...writes].sort((left, right) => left.offset - right.offset)

    return {
      nextSnapshot: {
        memory,
        initialized,
        locals,
      },
      trace,
      succeeded: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown runtime error.'

    trace.error = message
    trace.note = 'Execution failed.'
    trace.reads = [...readsMap.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([offset, value]) => ({ offset, value }))
    trace.writes = []

    return {
      nextSnapshot: snapshot,
      trace,
      succeeded: false,
    }
  }
}

const pickSelectedOffset = (entry: TraceEntry, currentSelection: number): number => {
  if (entry.writes.length > 0) {
    return entry.writes[0].offset
  }
  if (entry.reads.length > 0) {
    return entry.reads[0].offset
  }
  return currentSelection
}

const formatByteToken = (isInitialized: boolean, value: number): string => {
  if (!isInitialized) {
    return '??'
  }
  return value.toString(16).toUpperCase().padStart(2, '0')
}

const formatAddressToken = (value: number): string => value.toString().padStart(2, '0')

const defaultSnapshot = (size: number): MachineSnapshot => ({
  memory: Array(size).fill(0),
  initialized: Array(size).fill(false),
  locals: {},
})

export const MemoryLayoutSimulator: React.FC = () => {
  const memorySize = DEFAULT_MEMORY_SIZE

  const offsetEditorRef = useRef<HTMLTextAreaElement>(null)
  const lowLevelEditorRef = useRef<HTMLTextAreaElement>(null)
  const lowLevelHighlightRef = useRef<HTMLPreElement>(null)
  const lowLevelLineRef = useRef<HTMLPreElement>(null)

  const [selectedExampleId, setSelectedExampleId] = useState(HIGH_LEVEL_EXAMPLES[0].id)

  const [offsetEditorText, setOffsetEditorText] = useState(HIGH_LEVEL_EXAMPLES[0].offsetsText)
  const [lowLevelEditorText, setLowLevelEditorText] = useState(HIGH_LEVEL_EXAMPLES[0].lowLevelCode)

  const [memory, setMemory] = useState<number[]>(Array(DEFAULT_MEMORY_SIZE).fill(0))
  const [initialized, setInitialized] = useState<boolean[]>(Array(DEFAULT_MEMORY_SIZE).fill(false))
  const [locals, setLocals] = useState<Record<string, number>>({})
  const [programCounter, setProgramCounter] = useState(0)
  const [printedOutput, setPrintedOutput] = useState<string[]>([])
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [selectedOffset, setSelectedOffset] = useState(0)

  const [activeOffsetLine, setActiveOffsetLine] = useState(0)
  const [activeLowLevelLine, setActiveLowLevelLine] = useState(0)
  const [focusedEditor, setFocusedEditor] = useState<'offsets' | 'low-level' | null>(null)

  const selectedExample = useMemo(
    () =>
      HIGH_LEVEL_EXAMPLES.find((example) => example.id === selectedExampleId) || HIGH_LEVEL_EXAMPLES[0],
    [selectedExampleId],
  )

  const highLevelLines = useMemo(
    () => splitEditorLines(selectedExample.highLevelCode),
    [selectedExample.highLevelCode],
  )

  const parsedOffsets = useMemo(
    () => parseOffsetEditorText(offsetEditorText, memorySize),
    [offsetEditorText, memorySize],
  )

  const lowLevelLines = useMemo(
    () => splitEditorLines(lowLevelEditorText),
    [lowLevelEditorText],
  )

  const activeLowLevelText = lowLevelLines[activeLowLevelLine] ?? ''

  const lowLevelOffsetColors = useMemo(() => {
    const names = extractOffsetNames(activeLowLevelText, parsedOffsets.values)
    const colorByOffsetName = new Map<string, string>()
    const colorByCell = new Map<number, string>()

    names.forEach((name, index) => {
      const color = OFFSET_COLOR_PALETTE[index % OFFSET_COLOR_PALETTE.length]
      colorByOffsetName.set(name, color)
      const offset = parsedOffsets.values[name]
      if (offset !== undefined && !colorByCell.has(offset)) {
        colorByCell.set(offset, color)
      }
    })

    return {
      names,
      colorByOffsetName,
      colorByCell,
    }
  }, [activeLowLevelText, parsedOffsets.values])

  const resetExecutionState = (): void => {
    const snapshot = defaultSnapshot(memorySize)
    setMemory(snapshot.memory)
    setInitialized(snapshot.initialized)
    setLocals(snapshot.locals)
    setProgramCounter(0)
    setPrintedOutput([])
    setRuntimeError(null)
  }

  useEffect(() => {
    setOffsetEditorText(selectedExample.offsetsText)
    setLowLevelEditorText(selectedExample.lowLevelCode)
    setActiveOffsetLine(0)
    setActiveLowLevelLine(0)
    setFocusedEditor(null)
    setSelectedOffset(0)
    resetExecutionState()
  }, [selectedExample.id, selectedExample.offsetsText, selectedExample.lowLevelCode])

  const handleOffsetEditorChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const nextText = event.target.value.replace(/\r/g, '')
    const cursor = event.target.selectionStart
    const lineIndex = getLineIndexFromCursor(nextText, cursor)
    const lines = splitEditorLines(nextText)
    const lineText = lines[lineIndex] ?? ''
    const autoFillMatch = lineText.match(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*)$/)

    if (autoFillMatch) {
      const suggested = suggestNextOffsetValue(nextText, lineIndex, memorySize)
      lines[lineIndex] = `${autoFillMatch[1]}${suggested}`
      const patchedText = lines.join('\n')
      setOffsetEditorText(patchedText)
      resetExecutionState()

      const caretPosition = getLineStartPosition(lines, lineIndex) + lines[lineIndex].length
      requestAnimationFrame(() => {
        const editor = offsetEditorRef.current
        if (editor) {
          editor.setSelectionRange(caretPosition, caretPosition)
        }
      })
      return
    }

    setOffsetEditorText(nextText)
    resetExecutionState()
  }

  const handleOffsetCursorActivity = (): void => {
    const editor = offsetEditorRef.current
    if (!editor) {
      return
    }
    setActiveOffsetLine(getLineIndexFromCursor(offsetEditorText, editor.selectionStart))
  }

  const handleLowLevelEditorChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setLowLevelEditorText(event.target.value.replace(/\r/g, ''))
    resetExecutionState()
  }

  const handleLowLevelCursorActivity = (): void => {
    const editor = lowLevelEditorRef.current
    if (!editor) {
      return
    }
    setActiveLowLevelLine(getLineIndexFromCursor(lowLevelEditorText, editor.selectionStart))
  }

  const syncLowLevelEditorScroll = (): void => {
    const editor = lowLevelEditorRef.current
    if (!editor) {
      return
    }

    if (lowLevelHighlightRef.current) {
      lowLevelHighlightRef.current.scrollTop = editor.scrollTop
      lowLevelHighlightRef.current.scrollLeft = editor.scrollLeft
    }

    if (lowLevelLineRef.current) {
      lowLevelLineRef.current.scrollTop = editor.scrollTop
    }
  }

  useEffect(() => {
    if (activeLowLevelLine >= lowLevelLines.length) {
      setActiveLowLevelLine(Math.max(0, lowLevelLines.length - 1))
    }
  }, [activeLowLevelLine, lowLevelLines.length])

  useEffect(() => {
    if (focusedEditor !== 'offsets') {
      return
    }
    const resolved = parsedOffsets.lineToOffset[activeOffsetLine]
    if (resolved !== null && resolved !== undefined) {
      setSelectedOffset(resolved)
    }
  }, [focusedEditor, activeOffsetLine, parsedOffsets.lineToOffset])

  const activeLowLevelNamesKey = lowLevelOffsetColors.names.join('|')
  useEffect(() => {
    if (focusedEditor !== 'low-level') {
      return
    }

    if (lowLevelOffsetColors.names.length === 0) {
      return
    }

    const firstName = lowLevelOffsetColors.names[0]
    const firstOffset = parsedOffsets.values[firstName]
    if (firstOffset !== undefined) {
      setSelectedOffset(firstOffset)
    }
  }, [focusedEditor, activeLowLevelNamesKey, parsedOffsets.values, lowLevelOffsetColors.names])

  useEffect(() => {
    syncLowLevelEditorScroll()
  }, [lowLevelEditorText])

  const executeSingleStep = (): void => {
    if (programCounter >= lowLevelLines.length) {
      return
    }

    if (parsedOffsets.errors.length > 0) {
      setRuntimeError('Fix offset definitions before execution.')
      return
    }

    const snapshot: MachineSnapshot = { memory, initialized, locals }
    const result = executeInstruction(
      lowLevelLines[programCounter] ?? '',
      programCounter,
      snapshot,
      parsedOffsets.values,
      memorySize,
    )

    setSelectedOffset((current) => pickSelectedOffset(result.trace, current))

    if (!result.succeeded) {
      setRuntimeError(result.trace.error || 'Execution failed.')
      return
    }

    if (result.trace.printed.length > 0) {
      setPrintedOutput((current) => [...current, ...result.trace.printed])
    }

    setMemory(result.nextSnapshot.memory)
    setInitialized(result.nextSnapshot.initialized)
    setLocals(result.nextSnapshot.locals)
    setProgramCounter((current) => current + 1)
    setRuntimeError(null)
  }

  const executeAll = (): void => {
    if (programCounter >= lowLevelLines.length) {
      return
    }

    if (parsedOffsets.errors.length > 0) {
      setRuntimeError('Fix offset definitions before execution.')
      return
    }

    let workingSnapshot: MachineSnapshot = {
      memory: [...memory],
      initialized: [...initialized],
      locals: { ...locals },
    }
    let workingCounter = programCounter
    let latestTrace: TraceEntry | null = null
    const producedOutput: string[] = []

    while (workingCounter < lowLevelLines.length) {
      const result = executeInstruction(
        lowLevelLines[workingCounter] ?? '',
        workingCounter,
        workingSnapshot,
        parsedOffsets.values,
        memorySize,
      )

      latestTrace = result.trace
      producedOutput.push(...result.trace.printed)

      if (!result.succeeded) {
        setRuntimeError(result.trace.error || 'Execution failed.')
        break
      }

      workingSnapshot = result.nextSnapshot
      workingCounter += 1
    }

    if (!latestTrace) {
      return
    }

    setSelectedOffset((current) => pickSelectedOffset(latestTrace, current))

    if (producedOutput.length > 0) {
      setPrintedOutput((current) => [...current, ...producedOutput])
    }

    setMemory(workingSnapshot.memory)
    setInitialized(workingSnapshot.initialized)
    setLocals(workingSnapshot.locals)
    setProgramCounter(workingCounter)

    if (workingCounter >= lowLevelLines.length) {
      setRuntimeError(null)
    }
  }

  const isProgramFinished = programCounter >= lowLevelLines.length
  const showLowLevelCellColors = focusedEditor === 'low-level'

  const showLeftPrefixSeparator = selectedOffset !== 0

  const lowProgramLine = isProgramFinished ? -1 : programCounter

  const highProgramLine = useMemo(() => {
    if (isProgramFinished || highLevelLines.length === 0) {
      return -1
    }

    const mapped = selectedExample.lowToHighMap[programCounter]
    if (mapped !== undefined) {
      return Math.max(0, Math.min(highLevelLines.length - 1, mapped))
    }

    if (lowLevelLines.length <= 1) {
      return 0
    }

    const ratio = programCounter / (lowLevelLines.length - 1)
    return Math.max(0, Math.min(highLevelLines.length - 1, Math.round(ratio * (highLevelLines.length - 1))))
  }, [
    isProgramFinished,
    highLevelLines.length,
    selectedExample.lowToHighMap,
    programCounter,
    lowLevelLines.length,
  ])

  return (
    <div className="memory-layout-app">
      <section className="zone memory-zone">
        <div className="memory-zone-header">
          <span className="zone-title">memory</span>
          <div className="memory-console" role="grid" aria-label="Linear memory">
            <div className="memory-row" role="row">
              <span className="row-prefix row-prefix-muted" aria-hidden="true">
                {'  '}
              </span>
              <span className="separator" aria-hidden="true">
                {' '}
              </span>
              {Array.from({ length: MEMORY_COLUMNS }, (_, offset) => (
                <React.Fragment key={`address-${offset}`}>
                  {offset > 0 && (
                    <span className="separator" aria-hidden="true">
                      {' '}
                    </span>
                  )}
                  <span className="memory-token address-token">{formatAddressToken(offset)}</span>
                </React.Fragment>
              ))}
            </div>

            <div className="memory-row" role="row">
              <span className="row-prefix row-prefix-muted">00</span>
              {showLeftPrefixSeparator && (
                <span className="separator" aria-hidden="true">
                  {' '}
                </span>
              )}
              {Array.from({ length: memorySize }, (_, offset) => {
                const isSelected = selectedOffset === offset
                const token = formatByteToken(initialized[offset], memory[offset])
                const tokenDisplay = isSelected ? `[${token}]` : token
                const needsSeparator =
                  offset > 0 && selectedOffset !== offset && selectedOffset !== offset - 1

                const lowLevelColor = showLowLevelCellColors
                  ? lowLevelOffsetColors.colorByCell.get(offset)
                  : undefined

                return (
                  <React.Fragment key={`cell-${offset}`}>
                    {needsSeparator && (
                      <span className="separator" aria-hidden="true">
                        {' '}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`memory-token value-token ${isSelected ? 'is-selected' : ''}`}
                      style={lowLevelColor ? { color: lowLevelColor } : undefined}
                      onClick={() => setSelectedOffset(offset)}
                      aria-label={`Cell ${formatAddressToken(offset)} value ${token}`}
                    >
                      {tokenDisplay}
                    </button>
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        </div>

        <pre className="print-output">
          {printedOutput.length > 0
            ? printedOutput.join('\n')
            : <span className="print-output-empty">(output)</span>}
        </pre>

        <div className="execution-controls">
          <button
            type="button"
            onClick={executeSingleStep}
            disabled={isProgramFinished || parsedOffsets.errors.length > 0}
          >
            step
          </button>
          <button
            type="button"
            onClick={executeAll}
            disabled={isProgramFinished || parsedOffsets.errors.length > 0}
          >
            run all
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              resetExecutionState()
              setSelectedOffset(0)
            }}
          >
            reset
          </button>
          <span className="status-chip">
            {isProgramFinished ? 'finished' : `next instruction: ${programCounter + 1}/${lowLevelLines.length}`}
          </span>
          {runtimeError && <span className="runtime-inline-error">{runtimeError}</span>}
        </div>
      </section>

      <section className="zone offsets-zone">
        <div className="zone-title">offsets</div>
        <div className="offsets-body">
          <div className="offsets-left">
            <p className="panel-hint">name: expression</p>
            <textarea
              ref={offsetEditorRef}
              className="offset-editor"
              value={offsetEditorText}
              onChange={handleOffsetEditorChange}
              onSelect={handleOffsetCursorActivity}
              onClick={handleOffsetCursorActivity}
              onKeyUp={handleOffsetCursorActivity}
              onFocus={() => {
                setFocusedEditor('offsets')
                handleOffsetCursorActivity()
              }}
              onBlur={() => setFocusedEditor(null)}
              spellCheck={false}
            />
            {parsedOffsets.errors.length > 0 && (
              <div className="error-box">
                {parsedOffsets.errors.map((error) => (
                  <div key={error}>{error}</div>
                ))}
              </div>
            )}
          </div>
          {selectedExample.structLayout && (
            <div className="offsets-right">
              <p className="panel-hint">struct layout</p>
              <pre className="struct-layout">{selectedExample.structLayout}</pre>
            </div>
          )}
        </div>
      </section>

      <section className="zone instructions-zone">
        <div className="zone-title">low level instructions</div>

        <div className="code-editor">
          <pre ref={lowLevelLineRef} className="code-line-numbers" aria-hidden="true">
            {lowLevelLines.map((_, index) => (
              <div key={`ln-${index}`}>{index + 1}</div>
            ))}
          </pre>

          <div className="code-surface">
            <pre ref={lowLevelHighlightRef} className="code-highlight" aria-hidden="true">
              {lowLevelLines.map((line, index) => {
                const isCursorLine = index === activeLowLevelLine
                const isProgramLine = index === lowProgramLine

                return (
                  <div
                    key={`hl-${index}`}
                    className={`code-line ${isCursorLine ? 'is-cursor-line' : ''} ${
                      isProgramLine ? 'is-program-line' : ''
                    }`}
                  >
                    {isCursorLine
                      ? renderLineWithColors(line, lowLevelOffsetColors.colorByOffsetName, `low-${index}`)
                      : line || ' '}
                  </div>
                )
              })}
            </pre>

            <textarea
              ref={lowLevelEditorRef}
              className="instruction-editor"
              value={lowLevelEditorText}
              onChange={handleLowLevelEditorChange}
              onSelect={handleLowLevelCursorActivity}
              onClick={handleLowLevelCursorActivity}
              onKeyUp={handleLowLevelCursorActivity}
              onScroll={syncLowLevelEditorScroll}
              onFocus={() => {
                setFocusedEditor('low-level')
                handleLowLevelCursorActivity()
              }}
              onBlur={() => setFocusedEditor(null)}
              spellCheck={false}
            />
          </div>
        </div>
      </section>

      <section className="zone high-level-zone">
        <div className="zone-title">high level code</div>

        <div className="example-select-row">
          <label htmlFor="high-level-example">example</label>
          <select
            id="high-level-example"
            value={selectedExampleId}
            onChange={(event) => setSelectedExampleId(event.target.value)}
          >
            {HIGH_LEVEL_EXAMPLES.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </select>
        </div>

        <div className="readonly-grid">
          <pre className="readonly-line-numbers" aria-hidden="true">
            {highLevelLines.map((_, index) => (
              <div key={`high-ln-${index}`}>{index + 1}</div>
            ))}
          </pre>

          <pre className="readonly-code">
            {highLevelLines.map((line, index) => (
              <div
                key={`high-line-${index}`}
                className={`code-line ${index === highProgramLine ? 'is-program-line' : ''}`}
              >
                {line || ' '}
              </div>
            ))}
          </pre>
        </div>
      </section>
    </div>
  )
}
