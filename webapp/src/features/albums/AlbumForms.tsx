/* eslint-disable typographyPolicy/use-typography-component -- semantic native forms share the scoped album typography. */
import { useRef, useState } from 'react'
import type { AlbumDto, AlbumKind } from '@web-app-demo/contracts'
import { ApiRequestError } from '@/platform/api'
import type { AlbumsApi } from './api'
import { defaultTitle } from './api'
import { kindNames } from './model'

export function AlbumForm({ api, child, album, onCancel, onSaved }: { api: AlbumsApi; child: { id: string; name: string } | null; album?: AlbumDto; onCancel: () => void; onSaved: (album: AlbumDto) => void }) {
  const [kind, setKind] = useState<AlbumKind | null>(album?.kind ?? null)
  const [title, setTitle] = useState(album?.title ?? '')
  const [description, setDescription] = useState(album?.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locked, setLocked] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [version, setVersion] = useState(album?.version ?? 1)
  const attempt = useRef<{ key: string; kind: AlbumKind; title: string; description: string | null } | null>(null)
  const saving = useRef(false)
  async function save() {
    if (!kind || saving.current || conflict) return
    setError(null)
    if (!title.trim() || [...title.trim()].length > 80 || [...description].length > 2000) { setError('Название — от 1 до 80 символов, описание — до 2000.'); return }
    attempt.current ??= { key: crypto.randomUUID(), kind, title: title.trim(), description: description.trim() || null }
    const input = attempt.current; saving.current = true; setBusy(true); setLocked(true)
    try {
      const result = album ? await api.update(album.id, { expectedVersion: version, title: input.title, description: input.description }) : await api.create({ kind: input.kind, childId: input.kind === 'free' ? null : child!.id, title: input.title, description: input.description }, input.key)
      onSaved(result.album)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      const isConflict = reason instanceof ApiRequestError && reason.status === 409
      setConflict(isConflict)
      setError(isConflict ? album ? 'Альбом уже изменили. Обновите данные.' : 'Такой первый год уже существует для ребёнка. Вернитесь в каталог.' : 'Не удалось подтвердить сохранение. Повторите тот же запрос.')
      if (reason instanceof ApiRequestError && reason.status === 422) { setLocked(false); attempt.current = null; setError('Проверьте название и описание.') }
    } finally { saving.current = false; setBusy(false) }
  }
  return <section>
    <header className="albums-toolbar"><button disabled={busy} onClick={onCancel} type="button">‹ Альбомы</button><h1>{album ? 'Об альбоме' : 'Создать альбом'}</h1></header>
    {!kind ? <><p className="albums-muted">Выберите, какую историю хотите сохранить</p><div className="albums-template-list">{(Object.keys(kindNames) as AlbumKind[]).map((value) => <button className={`albums-template albums-kind-${value}`} disabled={value !== 'free' && !child} key={value} onClick={() => { setKind(value); setTitle(defaultTitle(value, child?.name)) }} type="button"><strong>{kindNames[value]}</strong><span>{value === 'year' ? '12 глав о маленьких больших переменах' : value === 'events' ? 'Свои открытия в своём ритме' : value === 'workshop' ? 'Рисунки, поделки и слова ребёнка' : 'Путешествия, праздники и любые истории семьи'}</span>{!child && value !== 'free' ? <small>Сначала заполните профиль ребёнка в разделе «Семья»</small> : null}</button>)}</div></> : <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <p className="albums-kicker">{kindNames[kind]} · {kind === 'free' ? 'Семейный альбом' : child?.name}</p>
      <fieldset disabled={busy || locked}><label className="albums-field">Название альбома<input autoFocus onChange={(event) => setTitle(event.target.value)} required value={title} /><small>{[...title].length}/80</small></label><label className="albums-field">Описание (необязательно)<textarea onChange={(event) => setDescription(event.target.value)} rows={5} value={description} /><small>{[...description].length}/2000</small></label><p className="albums-muted">Обложку можно выбрать из добавленных материалов.</p></fieldset>
      {error ? <p className="albums-error" role="alert">{error}</p> : null}
      {conflict && album ? <button disabled={busy} onClick={() => { setBusy(true); void api.album(album.id).then(({ album: fresh }) => { setTitle(fresh.title); setDescription(fresh.description ?? ''); setVersion(fresh.version); attempt.current = null; setConflict(false); setLocked(false); setError(null) }).catch(() => setError('Не удалось обновить альбом.')).finally(() => setBusy(false)) }} type="button">Обновить данные</button> : <button className="albums-primary" disabled={busy || conflict} type="submit">{busy ? 'Сохраняем…' : locked ? 'Повторить сохранение' : album ? 'Сохранить' : 'Создать'}</button>}
      <button disabled={busy} onClick={onCancel} type="button">Отмена</button>
    </form>}
  </section>
}
