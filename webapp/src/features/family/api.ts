import {
  completeChildProfileRequestSchema,
  acceptInviteRequestSchema,
  acceptInviteResponseSchema,
  familyInvitesResponseSchema,
  familyMeResponseSchema,
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

export function createFamilyBootstrap(transport: AuthenticatedTransport, timezone: string) {
  return transport.request('/api/v1/families', familyResponseSchema, {
    method: 'POST',
    body: createFamilyRequestSchema.parse({ name: 'Наша семья', timezone }),
    headers: idempotencyHeaders(),
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
) {
  onStage?.('reserve')
  const reservation = await transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads`, reserveMediaUploadResponseSchema,
    {
      method: 'POST',
      body: reserveMediaUploadRequestSchema.parse({
        purpose, kind: 'photo', contentType, byteSize: file.size,
      }),
      signal,
    },
  )
  onStage?.('upload')
  const response = await fetch(reservation.upload.url, {
    method: reservation.upload.method,
    headers: reservation.upload.headers,
    body: file,
    credentials: 'omit',
    mode: 'cors',
    signal,
  })
  if (!response.ok && response.status !== 412) throw new Error('Не удалось загрузить фотографию')
  onStage?.('finalize')
  await transport.request(
    `/api/v1/families/${encodeURIComponent(familyId)}/uploads/${encodeURIComponent(reservation.upload.uploadId)}/finalize`,
    finalizeMediaUploadResponseSchema,
    { method: 'POST', signal },
  )
  return reservation.assetId
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
