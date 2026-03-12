import React, { useMemo, useRef, useState } from 'react'

interface OffsetDefinition {
  id: string
  name: string
  expression: string
}

interface InstructionLine {
  id: string
  code: string
}

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

interface OffsetResolution {
  values: Record<string, number>
  errors: string[]
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
const MIN_MEMORY_SIZE = 4
const MAX_MEMORY_SIZE = 256

const INITIAL_OFFSETS: OffsetDefinition[] = [
  { id: 'offset-1', name: 'a_offset', expression: '0' },
  { id: 'offset-2', name: 'b_offset', expression: '1' },
  { id: 'offset-3', name: 'c_offset', expression: 'a_offset + 3' },
]

const INITIAL_INSTRUCTIONS: InstructionLine[] = [
  { id: 'instruction-1', code: 'mem[a_offset] = 2' },
  { id: 'instruction-2', code: 'mem[b_offset] = 3' },
  { id: 'instruction-3', code: 'mem[c_offset] = mem[a_offset] + mem[b_offset]' },
  { id: 'instruction-4', code: 'print(mem[c_offset])' },
]

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

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

    while (this.isOperator('*') || this.isOperator('/') || this.isOperator('//') || this.isOperator('%')) {
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

const isIdentifier = (value: string): boolean => IDENTIFIER_PATTERN.test(value)

const resolveOffsets = (offsets: OffsetDefinition[], memorySize: number): OffsetResolution => {
  const values: Record<string, number> = {}
  const errors: string[] = []

  offsets.forEach((offset, index) => {
    const name = offset.name.trim()
    const expression = offset.expression.trim()

    if (name.length === 0) {
      errors.push(`Offset #${index + 1}: name is required.`)
      return
    }

    if (!isIdentifier(name)) {
      errors.push(`Offset "${name}": invalid name.`)
      return
    }

    if (Object.prototype.hasOwnProperty.call(values, name)) {
      errors.push(`Offset "${name}": duplicate name.`)
      return
    }

    if (expression.length === 0) {
      errors.push(`Offset "${name}": expression is required.`)
      return
    }

    try {
      const value = evaluateExpression(expression, {
        resolveIdentifier: (identifier: string) => {
          if (Object.prototype.hasOwnProperty.call(values, identifier)) {
            return values[identifier]
          }
          throw new Error(`Unknown identifier "${identifier}" in offset expression.`)
        },
        readMemory: () => {
          throw new Error('Memory reads are not allowed in named offset expressions.')
        },
        allowMemoryAccess: false,
      })

      const numericOffset = asInteger(value, `Offset "${name}"`)
      if (numericOffset < 0 || numericOffset >= memorySize) {
        errors.push(`Offset "${name}": ${numericOffset} is outside memory range 0..${memorySize - 1}.`)
        return
      }

      values[name] = numericOffset
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      errors.push(`Offset "${name}": ${message}`)
    }
  })

  return { values, errors }
}

interface ExecutionResult {
  nextSnapshot: MachineSnapshot
  trace: TraceEntry
  printed: string[]
  succeeded: boolean
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

        const truncatedRawValue = Math.trunc(rawValue)
        const wrapSuffix =
          truncatedRawValue !== nextValue
            ? ` (wrapped ${truncatedRawValue} -> ${nextValue})`
            : ''

        trace.note = previousKnown
          ? `write mem[${computedOffset}] = ${nextValue}; previous value known from explicit read${wrapSuffix}`
          : `write mem[${computedOffset}] = ${nextValue}; previous value unknown to this instruction${wrapSuffix}`
      } else {
        if (!isIdentifier(leftHandSide)) {
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

const formatReadSummary = (reads: MemoryRead[]): string => {
  if (reads.length === 0) {
    return 'none'
  }
  return reads.map((read) => `mem[${read.offset}] = ${read.value}`).join(', ')
}

const formatWriteSummary = (writes: MemoryWrite[]): string => {
  if (writes.length === 0) {
    return 'none'
  }
  return writes
    .map((write) => {
      const previous = write.previousKnown ? String(write.previousValue) : 'unknown'
      return `mem[${write.offset}] = ${write.newValue} (prev ${previous})`
    })
    .join(', ')
}

const formatLocalsSummary = (locals: Record<string, number>): string => {
  const entries = Object.entries(locals)
  if (entries.length === 0) {
    return 'none'
  }
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}=${value}`)
    .join(', ')
}

const defaultSnapshot = (size: number): MachineSnapshot => ({
  memory: Array(size).fill(0),
  initialized: Array(size).fill(false),
  locals: {},
})

export const MemoryLayoutSimulator: React.FC = () => {
  const idCounter = useRef(100)

  const [memorySize, setMemorySize] = useState(DEFAULT_MEMORY_SIZE)
  const [memorySizeInput, setMemorySizeInput] = useState(String(DEFAULT_MEMORY_SIZE))

  const [offsets, setOffsets] = useState<OffsetDefinition[]>(INITIAL_OFFSETS)
  const [instructions, setInstructions] = useState<InstructionLine[]>(INITIAL_INSTRUCTIONS)

  const [memory, setMemory] = useState<number[]>(Array(DEFAULT_MEMORY_SIZE).fill(0))
  const [initialized, setInitialized] = useState<boolean[]>(Array(DEFAULT_MEMORY_SIZE).fill(false))
  const [locals, setLocals] = useState<Record<string, number>>({})
  const [programCounter, setProgramCounter] = useState(0)
  const [trace, setTrace] = useState<TraceEntry[]>([])
  const [printedOutput, setPrintedOutput] = useState<string[]>([])
  const [lastStep, setLastStep] = useState<TraceEntry | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  const offsetResolution = useMemo(() => resolveOffsets(offsets, memorySize), [offsets, memorySize])

  const ownersByOffset = useMemo(() => {
    const ownerMap: Record<number, string[]> = {}
    offsets.forEach((offset) => {
      const name = offset.name.trim()
      const value = offsetResolution.values[name]
      if (name.length === 0 || value === undefined) {
        return
      }
      if (!ownerMap[value]) {
        ownerMap[value] = []
      }
      ownerMap[value].push(name)
    })
    return ownerMap
  }, [offsets, offsetResolution.values])

  const readLookup = useMemo(() => {
    const lookup = new Map<number, number>()
    if (lastStep) {
      lastStep.reads.forEach((read) => {
        lookup.set(read.offset, read.value)
      })
    }
    return lookup
  }, [lastStep])

  const writeLookup = useMemo(() => {
    const lookup = new Map<number, MemoryWrite>()
    if (lastStep) {
      lastStep.writes.forEach((write) => {
        lookup.set(write.offset, write)
      })
    }
    return lookup
  }, [lastStep])

  const nextId = (prefix: string): string => {
    idCounter.current += 1
    return `${prefix}-${idCounter.current}`
  }

  const resetExecutionState = (size: number = memorySize): void => {
    const snapshot = defaultSnapshot(size)
    setMemory(snapshot.memory)
    setInitialized(snapshot.initialized)
    setLocals(snapshot.locals)
    setProgramCounter(0)
    setTrace([])
    setPrintedOutput([])
    setLastStep(null)
    setRuntimeError(null)
  }

  const applyMemorySize = (): void => {
    const parsed = Number.parseInt(memorySizeInput, 10)
    if (Number.isNaN(parsed) || parsed < MIN_MEMORY_SIZE || parsed > MAX_MEMORY_SIZE) {
      setRuntimeError(`Memory size must be between ${MIN_MEMORY_SIZE} and ${MAX_MEMORY_SIZE}.`)
      return
    }

    setMemorySize(parsed)
    setMemorySizeInput(String(parsed))
    resetExecutionState(parsed)
  }

  const updateOffset = (id: string, patch: Partial<OffsetDefinition>): void => {
    setOffsets((current) =>
      current.map((offset) => (offset.id === id ? { ...offset, ...patch } : offset)),
    )
    resetExecutionState()
  }

  const addOffset = (): void => {
    setOffsets((current) => [
      ...current,
      {
        id: nextId('offset'),
        name: `offset_${current.length + 1}`,
        expression: '0',
      },
    ])
    resetExecutionState()
  }

  const removeOffset = (id: string): void => {
    setOffsets((current) => {
      if (current.length <= 1) {
        return current
      }
      return current.filter((offset) => offset.id !== id)
    })
    resetExecutionState()
  }

  const updateInstruction = (id: string, code: string): void => {
    setInstructions((current) =>
      current.map((instruction) => (instruction.id === id ? { ...instruction, code } : instruction)),
    )
    resetExecutionState()
  }

  const addInstruction = (): void => {
    setInstructions((current) => [
      ...current,
      {
        id: nextId('instruction'),
        code: '',
      },
    ])
    resetExecutionState()
  }

  const removeInstruction = (id: string): void => {
    setInstructions((current) => {
      if (current.length <= 1) {
        return current
      }
      return current.filter((instruction) => instruction.id !== id)
    })
    resetExecutionState()
  }

  const executeSingleStep = (): void => {
    if (programCounter >= instructions.length) {
      return
    }

    if (offsetResolution.errors.length > 0) {
      setRuntimeError('Named offsets must be fixed before execution.')
      return
    }

    const snapshot: MachineSnapshot = { memory, initialized, locals }
    const result = executeInstruction(
      instructions[programCounter].code,
      programCounter,
      snapshot,
      offsetResolution.values,
      memorySize,
    )

    setTrace((current) => [...current, result.trace])
    setLastStep(result.trace)

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
    if (programCounter >= instructions.length) {
      return
    }

    if (offsetResolution.errors.length > 0) {
      setRuntimeError('Named offsets must be fixed before execution.')
      return
    }

    let workingSnapshot: MachineSnapshot = {
      memory: [...memory],
      initialized: [...initialized],
      locals: { ...locals },
    }
    let workingCounter = programCounter

    const producedTrace: TraceEntry[] = []
    const producedOutput: string[] = []

    while (workingCounter < instructions.length) {
      const result = executeInstruction(
        instructions[workingCounter].code,
        workingCounter,
        workingSnapshot,
        offsetResolution.values,
        memorySize,
      )

      producedTrace.push(result.trace)
      producedOutput.push(...result.printed)

      if (!result.succeeded) {
        setRuntimeError(result.trace.error || 'Execution failed.')
        break
      }

      workingSnapshot = result.nextSnapshot
      workingCounter += 1
    }

    if (producedTrace.length === 0) {
      return
    }

    setTrace((current) => [...current, ...producedTrace])
    setLastStep(producedTrace[producedTrace.length - 1])

    if (producedOutput.length > 0) {
      setPrintedOutput((current) => [...current, ...producedOutput])
    }

    setMemory(workingSnapshot.memory)
    setInitialized(workingSnapshot.initialized)
    setLocals(workingSnapshot.locals)
    setProgramCounter(workingCounter)

    if (workingCounter >= instructions.length) {
      setRuntimeError(null)
    }
  }

  const isProgramFinished = programCounter >= instructions.length

  return (
    <div className="memory-layout-app">
      <header className="hero">
        <div>
          <h1>Memory Layout Lab</h1>
          <p>
            Build and execute instruction sequences over linear memory. Each instruction only sees
            cells it explicitly reads.
          </p>
        </div>

        <div className="hero-controls">
          <label htmlFor="memory-size-input" className="control-label">
            Memory cells
          </label>
          <input
            id="memory-size-input"
            className="number-input"
            type="number"
            min={MIN_MEMORY_SIZE}
            max={MAX_MEMORY_SIZE}
            value={memorySizeInput}
            onChange={(event) => setMemorySizeInput(event.target.value)}
          />
          <button type="button" onClick={applyMemorySize}>
            Apply size
          </button>
          <button type="button" className="secondary" onClick={() => resetExecutionState()}>
            Reset state
          </button>
        </div>
      </header>

      <section className="memory-stage">
        <div className="section-head">
          <h2>Linear Memory</h2>
          <p>
            <span className="pill read-pill">Read</span>
            <span className="pill write-pill">Write</span>
            <span className="pill neutral-pill">Unknown to current instruction: ??</span>
          </p>
        </div>

        <div className="memory-grid">
          {Array.from({ length: memorySize }, (_, offset) => {
            const read = readLookup.get(offset)
            const write = writeLookup.get(offset)
            const ownerNames = ownersByOffset[offset]
            const stateValue = initialized[offset] ? String(memory[offset]) : '--'
            const instructionValue =
              read !== undefined ? String(read) : write ? String(write.newValue) : '??'

            return (
              <article
                key={`cell-${offset}`}
                className={`memory-cell ${read !== undefined ? 'is-read' : ''} ${
                  write ? 'is-write' : ''
                }`}
              >
                <div className="cell-head">
                  <span className="cell-index">[{offset}]</span>
                  <span className="cell-owner">{ownerNames ? ownerNames.join(', ') : 'free'}</span>
                </div>

                <div className="cell-values">
                  <div>
                    <span className="value-label">State</span>
                    <strong>{stateValue}</strong>
                  </div>
                  <div>
                    <span className="value-label">Instr</span>
                    <strong>{instructionValue}</strong>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="workbench">
        <article className="panel offsets-panel">
          <div className="panel-head">
            <h3>Named Offsets</h3>
            <button type="button" onClick={addOffset}>
              Add offset
            </button>
          </div>

          <p className="panel-hint">
            Use integer expressions with previously declared names, for example:
            <code>b_offset + 2</code>.
          </p>

          <div className="offset-list">
            {offsets.map((offset, index) => {
              const resolved = offsetResolution.values[offset.name.trim()]
              return (
                <div className="offset-row" key={offset.id}>
                  <span className="row-index">{index + 1}</span>
                  <input
                    type="text"
                    value={offset.name}
                    onChange={(event) => updateOffset(offset.id, { name: event.target.value })}
                    placeholder="name"
                  />
                  <span className="equals">=</span>
                  <input
                    type="text"
                    value={offset.expression}
                    onChange={(event) =>
                      updateOffset(offset.id, { expression: event.target.value })
                    }
                    placeholder="expression"
                  />
                  <span className="resolved-value">
                    {resolved === undefined ? 'unresolved' : `@${resolved}`}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => removeOffset(offset.id)}
                    disabled={offsets.length <= 1}
                  >
                    Delete
                  </button>
                </div>
              )
            })}
          </div>

          {offsetResolution.errors.length > 0 && (
            <div className="error-box">
              {offsetResolution.errors.map((error) => (
                <div key={error}>{error}</div>
              ))}
            </div>
          )}
        </article>

        <article className="panel instructions-panel">
          <div className="panel-head">
            <h3>Instructions</h3>
            <button type="button" onClick={addInstruction}>
              Add instruction
            </button>
          </div>

          <p className="panel-hint">
            Supported statements: <code>mem[...] = expr</code>, <code>name = expr</code>, and
            <code>print(expr)</code>.
          </p>

          <div className="execution-controls">
            <button
              type="button"
              onClick={executeSingleStep}
              disabled={isProgramFinished || offsetResolution.errors.length > 0}
            >
              Step
            </button>
            <button
              type="button"
              onClick={executeAll}
              disabled={isProgramFinished || offsetResolution.errors.length > 0}
            >
              Run all
            </button>
            <button type="button" className="secondary" onClick={() => resetExecutionState()}>
              Reset
            </button>
            <span className="status-chip">
              {isProgramFinished
                ? 'Program finished'
                : `Next instruction: ${programCounter + 1}/${instructions.length}`}
            </span>
          </div>

          <div className="instruction-list">
            {instructions.map((instruction, index) => (
              <div
                className={`instruction-row ${index === programCounter ? 'is-active' : ''}`}
                key={instruction.id}
              >
                <span className="row-index">{index + 1}</span>
                <input
                  type="text"
                  value={instruction.code}
                  onChange={(event) => updateInstruction(instruction.id, event.target.value)}
                  placeholder="mem[a_offset] = 1"
                />
                <button
                  type="button"
                  className="danger"
                  onClick={() => removeInstruction(instruction.id)}
                  disabled={instructions.length <= 1}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>

          {runtimeError && <div className="error-box runtime-error">{runtimeError}</div>}

          <div className="runtime-grid">
            <section className="runtime-box">
              <h4>print() output</h4>
              <pre>{printedOutput.length > 0 ? printedOutput.join('\n') : '(no output yet)'}</pre>
            </section>

            <section className="runtime-box">
              <h4>Local values</h4>
              <pre>{formatLocalsSummary(locals)}</pre>
            </section>
          </div>

          <section className="trace-panel">
            <h4>Execution Trace</h4>
            <div className="trace-list">
              {trace.length === 0 && <div className="empty-trace">Run Step to populate trace.</div>}
              {trace.map((entry, index) => (
                <article
                  className={`trace-item ${entry.error ? 'is-error' : ''}`}
                  key={`trace-${entry.step}-${index}`}
                >
                  <div className="trace-title">
                    <strong>Step {entry.step}</strong>
                    <code>{entry.instruction}</code>
                  </div>
                  <div>Reads: {formatReadSummary(entry.reads)}</div>
                  <div>Writes: {formatWriteSummary(entry.writes)}</div>
                  <div>Print: {entry.printed.length > 0 ? entry.printed.join(', ') : 'none'}</div>
                  <div>Note: {entry.error ? entry.error : entry.note}</div>
                </article>
              ))}
            </div>
          </section>
        </article>
      </section>
    </div>
  )
}
