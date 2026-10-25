import { sessionQueryKeys } from '@/features/auth'

export const memberAvatarDirectoryQueryKeys = {
  all: [...sessionQueryKeys.all, 'member-avatar-directory'] as const,
  family: (accountId: string, familyId: string, membershipEpoch: number) =>
    [...memberAvatarDirectoryQueryKeys.all, familyId, accountId, membershipEpoch] as const,
}
