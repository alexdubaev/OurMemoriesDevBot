/* eslint-disable typographyPolicy/use-typography-component -- extracted album markup retains the production page’s semantic headings and native controls. */
import type { ReactNode } from 'react'
import type { AlbumDto } from '@web-app-demo/contracts'

import { WebpIcon } from '@/components/WebpIcon'
import type { AlbumFilter } from './api'
import type { AlbumGroup } from './child-groups'
import { kindNames } from './model'

export type AlbumCardPresentationProps = {
  album: AlbumDto
  cover?: ReactNode
  onOpen: (album: AlbumDto) => void
}

/** Pure album card markup shared by the real catalog and synthetic walkthroughs. */
export function AlbumCardPresentation({ album, cover, onOpen }: AlbumCardPresentationProps) {
  return <button className="albums-card" onClick={() => onOpen(album)} type="button">
    <span className={`albums-cover albums-kind-${album.kind}`}>
      {cover ?? <><WebpIcon decorative name={album.kind === 'workshop' ? 'photo' : 'archive-box'} size={42} /><span>{kindNames[album.kind]}</span></>}
      <span className="albums-book-spine" />
    </span>
    <strong>{album.title}</strong>
    <small>{album.entryCount}{album.kind === 'year' ? ' из 12 месяцев' : album.kind === 'workshop' ? ' работ' : ' историй'}</small>
  </button>
}

export type AlbumCatalogPresentationProps = {
  albums: AlbumDto[]
  catalogCursor?: string | null
  error?: boolean
  filter: AlbumFilter
  groups?: AlbumGroup[] | null
  loading: boolean
  loadingMore?: boolean
  onCreate?: () => void
  onFilterChange: (filter: AlbumFilter) => void
  onLoadMore?: () => void
  onOpenAlbum: (album: AlbumDto) => void
  renderCover?: (album: AlbumDto) => ReactNode
  role: 'full' | 'viewer'
}

/** Pure catalog shell. Fetching, routing and mutations remain owned by AlbumsPage. */
export function AlbumCatalogPresentation({ albums, catalogCursor = null, error = false, filter, groups = null, loading, loadingMore = false, onCreate, onFilterChange, onLoadMore, onOpenAlbum, renderCover, role }: AlbumCatalogPresentationProps) {
  const albumCard = (album: AlbumDto) => <AlbumCardPresentation album={album} cover={renderCover?.(album)} key={album.id} onOpen={onOpenAlbum} />
  return <>
    <div className="albums-heading">
      <h1>Альбомы</h1>
      {role === 'full' ? <button aria-label="Создать альбом" className="albums-icon-button" onClick={onCreate} type="button"><WebpIcon decorative name="plus" size={24} /></button> : null}
    </div>
    <p className="albums-muted">Истории, к которым хочется возвращаться</p>
    <div aria-label="Фильтр альбомов" className="albums-chips">
      {(['all', 'template', 'custom'] as const).map((value, index) => <button aria-pressed={filter === value} key={value} onClick={() => onFilterChange(value)} type="button">{['Все', 'По шаблону', 'Свои'][index]}</button>)}
    </div>
    {loading ? <Loading /> : groups ? <div className="albums-groups">{groups.map((group) => <section aria-label={group.title} className="albums-group" data-albums-group={group.childId ?? 'family'} key={group.key}><h2 className="albums-group-title">{group.title}</h2><div className="albums-catalog">{group.albums.map(albumCard)}</div></section>)}</div> : <div className="albums-catalog">{albums.map(albumCard)}</div>}
    {!loading && !error && !albums.length ? <div className="albums-empty"><WebpIcon decorative name="archive-box" size={48} /><h2>Соберите свою первую историю</h2><p>Здесь будут моменты первого года, открытия и маленькие творения.</p>{role === 'full' ? <button className="albums-primary" onClick={onCreate} type="button">Создать альбом</button> : <p>Альбомы появятся, когда семья их создаст.</p>}</div> : null}
    {catalogCursor && !loading ? <button className="albums-secondary" disabled={loadingMore} onClick={onLoadMore} type="button">Ещё альбомы</button> : null}
  </>
}

function Loading() {
  return <div aria-label="Загрузка альбомов" className="albums-loading" role="status"><span /><span /><span /><span /></div>
}
