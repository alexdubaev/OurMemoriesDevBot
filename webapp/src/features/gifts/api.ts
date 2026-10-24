import {
  giftListResponseSchema,
  giftMutationResponseSchema,
  type CreateGiftRequest,
  type UpdateGiftRequest,
} from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

const giftsPath = (familyId: string) => `/api/v1/families/${encodeURIComponent(familyId)}/gifts`
const giftPath = (familyId: string, giftId: string) => `${giftsPath(familyId)}/${encodeURIComponent(giftId)}`

/** Gift photos are shown from the smaller `preview` variant of the private media. */
export const giftPhotoPath = (familyId: string, mediaId: string) =>
  `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(mediaId)}/content?variant=preview`

export function loadGifts(transport: AuthenticatedTransport, familyId: string, signal?: AbortSignal) {
  return transport.request(giftsPath(familyId), giftListResponseSchema, { signal, timeoutMs: 15_000 })
}

export function createGift(
  transport: AuthenticatedTransport,
  familyId: string,
  input: CreateGiftRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) {
  return transport.request(giftsPath(familyId), giftMutationResponseSchema, {
    method: 'POST', body: input, headers: { 'Idempotency-Key': idempotencyKey }, signal, timeoutMs: 15_000,
  })
}

export function updateGift(
  transport: AuthenticatedTransport,
  familyId: string,
  giftId: string,
  input: UpdateGiftRequest,
  signal?: AbortSignal,
) {
  return transport.request(giftPath(familyId, giftId), giftMutationResponseSchema, {
    method: 'PATCH', body: input, signal, timeoutMs: 15_000,
  })
}

/** The server answers 204 without a body, so the response is not parsed. */
export async function deleteGift(
  transport: AuthenticatedTransport,
  familyId: string,
  giftId: string,
  version: number,
  signal?: AbortSignal,
) {
  await transport.raw(giftPath(familyId, giftId), {
    method: 'DELETE', headers: { 'If-Match': String(version) }, signal, timeoutMs: 15_000,
  })
}

const versionAction = (
  method: 'POST' | 'DELETE',
  suffix: 'reservation' | 'purchase',
) => (
  transport: AuthenticatedTransport,
  familyId: string,
  giftId: string,
  expectedVersion: number,
  signal?: AbortSignal,
) => transport.request(`${giftPath(familyId, giftId)}/${suffix}`, giftMutationResponseSchema, {
  method, body: { expectedVersion }, signal, timeoutMs: 15_000,
})

export const reserveGift = versionAction('POST', 'reservation')
export const cancelGiftReservation = versionAction('DELETE', 'reservation')
export const markGiftBought = versionAction('POST', 'purchase')
export const unmarkGiftBought = versionAction('DELETE', 'purchase')
