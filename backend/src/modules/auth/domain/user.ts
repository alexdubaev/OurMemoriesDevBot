import type { UserDto, UserRole } from '@web-app-demo/contracts'

export type AuthUserRecord = {
  id: string
  email: string | null
  passwordHash: string | null
  displayName: string | null
  role: UserRole
  createdAt: Date
}

export type SessionExternalIdentity = {
  id: string
  provider: 'telegram' | 'max'
  subject: string
}

export type AuthenticatedPrincipal = UserDto & {
  sessionId: string
  externalIdentity: SessionExternalIdentity | null
}

export function toBaseUserDto(user: AuthUserRecord): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  }
}

export function userDtoFromPrincipal(principal: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, externalIdentity: _externalIdentity, ...user } = principal
  return user
}
