import type { AlbumMonthPhotoAppendRequest } from '@web-app-demo/contracts'
import type { FamilyPhotoUploadResume } from '@/features/family'
import { ApiRequestError } from '@/platform/api'
import { isAlbumScopeFailure } from './api'
import type { SourceRef } from './model'

type Selection = { file: File } | { source: SourceRef }
type Phase = 'reserve' | 'upload' | 'attach'
type Batch = { key: string; count: number; grant?: string }
type Job = {
  name: string
  key: string
  uploadKey: string
  resume: FamilyPhotoUploadResume
  file?: File
  source?: SourceRef
  saved: boolean
  failure?: { message: string; retryable: boolean }
}
type Operations = {
  upload(file: File, key: string, resume: FamilyPhotoUploadResume, signal: AbortSignal, progress: (loaded: number, total: number) => void): Promise<string>
} & ({
  reserve(count: number, key: string, signal: AbortSignal): Promise<{ grant: string }>
  attach(input: AlbumMonthPhotoAppendRequest, key: string, signal: AbortSignal): Promise<unknown>
} | {
  attachPhoto(source: SourceRef, key: string, signal: AbortSignal): Promise<unknown>
})

export class InvalidMonthPhoto extends Error {}

const batchSize = 48
const fallbackRetryAfterMs = 60_000
const maxRateLimitRetries = 2
const largestTimerDelayMs = 2_147_483_647
const rateLimitPause = 'Сервер ограничил частоту запросов. Попробуйте продолжить позже.'

function scopeChanged(error: unknown) {
  return isAlbumScopeFailure(error) || (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT')
}

function rateLimited(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status === 429
}

function waitForRetry(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    function cancel() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}

export function createMonthPhotoQueue(selection: readonly Selection[]) {
  const jobs: Job[] = selection.map((item, index) => ({
    ...item,
    name: 'file' in item ? item.file.name : `Фото ${index + 1}`,
    key: crypto.randomUUID(),
    uploadKey: crypto.randomUUID(),
    resume: {},
    saved: false,
  }))
  const batches: Batch[] = []
  for (let start = 0; start < jobs.length; start += batchSize) {
    batches.push({ key: crypto.randomUUID(), count: Math.min(batchSize, jobs.length - start) })
  }

  let current: { name: string; phase: Phase; fraction: number } | null = null
  let queueError: string | null = null
  let retryDelayMs: number | null = null
  let stale = false
  let running = false
  let attachmentAttempted = false

  function snapshot() {
    const errors = jobs.flatMap((job) => job.failure ? [{ ...job.failure, key: job.key, name: job.name }] : [])
    const saved = jobs.filter((job) => job.saved).length
    return {
      total: jobs.length, saved, failed: errors.length, pending: jobs.length - saved - errors.length,
      errors, retryable: errors.some((error) => error.retryable), current, queueError, retryDelayMs, stale, running, attachmentAttempted,
    }
  }

  async function run(ops: Operations, signal: AbortSignal, notify: () => void) {
    if (running || stale || signal.aborted) return
    running = true
    queueError = null
    notify()

    async function retryRateLimited<T>(operation: () => Promise<T>) {
      for (let attempt = 0; ; attempt += 1) {
        signal.throwIfAborted()
        try {
          return await operation()
        } catch (error) {
          if (!rateLimited(error) || attempt >= maxRateLimitRetries) throw error
          const delay = error.retryAfterMs ?? fallbackRetryAfterMs
          if (!Number.isFinite(delay) || delay < 0 || delay > largestTimerDelayMs) throw error
          retryDelayMs = delay
          notify()
          try {
            await waitForRetry(delay, signal)
          } finally {
            retryDelayMs = null
            notify()
          }
        }
      }
    }

    try {
      for (const [index, job] of jobs.entries()) {
        if (signal.aborted) return
        if (job.saved || job.failure?.retryable === false) continue
        const batch = batches[Math.floor(index / batchSize)]!
        if ('reserve' in ops && !batch.grant) {
          current = { name: job.name, phase: 'reserve', fraction: 0 }
          notify()
          try {
            // Stop at a failed reservation so a later batch cannot take the earlier positions.
            batch.grant = (await retryRateLimited(() => ops.reserve(batch.count, batch.key, signal))).grant
          } catch (error) {
            if (!signal.aborted) {
              stale = scopeChanged(error)
              if (!stale) queueError = rateLimited(error) ? rateLimitPause : 'Не удалось подготовить добавление. Продолжите, когда восстановится соединение.'
            }
            return
          }
        }
        if (signal.aborted) return
        job.failure = undefined
        try {
          const file = job.file
          if (file) {
            current = { name: job.name, phase: 'upload', fraction: 0 }
            notify()
            const assetId = await retryRateLimited(() => ops.upload(file, job.uploadKey, job.resume, signal, (loaded, total) => {
              if (signal.aborted || !total) return
              current = { name: job.name, phase: 'upload', fraction: Math.min(1, loaded / total) }
              notify()
            }))
            job.source = { memoryId: null, sourceKind: 'private_storage', sourceId: assetId }
            job.file = undefined
          }
          if (signal.aborted) return
          current = { name: job.name, phase: 'attach', fraction: 0 }
          notify()
          attachmentAttempted = true
          if ('attachPhoto' in ops) await retryRateLimited(() => ops.attachPhoto(job.source!, job.key, signal))
          else {
            const input = { grant: batch.grant!, offset: index % batchSize, source: job.source! }
            await retryRateLimited(() => ops.attach(input, job.key, signal))
          }
          job.saved = true
        } catch (error) {
          if (signal.aborted) return
          if (scopeChanged(error)) {
            stale = true
            return
          }
          if (rateLimited(error)) {
            queueError = rateLimitPause
            return
          }
          job.failure = error instanceof InvalidMonthPhoto
            ? { message: error.message, retryable: false }
            : { message: job.file ? 'Не удалось загрузить фото.' : 'Не удалось подтвердить добавление фото.', retryable: true }
          if (!job.failure.retryable) job.file = undefined
        }
        current = null
        notify()
      }
    } finally {
      running = false
      current = null
      notify()
    }
  }

  return { run, snapshot, hasAttachmentAttempt: () => attachmentAttempted }
}
