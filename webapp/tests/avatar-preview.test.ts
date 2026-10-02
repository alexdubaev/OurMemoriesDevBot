import { afterEach, expect, test } from 'bun:test'
import { createAvatarPreview } from '../src/features/avatar/api'
import type { AuthenticatedTransport } from '../src/platform/api'

const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
const originalCreateObjectUrl = URL.createObjectURL
const originalRevokeObjectUrl = URL.revokeObjectURL

afterEach(() => {
  if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage)
  else Reflect.deleteProperty(globalThis, 'Image')
  URL.createObjectURL = originalCreateObjectUrl
  URL.revokeObjectURL = originalRevokeObjectUrl
})

test('native HEIC preview returns the original file and releases the probe URL', async () => {
  const created: Blob[] = []
  const revoked: string[] = []
  URL.createObjectURL = (blob) => { created.push(blob); return 'blob:heic-probe' }
  URL.revokeObjectURL = (url) => { revoked.push(url) }
  class DecodableImage {
    naturalWidth = 120
    naturalHeight = 160
    src = ''
    async decode() {}
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: DecodableImage })
  let requests = 0
  const transport = { raw: async () => { requests += 1; return new Response('fallback') } } as unknown as AuthenticatedTransport
  const file = new File(['native HEIC'], 'photo.heic', { type: 'image/heic' })

  expect(await createAvatarPreview(transport, file, file.type)).toBe(file)
  expect(created).toEqual([file])
  expect(revoked).toEqual(['blob:heic-probe'])
  expect(requests).toBe(0)
})

test('aborting a pending native HEIC probe revokes its temporary object URL and skips fallback request', async () => {
  const revoked: string[] = []
  URL.createObjectURL = () => 'blob:pending-heic-probe'
  URL.revokeObjectURL = (url) => { revoked.push(url) }
  let started!: () => void
  let releaseDecode!: () => void
  const probeStarted = new Promise<void>((resolve) => { started = resolve })
  class PendingImage {
    naturalWidth = 0
    naturalHeight = 0
    set src(_value: string) { started() }
    decode() { return new Promise<void>((resolve) => { releaseDecode = resolve }) }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: PendingImage })
  let requests = 0
  const transport = { raw: async () => { requests += 1; return new Response('fallback') } } as unknown as AuthenticatedTransport
  const controller = new AbortController()
  const pending = createAvatarPreview(transport, new File(['heic'], 'photo.heic', { type: 'image/heic' }), 'image/heic', controller.signal)
  await probeStarted
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(revoked).toEqual(['blob:pending-heic-probe'])
  expect(requests).toBe(0)
  releaseDecode()
})

test('unsupported native HEIC probe falls back to authenticated normalization and always releases probe URL', async () => {
  const revoked: string[] = []
  URL.createObjectURL = () => 'blob:unsupported-heic-probe'
  URL.revokeObjectURL = (url) => { revoked.push(url) }
  class UnsupportedImage {
    naturalWidth = 0
    naturalHeight = 0
    src = ''
    async decode() { throw new Error('unsupported image format') }
  }
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: UnsupportedImage })
  const controller = new AbortController()
  let request: { path: string; rawBody: BodyInit | undefined; headers: Headers; signal: AbortSignal | undefined } | null = null
  const transport = {
    raw: async (path: string, options: { rawBody?: BodyInit; headers?: HeadersInit; signal?: AbortSignal }) => {
      request = { path, rawBody: options.rawBody, headers: new Headers(options.headers), signal: options.signal }
      return new Response(new Blob(['normalized'], { type: 'image/jpeg' }))
    },
  } as unknown as AuthenticatedTransport
  const file = new File(['unsupported HEIC'], 'photo.heic', { type: 'image/heic' })
  const preview = await createAvatarPreview(transport, file, file.type, controller.signal)

  expect(await preview.text()).toBe('normalized')
  expect(request?.path).toBe('/api/uploads/avatar/preview')
  expect(request?.rawBody).toBe(file)
  expect(request?.headers.get('Content-Type')).toBe('image/heic')
  expect(request?.signal).toBe(controller.signal)
  expect(revoked).toEqual(['blob:unsupported-heic-probe'])
})
