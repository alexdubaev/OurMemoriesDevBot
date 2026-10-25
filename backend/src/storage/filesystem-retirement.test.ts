import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { FilesystemPrivateStorage } from './filesystem-storage'

let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = '' })

function storage() {
  return new FilesystemPrivateStorage({ driver: 'filesystem', root, publicBaseUrl: 'http://localhost', signingKey: Buffer.alloc(32, 4), uploadMaxBytes: 1_000_000, uploadUrlTtlSeconds: 900, downloadUrlTtlSeconds: 60 })
}

function latch() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function waitAtMost<T, F>(promise: Promise<T>, timeoutMs: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<F>((resolve) => { timer = setTimeout(() => resolve(fallback), timeoutMs) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

describe('filesystem irreversible retirement', () => {
  test('installs a persistent directory barrier, hides the key, and makes repeated retirement safe', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const key = 'memories/retired/asset'
    await files.writeObject({ key, body: new Blob(['private bytes']).stream(), contentLength: 13, contentType: 'application/octet-stream' })
    await files.retireObject(key)
    expect(await files.headObject(key)).toBeNull()
    expect(await files.readRange(key, { start: 0, end: 2 })).toBeNull()
    expect(await files.listObjects('memories/retired')).toEqual([])
    await expect(files.createUploadUrl({ key, contentType: 'application/octet-stream', byteSize: 1 })).rejects.toThrow('retired')
    await expect(files.writeObject({ key, body: new Blob(['x']).stream(), contentLength: 1, contentType: 'application/octet-stream' })).rejects.toThrow('retired')
    await files.deleteObject(key)
    await files.retireObject(key)
    const info = await stat(files.objectPath(key))
    expect(info.isDirectory()).toBe(true)
    await expect(readFile(files.objectPath(key))).rejects.toThrow()
  })

  test('refuses a foreign nonempty directory without deleting its contents', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const objectPath = files.objectPath('memories/foreign/asset')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(objectPath, { recursive: true })
    await writeFile(join(objectPath, 'foreign'), 'keep')
    await expect(files.retireObject('memories/foreign/asset')).rejects.toThrow('nonempty')
    expect(await readFile(join(objectPath, 'foreign'), 'utf8')).toBe('keep')
  })

  test('refuses a symlinked metadata tree without touching the external target', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const outside = await mkdtemp(join(tmpdir(), 'memoly-retire-outside-'))
    try {
      await writeFile(join(outside, 'asset'), 'keep')
      await symlink(outside, join(root, 'metadata'), 'dir')
      await expect(files.retireObject('memories/symlink/asset')).rejects.toThrow('directory')
      expect(await readFile(join(outside, 'asset'), 'utf8')).toBe('keep')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })

  test('completes retirement after restarting from an empty durable marker', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const key = 'memories/interrupted/asset'
    const { mkdir, writeFile } = await import('node:fs/promises')
    const markerRoot = join(root, 'retired-objects')
    await mkdir(markerRoot)
    const digest = createHash('sha256').update(key).digest('hex')
    await writeFile(join(markerRoot, digest), new Uint8Array(), { mode: 0o600 })
    await files.retireObject(key)
    expect(await files.headObject(key)).toBeNull()
    expect((await stat(files.objectPath(key))).isDirectory()).toBe(true)
  })

  test('rechecks retirement after opening the part file and before consuming a stale writer body', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const key = 'memories/racing/asset'
    const staleCheckReached = latch()
    const resumeWriter = latch()
    const bodyStarted = latch()
    const releaseBody = latch()
    let bodyPulls = 0
    const internal = files as unknown as { isRetired(value: string): Promise<boolean> }
    const originalCheck = internal.isRetired.bind(files)
    let holdFirstCheck = true
    internal.isRetired = async (value) => {
      const retired = await originalCheck(value)
      if (holdFirstCheck) {
        holdFirstCheck = false
        staleCheckReached.resolve()
        await resumeWriter.promise
      }
      return retired
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        bodyPulls += 1
        bodyStarted.resolve()
        await releaseBody.promise
        controller.enqueue(new TextEncoder().encode('secret'))
        controller.close()
      },
    }, { highWaterMark: 0 })
    const writeResult = files.writeObject({ key, body, contentLength: 6, contentType: 'application/octet-stream' })
      .then(() => ({ kind: 'resolved' as const }), (error: unknown) => ({ kind: 'rejected' as const, error }))

    await staleCheckReached.promise
    await files.retireObject(key)
    resumeWriter.resolve()
    const firstResult = await Promise.race([
      writeResult.then((result) => ({ kind: 'settled' as const, result })),
      bodyStarted.promise.then(() => ({ kind: 'body-pulled' as const })),
    ])
    releaseBody.resolve()
    const finalResult = firstResult.kind === 'settled' ? firstResult.result : await writeResult

    expect(firstResult.kind).toBe('settled')
    expect(finalResult.kind).toBe('rejected')
    if (finalResult.kind === 'rejected') expect(String(finalResult.error)).toContain('retired')
    expect(bodyPulls).toBe(0)
    expect((await readdir(dirname(files.objectPath(key)))).filter((name) => name.endsWith('.part'))).toEqual([])
    expect((await stat(files.objectPath(key))).isDirectory()).toBe(true)
  })

  test('cancels an active body producer after the retirement marker appears', async () => {
    root = await mkdtemp(join(tmpdir(), 'memoly-retire-'))
    const files = storage()
    const key = 'memories/inflight/asset'
    const bodyStarted = latch()
    const bodyCancelled = latch()
    const monitorCheckReached = latch()
    const releaseMonitorCheck = latch()
    let checkCount = 0
    let bodyCancelledFlag = false
    let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined
    const internal = files as unknown as { isRetired(value: string): Promise<boolean> }
    const originalCheck = internal.isRetired.bind(files)
    internal.isRetired = async (value) => {
      checkCount += 1
      if (checkCount === 3) {
        monitorCheckReached.resolve()
        await releaseMonitorCheck.promise
      }
      return originalCheck(value)
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) { bodyController = controller },
      pull(controller) {
        bodyStarted.resolve()
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        bodyCancelledFlag = true
        bodyCancelled.resolve()
      },
    }, { highWaterMark: 0 })
    const writeResult = files.writeObject({ key, body, contentLength: 1_000_000, contentType: 'application/octet-stream' })
      .then(() => ({ kind: 'resolved' as const }), (error: unknown) => ({ kind: 'rejected' as const, error }))

    await bodyStarted.promise
    const monitorReached = await waitAtMost(monitorCheckReached.promise.then(() => 'reached' as const), 2_000, 'timeout' as const)
    if (monitorReached === 'reached') {
      await files.retireObject(key)
      releaseMonitorCheck.resolve()
    }
    const result = await waitAtMost(writeResult.then((value) => ({ kind: 'settled' as const, value })), 2_000, 'timeout' as const)
    if (result === 'timeout') bodyController?.error(new Error('retirement cancellation did not settle the writer'))
    const cancellation = await waitAtMost(bodyCancelled.promise.then(() => 'cancelled' as const), 2_000, 'timeout' as const)

    expect(monitorReached).toBe('reached')
    expect(result).not.toBe('timeout')
    if (result !== 'timeout' && result.kind === 'settled') {
      expect(result.value.kind).toBe('rejected')
      if (result.value.kind === 'rejected') expect(String(result.value.error)).toContain('retired')
    }
    expect(cancellation).toBe('cancelled')
    expect(bodyCancelledFlag).toBe(true)
  })
})
