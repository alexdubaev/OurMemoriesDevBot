import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { GiftDto } from '@web-app-demo/contracts'

import { MemolyBottomSheet } from '@/components/MemolyBottomSheet'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { DrawerDescription, DrawerTitle } from '@/components/ui/drawer'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/host-bridge'
import { isActivePrivateCacheIdentity, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'

import { cancelGiftReservation, deleteGift, markGiftBought, reserveGift, unmarkGiftBought } from './api'
import { GiftCard, type GiftActionKind } from './GiftCard'
import { GiftPagePresentation } from './GiftPagePresentation'
import { GiftFormSheet, type GiftFormTarget } from './GiftForm'
import { giftFailureMessage, isGiftStateConflict, reservationConflictMessage, splitGifts, type GiftViewer } from './model'
import { giftsQueryKeys, useGiftList } from './queries'

import './gifts.css'

export type GiftsPageProps = {
  /** The tab stays mounted while hidden; the list reloads each time it becomes visible again. */
  active?: boolean
  child: { id: string; name: string }
  currentUserId: string
  familyId: string
  hostBridge: Pick<HostBridge, 'openExternalLink'>
  isOwner: boolean
  membershipEpoch: number | null
  onAdd: () => void
  onAccessLost: () => void
  onAlbums: () => void
  onFamily: () => void
  onFeed: () => void
  role: 'full' | 'viewer'
  timeZone?: string
  transport: AuthenticatedTransport
}

const actionRequests = {
  reserve: reserveGift,
  cancel: cancelGiftReservation,
  bought: markGiftBought,
  unbought: unmarkGiftBought,
} as const

export function GiftsPage({
  active = true, child, currentUserId, familyId, hostBridge, isOwner, membershipEpoch, onAccessLost, onAdd, onAlbums, onFamily, onFeed, role, timeZone, transport,
}: GiftsPageProps) {
  const queryClient = useQueryClient()
  const scope = { familyId, accountId: currentUserId, membershipEpoch }
  const query = useGiftList(transport, scope, active)
  const accessLossHandled = useRef(false)
  const identityGeneration = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(currentUserId, familyId)
  const isCurrentScope = () => isActivePrivateCacheIdentity(currentUserId, identityGeneration) &&
    privateFamilyCacheGeneration(currentUserId, familyId) === familyGeneration
  const accessDeniedResponse = query.error instanceof ApiRequestError && [403, 404].includes(query.error.status)
  const gifts = accessDeniedResponse ? undefined : query.data
  const viewer: GiftViewer = { currentUserId, role, isOwner }
  const scopeKey = JSON.stringify([familyId, membershipEpoch])
  const accessLossScope = useRef(scopeKey)
  const [form, setForm] = useState<GiftFormTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<GiftDto | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<{ giftId: string; action: GiftActionKind } | null>(null)
  const [boughtOpen, setBoughtOpen] = useState(false)
  const busy = useRef(false)

  useEffect(() => {
    if (accessLossScope.current !== scopeKey) {
      accessLossScope.current = scopeKey
      accessLossHandled.current = false
    }
  }, [scopeKey])

  useEffect(() => {
    if (!(query.error instanceof ApiRequestError) || ![403, 404].includes(query.error.status) || accessLossHandled.current) return
    accessLossHandled.current = true
    void queryClient.cancelQueries({ predicate: ({ queryKey }) => queryKey[0] === 'session' && queryKey[2] === familyId })
    onAccessLost()
  }, [familyId, onAccessLost, query.error, queryClient, scopeKey])

  const refresh = async () => {
    if (!isCurrentScope()) return undefined
    const result = await query.refetch()
    return isCurrentScope() ? result.data : undefined
  }

  async function runAction(gift: GiftDto, action: GiftActionKind) {
    if (busy.current) return
    busy.current = true
    setPending({ giftId: gift.id, action })
    setNotice(null)
    let refreshed = false
    try {
      const { gift: next } = await actionRequests[action](transport, familyId, gift.id, gift.version)
      if (!isCurrentScope()) return
      queryClient.setQueryData<GiftDto[]>(
        giftsQueryKeys.list(familyId, currentUserId, membershipEpoch),
        (current) => current?.map((item) => (item.id === next.id ? next : item)),
      )
    } catch (error) {
      if (action === 'reserve' && error instanceof ApiRequestError && error.code === 'CONFLICT') {
        refreshed = true
        setNotice(reservationConflictMessage(await refresh(), gift.id))
      } else {
        setNotice(giftFailureMessage(error))
        if (isGiftStateConflict(error)) { refreshed = true; await refresh() }
      }
    } finally {
      if (isCurrentScope()) {
        busy.current = false
        setPending(null)
        if (!refreshed) void refresh()
      }
    }
  }

  function openLink(gift: GiftDto) {
    setNotice(null)
    if (!hostBridge.openExternalLink?.(gift.url)) setNotice('Не удалось открыть ссылку. Скопируйте адрес магазина и откройте его в браузере.')
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting || !isCurrentScope()) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteGift(transport, familyId, deleteTarget.id, deleteTarget.version)
      if (!isCurrentScope()) return
      setDeleteTarget(null)
      setNotice('Подарок удалён.')
      void refresh()
    } catch (error) {
      if (isGiftStateConflict(error)) {
        setDeleteTarget(null)
        setNotice(giftFailureMessage(error))
        void refresh()
      } else setDeleteError(giftFailureMessage(error))
    } finally {
      if (isCurrentScope()) setDeleting(false)
    }
  }

  function afterFormSaved(gift: GiftDto) {
    if (!isCurrentScope()) return
    const wasEdit = form?.mode === 'edit'
    setForm(null)
    setNotice(wasEdit ? 'Изменения сохранены.' : 'Подарок добавлен.')
    queryClient.setQueryData<GiftDto[]>(giftsQueryKeys.list(familyId, currentUserId, membershipEpoch), (current) => {
      if (!current) return current
      return current.some((item) => item.id === gift.id)
        ? current.map((item) => (item.id === gift.id ? gift : item))
        : [gift, ...current]
    })
    void refresh()
  }

  const { open, bought } = splitGifts(gifts ?? [])
  const isEmpty = gifts !== undefined && gifts.length === 0
  const renderCard = (gift: GiftDto, variant: 'open' | 'bought') => (
    <li key={gift.id}>
      <GiftCard
        accountId={currentUserId}
        familyId={familyId}
        gift={gift}
        locked={pending !== null || deleting}
        onAction={(item, action) => void runAction(item, action)}
        onDelete={(item) => { setDeleteError(null); setDeleteTarget(item) }}
        onEdit={(item) => setForm({ mode: 'edit', gift: item })}
        onOpenLink={openLink}
        pendingAction={pending?.giftId === gift.id ? pending.action : null}
        scopeKey={scopeKey}
        timeZone={timeZone}
        transport={transport}
        variant={variant}
        viewer={viewer}
      />
    </li>
  )

  return (
    <GiftPagePresentation childName={child.name} onAdd={onAdd} onAlbums={onAlbums} onCreate={() => setForm({ mode: 'create' })} onFamily={onFamily} onFeed={onFeed} role={role} showAddButton={Boolean(gifts?.length)} afterNavigation={<>
      <GiftFormSheet
        accountId={currentUserId}
        familyId={familyId}
        onClose={() => setForm(null)}
        onSaved={afterFormSaved}
        onStale={(message) => { setForm(null); setNotice(message); void refresh() }}
        open={active}
        scopeKey={scopeKey}
        target={form}
        transport={transport}
      />

      <MemolyBottomSheet onOpenChange={(next) => { if (!next && !deleting) setDeleteTarget(null) }} open={active && deleteTarget !== null}>
        {deleteTarget ? (
          <div className="gift-form" data-slot="gift-delete-confirm">
            <DrawerTitle className="gift-form-title">Удалить подарок? Бронь тоже исчезнет.</DrawerTitle>
            <DrawerDescription className="gift-form-subtitle">{deleteTarget.title}</DrawerDescription>
            {deleteError ? <Typography as="p" className="gift-form-failure" role="alert" variant="memoryCaption">{deleteError}</Typography> : null}
            <div className="gift-form-actions">
              <button className="gift-button gift-button--danger gift-button--wide" disabled={deleting} onClick={() => void confirmDelete()} type="button">
                <Typography as="span" variant="memoryButton">{deleting ? 'Удаляем…' : deleteError ? 'Повторить' : 'Удалить'}</Typography>
              </button>
              <button className="gift-button gift-button--wide" disabled={deleting} onClick={() => setDeleteTarget(null)} type="button">
                <Typography as="span" variant="memoryButton">Отмена</Typography>
              </button>
            </div>
          </div>
        ) : null}
      </MemolyBottomSheet>
    </>}>
      <>

      {notice ? <Typography aria-live="polite" as="p" className="gifts-notice" role="status" variant="memoryCaption">{notice}</Typography> : null}

      {query.isError && gifts ? (
        <div className="gifts-banner" role="alert">
          <Typography as="span" variant="memoryCaption">Не удалось обновить список. Показаны сохранённые данные.</Typography>
          <button className="gift-link-button" disabled={query.isFetching} onClick={() => void refresh()} type="button">
            <Typography as="span" variant="memoryButton">Повторить</Typography>
          </button>
        </div>
      ) : null}

      {gifts === undefined && query.isError ? (
        <div className="gifts-state" role="alert">
          <WebpIcon decorative name="warning" size={40} />
          <Typography as="h2" variant="memoryEmptyTitle">Не удалось загрузить подарки</Typography>
          <Typography as="p" className="gifts-state-text" variant="memoryCaption">Проверьте соединение и попробуйте ещё раз.</Typography>
          <button className="gift-button gift-button--primary" disabled={query.isFetching} onClick={() => void refresh()} type="button">
            <Typography as="span" variant="memoryButton">Повторить</Typography>
          </button>
        </div>
      ) : null}

      {gifts === undefined && !query.isError ? (
        <Typography aria-live="polite" as="p" className="gifts-loading" role="status" variant="memoryCaption">Загружаем подарки…</Typography>
      ) : null}

      {isEmpty ? (
        <div className="gifts-state" data-slot="gifts-empty">
          <WebpIcon decorative name="gift" size={56} />
          {role === 'full' ? <>
            <Typography as="h2" variant="memoryEmptyTitle">Пока нет подарков</Typography>
            <Typography as="p" className="gifts-state-text" variant="memoryCaption">Здесь будут подарки для {child.name}. Добавьте ссылку на товар, название и фото</Typography>
            <button className="gift-button gift-button--primary" onClick={() => setForm({ mode: 'create' })} type="button">
              <Typography as="span" variant="memoryButton">Добавить подарок</Typography>
            </button>
          </> : <>
            <Typography as="h2" variant="memoryEmptyTitle">Пока нет подарков</Typography>
            <Typography as="p" className="gifts-state-text" variant="memoryCaption">Родители ещё не добавили подарки</Typography>
          </>}
        </div>
      ) : null}

      {gifts && gifts.length > 0 ? (
        open.length > 0
          ? <ul className="gifts-list" data-slot="gifts-open-list">{open.map((gift) => renderCard(gift, 'open'))}</ul>
          : <Typography as="p" className="gifts-state-text" variant="memoryCaption">Свободных подарков пока нет.</Typography>
      ) : null}

      {bought.length > 0 ? (
        <section className="gifts-bought" data-slot="gifts-bought">
          <button aria-controls="gifts-bought-list" aria-expanded={boughtOpen} className="gifts-bought-toggle" onClick={() => setBoughtOpen((value) => !value)} type="button">
            <Typography as="span" variant="memoryBodyMedium">Подарено ({bought.length})</Typography>
            <span aria-hidden="true" className="gifts-bought-chevron" data-open={boughtOpen}>
              <WebpIcon decorative monochrome name="chevron" size={18} />
            </span>
          </button>
          {boughtOpen ? <ul className="gifts-list" id="gifts-bought-list">{bought.map((gift) => renderCard(gift, 'bought'))}</ul> : null}
        </section>
      ) : null}

      </>
    </GiftPagePresentation>
  )
}
