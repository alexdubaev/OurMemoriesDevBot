import { expect, mock, test } from 'bun:test'

import { responseToPrivateImageObjectUrl } from '../src/platform/media/private-image'

test('non-success private media responses never become image object URLs', async () => {
  const createObjectUrl = mock(() => 'blob:should-not-exist')
  const original = URL.createObjectURL
  URL.createObjectURL = createObjectUrl as typeof URL.createObjectURL

  try {
    for (const status of [401, 403, 404, 500]) {
      await expect(responseToPrivateImageObjectUrl(new Response('error body', { status }))).rejects.toThrow()
    }
    expect(createObjectUrl).not.toHaveBeenCalled()
  } finally {
    URL.createObjectURL = original
  }
})

test('a successful private image response becomes an object URL', async () => {
  const original = URL.createObjectURL
  URL.createObjectURL = (() => 'blob:private-image') as typeof URL.createObjectURL
  try {
    await expect(responseToPrivateImageObjectUrl(new Response(new Blob(['image']), { status: 200 })))
      .resolves.toBe('blob:private-image')
  } finally {
    URL.createObjectURL = original
  }
})
