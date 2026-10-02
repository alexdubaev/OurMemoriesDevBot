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
  const response = await transport.raw('/api/uploads/avatar/preview', {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    rawBody: file,
    signal,
  })
  return response.blob()
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
