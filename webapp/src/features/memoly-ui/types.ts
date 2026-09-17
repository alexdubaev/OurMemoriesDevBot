import type {
  FamilyResponse,
  MemoryAttachment,
  MemoryDto,
} from '@web-app-demo/contracts'

export type MemoryType = MemoryDto['kind']
export type FeedFilter = 'all' | MemoryType
export type AccessRole = 'OWNER' | 'FULL' | 'VIEWER'

export interface ChildPresentation {
  id: NonNullable<FamilyResponse['child']>['id']
  name: string
  ageText: string
  avatarMediaId: string | null
  avatarUrl: string | null
  avatarCrop: NonNullable<FamilyResponse['child']>['avatarCrop']
}

export interface MemoryAuthorPresentation {
  id: string
  displayName: string
}

export interface MemoryPresentation {
  id: string
  type: MemoryType
  body: string
  dateKey: string
  dateLabel: string
  timeLabel: string
  author: MemoryAuthorPresentation
  likes: MemoryDto['likes']
  liked: boolean
  likeCount: number
  attachments: MemoryAttachment[]
  images: string[]
  posterPath: string | null
  videoPath: string | null
  audioPath: string | null
  durationMs: number | null
  waveform: number[] | null
  capabilities: MemoryDto['capabilities']
}

export interface MemberPresentation {
  id: string
  displayName: string
  role: AccessRole
  subtitle: string | null
  initials: string
}

export interface InvitePresentation {
  id: string
  label: string
  role: Exclude<AccessRole, 'OWNER'>
  status: 'pending'
  expiresAt: string
}

export interface FamilyPresentation {
  id: string
  name: string
  members: MemberPresentation[]
  pendingInvites: InvitePresentation[]
}

export interface Capabilities {
  canContribute: boolean
  canDeleteMemories: boolean
  canEditMemories: boolean
  canManageFamily: boolean
  canInvite: boolean
  canEditChild: boolean
  canLeaveFamily: boolean
}

export type ChildViewModel = ChildPresentation
export type MemberViewModel = MemberPresentation
export type MemoryAuthorViewModel = MemoryAuthorPresentation
export type MemoryViewModel = MemoryPresentation
export type InviteViewModel = InvitePresentation
export type FamilyViewModel = FamilyPresentation
