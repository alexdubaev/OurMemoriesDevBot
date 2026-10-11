import {
  avatarResponseSchema,
  createAvatarUploadRequestSchema,
  createAvatarUploadResponseSchema,
  type CreateAvatarUploadRequest,
  type AvatarCrop,
  type UpdateAvatarCropRequest,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function createAvatarUpload(
  transport: AuthenticatedTransport,
  input: CreateAvatarUploadRequest,
) {
  return transport.request('/api/uploads/avatar', createAvatarUploadResponseSchema, {
    method: 'POST',
    body: createAvatarUploadRequestSchema.parse(input),
  })
}

export function finalizeAvatarUpload(transport: AuthenticatedTransport, uploadId: string, avatarCrop?: AvatarCrop) {
  return transport.request(
    `/api/uploads/avatar/${encodeURIComponent(uploadId)}/finalize`,
    avatarResponseSchema,
    { method: 'POST', ...(avatarCrop ? { body: { avatarCrop } } : {}) },
  )
}

export function updateAvatarCrop(transport: AuthenticatedTransport, input: UpdateAvatarCropRequest) {
  return transport.request('/api/uploads/avatar/crop', avatarResponseSchema, { method: 'POST', body: input })
}

export async function createAvatarPreview(transport: AuthenticatedTransport, file: File, contentType: string, signal?: AbortSignal) {
  if ((contentType === 'image/heic' || contentType === 'image/heif') && await browserCanDecode(file, signal)) return file
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
  const response = await transport.raw('/api/uploads/avatar/preview', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    rawBody: file,
    signal,
  })
  return response.blob()
}

async function browserCanDecode(file: File, signal?: AbortSignal) {
  if (typeof Image === 'undefined') return false
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
  const url = URL.createObjectURL(file)
  const image = new Image()
  let onAbort: (() => void) | undefined
  try {
    image.src = url
    const decoding = image.decode()
    if (signal) {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
      })
      await Promise.race([decoding, aborted])
    } else {
      await decoding
    }
    return image.naturalWidth > 0 && image.naturalHeight > 0
  } catch {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError')
    return false
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    URL.revokeObjectURL(url)
  }
}

export function fetchAvatar(
  transport: AuthenticatedTransport,
  options: { signal?: AbortSignal } = {},
) {
  return transport.request('/api/uploads/avatar', avatarResponseSchema, options)
}

export function deleteAvatar(transport: AuthenticatedTransport) {
  return transport.request('/api/uploads/avatar', avatarResponseSchema, { method: 'DELETE' })
}
