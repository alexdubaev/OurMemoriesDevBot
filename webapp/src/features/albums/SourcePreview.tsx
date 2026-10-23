import { useEffect, useRef, useState } from 'react'
import { WebpIcon } from '@/components/WebpIcon'
import { Typography } from '@/components/typography'
import { usePrivateImageResource } from '@/platform/media/use-private-image-url'
import type { AuthenticatedTransport } from '@/platform/api'
import { previewPath, type AlbumSource } from './model'

export function SourcePreview({ source, accountId, scopeKey, transport, active = true }: { source?: AlbumSource | null; accountId: string; scopeKey: string; transport: AuthenticatedTransport; active?: boolean }) {
  const root = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active || !root.current) return
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect() } }, { rootMargin: '150px' })
    observer.observe(root.current)
    return () => observer.disconnect()
  }, [active])
  const image = usePrivateImageResource(accountId, previewPath(source), transport, active && visible, undefined, scopeKey)
  return <span className="albums-preview" data-preview-kind={source?.kind ?? 'empty'} ref={root}>
    {image.url ? <img alt="" decoding="async" height={source?.attachment?.height ?? 240} loading="lazy" src={image.url} width={source?.attachment?.width ?? 240} /> : <WebpIcon decorative name={!source?.available && source ? 'warning' : source?.kind === 'voice' ? 'voice' : source?.kind === 'note' ? 'note' : source?.kind === 'video' ? 'video' : 'photo'} size={28} />}
    {source && !source.available ? <Typography as="span" className="albums-unavailable" variant="memoryMeta">Оригинал недоступен</Typography> : null}
    {image.status === 'error' ? <Typography as="span" className="albums-unavailable" variant="memoryMeta">Нет миниатюры</Typography> : null}
    {source?.kind === 'video' && source.available ? <span className="albums-video-mark"><WebpIcon decorative name="play" size={18} /></span> : null}
  </span>
}
