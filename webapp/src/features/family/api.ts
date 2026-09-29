import {
  completeChildProfileRequestSchema,
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  familyInvitesResponseSchema,
  familyMeResponseSchema,
  familyHomeResponseSchema,
  familyMembersResponseSchema,
  familyResponseSchema,
  finalizeMediaUploadResponseSchema,
  reserveMediaUploadRequestSchema,
  reserveMediaUploadResponseSchema,
  type CompleteChildProfileRequest,
  type CreateInviteRequest,
  type UpdateMemberRoleRequest,
  type UpdateFamilyRequest,
  createInviteRequestSchema,
  createInviteResponseSchema,
  createFamilyRequestSchema,
  familyMemberResponseSchema,
  familyUsageSchema,
  invitePreviewRequestSchema,
  invitePreviewResponseSchema,
  removeMemberRequestSchema,
  updateFamilyRequestSchema,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

function idempotencyHeaders() {
  return { 'Idempotency-Key': crypto.randomUUID() }
}

export function loadFamilyMe(transport: AuthenticatedTransport) {
  return transport.request('/api/v1/me', familyMeResponseSchema)
}

export function loadFamilyHome(transport: AuthenticatedTransport, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
  return transport.request(`/api/v1/me/families${query}`, familyHomeResponseSchema)
}

export function createFamilyBootstrap(transport: AuthenticatedTransport, timezone: string, idempotencyKey: string = crypto.randomUUID()) {
  return transport.request('/api/v1/families', familyResponseSchema, {
    method: 'POST',
    body: createFamilyRequestSchema.parse({ name: 'Наша семья', timezone }),
    headers: { 'Idempotency-Key': idempotencyKey },
  })
}

export function acceptInvite(transport: AuthenticatedTransport, token: string) {
  return transport.request('/api/v1/invites/accept', acceptInviteResponseSchema, {
    method: 'POST', body: acceptInviteRequestSchema.parse({ token }),
  })
}

export function previewInvite(transport: AuthenticatedTransport, token: string) {
  return transport.request('/api/v1/invites/preview', invitePreviewResponseSchema, {
    method: 'POST', body: invitePreviewRequestSchema.parse({ token }),
  })
}

export function loadFamily(transport: AuthenticatedTransport, familyId: string) {
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}`, familyResponseSchema)
}

export function updateFamily(transport: AuthenticatedTransport, familyId: string, input: UpdateFamilyRequest) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}`, familyResponseSchema,
    { method: 'PATCH', body: updateFamilyRequestSchema.parse(input) },
  )
}

export function loadFamilyMembers(transport: AuthenticatedTransport, familyId: string) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/members`, familyMembersResponseSchema,
  )
}

export function loadFamilyInvites(transport: AuthenticatedTransport, familyId: string) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/invites`, familyInvitesResponseSchema,
  )
}

export function loadFamilyUsage(transport: AuthenticatedTransport, familyId: string) {
  return transport.request(`/api/v1/families/${encodeURIComponent(familyId)}/usage`, familyUsageSchema)
}

export function completeChildProfile(
  transport: AuthenticatedTransport,
  familyId: string,
  input: CompleteChildProfileRequest,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/child`, familyResponseSchema,
    { method: 'PUT', body: completeChildProfileRequestSchema.parse(input) },
  )
}

export async function uploadChildAvatar(
  transport: AuthenticatedTransport,
  familyId: string,
  file: File,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif',
) {
  return uploadFamilyPhoto(transport, familyId, file, contentType, 'child_avatar')
}

export async function uploadFamilyPhoto(
  transport: AuthenticatedTransport,
  familyId: string,
  file: File,
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif',
  purpose: 'child_avatar' | 'memory',
  signal?: AbortSignal,
  onStage?: (stage: 'reserve' | 'upload' | 'finalize') => void,
  idempotencyKey?: string,
  onProgress?: (loaded: number, total: number) => void,
  onAccepted?: () => void,
) {
  return uploadFamilyMedia(transport, familyId, file, 'photo', contentType, purpose, signal, onStage, idempotencyKey, onProgress, onAccepted)
}

export async function uploadFamilyVideo(
  transport: AuthenticatedTransport,
  familyId: string,
  file: File,
  contentType: 'video/mp4' | 'video/quicktime',
  signal?: AbortSignal,
  onStage?: (stage: 'reserve' | 'upload' | 'finalize') => void,
  idempotencyKey?: string,
) {
  return uploadFamilyMedia(transport, familyId, file, 'video', contentType, 'memory', signal, onStage, idempotencyKey)
}

async function uploadFamilyMedia(
  transport: AuthenticatedTransport,
  familyId: string,
  file: File,
  kind: 'photo' | 'video',
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'image/heif' | 'video/mp4' | 'video/quicktime',
  purpose: 'child_avatar' | 'memory',
  signal?: AbortSignal,
  onStage?: (stage: 'reserve' | 'upload' | 'finalize') => void,
  idempotencyKey?: string,
  onProgress?: (loaded: number, total: number) => void,
  onAccepted?: () => void,
) {
  onStage?.('reserve')
  const reservation = await transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads`, reserveMediaUploadResponseSchema,
    {
      method: 'POST',
      body: reserveMediaUploadRequestSchema.parse({
        purpose, kind, contentType, byteSize: file.size,
      }),
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
      signal,
    },
  )
  onStage?.('upload')
  let response: { ok: boolean; status: number } | undefined
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted()
    try {
      response = onProgress && typeof XMLHttpRequest !== 'undefined'
        ? await putWithProgress(reservation.upload.url, reservation.upload.method, reservation.upload.headers, file, signal, onProgress)
        : await fetch(reservation.upload.url, {
        method: reservation.upload.method,
        headers: reservation.upload.headers,
        body: file,
        credentials: 'omit',
        mode: 'cors',
        signal,
        })
      if (response.ok || response.status === 412 || response.status < 500 || attempt === 2) break
    } catch (error) {
      if (signal?.aborted || attempt === 2) throw error
    }
  }
  signal?.throwIfAborted()
  if (!response?.ok && response?.status !== 412) throw new Error(kind === 'photo' ? 'Не удалось загрузить фотографию' : 'Не удалось загрузить видео')
  if (response.ok) onAccepted?.()
  onStage?.('finalize')
  await transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads/${encodeURIComponent(reservation.upload.uploadId)}/finalize`,
    finalizeMediaUploadResponseSchema,
    { method: 'POST', signal },
  )
  return reservation.assetId
}

function putWithProgress(url: string, method: string, headers: Record<string, string>, file: File, signal: AbortSignal | undefined, onProgress: (loaded: number, total: number) => void): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status })
    }
    const abort = () => { xhr.abort(); finish(new DOMException('Загрузка отменена', 'AbortError')) }
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded, event.total)
    })
    xhr.addEventListener('load', () => finish())
    xhr.addEventListener('error', () => finish(new Error('Не удалось загрузить файл')))
    xhr.addEventListener('abort', () => finish(new DOMException('Загрузка отменена', 'AbortError')))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try {
      xhr.open(method, url)
      xhr.withCredentials = false
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
      xhr.send(file)
    } catch { finish(new Error('Не удалось загрузить файл')) }
  })
}

export function createInvite(
  transport: AuthenticatedTransport,
  familyId: string,
  input: CreateInviteRequest,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/invites`, createInviteResponseSchema,
    { method: 'POST', body: createInviteRequestSchema.parse(input), headers: idempotencyHeaders() },
  )
}

export function revokeInvite(transport: AuthenticatedTransport, familyId: string, inviteId: string) {
  return transport.raw(
    `/api/v1/families/${encodeURIComponent(familyId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  )
}

export function updateFamilyMember(
  transport: AuthenticatedTransport,
  familyId: string,
  userId: string,
  input: UpdateMemberRoleRequest,
) {
  return transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(userId)}`,
    familyMemberResponseSchema,
    { method: 'PATCH', body: input },
  )
}

export function leaveFamily(
  transport: AuthenticatedTransport,
  familyId: string,
  userId: string,
  expectedVersion: number,
) {
  return transport.raw(
    `/api/v1/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', body: removeMemberRequestSchema.parse({ expectedVersion }) },
  )
}
