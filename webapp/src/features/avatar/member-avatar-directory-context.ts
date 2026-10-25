import { createContext, useContext } from 'react'
import type { FamilyMemberDto } from '@web-app-demo/contracts'

export type MemberAvatarDirectoryEntry = Pick<FamilyMemberDto, 'userId' | 'avatarPath' | 'avatarCrop'>
export type MemberAvatarDirectoryContextValue = {
  resolve: (userId: string) => MemberAvatarDirectoryEntry | null
}

export const MemberAvatarDirectoryContext = createContext<MemberAvatarDirectoryContextValue | null>(null)

/** undefined means no selected-family provider; null means the user is absent from its current directory. */
export function useMemberAvatarDirectoryEntry(userId?: string | null) {
  const directory = useContext(MemberAvatarDirectoryContext)
  if (!directory) return undefined
  return userId ? directory.resolve(userId) : null
}

export function useMemberAvatarDirectory() {
  return useContext(MemberAvatarDirectoryContext)
}
