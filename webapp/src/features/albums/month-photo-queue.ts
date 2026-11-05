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
  reserve(count: number, key: string, signal: AbortSignal): Promise<{ grant: string }>
  upload(file: File, key: string, resume: FamilyPhotoUploadResume, signal: AbortSignal, progress: (loaded: number, total: number) => void): Promise<string>
  attach(input: AlbumMonthPhotoAppendRequest, key: string, signal: AbortSignal): Promise<unknown>
}

export class InvalidMonthPhoto extends Error {}

const batchSize = 48

function scopeChanged(error: unknown) {
  return isAlbumScopeFailure(error) || (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICT')
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
  let batchError: string | null = null
  let stale = false
  let running = false
  let attachmentAttempted = false

  function snapshot() {
    const errors = jobs.flatMap((job) => job.failure ? [{ ...job.failure, key: job.key, name: job.name }] : [])
    const saved = jobs.filter((job) => job.saved).length
    return {
      total: jobs.length, saved, failed: errors.length, pending: jobs.length - saved - errors.length,
      errors, retryable: errors.some((error) => error.retryable), current, batchError, stale, running, attachmentAttempted,
    }
  }

  async function run(ops: Operations, signal: AbortSignal, notify: () => void) {
    if (running || stale || signal.aborted) return
    running = true
    batchError = null
    notify()
    try {
      for (const [index, job] of jobs.entries()) {
        if (signal.aborted) return
        if (job.saved || job.failure?.retryable === false) continue
        const batch = batches[Math.floor(index / batchSize)]!
        if (!batch.grant) {
          current = { name: job.name, phase: 'reserve', fraction: 0 }
          notify()
          try {
            // Stop at a failed reservation so a later batch cannot take the earlier positions.
            batch.grant = (await ops.reserve(batch.count, batch.key, signal)).grant
          } catch (error) {
            if (!signal.aborted) {
              stale = scopeChanged(error)
              if (!stale) batchError = 'Не удалось подготовить добавление. Продолжите, когда восстановится соединение.'
            }
            return
          }
        }
        if (signal.aborted) return
        job.failure = undefined
        try {
          if (job.file) {
            current = { name: job.name, phase: 'upload', fraction: 0 }
            notify()
            const assetId = await ops.upload(job.file, job.uploadKey, job.resume, signal, (loaded, total) => {
              if (signal.aborted || !total) return
              current = { name: job.name, phase: 'upload', fraction: Math.min(1, loaded / total) }
              notify()
            })
            job.source = { memoryId: null, sourceKind: 'private_storage', sourceId: assetId }
            job.file = undefined
          }
          if (signal.aborted) return
          current = { name: job.name, phase: 'attach', fraction: 0 }
          notify()
          attachmentAttempted = true
          await ops.attach({ grant: batch.grant, offset: index % batchSize, source: job.source! }, job.key, signal)
          job.saved = true
        } catch (error) {
          if (signal.aborted) return
          if (scopeChanged(error)) {
            stale = true
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
