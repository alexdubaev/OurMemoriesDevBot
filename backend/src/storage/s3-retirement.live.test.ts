import { afterAll, describe, expect, test } from 'bun:test'
import { DeleteObjectCommand, GetBucketVersioningCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash, randomBytes, randomUUID } from 'node:crypto'

import type { S3StorageConfig } from './config'
import { isRetiredS3Object, S3PrivateStorage, s3RetiredObjectContentType, s3RetiredObjectLength, s3RetiredObjectDigestMetadataKey } from './s3-storage'

const testEndpoint = process.env.TEST_S3_RETIREMENT_ENDPOINT
const testBucket = process.env.TEST_S3_RETIREMENT_BUCKET
const testAccessKeyId = process.env.TEST_S3_RETIREMENT_ACCESS_KEY_ID
const testSecretAccessKey = process.env.TEST_S3_RETIREMENT_SECRET_ACCESS_KEY
const testRegion = process.env.TEST_S3_RETIREMENT_REGION
const testPathStyle = process.env.TEST_S3_RETIREMENT_FORCE_PATH_STYLE
const liveEnabled = Boolean(testEndpoint && testBucket && testAccessKeyId && testSecretAccessKey && testRegion && ['true', 'false'].includes(testPathStyle ?? ''))
const maybeDescribe = liveEnabled ? describe : describe.skip
const namespace = `migration-checks-${randomUUID()}`
const retiredObjectLength = s3RetiredObjectLength

const config: S3StorageConfig = {
  driver: 's3',
  endpoint: testEndpoint ?? 'http://127.0.0.1:1',
  bucket: testBucket ?? 'missing-test-bucket',
  accessKeyId: testAccessKeyId ?? '',
  secretAccessKey: testSecretAccessKey ?? '',
  region: testRegion ?? 'us-east-1',
  forcePathStyle: testPathStyle === 'true',
  uploadMaxBytes: 5 * 1024 * 1024,
  uploadUrlTtlSeconds: 900,
  downloadUrlTtlSeconds: 300,
}

const rawS3 = new S3Client({
  endpoint: config.endpoint,
  region: config.region,
  forcePathStyle: config.forcePathStyle,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

afterAll(() => rawS3.destroy())

for (const status of ['Enabled', 'Suspended'] as const) {
  test(`refuses retirement when bucket versioning is ${status.toLowerCase()}`, async () => {
    const commands: unknown[] = []
    const fakeS3 = {
      async send(command: unknown) {
        commands.push(command)
        if (command instanceof GetBucketVersioningCommand) return { Status: status }
        return {}
      },
    } as unknown as S3Client
    const storage = new S3PrivateStorage(config, fakeS3)

    await expect(storage.retireObject!('migration-checks/versioned/key')).rejects.toThrow()
    expect(commands.some((command) => command instanceof PutObjectCommand)).toBe(false)
  })
}

maybeDescribe('S3 retirement against an explicitly configured test bucket', () => {
  const storage = new S3PrivateStorage(config)

  async function clean(key: string) {
    await rawS3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
  }

  async function headRaw(key: string) {
    try {
      return await rawS3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
    } catch (error) {
      if (typeof error === 'object' && error !== null && '$metadata' in error && (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null
      throw error
    }
  }

  async function markerIsPresent(key: string) {
    const head = await headRaw(key)
    return Boolean(head && isRetiredS3Object(head))
  }

  test('retire-before-upload leaves a marker that rejects the stale conditional PUT and hides reads', async () => {
    const key = `${namespace}/late-upload`
    try {
      const ticket = await storage.createUploadUrl({ key, contentType: 'image/png', byteSize: 4 })
      await storage.retireObject!(key)

      const latePut = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: new Uint8Array([1, 2, 3, 4]) })
      expect(latePut.status).toBe(412)
      expect(await markerIsPresent(key)).toBe(true)
      expect(await storage.headObject(key)).toBeNull()
      expect(await storage.readObject({ key })).toBeNull()
      expect(await storage.readObject({ key, range: { start: 0, end: 1 } })).toBeNull()
      expect(await storage.readRange(key, { start: 0, end: 1 })).toBeNull()
    } finally {
      await clean(key)
    }
  })

  test('replaces existing bytes with a verified repeatable random sentinel', async () => {
    const key = `${namespace}/existing-object`
    const original = randomBytes(retiredObjectLength)
    try {
      await storage.writeObject({ key, body: streamOf(original), contentLength: original.byteLength, contentType: 'image/png' })

      await storage.retireObject!(key)
      const firstMarker = await rawS3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      const firstMarkerBytes = await firstMarker.Body?.transformToByteArray()
      await storage.retireObject!(key)

      expect(await markerIsPresent(key)).toBe(true)
      expect(await storage.headObject(key)).toBeNull()
      expect(await storage.readObject({ key })).toBeNull()
      expect(await storage.readObject({ key, range: { start: 0, end: 1 } })).toBeNull()
      expect(await storage.readRange(key, { start: 0, end: 1 })).toBeNull()
      const raw = await rawS3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      const markerBytes = await raw.Body?.transformToByteArray()
      expect(raw.ContentLength).toBe(retiredObjectLength)
      expect(markerBytes).toHaveLength(retiredObjectLength)
      expect(Buffer.from(markerBytes ?? []).equals(original)).toBe(false)
      expect(markerBytes).toEqual(firstMarkerBytes)
      const markerDigest = raw.Metadata?.[s3RetiredObjectDigestMetadataKey]
      expect(markerDigest).toBeDefined()
      expect(createHash('sha256').update(markerBytes ?? new Uint8Array()).digest('hex')).toBe(markerDigest!)
    } finally {
      await clean(key)
    }
  })

  test('a delete with a stale ETag cannot remove a marker written after its HEAD', async () => {
    const key = `${namespace}/delete-race`
    const original = new Uint8Array([31, 32, 33, 34])
    const raceClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    })
    let releaseDeleteHead!: () => void
    let signalDeleteHead!: () => void
    let sawDeleteHead = false
    let sawConditionalDelete412 = false
    const deleteHeadObserved = new Promise<void>((resolve) => { signalDeleteHead = resolve })
    const deleteHeadGate = new Promise<void>((resolve) => { releaseDeleteHead = resolve })
    raceClient.middlewareStack.add((next, context) => async (args) => {
      const result = await next(args)
      if (context.commandName === 'HeadObjectCommand' && !sawDeleteHead) {
        sawDeleteHead = true
        signalDeleteHead()
        await deleteHeadGate
      }
      return result
    }, { step: 'deserialize', name: `pause-first-delete-head-${randomUUID()}` })
    raceClient.middlewareStack.add((next, context) => async (args) => {
      try {
        return await next(args)
      } catch (error) {
        const status = typeof error === 'object' && error !== null && '$metadata' in error
          ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
          : undefined
        if (context.commandName === 'DeleteObjectCommand' && status === 412) sawConditionalDelete412 = true
        throw error
      }
    }, { step: 'initialize', name: `capture-delete-precondition-${randomUUID()}` })
    const raceStorage = new S3PrivateStorage(config, raceClient)
    try {
      await storage.writeObject({ key, body: streamOf(original), contentLength: original.byteLength, contentType: 'image/png' })

      const deleting = raceStorage.deleteObject(key)
      await deleteHeadObserved
      await raceStorage.retireObject!(key)
      releaseDeleteHead()
      await deleting

      expect(await markerIsPresent(key)).toBe(true)
      expect(sawConditionalDelete412).toBe(true)
      expect(await storage.headObject(key)).toBeNull()
    } finally {
      releaseDeleteHead()
      await clean(key)
      raceClient.destroy()
    }
  })

  test('keeps retired keys out of storage inventory', async () => {
    const liveKey = `${namespace}/inventory-live`
    const retiredKey = `${namespace}/inventory-retired`
    const bytes = new Uint8Array([41, 42, 43, 44])
    try {
      await storage.writeObject({ key: liveKey, body: streamOf(bytes), contentLength: bytes.byteLength, contentType: 'image/png' })
      await storage.retireObject!(retiredKey)

      expect((await storage.listObjects(namespace)).map(({ key }) => key)).toEqual([liveKey])
    } finally {
      await Promise.all([clean(liveKey), clean(retiredKey)])
    }
  })
})

function streamOf(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
