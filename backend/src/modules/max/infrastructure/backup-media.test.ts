import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'

import type { PrivateStorage } from '../../../storage'
import type { MaxApiPort, MaxSendMediaMessageInput } from '../application/ports'
import { createMaxMemoryBackupProcessor, type MaxMemoryBackupRepository } from './backup-media'
import { MaxProviderError } from './max-api'

const bytes = new Uint8Array(await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer())

function fixture(kinds: Array<'image' | 'video'>, options: { configured?: boolean; published?: boolean; imageBytes?: Uint8Array } = {}) {
  const originalBytes = options.imageBytes ?? bytes
  const backup: any = {
    id: 'backup-id', memoryId: '11111111-1111-4111-8111-111111111111', familyId: 'family-id', body: 'Caption',
    state: options.configured === false ? 'needs_configuration' : 'pending', channelChatId: options.configured === false ? null : 88001n,
    providerMessageId: null, sendIntentAt: null,
    family: { maxBackupChatId: options.configured === false ? null : 88001n },
    memory: { familyId: 'family-id', status: options.published === false ? 'draft' : 'published', deletedAt: null },
    attachments: kinds.map((kind, position) => ({
      position, kind, uploadToken: null,
      media: kind === 'image' ? { id: `photo-${position}`, familyId: 'family-id', mediaKind: 'photo',
        originalKey: `media-originals/${position}`, byteSize: BigInt(originalBytes.byteLength), verifiedMime: 'image/png', declaredMime: 'image/png',
        originalStatus: 'stored', deletedAt: null, storageDeletedAt: null } : null,
      uploadSession: kind === 'video' ? { familyId: 'family-id', state: 'finalized', providerUploadToken: `video-${position}` } : null,
    })),
  }
  const repo: MaxMemoryBackupRepository = {
    async load() { return backup },
    async reserveChannelSendDelay() { return 0 },
    async persistUploadToken(_record, attachment, token) {
      const target = backup.attachments[attachment.position]
      if (target.uploadToken) return false
      target.uploadToken = token
      return true
    },
    async updateState(_record, state, patch = {}) {
      if (state === 'send_intent' && !['pending', 'uploading'].includes(backup.state)) return false
      if ((state === 'sent' || state === 'ambiguous') && backup.state !== 'send_intent') return false
      if ((state === 'uploading' || state === 'failed') && _record.state === 'send_intent' &&
          (backup.state !== 'send_intent' || backup.sendIntentAt?.getTime() !== _record.sendIntentAt?.getTime() || patch.sendIntentAt !== null)) return false
      if (state === 'needs_configuration' || state === 'failed') backup.state = state
      else if (state === 'uploading' && backup.state === 'pending') backup.state = state
      else backup.state = state
      Object.assign(backup, patch)
      return true
    },
  }
  const uploads: number[] = []
  const uploadedImages: Uint8Array[] = []
  const sends: MaxSendMediaMessageInput[] = []
  const successfulSends: string[] = []
  let failSend = false
  let nextSendError: unknown = null
  let failUploadAt: number | null = null
  const api: Pick<MaxApiPort, 'uploadImage' | 'sendMediaMessage'> = {
    async uploadImage(input) {
      uploads.push(input.bytes.byteLength)
      uploadedImages.push(input.bytes)
      if (uploads.length === failUploadAt) throw new Error('temporary upload failure')
      return { token: `image-token-${uploads.length}` }
    },
    async sendMediaMessage(input) {
      sends.push(input)
      if (failSend) throw new Error('connection lost')
      if (nextSendError !== null) {
        const error = nextSendError
        nextSendError = null
        throw error
      }
      successfulSends.push('provider-message-1')
      return { messageId: 'provider-message-1' }
    },
  }
  const storage = {
    async readObject() { return { key: 'original', contentLength: originalBytes.byteLength, contentType: 'image/png', body: new ReadableStream({ start(controller) { controller.enqueue(originalBytes); controller.close() } }) } },
  } as unknown as PrivateStorage
  const process = createMaxMemoryBackupProcessor({ repository: repo, storage, api, now: () => new Date('2026-09-29T00:00:00Z') })
  return {
    backup, uploads, uploadedImages, sends, successfulSends, process,
    failSend: (value: boolean) => { failSend = value },
    failNextSend: (error: unknown) => { nextSendError = error },
    failUploadAt: (count: number | null) => { failUploadAt = count },
  }
}

describe('MAX Memory backup outbox processor', () => {
  for (const count of [1, 5, 10]) {
    test(`publishes ${count} private photos in one ordered provider post`, async () => {
      const state = fixture(Array.from({ length: count }, () => 'image'))
      await state.process({ memoryId: state.backup.memoryId })
      expect(state.uploads).toHaveLength(count)
      expect(state.sends).toHaveLength(1)
      expect(state.sends[0]!.attachments.map(({ kind }) => kind)).toEqual(Array(count).fill('image'))
      expect(state.sends[0]!.attachments.map(({ token }) => token)).toEqual(Array.from({ length: count }, (_, index) => `image-token-${index + 1}`))
      expect(state.backup.state).toBe('sent')
      expect(state.backup.providerMessageId).toBe('provider-message-1')
    })
  }

  test('keeps mixed photos and finalized MAX video tokens in exact attachment order', async () => {
    const state = fixture(['image', 'video', 'image', 'video'])
    await state.process({ memoryId: state.backup.memoryId })
    expect(state.sends[0]!.attachments).toEqual([
      { kind: 'image', token: 'image-token-1' }, { kind: 'video', token: 'video-1' },
      { kind: 'image', token: 'image-token-2' }, { kind: 'video', token: 'video-3' },
    ])
    expect(state.uploads).toHaveLength(2)
    expect(state.sends).toHaveLength(1)
  })

  test('does not post twice when the provider response is lost', async () => {
    const state = fixture(['image'])
    state.failSend(true)
    await expect(state.process({ memoryId: state.backup.memoryId })).rejects.toThrow('ambiguous')
    state.failSend(false)
    await state.process({ memoryId: state.backup.memoryId })
    expect(state.sends).toHaveLength(1)
    expect(state.backup.state).toBe('ambiguous')
  })

  test('resizes a valid wide app photo before uploading it to MAX', async () => {
    const wide = new Uint8Array(await sharp({ create: { width: 8_000, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer())
    const state = fixture(['image'], { imageBytes: wide })
    await state.process({ memoryId: state.backup.memoryId })
    const uploaded = await sharp(state.uploadedImages[0]!).metadata()
    expect(uploaded.width).toBeLessThanOrEqual(7_680)
    expect(uploaded.height).toBeLessThanOrEqual(7_680)
    expect(state.backup.state).toBe('sent')
  })

  test('retries an explicit MAX 429 without losing the provider delay or sending twice successfully', async () => {
    const state = fixture(['image'])
    state.failNextSend(new MaxProviderError(3, true, 429, 'rate.limit'))
    await expect(state.process({ memoryId: state.backup.memoryId })).rejects.toMatchObject({
      name: 'MaxProviderError', status: 429, retryAfterSeconds: 3, retryable: true,
    })
    expect(state.backup.state).toBe('uploading')
    expect(state.backup.sendIntentAt).toBeNull()
    await state.process({ memoryId: state.backup.memoryId })
    expect(state.sends).toHaveLength(2)
    expect(state.successfulSends).toHaveLength(1)
    expect(state.uploads).toHaveLength(1)
    expect(state.backup.state).toBe('sent')
  })

  test('fails an explicit MAX 429 on the final outbox attempt', async () => {
    const state = fixture(['image'])
    state.failNextSend(new MaxProviderError(3, true, 429, 'rate.limit'))
    await expect(state.process({ memoryId: state.backup.memoryId }, undefined, true)).rejects.toThrow('final attempt')
    expect(state.backup.state).toBe('failed')
    expect(state.backup.sendIntentAt).toBeNull()
    expect(state.successfulSends).toHaveLength(0)
  })

  test('retries only an explicit attachment-not-ready response and succeeds on the next attempt', async () => {
    const state = fixture(['image'])
    state.failNextSend(new MaxProviderError(undefined, false, 400, 'attachment.not.ready'))

    await expect(state.process({ memoryId: state.backup.memoryId })).rejects.toMatchObject({
      name: 'MaxProviderError', code: 'attachment.not.ready', retryable: true,
    })
    expect(state.backup.state).toBe('uploading')
    expect(state.backup.sendIntentAt).toBeNull()
    expect(state.backup.lastErrorCode).toBe('attachment_not_ready')

    await state.process({ memoryId: state.backup.memoryId })
    expect(state.sends).toHaveLength(2)
    expect(state.successfulSends).toHaveLength(1)
    expect(state.backup.state).toBe('sent')
  })

  test('marks explicit attachment-not-ready failed on the final attempt without releasing for resend', async () => {
    const state = fixture(['image'])
    state.failNextSend(new MaxProviderError(undefined, false, 400, 'attachment.not.ready'))

    await expect(state.process({ memoryId: state.backup.memoryId }, undefined, true)).rejects.toThrow('final attempt')
    expect(state.backup.state).toBe('failed')
    expect(state.backup.sendIntentAt).toBeNull()
    expect(state.backup.lastErrorCode).toBe('attachment_not_ready')
    await state.process({ memoryId: state.backup.memoryId })
    expect(state.sends).toHaveLength(1)
    expect(state.successfulSends).toHaveLength(0)
  })

  for (const [caseName, status] of [['missing HTTP response', undefined], ['server error response', 503]] as const) {
    test(`treats attachment-not-ready with ${caseName} as ambiguous`, async () => {
      const state = fixture(['image'])
      state.failNextSend(new MaxProviderError(undefined, false, status, 'attachment.not.ready'))

      await expect(state.process({ memoryId: state.backup.memoryId })).rejects.toThrow('ambiguous')
      expect(state.backup.state).toBe('ambiguous')
      expect(state.sends).toHaveLength(1)
      expect(state.successfulSends).toHaveLength(0)
    })
  }

  test('uses the send-intent compare-and-set to allow only one concurrent post', async () => {
    const state = fixture(['image'])
    await Promise.all([
      state.process({ memoryId: state.backup.memoryId }),
      state.process({ memoryId: state.backup.memoryId }),
    ])
    expect(state.sends).toHaveLength(1)
    expect(state.backup.state).toBe('sent')
  })

  test('retries a failed pre-send upload using already persisted image tokens', async () => {
    const state = fixture(['image', 'image'])
    state.failUploadAt(2)
    await expect(state.process({ memoryId: state.backup.memoryId })).rejects.toThrow('temporary upload failure')
    expect(state.backup.attachments[0]!.uploadToken).toBe('image-token-1')
    state.failUploadAt(null)
    await state.process({ memoryId: state.backup.memoryId })
    expect(state.uploads).toHaveLength(3)
    expect(state.sends).toHaveLength(1)
    expect(state.sends[0]!.attachments.map(({ token }) => token)).toEqual(['image-token-1', 'image-token-3'])
  })

  test('marks a retryable pre-send failure failed on the final outbox attempt', async () => {
    const state = fixture(['image', 'image'])
    state.failUploadAt(2)
    await expect(state.process({ memoryId: state.backup.memoryId }, undefined, false)).rejects.toThrow('temporary upload failure')
    expect(state.backup.state).toBe('uploading')

    state.failUploadAt(3)
    await expect(state.process({ memoryId: state.backup.memoryId }, undefined, true)).rejects.toThrow('temporary upload failure')
    expect(state.backup.state).toBe('failed')
    expect(state.backup.lastErrorCode).toBe('pre_send_attempts_exhausted')
    expect(state.sends).toHaveLength(0)
  })

  test('leaves unconfigured families unsent and rejects unpublished Memories', async () => {
    const unconfigured = fixture(['image'], { configured: false })
    await unconfigured.process({ memoryId: unconfigured.backup.memoryId })
    expect(unconfigured.sends).toHaveLength(0)
    const unpublished = fixture(['image'], { published: false })
    await expect(unpublished.process({ memoryId: unpublished.backup.memoryId })).rejects.toThrow('not published')
    expect(unpublished.sends).toHaveLength(0)
  })
})
