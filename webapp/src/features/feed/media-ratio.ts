import { useState } from 'react'

export type MediaRatioAttachment = {
  id: string
  kind: 'photo' | 'video' | 'voice'
  width: number | null
  height: number | null
}

export const DEFAULT_MEDIA_RATIO = 0.8

export function getMediaCompositionKey(memoryId: string, attachments: readonly MediaRatioAttachment[]) {
  return JSON.stringify([memoryId, attachments.map(({ id, kind }) => [id, kind])])
}

export function getMediaFrameRatio(attachments: readonly MediaRatioAttachment[]) {
  if (attachments.length === 0) return DEFAULT_MEDIA_RATIO
  if (attachments.length > 1 && attachments.some(({ kind }) => kind === 'video')) return DEFAULT_MEDIA_RATIO

  const first = attachments[0]!
  if (!Number.isFinite(first.width) || !Number.isFinite(first.height) || first.width! <= 0 || first.height! <= 0) return DEFAULT_MEDIA_RATIO

  return Math.max(0.8, Math.min(2.4, first.width! / first.height!))
}

export function useMediaFrameRatio(memoryId: string, attachments: readonly MediaRatioAttachment[]) {
  const composition = getMediaCompositionKey(memoryId, attachments)
  const [snapshot, setSnapshot] = useState(() => ({ composition, ratio: getMediaFrameRatio(attachments) }))
  if (snapshot.composition !== composition) {
    setSnapshot({ composition, ratio: getMediaFrameRatio(attachments) })
  }
  return snapshot.composition === composition ? snapshot.ratio : getMediaFrameRatio(attachments)
}
