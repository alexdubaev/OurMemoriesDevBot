import { welcomeClaimResponseSchema } from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

export function claimWelcome(transport: AuthenticatedTransport) {
  return transport.request('/api/v1/me/welcome/claim', welcomeClaimResponseSchema, { method: 'POST' })
}
