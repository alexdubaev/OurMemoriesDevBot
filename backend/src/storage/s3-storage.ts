import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { S3StorageConfig } from './config'
import { StorageError } from './errors'
import { assertSafeObjectKey } from './object-keys'
import type {
  CreateDownloadUrlInput,
  CreateUploadUrlInput,
  PresignedDownload,
  PresignedUpload,
  PrivateStorage,
  ReadObjectInput,
  ReadRangeInput,
  StorageObjectHead,
  StorageObjectRead,
  WriteObjectInput,
} from './port'
import {
  assertByteSize,
  assertContentType,
  assertReadRange,
  assertSignedUrlTtl,
  expiresAtFromNow,
} from './request-guards'

/**
 * Private storage on any S3-compatible endpoint: a local SeaweedFS container, DigitalOcean
 * Spaces, Yandex Object Storage, MinIO, or AWS itself. Nothing here is provider-specific; the
 * differences live entirely in `PRIVATE_STORAGE_*` configuration.
 */
export class S3PrivateStorage implements PrivateStorage {
  readonly driver = 's3' as const

  private readonly s3: S3Client

  constructor(
    private readonly config: S3StorageConfig,
    s3?: S3Client,
  ) {
    this.s3 =
      s3 ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        // Local S3 servers and most self-hosted endpoints cannot resolve `<bucket>.<host>`,
        // so addressing has to go in the path.
        forcePathStyle: config.forcePathStyle,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        // The SDK otherwise adds an optional CRC checksum to PUT requests. When presigning, the
        // body is not there yet, so it would sign the checksum of an empty body and every real
        // upload would fail the signature. Only checksums the operation actually requires stay.
        requestChecksumCalculation: 'WHEN_REQUIRED',
      })
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedUpload> {
    const key = assertSafeObjectKey(input.key)
    const contentType = assertContentType(input.contentType)
    const contentLength = assertByteSize(input.byteSize, this.config.uploadMaxBytes)
    const expiresIn = assertSignedUrlTtl(
      input.expiresInSeconds ?? this.config.uploadUrlTtlSeconds,
    )

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      // Makes the key write-once. A second PUT gets 412 instead of silently replacing an
      // object that another record already points at, which is what lets a retry be safe.
      IfNoneMatch: '*',
      // No ACL on purpose: these objects are private because the bucket is, and an explicit
      // ACL would break on providers that have object ACLs disabled.
    })

    return {
      key,
      method: 'PUT',
      url: await getSignedUrl(this.s3, command, {
        expiresIn,
        // SigV4 leaves `content-type` out of the signature by default, which would let a
        // browser upload anything under a URL issued for a PNG. Signing it makes the declared
        // type binding: a mismatched header fails the signature instead of the content check.
        signableHeaders: new Set(['content-type']),
      }),
      headers: {
        'Content-Type': contentType,
        'If-None-Match': '*',
      },
      contentLength,
      expiresAt: expiresAtFromNow(expiresIn),
    }
  }

  async createDownloadUrl(input: CreateDownloadUrlInput): Promise<PresignedDownload> {
    const key = assertSafeObjectKey(input.key)
    const expiresIn = assertSignedUrlTtl(
      input.expiresInSeconds ?? this.config.downloadUrlTtlSeconds,
    )

    return {
      key,
      url: await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
        { expiresIn },
      ),
      expiresAt: expiresAtFromNow(expiresIn),
    }
  }

  async writeObject(input: WriteObjectInput): Promise<StorageObjectHead> {
    const key = assertSafeObjectKey(input.key)
    const contentType = assertContentType(input.contentType)
    const contentLength = assertByteSize(input.contentLength, this.config.uploadMaxBytes)
    const directory = await mkdtemp(join(tmpdir(), 'private-storage-s3-'))
    const bufferedPath = join(directory, 'object')
    try {
      let received = 0
      const exactLength = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length
          callback(received <= contentLength ? null : new StorageError('invalid_request', 'Object body exceeds its declared length'), chunk)
        },
        flush(callback) {
          callback(received === contentLength ? null : new StorageError('invalid_request', 'Object body length differs from its declaration'))
        },
      })
      await pipeline(Readable.fromWeb(input.body as never), exactLength, createWriteStream(bufferedPath))
      const response = await this.s3.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: createReadStream(bufferedPath),
        ContentLength: contentLength,
        ContentType: contentType,
        IfNoneMatch: '*',
      }))
      return {
        key,
        contentLength,
        contentType,
        ...(response.ETag ? { etag: response.ETag } : {}),
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      if (isPreconditionFailure(error)) {
        throw new StorageError('already_exists', 'Storage object key already exists')
      }
      throw error
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async readObject(input: ReadObjectInput): Promise<StorageObjectRead | null> {
    const key = assertSafeObjectKey(input.key)
    const range = input.range ? assertReadRange(input.range) : undefined
    try {
      const response = await this.s3.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }))
      const body = response.Body?.transformToWebStream()
      if (!body) throw new Error('S3 returned an object without a response body')
      const total = range ? parseContentRangeTotal(response.ContentRange) : undefined
      return {
        key,
        body,
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        ...(response.ETag ? { etag: response.ETag } : {}),
        ...(range && total !== undefined
          ? { contentRange: { start: range.start, end: range.end, total } }
          : {}),
      }
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  async headObject(key: string): Promise<StorageObjectHead | null> {
    const safeKey = assertSafeObjectKey(key)

    try {
      const response = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: safeKey }),
      )

      return {
        key: safeKey,
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? 'application/octet-stream',
        ...(response.ETag ? { etag: response.ETag } : {}),
      }
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  async readRange(key: string, range: ReadRangeInput): Promise<Uint8Array | null> {
    const safeKey = assertSafeObjectKey(key)
    const { start, end } = assertReadRange(range)

    try {
      const response = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: safeKey,
          Range: `bytes=${start}-${end}`,
        }),
      )

      return (await response.Body?.transformToByteArray()) ?? new Uint8Array()
    } catch (error) {
      if (isMissingObject(error)) return null
      throw error
    }
  }

  async deleteObject(key: string) {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: assertSafeObjectKey(key) }),
    )
  }


  async listObjects(prefix: string) {
    const safePrefix = assertSafeObjectKey(prefix)
    const found: Array<{ key: string; lastModified: Date }> = []
    let continuationToken: string | undefined
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.config.bucket,
        Prefix: safePrefix, ContinuationToken: continuationToken }))
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified) found.push({ key: object.Key, lastModified: object.LastModified })
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (continuationToken)
    return found
  }
}

/**
 * S3 reports a missing object under several names depending on the operation and the provider:
 * `NotFound` for HEAD, `NoSuchKey` for GET, and a bare 404 from some S3-compatible servers.
 */
function isMissingObject(error: unknown) {
  if (typeof error !== 'object' || error === null) return false

  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey' ||
    candidate.$metadata?.httpStatusCode === 404
  )
}

function isPreconditionFailure(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return candidate.name === 'PreconditionFailed' || candidate.$metadata?.httpStatusCode === 412
}

function parseContentRangeTotal(value: string | undefined) {
  const match = value?.match(/^bytes \d+-\d+\/(\d+)$/)
  return match ? Number(match[1]) : undefined
}
