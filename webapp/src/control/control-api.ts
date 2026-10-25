import {
  controlEventSchema,
  controlFamilyMemberSchema,
  controlFamilyRowSchema,
  controlInviteSchema,
  controlMeSchema,
  controlMembershipSchema,
  controlOverviewSchema,
  controlPageSchema,
  controlSourceSchema,
  controlStorageSchema,
  controlSystemSchema,
  controlUserRowSchema,
  controlFamilyDeletionPreviewSchema,
  controlLifecycleResultSchema,
  controlUserDeletionPreviewSchema,
} from '@web-app-demo/contracts'
import { z } from 'zod'
import type { AuthApi } from '@/features/auth'

export const familyPageSchema = controlPageSchema(controlFamilyRowSchema)
export const userPageSchema = controlPageSchema(controlUserRowSchema)
export const memberPageSchema = controlPageSchema(controlFamilyMemberSchema)
export const invitePageSchema = controlPageSchema(controlInviteSchema)
export const membershipPageSchema = controlPageSchema(controlMembershipSchema)
export const eventPageSchema = controlPageSchema(controlEventSchema)
export type FamilyRow = z.infer<typeof controlFamilyRowSchema>
export type UserRow = z.infer<typeof controlUserRowSchema>
export type Page<T> = { items: T[]; nextCursor: string | null }
export type FamilyMember = z.infer<typeof controlFamilyMemberSchema>
export type Invite = z.infer<typeof controlInviteSchema>
export type Membership = z.infer<typeof controlMembershipSchema>
export type MetricSample<T> = { value: T | null; status: string; sourceId: string; observedAt: string | null; lastAttemptAt: string | null; staleAfterSeconds: number; coverageFrom: string | null; coverageRatio: number | null; errorCode: string | null }
export type Overview = z.infer<typeof controlOverviewSchema>
export type Storage = z.infer<typeof controlStorageSchema>
export type System = z.infer<typeof controlSystemSchema>
export type Source = z.infer<typeof controlSourceSchema>

export type ListParams = { limit?: number; cursor?: string; q?: string; sort?: string; status?: string; maxState?: string; userState?: string }
export type UserDeletionPreview = z.infer<typeof controlUserDeletionPreviewSchema>
export type FamilyDeletionPreview = z.infer<typeof controlFamilyDeletionPreviewSchema>
export type ControlLifecycleResult = z.infer<typeof controlLifecycleResultSchema>
function qs(params: ListParams = {}) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') search.set(key, String(value))
  return search.size ? `?${search}` : ''
}

export function controlApi(api: AuthApi) {
  const get = <S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal) =>
    api.requestAuthenticated(path, schema, { signal, timeoutMs: 12_000 })
  const post = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
    api.requestAuthenticated(path, schema, { method: 'POST', body, timeoutMs: 12_000 })
  return {
    me: (signal?: AbortSignal) => get('/api/v1/control/me', controlMeSchema, signal),
    overview: (days: number, signal?: AbortSignal) => get(`/api/v1/control/overview?days=${days}`, controlOverviewSchema, signal),
    families: (params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/families${qs(params)}`, familyPageSchema, signal),
    family: (id: string, signal?: AbortSignal) => get(`/api/v1/control/families/${encodeURIComponent(id)}`, controlFamilyRowSchema, signal),
    familyDeletionPreview: (id: string, signal?: AbortSignal) => get(`/api/v1/control/families/${encodeURIComponent(id)}/deletion-preview`, controlFamilyDeletionPreviewSchema, signal),
    purgeFamily: (id: string, body: { key: string; fingerprint: string; confirmation: string }) => post(`/api/v1/control/families/${encodeURIComponent(id)}/purge`, controlLifecycleResultSchema, body),
    familyMembers: (id: string, params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/families/${encodeURIComponent(id)}/members${qs(params)}`, memberPageSchema, signal),
    familyInvites: (id: string, params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/families/${encodeURIComponent(id)}/invites${qs(params)}`, invitePageSchema, signal),
    users: (params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/users${qs(params)}`, userPageSchema, signal),
    user: (id: string, signal?: AbortSignal) => get(`/api/v1/control/users/${encodeURIComponent(id)}`, controlUserRowSchema, signal),
    userDeletionPreview: (id: string, signal?: AbortSignal) => get(`/api/v1/control/users/${encodeURIComponent(id)}/deletion-preview`, controlUserDeletionPreviewSchema, signal),
    trashUser: (id: string, body: { key: string; fingerprint: string; confirmation: string }) => post(`/api/v1/control/users/${encodeURIComponent(id)}/trash`, controlLifecycleResultSchema, body),
    restoreUser: (id: string, body: { key: string; deletionId: string }) => post(`/api/v1/control/users/${encodeURIComponent(id)}/restore`, controlLifecycleResultSchema, body),
    userMemberships: (id: string, params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/users/${encodeURIComponent(id)}/memberships${qs(params)}`, membershipPageSchema, signal),
    storage: (signal?: AbortSignal) => get('/api/v1/control/storage', controlStorageSchema, signal),
    sources: (signal?: AbortSignal) => get('/api/v1/control/sources', z.array(controlSourceSchema), signal),
    system: (signal?: AbortSignal) => get('/api/v1/control/system', controlSystemSchema, signal),
    events: (params: ListParams, signal?: AbortSignal) => get(`/api/v1/control/events${qs(params)}`, eventPageSchema, signal),
    exportCsv: (kind: 'families' | 'users', params: ListParams, signal?: AbortSignal) => api.rawAuthenticated(`/api/v1/control/exports/${kind}.csv${qs(params)}`, { timeoutMs: 25_000, signal }),
  }
}
