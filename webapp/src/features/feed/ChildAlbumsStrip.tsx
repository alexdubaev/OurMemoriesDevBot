import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AlbumDto, ChildDto } from '@web-app-demo/contracts'

import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { createChildAlbum, loadChildAlbums } from './api'
import { childAlbumsQueryKey, missingChildAlbumTemplates, orderChildAlbums } from './child-albums'

export function ChildAlbumsStrip({ accountId, active, child, familyId, membershipEpoch, onChildMissing, onOpenAlbum, role, transport }: {
  accountId: string
  active: boolean
  child: ChildDto
  familyId: string
  membershipEpoch: number
  /** The child's albums answered 404: the child was removed elsewhere; the page falls back to «Все». */
  onChildMissing?: () => void
  onOpenAlbum?: (album: AlbumDto) => void
  role: 'full' | 'viewer'
  transport: AuthenticatedTransport
}) {
  const queryClient = useQueryClient()
  const queryKey = childAlbumsQueryKey(familyId, accountId, membershipEpoch, child.id)
  const albums = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadChildAlbums(transport, familyId, child.id, signal),
    enabled: active,
    staleTime: 30_000,
    retry: false,
  })
  const childMissing = Boolean(onChildMissing) && albums.error instanceof ApiRequestError && albums.error.status === 404
  const onChildMissingRef = useRef(onChildMissing)
  useEffect(() => { onChildMissingRef.current = onChildMissing }, [onChildMissing])
  useEffect(() => { if (childMissing) onChildMissingRef.current?.() }, [childMissing])
  const [creating, setCreating] = useState<'year' | 'workshop' | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const createKeys = useRef(new Map<string, string>())

  const items = orderChildAlbums(albums.data?.items ?? [])
  const missing = albums.isSuccess ? missingChildAlbumTemplates(items, role) : []

  async function create(kind: 'year' | 'workshop', title: string) {
    if (creating) return
    const slot = `${child.id}:${kind}`
    const key = createKeys.current.get(slot) ?? crypto.randomUUID()
    createKeys.current.set(slot, key)
    setCreating(kind)
    setCreateError(null)
    try {
      const result = await createChildAlbum(transport, familyId, { kind, childId: child.id, title }, key)
      createKeys.current.delete(slot)
      await queryClient.invalidateQueries({ queryKey })
      onOpenAlbum?.(result.album)
    } catch (reason) {
      const conflict = reason instanceof ApiRequestError && reason.status === 409
      if (conflict || reason instanceof ApiRequestError && reason.status === 422) createKeys.current.delete(slot)
      setCreateError(conflict ? 'Такой альбом уже есть. Список обновлён.' : 'Не удалось создать альбом. Попробуйте ещё раз.')
      if (conflict) void queryClient.invalidateQueries({ queryKey })
    } finally {
      setCreating(null)
    }
  }

  if (albums.isSuccess && items.length === 0 && missing.length === 0) return null
  return <section aria-label={`Альбомы: ${child.name}`} className="feed-child-albums" data-slot="child-albums-strip">
    <Typography as="h2" className="feed-child-albums-title" variant="memoryBodyMedium">Альбомы</Typography>
    {albums.isPending ? <Typography as="p" className="feed-child-albums-note" role="status" variant="memoryMeta">Загружаем альбомы…</Typography> : null}
    {albums.isError && !childMissing ? <div className="feed-child-albums-note" role="alert"><Typography as="p" variant="memoryMeta">Не удалось загрузить альбомы.</Typography><button className="feed-child-albums-retry" onClick={() => void albums.refetch()} type="button"><Typography as="span" variant="memoryFilter">Повторить</Typography></button></div> : null}
    {albums.isSuccess ? <ul className="feed-child-albums-row">
      {items.map((album) => <li key={album.id}>
        <button className={`feed-child-album feed-child-album-${album.kind}`} onClick={() => onOpenAlbum?.(album)} type="button">
          <span aria-hidden="true" className="feed-child-album-cover"><WebpIcon decorative name={album.kind === 'workshop' ? 'photo' : 'archive-box'} size={28} /></span>
          <Typography as="strong" className="feed-child-album-name" variant="memoryMeta">{album.title}</Typography>
          <Typography as="small" className="feed-child-album-count" variant="memoryMeta">{album.kind === 'year' ? `${album.entryCount} из 12 месяцев` : album.kind === 'workshop' ? `${album.entryCount} работ` : `${album.entryCount} историй`}</Typography>
        </button>
      </li>)}
      {missing.map((template) => <li key={template.kind}>
        <button aria-label={`Создать альбом «${template.title}» для ребёнка ${child.name}`} className="feed-child-album feed-child-album-invite" disabled={creating !== null} onClick={() => void create(template.kind, template.title)} type="button">
          <span aria-hidden="true" className="feed-child-album-cover"><WebpIcon decorative name="plus" size={24} /></span>
          <Typography as="strong" className="feed-child-album-name" variant="memoryMeta">{template.title}</Typography>
          <Typography as="small" className="feed-child-album-count" variant="memoryMeta">{creating === template.kind ? 'Создаём…' : 'Создать'}</Typography>
        </button>
      </li>)}
    </ul> : null}
    {createError ? <Typography as="p" className="feed-child-albums-note" role="alert" variant="memoryMeta">{createError}</Typography> : null}
  </section>
}
