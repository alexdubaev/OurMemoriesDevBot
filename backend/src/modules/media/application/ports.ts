import type {
  MediaAssetDto,
  MediaPurpose,
  MediaVariant,
  PrivateMediaKind,
  ReserveMediaUploadRequest,
} from '@web-app-demo/contracts'

import type { FamilyScope } from '../../families'

export type PendingMediaUpload = {
  uploadId: string
  assetId: string
  familyId: string
  userId: string
  purpose: MediaPurpose
  kind: PrivateMediaKind
  objectKey: string
  declaredMime: ReserveMediaUploadRequest['contentType']
  byteSize: number
  expiresAt: Date
}

export type StoredVariant = {
  variant: Exclude<MediaVariant, 'original'>
  objectKey: string
  sha256: string
  byteSize: number
  mime: string
  width: number | null
  height: number | null
  durationMs: number | null
}

export type ContentObject = {
  objectKey: string
  contentType: string
  contentLength: number
}

export type FinalizePreparation =
  | { kind: 'pending'; upload: PendingMediaUpload }
  | { kind: 'ready'; asset: MediaAssetDto }
  | { kind: 'forbidden' }
  | { kind: 'expired' }

export type FinalizeCommit =
  | { kind: 'ready'; asset: MediaAssetDto }
  | { kind: 'forbidden' }
  | { kind: 'expired' }

export type MediaRepository = {
  reserve(input: PendingMediaUpload & {
    quotaBytes: number
    maxPendingUploads: number
    now: Date
  }): Promise<void>
  prepareFinalize(scope: FamilyScope, uploadId: string, now: Date): Promise<FinalizePreparation>
  rejectUpload(scope: FamilyScope, uploadId: string, now: Date): Promise<void>
  commitFinalization(input: {
    scope: FamilyScope
    uploadId: string
    verifiedMime: string
    sha256: string
    width: number | null
    height: number | null
    durationMs: number | null
    renditionStatus: 'pending' | 'ready'
    variants: StoredVariant[]
    now: Date
  }): Promise<FinalizeCommit>
  readyForMemory(scope: FamilyScope, mediaIds: string[]): Promise<boolean>
  resolveContent(scope: FamilyScope, mediaId: string, variant: MediaVariant): Promise<ContentObject | null>
}

export type PhotoProcessor = (inputPath: string) => Promise<{
  verifiedMime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  originalSha256: string
  width: number
  height: number
  display: { bytes: Uint8Array; sha256: string; width: number; height: number }
  preview: { bytes: Uint8Array; sha256: string; width: number; height: number }
}>
export type MediaProbe = (inputPath: string, kind: 'video' | 'voice') => Promise<{
  width: number | null
  height: number | null
  durationMs: number
}>
