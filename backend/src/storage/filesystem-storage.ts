import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { link, lstat, mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import type { FilesystemStorageConfig } from './config'
import { StorageError } from './errors'
import { signStorageUrl, storageUrlSearchParams, type StorageUrlClaims } from './filesystem-signing'
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

export const filesystemStorageRoutePrefix = '/storage/objects'
const retirementWritePollIntervalMs = 25

export type StoredObjectMetadata = {
  contentType: string
  contentLength: number
  etag: string
}

/**
 * Private storage on the local disk, with the same contract as S3.
 *
 * This is the default driver so that `bun run dev` needs no cloud account, no credentials, and
 * no Docker. It is not a stub: it signs real time-limited URLs, refuses unsigned reads, and
 * enforces write-once keys, because a development driver that is more permissive than production
 * teaches the wrong lesson and hides the bugs it is supposed to surface.
 *
 * Objects and their metadata live in two parallel trees under the configured root, so a
 * metadata file can never collide with an object key.
 */
export class FilesystemPrivateStorage implements PrivateStorage {
  readonly driver = 'filesystem' as const

  constructor(private readonly config: FilesystemStorageConfig) {}

  async createUploadUrl(input: CreateUploadUrlInput): Promise<PresignedUpload> {
    const key = assertSafeObjectKey(input.key)
    if (await this.isRetired(key)) throw new StorageError('already_exists', 'Storage object key was retired')
    const contentType = assertContentType(input.contentType)
    const contentLength = assertByteSize(input.byteSize, this.config.uploadMaxBytes)
    const expiresIn = assertSignedUrlTtl(input.expiresInSeconds ?? this.config.uploadUrlTtlSeconds)
    const claims: StorageUrlClaims = {
      operation: 'put',
      key,
      expiresAt: unixSecondsFromNow(expiresIn),
      contentLength,
      contentType,
      ifNoneMatch: '*',
    }

    return {
      key,
      method: 'PUT',
      url: this.signedUrl(claims),
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
    const expiresIn = assertSignedUrlTtl(input.expiresInSeconds ?? this.config.downloadUrlTtlSeconds)

    return {
      key,
      url: this.signedUrl({ operation: 'get', key, expiresAt: unixSecondsFromNow(expiresIn) }),
      expiresAt: expiresAtFromNow(expiresIn),
    }
  }

  async headObject(key: string): Promise<StorageObjectHead | null> {
    const safeKey = assertSafeObjectKey(key)
    const metadata = await this.readMetadata(safeKey)
    if (!metadata) return null

    return {
      key: safeKey,
      contentLength: metadata.contentLength,
      contentType: metadata.contentType,
      etag: metadata.etag,
    }
  }

  async writeObject(input: WriteObjectInput): Promise<StorageObjectHead> {
    const safeKey = assertSafeObjectKey(input.key)
    if (await this.isRetired(safeKey)) throw new StorageError('already_exists', 'Storage object key was retired')
    const contentType = assertContentType(input.contentType)
    const contentLength = assertByteSize(input.contentLength, this.config.uploadMaxBytes)
    const objectPath = this.objectPath(safeKey)
    await mkdir(dirname(objectPath), { recursive: true })
    const temporaryPath = `${objectPath}.${randomUUID()}.part`
    let temporaryHandle: Awaited<ReturnType<typeof open>> | undefined
    let retirementPollTimer: ReturnType<typeof setTimeout> | undefined
    let retirementMonitorFinished = false
    let retirementMonitor: Promise<void> | undefined
    let retirementError: unknown
    const retirementAbort = new AbortController()
    const hash = createHash('md5')
    let written = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.byteLength
        if (written > contentLength) {
          callback(new StorageError('invalid_request', 'Stream exceeds its declared length'))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      },
    })

    try {
      // Create the named temporary path before the second marker read. Retirement can then
      // either observe and remove this file, or make the writer see its durable marker before
      // it is allowed to consume private bytes from the request body.
      temporaryHandle = await open(temporaryPath, 'wx')
      if (await this.isRetired(safeKey)) {
        throw new StorageError('already_exists', 'Storage object key was retired')
      }

      retirementMonitor = (async () => {
        while (!retirementMonitorFinished && !retirementAbort.signal.aborted) {
          await new Promise<void>((resolve) => {
            retirementPollTimer = setTimeout(resolve, retirementWritePollIntervalMs)
          })
          retirementPollTimer = undefined
          if (retirementMonitorFinished || retirementAbort.signal.aborted) break
          try {
            if (await this.isRetired(safeKey)) {
              retirementError = new StorageError('already_exists', 'Storage object key was retired')
              retirementAbort.abort(retirementError)
              break
            }
          } catch (error) {
            retirementError = error
            retirementAbort.abort(error)
            break
          }
        }
      })()

      try {
        await pipeline(
          Readable.fromWeb(input.body as never, { signal: retirementAbort.signal }),
          meter,
          temporaryHandle.createWriteStream({ autoClose: false }),
        )
      } catch (error) {
        if (retirementError) throw retirementError
        throw error
      }
      if (retirementError) throw retirementError
      if (await this.isRetired(safeKey)) {
        throw new StorageError('already_exists', 'Storage object key was retired')
      }
      if (written !== contentLength) {
        throw new StorageError('invalid_request', 'Stream does not match its declared length')
      }
      await temporaryHandle.sync()
      try {
        await link(temporaryPath, objectPath)
      } catch (error) {
        if (isExistingFile(error)) {
          throw new StorageError('already_exists', 'Storage object key already exists')
        }
        throw error
      }
      const etag = `"${hash.digest('hex')}"`
      const metadataPath = this.metadataPath(safeKey)
      await mkdir(dirname(metadataPath), { recursive: true })
      await writeFile(
        metadataPath,
        JSON.stringify({ contentType, contentLength, etag } satisfies StoredObjectMetadata),
      )
      return { key: safeKey, contentLength, contentType, etag }
    } finally {
      retirementMonitorFinished = true
      if (retirementPollTimer) clearTimeout(retirementPollTimer)
      retirementAbort.abort()
      try {
        await retirementMonitor
      } finally {
        try {
          await temporaryHandle?.close()
        } finally {
          await unlinkIfPresent(temporaryPath)
        }
      }
    }
  }

  async readObject(input: ReadObjectInput): Promise<StorageObjectRead | null> {
    const safeKey = assertSafeObjectKey(input.key)
    const metadata = await this.readMetadata(safeKey)
    if (!metadata) return null
    const range = input.range ? assertReadRange(input.range) : undefined
    if (range && (range.start >= metadata.contentLength || range.end >= metadata.contentLength)) {
      throw new StorageError('invalid_request', 'Read range exceeds the stored object')
    }
    const nodeBody = createReadStream(this.objectPath(safeKey), range)
    const body = Readable.toWeb(nodeBody) as unknown as ReadableStream<Uint8Array>
    return {
      key: safeKey,
      body,
      contentLength: range ? range.end - range.start + 1 : metadata.contentLength,
      contentType: metadata.contentType,
      etag: metadata.etag,
      ...(range
        ? { contentRange: { start: range.start, end: range.end, total: metadata.contentLength } }
        : {}),
    }
  }

  async readRange(key: string, range: ReadRangeInput): Promise<Uint8Array | null> {
    const safeKey = assertSafeObjectKey(key)
    const { start, end } = assertReadRange(range)
    if (await this.isRetired(safeKey)) return null

    let handle
    try {
      handle = await open(this.objectPath(safeKey), 'r')
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }

    try {
      const buffer = Buffer.alloc(end - start + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      return new Uint8Array(buffer.subarray(0, bytesRead))
    } finally {
      await handle.close()
    }
  }

  async deleteObject(key: string) {
    const safeKey = assertSafeObjectKey(key)

    if (await this.isRetired(safeKey)) {
      await this.retireObject(safeKey)
      return
    }

    await Promise.all([
      unlinkIfPresent(this.objectPath(safeKey)),
      unlinkIfPresent(this.metadataPath(safeKey)),
    ])
  }

  /**
   * Permanently fences a key before erasing it. The empty directory occupies the object path,
   * so the archived filesystem writer's atomic link(temp, objectPath) cannot recreate it.
   */
  async retireObject(key: string) {
    const safeKey = assertSafeObjectKey(key)
    const markerRoot = join(this.config.root, 'retired-objects')
    await ensureSafeDirectoryPath(markerRoot)
    const markerPath = join(markerRoot, createHash('sha256').update(safeKey).digest('hex'))
    let markerHandle
    try {
      markerHandle = await open(markerPath, 'wx', 0o600)
      await markerHandle.sync()
    } catch (error) {
      if (!isExistingFile(error)) throw error
      const markerInfo = await lstat(markerPath)
      if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size !== 0) throw new Error('retired_object_refuses_marker_path')
    } finally {
      await markerHandle?.close()
    }
    const markerDir = await open(markerRoot, 'r')
    try { await markerDir.sync() } finally { await markerDir.close() }

    const objectPath = this.objectPath(safeKey)
    await ensureSafeParentDirectories(join(this.config.root, 'objects'), dirname(objectPath))
    let barrierInstalled = false
    for (let attempt = 0; attempt < 16; attempt += 1) {
      try {
        await mkdir(objectPath)
        barrierInstalled = true
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') {
          const info = await lstat(objectPath)
          if (info.isSymbolicLink()) throw new Error('retired_object_refuses_symlink')
          if (info.isDirectory()) {
            const children = await readdir(objectPath)
            if (children.length) throw new Error('retired_object_refuses_nonempty_directory')
            barrierInstalled = true
            break
          }
          if (!info.isFile()) throw new Error('retired_object_refuses_unknown_path')
          await unlink(objectPath)
          continue
        }
        if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
          await mkdir(dirname(objectPath), { recursive: true })
          continue
        }
        throw error
      }
    }
    if (!barrierInstalled) throw new Error('retired_object_barrier_retry_exhausted')

    const metadataPath = this.metadataPath(safeKey)
    await ensureSafeParentDirectories(join(this.config.root, 'metadata'), dirname(metadataPath))
    await removeRegularFileIfPresent(metadataPath, 'retired_object_refuses_metadata_path')
    const parent = dirname(objectPath)
    const base = objectPath.slice(parent.length + 1)
    for (const name of await readdir(parent)) {
      if (!new RegExp(`^${escapeRegExp(base)}\\.[0-9a-f-]{36}\\.part$`, 'i').test(name)) continue
      await removeRegularFileIfPresent(join(parent, name), 'retired_object_refuses_part_path')
    }
    const children = await readdir(objectPath)
    if (children.length) throw new Error('retired_object_barrier_not_empty')
    const parentHandle = await open(parent, 'r')
    try { await parentHandle.sync() } finally { await parentHandle.close() }
  }

  /**
   * Stores an object exactly once.
   *
   * `link()` rather than `rename()` is what makes this race-free: it refuses to replace an
   * existing name, so two concurrent uploads of the same key produce one winner and one
   * `EEXIST`, and a partially written file never appears under the final name.
   */
  async putObjectOnce(
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<{ stored: true; etag: string } | { stored: false; reason: 'already_exists' }> {
    try {
      const stored = await this.writeObject({
        key,
        body: new Blob([body.slice().buffer as ArrayBuffer]).stream(),
        contentLength: body.byteLength,
        contentType,
      })
      return { stored: true, etag: stored.etag ?? '' }
    } catch (error) {
      if (error instanceof StorageError && error.kind === 'already_exists') {
        return { stored: false, reason: 'already_exists' }
      }
      throw error
    }
  }

  async listObjects(prefix: string) {
    const safePrefix = assertSafeObjectKey(prefix)
    const root = join(this.config.root, 'objects')
    const found: Array<{ key: string; lastModified: Date }> = []
    const walk = async (directory: string) => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) {
        if (isMissingFile(error)) return
        throw error
      }
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (!entry.name.endsWith('.part')) {
          const key = path.slice(root.length + 1).split(sep).join('/')
          if (key.startsWith(safePrefix)) found.push({ key, lastModified: (await stat(path)).mtime })
        }
      }
    }
    await walk(join(root, ...safePrefix.split('/')))
    return found
  }

  async readMetadata(key: string): Promise<StoredObjectMetadata | null> {
    if (await this.isRetired(key)) return null
    try {
      return JSON.parse(await readFile(this.metadataPath(key), 'utf8')) as StoredObjectMetadata
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  objectPath(key: string) {
    return this.resolveWithin(join(this.config.root, 'objects'), key)
  }

  private metadataPath(key: string) {
    return this.resolveWithin(join(this.config.root, 'metadata'), key)
  }

  private async isRetired(key: string) {
    const markerPath = join(this.config.root, 'retired-objects', createHash('sha256').update(key).digest('hex'))
    try {
      const markerInfo = await lstat(markerPath)
      if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size !== 0) throw new Error('retired_object_refuses_marker_path')
      return true
    } catch (error) {
      if (isMissingFile(error)) return false
      throw error
    }
  }

  /**
   * Belt and braces on top of `assertSafeObjectKey`: even a key that slipped through validation
   * cannot address anything outside its tree.
   */
  private resolveWithin(root: string, key: string) {
    const resolved = resolve(root, key)

    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new StorageError('invalid_key', 'Storage object key escapes the storage root')
    }

    return resolved
  }

  private signedUrl(claims: StorageUrlClaims) {
    const params = storageUrlSearchParams(claims, signStorageUrl(this.config.signingKey, claims))
    const path = claims.key.split('/').map(encodeURIComponent).join('/')

    return `${this.config.publicBaseUrl}${filesystemStorageRoutePrefix}/${path}?${params.toString()}`
  }
}

async function unlinkIfPresent(path: string) {
  try {
    await unlink(path)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

async function ensureSafeParentDirectories(root: string, target: string) {
  await ensureSafeDirectoryPath(root)
  const relative = target.slice(root.length).split(sep).filter(Boolean)
  let current = root
  for (const component of relative) {
    current = join(current, component)
    try { await mkdir(current) } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
    }
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('retired_object_refuses_parent_path')
  }
}

async function ensureSafeDirectoryPath(target: string) {
  const directories: string[] = []
  let current = resolve(target)
  for (;;) {
    directories.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  for (const directory of directories.reverse()) {
    try { await mkdir(directory) } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
    }
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('retired_object_refuses_directory_path')
  }
}

async function removeRegularFileIfPresent(path: string, errorCode: string) {
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(errorCode)
    await unlink(path)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isExistingFile(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

function unixSecondsFromNow(seconds: number) {
  return Math.floor(Date.now() / 1000) + seconds
}
