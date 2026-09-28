import type { FamilyMemberDto } from '@web-app-demo/contracts'
import { AvatarUploadError } from '@/features/avatar'
import { ApiRequestError } from '@/platform/api'
import type { FamilyMemberActions } from './FamilyPresentation'

export type MemberProfileChange = { familyDisplayName?: string | null; role?: 'full' | 'viewer' }

export function isMemberSelf(member: FamilyMemberDto, currentUserId: string) {
  return member.userId === currentUserId
}

export type SelfNameOverride = { value: string | null; baseline: string | null }

export function presentSelfNameOverride(members: FamilyMemberDto[], currentUserId: string, override: SelfNameOverride | null) {
  if (!override) return members
  return members.map((member) => member.userId === currentUserId ? { ...member, displayName: override.value } : member)
}

export function serverConfirmsSelfName(members: FamilyMemberDto[], currentUserId: string, override: SelfNameOverride | null) {
  return Boolean(override && members.some((member) => member.userId === currentUserId && member.displayName === override.value))
}

export function avatarFileErrorMessage(reason: 'type' | 'too-small' | 'too-large') {
  if (reason === 'type') return 'Формат фото не поддерживается. Выберите JPEG, PNG, HEIC или HEIF.'
  if (reason === 'too-large') return 'Фото должно быть не больше 5 МБ.'
  return 'Выберите изображение для фото профиля.'
}

export function avatarUploadErrorMessage(error: unknown) {
  if (error instanceof AvatarUploadError) {
    if (error.reason === 'size-changed') return 'Фото изменилось во время загрузки. Выберите файл ещё раз.'
    if (error.reason === 'transfer-failed') return 'Не удалось загрузить фото. Проверьте соединение и попробуйте снова.'
    return 'Выберите JPEG, PNG, HEIC или HEIF размером до 5 МБ.'
  }
  if (error instanceof ApiRequestError && error.code === 'UPLOAD_EXPIRED') return 'Загрузка заняла слишком много времени. Выберите фото ещё раз.'
  if (error instanceof ApiRequestError && error.code === 'UPLOAD_REJECTED') return 'Формат фото не поддерживается. Выберите JPEG, PNG, HEIC или HEIF.'
  if (error instanceof ApiRequestError && error.code === 'UPLOAD_NOT_COMPLETED') return 'Фото не загрузилось полностью. Попробуйте ещё раз.'
  return 'Не удалось сохранить фото. Попробуйте ещё раз.'
}

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
