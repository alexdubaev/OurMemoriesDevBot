import type { FamilyMemberDto } from '@web-app-demo/contracts'
import { ApiRequestError } from '@/platform/api'
import type { FamilyMemberActions } from './FamilyPresentation'

export type MemberProfileChange = { familyDisplayName?: string | null; role?: 'full' | 'viewer' }

export function memberProfileChanges(member: FamilyMemberDto, actions: FamilyMemberActions, alias: string, role: 'full' | 'viewer'): MemberProfileChange | null {
  const changes: MemberProfileChange = {}
  const trimmed = alias.trim()
  if (actions.canEditAlias && !member.isOwner && trimmed !== (member.familyDisplayName ?? '')) changes.familyDisplayName = trimmed || null
  if (actions.canManageRole && !member.isOwner && role !== member.role) changes.role = role
  return Object.keys(changes).length ? changes : null
}

export function memberProfileError(reason: unknown, action: 'save' | 'remove') {
  if (reason instanceof ApiRequestError && reason.code === 'VERSION_CONFLICT') {
    return { conflict: true, message: `Данные участника изменились. Обновите их перед ${action === 'save' ? 'сохранением' : 'удалением'}.` }
  }
  return { conflict: false, message: action === 'save' ? 'Не удалось сохранить изменения. Попробуйте снова.' : 'Не удалось удалить участника. Попробуйте снова.' }
}
