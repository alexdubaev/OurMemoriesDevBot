import type { Role } from '../states/catalog'
export type PersonModel = { id: string; name: string; subtitle: string; initials: string; owner?: boolean; role: Role; avatar?: string }
export type FamilyHeroModel = { name: string; age: string; familyName: string; avatar: string; birthDate?: string; sex?: string; timezone?: string }
export type MediaModel = { kind: 'photo' | 'video'; src: string; alt: string; orientation: 'portrait' | 'landscape'; status?: 'ready' | 'processing' | 'unavailable' | 'error' | 'unknown' | 'checking' | 'check-error'; duration?: string; provider?: 'MAX' | 'Приватное видео' | 'Telegram' }
export type MemoryCardModel = { id: string; kind: 'media' | 'note' | 'voice'; author: PersonModel; date: string; body: string; media: MediaModel[]; unread?: boolean; reactions: { emoji: string; count: number }[]; ownReaction?: string; voice?: { duration: number; peaks: number[] } }
export type InviteModel = { name: string; role: 'full' | 'viewer'; expires: string; url: string }
export type ChannelStatusModel = { state: string; title: string; canManage: boolean }
