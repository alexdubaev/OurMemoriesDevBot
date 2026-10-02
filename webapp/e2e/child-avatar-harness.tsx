import { createRoot } from 'react-dom/client'
import { ApiRequestError } from '../src/platform/api'
import { FamilyOnboarding } from '../src/features/family/FamilyOnboarding'
import type { AuthenticatedTransport } from '../src/platform/api'
import '../src/index.css'
import '../src/features/family/ChildProfile.css'

const familyId = '11111111-1111-4111-8111-111111111111'
const avatarId = '22222222-2222-4222-8222-222222222222'
const child = { id: '33333333-3333-4333-8333-333333333333', name: 'Лиза', birthDate: '2020-02-02', sex: 'girl' as const, avatarMediaId: avatarId, avatarCrop: { x: 0.2, y: 0.1, width: 0.6, height: 0.6 }, version: 7, isComplete: true }
const calls: Array<{ path: string; options: unknown }> = []
Object.assign(window, { __childAvatarCalls: calls })
const failure = new URLSearchParams(location.search).get('failure')
const profileEdit = new URLSearchParams(location.search).has('profile')
const canvas = document.createElement('canvas')
canvas.width = 64; canvas.height = 64
const context = canvas.getContext('2d')!
context.fillStyle = '#d35'; context.fillRect(0, 0, 64, 64)
const imageBytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!), (value) => value.charCodeAt(0))
const selectedCanvas = document.createElement('canvas')
selectedCanvas.width = 80; selectedCanvas.height = 60
selectedCanvas.getContext('2d')!.fillStyle = '#27a'
selectedCanvas.getContext('2d')!.fillRect(0, 0, 80, 60)
Object.assign(window, { __childReplacementPng: selectedCanvas.toDataURL('image/png') })
let failCount = 0
const transport: AuthenticatedTransport = {
  async request(path, _schema, options) {
    calls.push({ path, options })
    if (path === `/api/v1/families/${familyId}` && options?.method === 'PATCH') {
      if (failure === 'conflict' && failCount++ === 0) throw new ApiRequestError(409, 'VERSION_CONFLICT', 'Stale child profile')
      if (failure === 'retry' && failCount++ === 0) throw new Error('Synthetic network failure')
      return { family: { id: familyId, name: 'Test', timezone: 'UTC', ownerUserId: avatarId }, child } as never
    }
    if (path.endsWith('/uploads')) return { assetId: '44444444-4444-4444-8444-444444444444', upload: { uploadId: '55555555-5555-4555-8555-555555555555', method: 'PUT', url: `${location.origin}/signed-put`, headers: { 'Content-Type': 'image/png' }, contentLength: 80, expiresAt: new Date(Date.now() + 60_000).toISOString() }, reservationExpiresAt: new Date(Date.now() + 60_000).toISOString() } as never
    return {} as never
  },
  async raw() { return new Response(new Blob([imageBytes], { type: 'image/png' })) },
}

createRoot(document.getElementById('root')!).render(<FamilyOnboarding familyId={familyId} familyTimezone="UTC" initialChild={child} photoOnly={!profileEdit} transport={transport} onCompleted={async () => undefined} />)
