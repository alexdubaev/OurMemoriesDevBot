const MIN = -9_223_372_036_854_775_808n
const MAX = 9_223_372_036_854_775_807n

/** Provider failures are classified at the application boundary without depending on the adapter. */
export class MaxChannelProviderError extends Error {
  constructor(readonly status: number | null, message = 'MAX channel verification failed') { super(message) }
  get permanentAccessLoss() { return this.status === 400 || this.status === 403 || this.status === 404 }
}

/** Reads a unique root-level JSON integer without passing through JavaScript's lossy number parser. */
export function readMaxRootInt64(raw: string, key: string): bigint | null {
  let index = 0
  let found: bigint | null = null
  const whitespace = () => { while (/\s/.test(raw[index] ?? '')) index += 1 }
  const stringEnd = (start: number) => {
    let cursor = start + 1
    while (cursor < raw.length) {
      if (raw[cursor] === '\\') cursor += 2
      else if (raw[cursor++] === '"') return cursor
    }
    return -1
  }
  const skipValue = () => {
    if (raw[index] === '"') { const end = stringEnd(index); if (end < 0) return false; index = end; return true }
    if (raw[index] === '{' || raw[index] === '[') {
      const stack = [raw[index++] === '{' ? '}' : ']']
      while (index < raw.length && stack.length) {
        if (raw[index] === '"') { const end = stringEnd(index); if (end < 0) return false; index = end }
        else if (raw[index] === '{' || raw[index] === '[') stack.push(raw[index++] === '{' ? '}' : ']')
        else if (raw[index] === '}' || raw[index] === ']') { if (raw[index++] !== stack.pop()) return false }
        else index += 1
      }
      return stack.length === 0
    }
    while (index < raw.length && raw[index] !== ',' && raw[index] !== '}') index += 1
    return true
  }
  whitespace()
  if (raw[index++] !== '{') return null
  while (index < raw.length) {
    whitespace()
    if (raw[index] === '}') return found
    if (raw[index] !== '"') return null
    const end = stringEnd(index)
    if (end < 0) return null
    let current: unknown
    try { current = JSON.parse(raw.slice(index, end)) } catch { return null }
    index = end
    whitespace()
    if (raw[index++] !== ':') return null
    whitespace()
    if (current === key) {
      if (found !== null) return null
      const match = /^-?(?:0|[1-9][0-9]*)/.exec(raw.slice(index))
      if (!match) return null
      index += match[0].length
      whitespace()
      if (raw[index] !== ',' && raw[index] !== '}') return null
      const value = BigInt(match[0])
      if (value < MIN || value > MAX) return null
      found = value
      if (raw[index] === ',') { index += 1; continue }
      if (raw[index] === '}') return found
      return null
    }
    if (!skipValue()) return null
    whitespace()
    if (raw[index] === ',') index += 1
    else if (raw[index] !== '}') return null
  }
  return null
}

/** Reads a unique signed int64 from an exact JSON path without converting it through Number. */
export function readMaxInt64AtPath(raw: string, path: readonly (string | number)[], allowString = false): bigint | null {
  const token = readRawTokenAtPath(raw, path)
  if (token === null) return null
  let text: string
  if (token.startsWith('"')) {
    if (!allowString) return null
    try {
      const value: unknown = JSON.parse(token)
      if (typeof value !== 'string') return null
      text = value
    } catch { return null }
  } else text = token
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(text)) return null
  try {
    const value = BigInt(text)
    return value >= MIN && value <= MAX ? value : null
  } catch { return null }
}

/** Reads a unique JSON string at an exact path; duplicate keys on the path fail closed. */
export function readMaxStringAtPath(raw: string, path: readonly (string | number)[]): string | null {
  const token = readRawTokenAtPath(raw, path)
  if (token === null || !token.startsWith('"')) return null
  try {
    const value: unknown = JSON.parse(token)
    return typeof value === 'string' ? value : null
  } catch { return null }
}

function readRawTokenAtPath(raw: string, path: readonly (string | number)[]): string | null {
  if (path.length === 0) return null
  const skipSpace = (at: number) => { while (/\s/.test(raw[at] ?? '')) at += 1; return at }
  const stringEnd = (start: number): number => {
    for (let at = start + 1; at < raw.length; at += 1) {
      if (raw[at] === '\\') at += 1
      else if (raw[at] === '"') return at + 1
    }
    return -1
  }
  const valueEnd = (start: number): number => {
    const first = raw[start]
    if (first === '"') return stringEnd(start)
    if (first !== '{' && first !== '[') {
      let at = start
      while (at < raw.length && raw[at] !== ',' && raw[at] !== '}' && raw[at] !== ']') at += 1
      return at
    }
    const stack = [first === '{' ? '}' : ']']
    for (let at = start + 1; at < raw.length; at += 1) {
      if (raw[at] === '"') {
        const end = stringEnd(at)
        if (end < 0) return -1
        at = end - 1
      } else if (raw[at] === '{') stack.push('}')
      else if (raw[at] === '[') stack.push(']')
      else if (raw[at] === '}' || raw[at] === ']') {
        if (raw[at] !== stack.pop()) return -1
        if (stack.length === 0) return at + 1
      }
    }
    return -1
  }
  const visit = (start: number, depth: number): string | null => {
    start = skipSpace(start)
    const key = path[depth]
    if (typeof key === 'string') {
      if (raw[start] !== '{') return null
      let at = start + 1
      let match: string | null = null
      while (at < raw.length) {
        at = skipSpace(at)
        if (raw[at] === '}') return match
        if (raw[at] !== '"') return null
        const end = stringEnd(at)
        if (end < 0) return null
        let name: unknown
        try { name = JSON.parse(raw.slice(at, end)) } catch { return null }
        at = skipSpace(end)
        if (raw[at] !== ':') return null
        const childStart = skipSpace(at + 1)
        const childEnd = valueEnd(childStart)
        if (childEnd < 0) return null
        if (name === key) {
          if (match !== null) return null
          match = depth === path.length - 1 ? raw.slice(childStart, childEnd) : visit(childStart, depth + 1)
          if (match === null) return null
        }
        at = skipSpace(childEnd)
        if (raw[at] === ',') at += 1
        else if (raw[at] !== '}') return null
      }
      return null
    }
    if (!Number.isSafeInteger(key) || key < 0 || raw[start] !== '[') return null
    let at = start + 1
    let index = 0
    while (at < raw.length) {
      at = skipSpace(at)
      if (raw[at] === ']') return null
      const childStart = at
      const childEnd = valueEnd(childStart)
      if (childEnd < 0) return null
      if (index === key) return depth === path.length - 1 ? raw.slice(childStart, childEnd) : visit(childStart, depth + 1)
      index += 1
      at = skipSpace(childEnd)
      if (raw[at] === ',') at += 1
      else if (raw[at] === ']') return null
      else return null
    }
    return null
  }
  return visit(0, 0)
}
