/* eslint-disable typographyPolicy/use-typography-component -- semantic gallery labels use the album stylesheet. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { WebpIcon } from '@/components/WebpIcon'
import type { AuthenticatedTransport } from '@/platform/api'
import { monthCollageLayout } from './month-collage-layout'
import type { AlbumSource } from './model'
import { SourcePreview } from './SourcePreview'

type Props = {
  pages: AlbumSource[][]
  cover: AlbumSource | null
  accountId: string
  scopeKey: string
  transport: AuthenticatedTransport
  onOpen: (index: number, element: HTMLElement) => void
}

export function MonthPhotoCollage({ pages, cover, accountId, scopeKey, transport, onOpen }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, top: 0, height: 0 })
  const layout = useMemo(() => monthCollageLayout(pages, viewport.width, Boolean(cover)), [pages, viewport.width, cover])

  useEffect(() => {
    const element = root.current
    if (!element) return
    let frame = 0
    const measure = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const { width, top } = element.getBoundingClientRect()
        const height = window.innerHeight
        setViewport((old) => old.width === width && old.top === -top && old.height === height ? old : { width, top: -top, height })
      })
    }
    const resize = new ResizeObserver(measure)
    resize.observe(element)
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    measure()
    return () => {
      resize.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  const margin = Math.min(viewport.height / 2, 450)
  const visible = layout.tiles.filter(({ y, height }) => y + height >= viewport.top - margin && y <= viewport.top + viewport.height + margin).slice(0, 84)
  const preview = (source: AlbumSource) => <SourcePreview accountId={accountId} scopeKey={scopeKey} source={source} transport={transport} />

  return <div aria-label="Фотографии месяца" className="month-collage" role="group">
    {cover ? <div className="month-collage-cover" data-month-cover={cover.id}>
      <button aria-label="Открыть фото 1" className="month-collage-tile" data-month-photo={cover.id} onClick={(event) => onOpen(0, event.currentTarget)} type="button">{preview(cover)}</button>
      <span aria-label="Обложка месяца" className="month-collage-cover-icon" role="img">
        <WebpIcon decorative monochrome name="star" size={14} />
      </span>
    </div> : null}
    <div className="month-collage-wall" data-populated={layout.height > 0 || undefined} ref={root} style={{ height: layout.height }}>
      {visible.map(({ source, index, x, y, width, height }) => (
        <button aria-label={`Открыть фото ${index + 1}`} className="month-collage-tile" data-month-photo={source.id} key={source.id} onClick={(event) => onOpen(index, event.currentTarget)} style={{ left: x, top: y, width, height }} type="button">{preview(source)}</button>
      ))}
    </div>
  </div>
}
