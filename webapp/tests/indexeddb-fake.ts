/**
 * Minimal in-memory IndexedDB for the private cache: one object store keyed by `id`
 * with a `userId` index, which is all `private-cache.ts` touches. Requests answer on a
 * microtask and a transaction completes on the macrotask after its last request.
 */
type Row = { id: string; userId: string } & Record<string, unknown>
type Handler = (() => void) | null

class FakeRequest<T> {
  result: T | null = null
  error: Error | null = null
  source: unknown = null
  onsuccess: Handler = null
  onerror: Handler = null
}

class FakeTransaction {
  error: Error | null = null
  oncomplete: Handler = null
  onabort: Handler = null
  onerror: Handler = null
  private pending = 0
  private finished = false
  constructor(private readonly rows: Map<string, Row>) {}

  objectStore() { return new FakeStore(this.rows, this) }

  abort() {
    if (this.finished) return
    this.finished = true
    this.error = new Error('aborted')
    this.onabort?.()
  }

  begin() { this.pending += 1 }
  end() {
    this.pending -= 1
    if (this.pending > 0) return
    setTimeout(() => {
      if (this.pending > 0 || this.finished) return
      this.finished = true
      this.oncomplete?.()
    }, 0)
  }
}

class FakeStore {
  constructor(private readonly rows: Map<string, Row>, private readonly transaction: FakeTransaction) {}
  readonly indexNames = { contains: () => true }

  private run<T>(operation: () => T) {
    const request = new FakeRequest<T>()
    this.transaction.begin()
    queueMicrotask(() => {
      request.result = operation()
      request.onsuccess?.()
      this.transaction.end()
    })
    return request
  }

  get(id: string) { return this.run(() => this.rows.get(id)) }
  put(value: Row) { return this.run(() => { this.rows.set(value.id, structuredClone(value)); return value.id }) }
  delete(id: string) { return this.run(() => { this.rows.delete(id) }) }
  clear() { return this.run(() => { this.rows.clear() }) }

  index() {
    return {
      openCursor: (range: { only: string }) => {
        const request = new FakeRequest<unknown>()
        const matches = [...this.rows.values()].filter((row) => row.userId === range.only)
        this.transaction.begin()
        const step = (position: number) => queueMicrotask(() => {
          const row = matches[position]
          if (!row) {
            request.result = null
            request.onsuccess?.()
            this.transaction.end()
            return
          }
          let advanced = false
          request.result = {
            value: structuredClone(row),
            delete: () => { this.rows.delete(row.id) },
            continue: () => { advanced = true; step(position + 1) },
          }
          request.onsuccess?.()
          if (!advanced) this.transaction.end()
        })
        step(0)
        return request
      },
    }
  }
}

export function installFakeIndexedDb() {
  const rows = new Map<string, Row>()
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => new FakeStore(rows, new FakeTransaction(rows)),
    transaction: () => new FakeTransaction(rows),
    close: () => undefined,
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        const request = new FakeRequest<typeof database>() as FakeRequest<typeof database> & { onupgradeneeded: Handler; onblocked: Handler }
        request.onupgradeneeded = null
        request.onblocked = null
        queueMicrotask(() => {
          request.result = database
          request.onsuccess?.()
        })
        return request
      },
    } as unknown as IDBFactory,
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { only: (value: string) => ({ only: value }) } })
  return {
    rows,
    ids: () => [...rows.keys()],
    seed(row: Row) { rows.set(row.id, structuredClone(row)) },
  }
}
