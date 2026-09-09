import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { probeMedia } from './infrastructure/media-probe'

test('ffprobe rejects a signature-only fake video before it becomes stored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-probe-'))
  try {
    const path = join(root, 'fake.mp4')
    const bytes = Buffer.alloc(100)
    bytes.write('ftypisom', 4)
    await writeFile(path, bytes)
    await expect(probeMedia(path, 'video')).rejects.toMatchObject({ kind: 'unsupported_media' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
