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

interface ParsedOffsets {
  values: Record<string, number>
  errors: string[]
  lineToOffset: Array<number | null>
}

interface ExecutionResult {
  nextSnapshot: MachineSnapshot
  trace: TraceEntry
  printed: string[]
  succeeded: boolean
}

const DEFAULT_MEMORY_SIZE = 16
const MEMORY_COLUMNS = 16

const INITIAL_OFFSETS_TEXT = ['a_offset: 0', 'b_offset: 1', 'c_offset: a_offset + 3'].join('\n')

const INITIAL_INSTRUCTIONS_TEXT = [
  'mem[a_offset] = 2',
  'mem[b_offset] = 3',
  'mem[c_offset] = mem[a_offset] + mem[b_offset]',
  'print(mem[c_offset])',
].join('\n')

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const OFFSET_COLOR_PALETTE = ['#d9480f', '#1c7ed6', '#2b8a3e', '#c92a2a', '#5f3dc4', '#0b7285']

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

const renderInstructionLineWithColors = (
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
  const printed: string[] = []

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
        printed,
        succeeded: true,
      }
    }

    const printMatch = trimmed.match(/^print\s*\((.*)\)\s*$/)

    if (printMatch) {
      const printedValue = evaluateRuntime(printMatch[1])
      printed.push(String(printedValue))
      trace.note = `print -> ${printedValue}`
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

        trace.note = previousKnown
          ? `write mem[${computedOffset}] = ${nextValue}; previous value known from explicit read`
          : `write mem[${computedOffset}] = ${nextValue}; previous value unknown to this instruction`
      } else {
        if (!IDENTIFIER_PATTERN.test(leftHandSide)) {
          throw new Error(`Invalid assignment target "${leftHandSide}".`)
        }

        if (Object.prototype.hasOwnProperty.call(offsetScope, leftHandSide)) {
          throw new Error(`"${leftHandSide}" is a named offset and cannot be reassigned.`)
        }

        const value = Math.trunc(evaluateRuntime(rightHandSide))
        locals[leftHandSide] = value
        trace.note = `set ${leftHandSide} = ${value}`
      }
    }

    trace.reads = [...readsMap.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([offset, value]) => ({ offset, value }))
    trace.writes = [...writes].sort((left, right) => left.offset - right.offset)
    trace.printed = [...printed]

    return {
      nextSnapshot: {
        memory,
        initialized,
        locals,
      },
      trace,
      printed,
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
    trace.printed = []

    return {
      nextSnapshot: snapshot,
      trace,
      printed: [],
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
  const instructionEditorRef = useRef<HTMLTextAreaElement>(null)
  const instructionHighlightRef = useRef<HTMLPreElement>(null)
  const instructionLineRef = useRef<HTMLPreElement>(null)

  const [offsetEditorText, setOffsetEditorText] = useState(INITIAL_OFFSETS_TEXT)
  const [instructionEditorText, setInstructionEditorText] = useState(INITIAL_INSTRUCTIONS_TEXT)

  const [memory, setMemory] = useState<number[]>(Array(DEFAULT_MEMORY_SIZE).fill(0))
  const [initialized, setInitialized] = useState<boolean[]>(Array(DEFAULT_MEMORY_SIZE).fill(false))
  const [locals, setLocals] = useState<Record<string, number>>({})
  const [programCounter, setProgramCounter] = useState(0)
  const [printedOutput, setPrintedOutput] = useState<string[]>([])
  const [lastStep, setLastStep] = useState<TraceEntry | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [selectedOffset, setSelectedOffset] = useState(0)

  const [activeOffsetLine, setActiveOffsetLine] = useState(0)
  const [activeInstructionLine, setActiveInstructionLine] = useState(0)
  const [focusedEditor, setFocusedEditor] = useState<'offsets' | 'instructions' | null>(null)

  const parsedOffsets = useMemo(
    () => parseOffsetEditorText(offsetEditorText, memorySize),
    [offsetEditorText, memorySize],
  )

  const instructionLines = useMemo(
    () => splitEditorLines(instructionEditorText),
    [instructionEditorText],
  )

  const activeInstructionText = instructionLines[activeInstructionLine] ?? ''

  const instructionOffsetColors = useMemo(() => {
    const names = extractOffsetNames(activeInstructionText, parsedOffsets.values)
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
  }, [activeInstructionText, parsedOffsets.values])

  const resetExecutionState = (): void => {
    const snapshot = defaultSnapshot(memorySize)
    setMemory(snapshot.memory)
    setInitialized(snapshot.initialized)
    setLocals(snapshot.locals)
    setProgramCounter(0)
    setPrintedOutput([])
    setLastStep(null)
    setRuntimeError(null)
  }

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

  const handleInstructionEditorChange = (event: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInstructionEditorText(event.target.value.replace(/\r/g, ''))
    resetExecutionState()
  }

  const handleInstructionCursorActivity = (): void => {
    const editor = instructionEditorRef.current
    if (!editor) {
      return
    }
    setActiveInstructionLine(getLineIndexFromCursor(instructionEditorText, editor.selectionStart))
  }

  const syncInstructionEditorScroll = (): void => {
    const editor = instructionEditorRef.current
    if (!editor) {
      return
    }

    if (instructionHighlightRef.current) {
      instructionHighlightRef.current.scrollTop = editor.scrollTop
      instructionHighlightRef.current.scrollLeft = editor.scrollLeft
    }

    if (instructionLineRef.current) {
      instructionLineRef.current.scrollTop = editor.scrollTop
    }
  }

  useEffect(() => {
    if (activeInstructionLine >= instructionLines.length) {
      setActiveInstructionLine(Math.max(0, instructionLines.length - 1))
    }
  }, [activeInstructionLine, instructionLines.length])

  useEffect(() => {
    if (focusedEditor !== 'offsets') {
      return
    }
    const resolved = parsedOffsets.lineToOffset[activeOffsetLine]
    if (resolved !== null && resolved !== undefined) {
      setSelectedOffset(resolved)
    }
  }, [focusedEditor, activeOffsetLine, parsedOffsets.lineToOffset])

  const activeInstructionNamesKey = instructionOffsetColors.names.join('|')
  useEffect(() => {
    if (focusedEditor !== 'instructions') {
      return
    }

    if (instructionOffsetColors.names.length === 0) {
      return
    }

    const firstName = instructionOffsetColors.names[0]
    const firstOffset = parsedOffsets.values[firstName]
    if (firstOffset !== undefined) {
      setSelectedOffset(firstOffset)
    }
  }, [focusedEditor, activeInstructionNamesKey, parsedOffsets.values, instructionOffsetColors.names])

  useEffect(() => {
    syncInstructionEditorScroll()
  }, [instructionEditorText])

  const executeSingleStep = (): void => {
    if (programCounter >= instructionLines.length) {
      return
    }

    if (parsedOffsets.errors.length > 0) {
      setRuntimeError('Fix offset definitions before execution.')
      return
    }

    const snapshot: MachineSnapshot = { memory, initialized, locals }
    const result = executeInstruction(
      instructionLines[programCounter] ?? '',
      programCounter,
      snapshot,
      parsedOffsets.values,
      memorySize,
    )

    setLastStep(result.trace)
    setSelectedOffset((current) => pickSelectedOffset(result.trace, current))

    if (result.printed.length > 0) {
      setPrintedOutput((current) => [...current, ...result.printed])
    }

    if (!result.succeeded) {
      setRuntimeError(result.trace.error || 'Execution failed.')
      return
    }

    setMemory(result.nextSnapshot.memory)
    setInitialized(result.nextSnapshot.initialized)
    setLocals(result.nextSnapshot.locals)
    setProgramCounter((current) => current + 1)
    setRuntimeError(null)
  }

  const executeAll = (): void => {
    if (programCounter >= instructionLines.length) {
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

    while (workingCounter < instructionLines.length) {
      const result = executeInstruction(
        instructionLines[workingCounter] ?? '',
        workingCounter,
        workingSnapshot,
        parsedOffsets.values,
        memorySize,
      )

      latestTrace = result.trace
      producedOutput.push(...result.printed)

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

    setLastStep(latestTrace)
    setSelectedOffset((current) => pickSelectedOffset(latestTrace, current))

    if (producedOutput.length > 0) {
      setPrintedOutput((current) => [...current, ...producedOutput])
    }

    setMemory(workingSnapshot.memory)
    setInitialized(workingSnapshot.initialized)
    setLocals(workingSnapshot.locals)
    setProgramCounter(workingCounter)

    if (workingCounter >= instructionLines.length) {
      setRuntimeError(null)
    }
  }

  const isProgramFinished = programCounter >= instructionLines.length
  const showInstructionCellColors = focusedEditor === 'instructions'

  return (
    <div className="memory-layout-app">
      <header className="memory-header">
        <h1>Memory Layout Trainer</h1>
        <p>type offsets, type commands, step through memory</p>
      </header>

      <section className="memory-stage">
        <div className="memory-stage-head">
          <h2>memory</h2>
          <span>[??] = selected cell</span>
        </div>

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
            <span className="separator" aria-hidden="true">
              {' '}
            </span>
            {Array.from({ length: memorySize }, (_, offset) => {
              const isSelected = selectedOffset === offset
              const token = formatByteToken(initialized[offset], memory[offset])
              const tokenDisplay = isSelected ? `[${token}]` : token
              const needsSeparator =
                offset > 0 && selectedOffset !== offset && selectedOffset !== offset - 1

              const instructionColor = showInstructionCellColors
                ? instructionOffsetColors.colorByCell.get(offset)
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
                    style={instructionColor ? { color: instructionColor } : undefined}
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
      </section>

      <section className="workbench">
        <article className="panel offsets-panel">
          <div className="panel-head">
            <h3>offsets</h3>
          </div>

          <p className="panel-hint">format: name: expression</p>

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
        </article>

        <article className="panel instructions-panel">
          <div className="panel-head">
            <h3>instructions</h3>
          </div>

          <p className="panel-hint">supports mem[...] = expr, name = expr, print(expr)</p>

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
              {isProgramFinished
                ? 'program finished'
                : `next line: ${programCounter + 1}/${instructionLines.length}`}
            </span>
          </div>

          <div className="instructions-editor">
            <pre ref={instructionLineRef} className="instruction-line-numbers" aria-hidden="true">
              {instructionLines.map((_, index) => (
                <div key={`ln-${index}`}>{index + 1}</div>
              ))}
            </pre>

            <div className="instruction-editor-surface">
              <pre ref={instructionHighlightRef} className="instruction-highlight" aria-hidden="true">
                {instructionLines.map((line, index) => (
                  <div
                    key={`hl-${index}`}
                    className={`instruction-highlight-line ${
                      index === activeInstructionLine ? 'is-active-line' : ''
                    }`}
                  >
                    {index === activeInstructionLine
                      ? renderInstructionLineWithColors(
                          line,
                          instructionOffsetColors.colorByOffsetName,
                          `line-${index}`,
                        )
                      : line || ' '}
                  </div>
                ))}
              </pre>

              <textarea
                ref={instructionEditorRef}
                className="instruction-editor"
                value={instructionEditorText}
                onChange={handleInstructionEditorChange}
                onSelect={handleInstructionCursorActivity}
                onClick={handleInstructionCursorActivity}
                onKeyUp={handleInstructionCursorActivity}
                onScroll={syncInstructionEditorScroll}
                onFocus={() => {
                  setFocusedEditor('instructions')
                  handleInstructionCursorActivity()
                }}
                onBlur={() => setFocusedEditor(null)}
                spellCheck={false}
              />
            </div>
          </div>

          {runtimeError && <div className="error-box">{runtimeError}</div>}

          <section className="runtime-box">
            <h4>print output</h4>
            <pre>{printedOutput.length > 0 ? printedOutput.join('\n') : '(no output yet)'}</pre>
            <h4>locals</h4>
            <pre>
              {Object.keys(locals).length === 0
                ? '(none)'
                : Object.entries(locals)
                    .map(([name, value]) => `${name}=${value}`)
                    .join(', ')}
            </pre>
            {lastStep && (
              <h4>
                last line: <span>{lastStep.step}</span>
              </h4>
            )}
          </section>
        </article>
      </section>
    </div>
  )
}
