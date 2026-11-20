/**
 * Minimal in-memory IndexedDB for the private cache: named object stores keyed by `id`,
 * named indexes on one field, version upgrades and long-lived connections — all that
 * `private-cache.ts` touches. Requests answer on a microtask and a transaction completes on
 * the macrotask after its last request. The returned handle also records opens, transactions,
 * writes and cursor reads so tests can prove what a cache operation did or did not touch.
 * A `get` can be held or failed by the hook passed to `installFakeIndexedDb`; a failed request
 * aborts its transaction unless its error handler calls `preventDefault`, as in IndexedDB.
 */
type Row = { id: string; userId?: string } & Record<string, unknown>
type Handler = ((event?: unknown) => void) | null
type StoreState = { rows: Map<string, Row>; indexes: Map<string, string> }
type Stores = Map<string, StoreState>
export type FakeIndexedDbLog = {
  opens: number
  transactions: Array<{ mode: IDBTransactionMode | 'versionchange'; stores: string[] }>
  puts: Array<{ store: string; value: Row }>
  cursorValues: Array<{ store: string; index: string | null; value: Row }>
}

class FakeRequest<T> {
  result: T | null = null
  error: Error | null = null
  source: unknown = null
  transaction: FakeTransaction | null = null
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
  constructor(
    private readonly stores: Stores,
    private readonly log: FakeIndexedDbLog,
    readonly mode: IDBTransactionMode | 'versionchange',
    readonly beforeGet?: (store: string, id: string) => Promise<void> | undefined,
  ) {
    // IndexedDB commits a transaction that never receives a request.
    setTimeout(() => { if (this.pending === 0) this.complete() }, 0)
  }

  objectStore(name = 'entries') {
    const state = this.stores.get(name)
    if (!state) throw new DOMException(`No object store ${name}`, 'NotFoundError')
    return new FakeStore(name, state, this, this.log)
  }

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
    setTimeout(() => { if (this.pending === 0) this.complete() }, 0)
  }

  private complete() {
    if (this.finished) return
    this.finished = true
    this.oncomplete?.()
  }
}

class FakeStore {
  constructor(private readonly name: string, private readonly state: StoreState, private readonly transaction: FakeTransaction, private readonly log: FakeIndexedDbLog) {}
  get indexNames() { return { contains: (index: string) => this.state.indexes.has(index) } }

  private run<T>(operation: () => T, beforeRequest?: Promise<void>) {
    const request = new FakeRequest<T>()
    request.transaction = this.transaction
    this.transaction.begin()
    const complete = () => {
      request.result = operation()
      request.onsuccess?.()
      this.transaction.end()
    }
    const fail = (reason: unknown) => {
      let prevented = false
      request.error = reason instanceof Error ? reason : new Error(String(reason))
      request.onerror?.({ preventDefault: () => { prevented = true } })
      if (!prevented) this.transaction.abort()
      this.transaction.end()
    }
    if (beforeRequest) void beforeRequest.then(complete, fail)
    else queueMicrotask(complete)
    return request
  }

  createIndex(index: string, keyPath: string) { this.state.indexes.set(index, keyPath) }
  get(id: string) { return this.run(() => this.state.rows.get(id), this.transaction.beforeGet?.(this.name, id)) }
  put(value: Row) {
    this.log.puts.push({ store: this.name, value })
    return this.run(() => { this.state.rows.set(value.id, structuredClone(value)); return value.id })
  }
  delete(id: string) { return this.run(() => { this.state.rows.delete(id) }) }
  clear() { return this.run(() => { this.state.rows.clear() }) }
  openCursor() { return this.cursor(null, () => true) }

  index(index: string) {
    const keyPath = this.state.indexes.get(index)
    if (!keyPath) throw new DOMException(`No index ${index}`, 'NotFoundError')
    return { openCursor: (range: { only: string }) => this.cursor(index, (row) => row[keyPath] === range.only) }
  }

  private cursor(index: string | null, matches: (row: Row) => boolean) {
    const request = new FakeRequest<unknown>()
    const rows = [...this.state.rows.values()].filter(matches)
    this.transaction.begin()
    const step = (position: number) => queueMicrotask(() => {
      const row = rows[position]
      if (!row) {
        request.result = null
        request.onsuccess?.()
        this.transaction.end()
        return
      }
      let advanced = false
      const value = structuredClone(row)
      this.log.cursorValues.push({ store: this.name, index, value })
      request.result = {
        value,
        delete: () => { this.state.rows.delete(row.id) },
        update: (next: Row) => { this.state.rows.set(row.id, structuredClone(next)) },
        continue: () => { advanced = true; step(position + 1) },
      }
      request.onsuccess?.()
      if (!advanced) this.transaction.end()
    })
    step(0)
    return request
  }
}

/**
 * Installs the fake. It starts as an existing version-1 database with the `entries` store and
 * its `userId` index, so rows seeded before the first open model data from the previous app.
 */
export function installFakeIndexedDb(beforeGet?: (mode: IDBTransactionMode, request: { store: string; id: string }) => Promise<void> | undefined) {
  const stores: Stores = new Map([['entries', { rows: new Map(), indexes: new Map([['userId', 'userId']]) }]])
  const log: FakeIndexedDbLog = { opens: 0, transactions: [], puts: [], cursorValues: [] }
  let version = 1
  const connections = new Set<{ closed: boolean; onclose: Handler; onversionchange: Handler }>()
  const connect = () => {
    const connection = {
      closed: false,
      onclose: null as Handler,
      onversionchange: null as Handler,
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => {
        const state: StoreState = { rows: new Map(), indexes: new Map() }
        stores.set(name, state)
        return new FakeStore(name, state, new FakeTransaction(stores, log, 'versionchange'), log)
      },
      transaction: (names: string | string[], mode: IDBTransactionMode = 'readonly') => {
        if (connection.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError')
        log.transactions.push({ mode, stores: typeof names === 'string' ? [names] : [...names] })
        return new FakeTransaction(stores, log, mode, beforeGet && ((store, id) => beforeGet(mode, { store, id })))
      },
      close: () => { connection.closed = true; connections.delete(connection) },
    }
    connections.add(connection)
    return connection
  }
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: (_name: string, requested = version) => {
        log.opens += 1
        const request = new FakeRequest<ReturnType<typeof connect>>() as FakeRequest<ReturnType<typeof connect>> & { onupgradeneeded: Handler; onblocked: Handler }
        request.onupgradeneeded = null
        request.onblocked = null
        queueMicrotask(() => {
          const connection = connect()
          request.result = connection
          if (requested <= version) {
            request.onsuccess?.()
            return
          }
          const oldVersion = version
          version = requested
          const upgrade = new FakeTransaction(stores, log, 'versionchange')
          request.transaction = upgrade
          upgrade.oncomplete = () => { request.transaction = null; request.onsuccess?.() }
          request.onupgradeneeded?.({ oldVersion, newVersion: requested })
        })
        return request
      },
    } as unknown as IDBFactory,
  })
  Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: { only: (value: string) => ({ only: value }) } })
  const entries = stores.get('entries')!.rows
  return {
    rows: entries,
    log,
    store: (name: string) => stores.get(name)?.rows ?? new Map<string, Row>(),
    ids: () => [...entries.keys()],
    seed(row: Row) { entries.set(row.id, structuredClone(row)) },
    /** The browser closed every open connection, as it may do under storage pressure. */
    closeConnections() {
      for (const connection of [...connections]) {
        connection.closed = true
        connections.delete(connection)
        connection.onclose?.()
      }
    },
  }
}
