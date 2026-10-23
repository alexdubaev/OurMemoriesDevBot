/* eslint-disable typographyPolicy/use-typography-component -- semantic gallery headings share the album stylesheet. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AlbumEntryDto } from '@web-app-demo/contracts'
import type { AuthenticatedTransport } from '@/platform/api'
import { coverSource, visibleTiles, workshopLayout, zoomLevel, zoomLevels } from './model'
import { SourcePreview } from './SourcePreview'

export function WorkshopGallery({ entries, accountId, scopeKey, transport, active, focusId, focusTop, level, onFocusRestored, onLevelChange, onOpen }: { entries: AlbumEntryDto[]; accountId: string; scopeKey: string; transport: AuthenticatedTransport; active: boolean; focusId: string | null; focusTop: number | null; level: number; onFocusRestored: () => void; onLevelChange: (level: number) => void; onOpen: (entry: AlbumEntryDto, trigger: HTMLElement) => void }) {
  const [viewport, setViewport] = useState({ top: 0, height: 844, width: 358 })
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ id: string; screenY: number; fraction: number } | null>(null)
  const pinching = useRef<{ distance: number; level: number; x: number; y: number } | null>(null)
  const suppressUntil = useRef(0)
  const levelRef = useRef(level)
  const layout = useMemo(() => workshopLayout(entries, zoomLevels[level].columns, viewport.width), [entries, level, viewport.width])
  const layoutRef = useRef(layout)
  useLayoutEffect(() => { layoutRef.current = layout; levelRef.current = level }, [layout, level])
  const measure = useCallback(() => {
    const rect = root.current?.getBoundingClientRect()
    if (rect && rect.width) setViewport({ top: -rect.top, height: window.innerHeight, width: rect.width })
  }, [])
  useEffect(() => {
    if (!active) return
    let frame = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure() }) }
    const observer = new ResizeObserver(schedule)
    if (root.current) observer.observe(root.current)
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule)
    schedule()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule) }
  }, [active, measure])
  const changeZoom = useCallback((next: number, clientX = window.innerWidth / 2, clientY = window.innerHeight / 2) => {
    if (next === levelRef.current) return
    const rect = root.current?.getBoundingClientRect()
    if (rect) {
      const x = clientX - rect.left; const y = clientY - rect.top
      const tiles = layoutRef.current.tiles
      const tile = tiles.find((tile) => x >= tile.x && x <= tile.x + tile.width && y >= tile.y && y <= tile.y + tile.height)
        ?? tiles.reduce<(typeof tiles)[number] | null>((best, candidate) => !best || Math.abs(candidate.y - y) < Math.abs(best.y - y) ? candidate : best, null)
      if (tile) anchor.current = { id: tile.id, screenY: rect.top + tile.y + Math.min(tile.height, Math.max(0, y - tile.y)), fraction: Math.max(0, Math.min(1, (y - tile.y) / tile.height)) }
    }
    levelRef.current = next; onLevelChange(next)
  }, [onLevelChange])
  useLayoutEffect(() => {
    const pending = anchor.current; const rect = root.current?.getBoundingClientRect()
    if (!pending || !rect) return
    const tile = layout.tiles.find((tile) => tile.id === pending.id)
    anchor.current = null
    if (tile) window.scrollBy(0, rect.top + tile.y + tile.height * pending.fraction - pending.screenY)
    measure()
  }, [layout, measure])
  useEffect(() => {
    const element = root.current
    if (!element || !active) return
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      const [a, b] = Array.from(event.touches)
      pinching.current = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), level: levelRef.current, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
      suppressUntil.current = performance.now() + 700
      element.addEventListener('touchmove', move, { passive: false })
    }
    const move = (event: TouchEvent) => {
      const pinch = pinching.current
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const [a, b] = Array.from(event.touches)
      const ratio = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.distance
      const delta = ratio > 1.22 ? 1 : ratio < .82 ? -1 : 0
      if (delta) changeZoom(zoomLevel(pinch.level, delta), pinch.x, pinch.y)
      suppressUntil.current = performance.now() + 700
    }
    const end = () => { if (pinching.current) suppressUntil.current = performance.now() + 700; pinching.current = null; element.removeEventListener('touchmove', move) }
    element.addEventListener('touchstart', start, { passive: true }); element.addEventListener('touchend', end, { passive: true }); element.addEventListener('touchcancel', end, { passive: true })
    return () => { end(); element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move); element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', end) }
  }, [active, changeZoom])
  const rendered = visibleTiles(layout, viewport.top, viewport.height)
  useLayoutEffect(() => {
    if (!focusId) return
    const target = [...(root.current?.querySelectorAll<HTMLElement>('[data-album-tile]') ?? [])].find((tile) => tile.dataset.albumTile === focusId)
    if (!target) {
      const logicalTile = layout.tiles.find((tile) => tile.id === focusId)
      const rect = root.current?.getBoundingClientRect()
      if (logicalTile && rect && focusTop !== null) { window.scrollBy(0, rect.top + logicalTile.y - focusTop); measure() }
      return
    }
    target.focus({ preventScroll: true })
    onFocusRestored()
  }, [focusId, focusTop, layout, measure, onFocusRestored, rendered])
  return <>
    <div className="albums-workshop-zoom"><strong>Все работы</strong><div><button aria-label="Уменьшить работы" disabled={level === 0} onClick={() => changeZoom(zoomLevel(level, -1))} type="button">−</button><output aria-live="polite">{zoomLevels[level].label} {zoomLevels[level].columns}</output><button aria-label="Увеличить работы" disabled={level === 2} onClick={() => changeZoom(zoomLevel(level, 1))} type="button">+</button></div></div>
    <p className="albums-muted albums-gesture-hint">Два пальца меняют масштаб · один прокручивает</p>
    <div aria-label="Галерея работ" className="albums-workshop-wall" data-columns={zoomLevels[level].columns} ref={root} style={{ height: layout.height }}>
      {layout.headings.filter((heading) => heading.y >= viewport.top - 100 && heading.y < viewport.top + viewport.height + 500).map((heading) => <h2 className="albums-workshop-heading" key={`${heading.title}:${heading.y}`} style={{ top: heading.y }}>{heading.title}</h2>)}
      {rendered.map((tile) => { const entry = entries[tile.index]; return <button aria-label={entry.title || `Работа · ${entry.date.value ?? 'без даты'}`} className="albums-workshop-tile" data-album-tile={entry.id} key={entry.id} onClick={(event) => { if (performance.now() < suppressUntil.current) { event.preventDefault(); return } onOpen(entry, event.currentTarget) }} style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height }} type="button"><SourcePreview accountId={accountId} active={active} scopeKey={scopeKey} source={coverSource(entry.sources)} transport={transport} /></button> })}
    </div>
  </>
}
