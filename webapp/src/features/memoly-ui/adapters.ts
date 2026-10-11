import type {
  FamilyInviteDto,
  FamilyMemberDto,
  FamilyResponse,
  MemoryAttachment,
  MemoryDto,
} from '@web-app-demo/contracts'

import { feedChildSubtitle, familyMemberName } from '@/features/family'

import type {
  Capabilities,
  ChildPresentation,
  FamilyPresentation,
  InvitePresentation,
  MemberPresentation,
  MemoryPresentation,
} from './types'

type ChildDto = NonNullable<FamilyResponse['child']>
type PrivateMedia = Extract<MemoryAttachment, { source: 'private_storage' }>
type VideoAttachment = PrivateMedia | Extract<MemoryAttachment, { source: 'telegram' }> | Extract<MemoryAttachment, { source: 'max' }>

export function toMemoryPresentation(memory: MemoryDto, timezone = 'UTC'): MemoryPresentation {
  const date = calendarDate(memory.occurredAt, timezone)
  const attachments = memory.attachments
  const first = attachments[0] ?? null
  const privatePhotos = attachments.filter(isPrivatePhoto)
  const firstVideo = attachments.find(isVideoAttachment)
  const firstVoice = attachments.find(isPrivateVoice)

  return {
    id: memory.id,
    type: memory.kind,
    body: memory.body,
    dateKey: date.key,
    dateLabel: date.label,
    timeLabel: new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(memory.occurredAt)),
    author: { id: memory.author.id, displayName: memory.author.name },
    likes: memory.likes,
    liked: memory.likes.likedByMe,
    likeCount: memory.likes.count,
    attachments,
    images: privatePhotos.flatMap((attachment) => {
      const path = attachment.playbackPath ?? attachment.displayPath ?? attachment.previewPath
      return path ? [path] : []
    }),
    posterPath: firstVideo ? videoPosterPath(firstVideo) : null,
    videoPath: firstVideo ? videoPlaybackPath(firstVideo) : null,
    audioPath: firstVoice?.playbackPath ?? null,
    durationMs: first?.durationMs ?? null,
    waveform: firstVoice?.waveform ?? null,
    capabilities: memory.capabilities,
  }
}

export function toCapabilities(source: { capabilities: Capabilities }): Capabilities {
  return { ...source.capabilities }
}

export function toChildPresentation(child: ChildDto, timezone: string, now = new Date()): ChildPresentation {
  return {
    id: child.id,
    name: child.name,
    ageText: feedChildSubtitle(child.birthDate, timezone, now),
    avatarMediaId: child.avatarMediaId,
    avatarUrl: null,
    avatarCrop: child.avatarCrop,
  }
}

export function toMemberPresentation(member: FamilyMemberDto): MemberPresentation {
  const displayName = familyMemberName(member)
  return {
    id: member.userId,
    displayName,
    role: member.isOwner ? 'OWNER' : member.role === 'full' ? 'FULL' : 'VIEWER',
    subtitle: member.familyDisplayName ? member.displayName : null,
    initials: initials(displayName),
  }
}

export function toInvitePresentation(invite: FamilyInviteDto): InvitePresentation {
  return {
    id: invite.id,
    label: invite.inviteeDisplayName ?? 'Новое приглашение',
    role: invite.role === 'full' ? 'FULL' : 'VIEWER',
    status: 'pending',
    expiresAt: invite.expiresAt,
  }
}

export function toFamilyPresentation(
  family: FamilyResponse['family'],
  members: FamilyMemberDto[],
  invites: FamilyInviteDto[],
): FamilyPresentation {
  return {
    id: family.id,
    name: family.name,
    members: members.map(toMemberPresentation),
    pendingInvites: invites.map(toInvitePresentation),
  }
}

function videoPosterPath(attachment: VideoAttachment) {
  if (attachment.source === 'private_storage') return attachment.previewPath ?? attachment.displayPath
  return attachment.source === 'telegram' ? attachment.thumbnailPath : attachment.playbackPath
}

function videoPlaybackPath(attachment: VideoAttachment) {
  return attachment.source === 'telegram' ? null : attachment.playbackPath
}

function isPrivatePhoto(attachment: MemoryAttachment): attachment is PrivateMedia {
  return attachment.source === 'private_storage' && attachment.kind === 'photo'
}

function isPrivateVoice(attachment: MemoryAttachment): attachment is PrivateMedia {
  return attachment.source === 'private_storage' && attachment.kind === 'voice'
}

function isVideoAttachment(attachment: MemoryAttachment): attachment is VideoAttachment {
  return attachment.kind === 'video'
}

function calendarDate(value: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  })
  const parts = formatter.formatToParts(new Date(value))
  const get = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? ''
  const key = `${get('year')}-${get('month')}-${get('day')}`
  return { key, label: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: timezone }).format(new Date(value)) }
}

function initials(value: string) {
  return value.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '•'
}
