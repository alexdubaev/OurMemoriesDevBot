import { describe, expect, test } from 'bun:test'

import { createMaxVideoPosterProcessor, maxVideoPosterMediaId } from './video-poster'

const referenceId = '2c1d61dd-c524-4f29-a18b-3b57cb7248e1'

function posterFixture(linkCount = 1, resumeResult: unknown | null = null, envelopeForward = false, confirmEnvelope = true) {
  const reference = {
    id: referenceId, familyId: 'family', memoryId: 'memory', attachmentPosition: 0,
    providerAttachmentId: 'provider-video', thumbnailMediaId: null as string | null,
    source: { id: 'source', status: 'published', familyId: 'family', memoryId: 'memory', userId: 'author',
      messageId: envelopeForward ? 'outer-message' : 'original-message', senderSubject: 'sender', recipientId: 456n,
      originalMessageId: envelopeForward ? 'private-original' : 'original-message', originalChannelId: envelopeForward ? null : 456n },
    outboundSource: null,
    memory: { id: 'memory', familyId: 'family', authorId: 'author', status: 'published', deletedAt: null },
  }
  const linked: unknown[] = []
  const discarded: unknown[] = []
  const ingested: unknown[] = []
  type FakeTx = { $queryRaw<T>(): Promise<T>; maxVideoReference: { findFirst(input: unknown): Promise<{ id: string } | null>; updateMany(input: unknown): Promise<{ count: number }> } }
  const tx: FakeTx = { $queryRaw: async <T>() => [] as T, maxVideoReference: {
    findFirst: async () => reference.thumbnailMediaId === null ? { id: referenceId } : null,
    updateMany: async (input: unknown) => {
    linked.push(input)
    if (linkCount === 1) reference.thumbnailMediaId = maxVideoPosterMediaId(referenceId)
    return { count: linkCount }
  } } }
  const prisma = {
    maxVideoReference: { findFirst: async () => reference },
    $transaction: async (run: (tx: FakeTx) => Promise<unknown>) => run(tx),
  }
  const media = {
    resumeTrustedMedia: async () => resumeResult,
    ingestTrustedPhoto: async (_scope: unknown, input: unknown) => { ingested.push(input); return { asset: { id: maxVideoPosterMediaId(referenceId) } } },
    discardTrustedSourceAssets: async (input: unknown) => { discarded.push(input) },
  }
  const downloaded: unknown[] = []
  let providerCalls = 0
  const process = createMaxVideoPosterProcessor({
    prisma: prisma as never,
    familyAccess: { requireFull: async () => undefined } as never,
    media: media as never,
    api: {
      getMessage: async () => { providerCalls++; return envelopeForward ? { messageId: 'outer-message', recipientId: '456', recipientType: 'dialog', senderId: 'sender',
        forwardedFrom: { messageId: confirmEnvelope ? 'private-original' : 'mismatched-original' }, attachments: [], forwardedAttachments: [
          { kind: 'video', providerAttachmentId: 'provider-video', currentToken: 'current-token', inboundDurationSeconds: 66, width: 1280, height: 720 },
        ] } : { messageId: 'original-message', recipientId: '456', recipientType: 'channel', senderId: 'other', attachments: [
          { kind: 'video', providerAttachmentId: 'provider-video', currentToken: 'current-token', inboundDurationSeconds: 66, width: 1280, height: 720 },
        ] } },
      getVideo: async () => { providerCalls++; return { width: 1280, height: 720, durationMs: 66_000, thumbnailUrl: 'https://pimg.mycdn.me/poster.jpg?sig=opaque', renditions: [] } },
    } as never,
    download: async (url: string) => { downloaded.push(url); return { bytes: Uint8Array.of(1, 2, 3), contentLength: 3, contentType: 'image/jpeg' } },
  })
  return { process, reference, linked, discarded, ingested, downloaded, get providerCalls() { return providerCalls } }
}

describe('durable MAX video poster task', () => {
  test('derives the same valid fixed media id for every retry of a reference', () => {
    const first = maxVideoPosterMediaId(referenceId)
    expect(first).toBe(maxVideoPosterMediaId(referenceId))
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('ingests the verified pimg thumbnail once, links it to the live reference, and skips a replay', async () => {
    const fixture = posterFixture()
    await expect(fixture.process({ referenceId })).resolves.toBe('done')
    await expect(fixture.process({ referenceId })).resolves.toBe('done')
    expect(fixture.downloaded).toEqual(['https://pimg.mycdn.me/poster.jpg?sig=opaque'])
    expect(fixture.ingested).toEqual([{ assetId: maxVideoPosterMediaId(referenceId), sourceKind: 'max', bytes: Uint8Array.of(1, 2, 3) }])
    expect(fixture.linked).toHaveLength(1)
  })

  test('discards the deterministic staged asset if the reference is deleted before atomic link', async () => {
    const fixture = posterFixture(0)
    await expect(fixture.process({ referenceId })).resolves.toBe('skipped')
    expect(fixture.discarded).toEqual([{ sourceKind: 'max', assetIds: [maxVideoPosterMediaId(referenceId)] }])
  })

  test('resumes a deterministic stored poster after a crash without provider calls or a second ingest', async () => {
    const fixture = posterFixture(1, { id: maxVideoPosterMediaId(referenceId) })
    await expect(fixture.process({ referenceId })).resolves.toBe('done')
    expect(fixture.providerCalls).toBe(0)
    expect(fixture.downloaded).toHaveLength(0)
    expect(fixture.ingested).toHaveLength(0)
    expect(fixture.linked).toHaveLength(1)
  })

  test('uses provider-confirmed envelope video identity for forwarded poster capture', async () => {
    const fixture = posterFixture(1, null, true)
    await expect(fixture.process({ referenceId })).resolves.toBe('done')
    expect(fixture.downloaded).toEqual(['https://pimg.mycdn.me/poster.jpg?sig=opaque'])
    expect(fixture.ingested).toHaveLength(1)
  })

  test('skips envelope video poster capture when the forwarded identity does not match', async () => {
    const fixture = posterFixture(1, null, true, false)
    await expect(fixture.process({ referenceId })).resolves.toBe('skipped')
    expect(fixture.downloaded).toHaveLength(0)
    expect(fixture.ingested).toHaveLength(0)
    expect(fixture.linked).toHaveLength(0)
  })
})
