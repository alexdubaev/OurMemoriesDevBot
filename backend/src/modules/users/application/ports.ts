import type {
  AdminDashboardResponse,
  AdminUserSummary,
  AdminUsersQuery,
  AdminUsersResponse,
  UserRole,
} from '@web-app-demo/contracts'

export type UserRecord = {
  id: string
  email: string | null
  displayName: string | null
  role: UserRole
  uiTheme?: string
  createdAt: Date
}

export type ProfileWriter = {
  updateProfile(userId: string, input: { displayName?: string | null; theme?: import('@web-app-demo/contracts').MemolyTheme }): Promise<UserRecord>
}

export type WelcomeClaimer = {
  claimWelcome(userId: string, now: Date): Promise<boolean>
}

export type AdminDashboardReader = {
  dashboard(createdAfter: Date): Promise<AdminDashboardResponse>
}

export type AdminUsersReader = {
  listUsers(query: AdminUsersQuery): Promise<AdminUsersResponse>
}

export type UserRoleUpdater = {
  updateRole(input: {
    actorUserId: string
    targetUserId: string
    role: UserRole
    now: Date
  }): Promise<AdminUserSummary>
}

export type Clock = {
  now(): Date
}
