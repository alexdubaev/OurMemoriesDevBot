import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'
import { Typography } from '@/components/typography'
import { CommentComposer } from './CommentComposer'
import { CommentItem } from './CommentItem'
import { FeedSharedAuthorAvatars } from '@/features/feed/shared-author-avatars'
import { createComment, deleteComment, updateComment } from './api'
import { cancelCommentSummaryQueries, commentsQueryKeys, invalidateCommentSummaryForMemory, removeCommentScopeQueries, useCommentsList, writeCommentSummary } from './queries'
import { createCommentAttempt, isCurrentCommentScope, mergeCommentPages, normalizeCommentBody, type CommentCreateAttempt, type CommentScope } from './state'
import { isActivePrivateCacheIdentity, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import './comments.css'

export function CommentsPanel({ open, scope, familyTimezone, transport, hostBridge, onClose, returnFocusRef }: {
  open: boolean
  scope: CommentScope
  familyTimezone: string
  transport: AuthenticatedTransport
  hostBridge: { onBack: (callback: () => void) => () => void }
  onClose: () => void
  returnFocusRef: React.RefObject<HTMLElement | null>
}) {
  const queryClient = useQueryClient()
  const lease = useRef(true)
  const listRef = useRef<HTMLDivElement>(null)
  const historyEntry = useRef<string | null>(null)
  const historySetupGeneration = useRef(0)
  const closingFromHistory = useRef(false)
  const [closeChoice, setCloseChoice] = useState<'dirty' | 'pending' | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mutationController = useRef<AbortController | null>(null)
  const [uncertainAttempt, setUncertainAttempt] = useState<CommentCreateAttempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; version: number; body: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; version: number } | null>(null)
  const list = useCommentsList(transport, scope, open, lease)
  const comments = useMemo(() => mergeCommentPages((list.data?.pages ?? []).map((page) => page.items)), [list.data])
  const currentScope = useRef(scope)
  const { accountId, familyId, membershipEpoch, memoryId } = scope
  const scrollRestore = useRef<{ data: InfiniteData<CommentPage> | undefined; pageCount: number; height: number; top: number } | null>(null)
  const previousListData = useRef<InfiniteData<CommentPage> | undefined>(undefined)
  useLayoutEffect(() => { currentScope.current = { accountId, familyId, membershipEpoch, memoryId } }, [accountId, familyId, membershipEpoch, memoryId])
  const identityGeneration = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(scope.accountId, scope.familyId)
  const leaseIsCurrent = () => isCurrentCommentScope(scope, currentScope.current, lease.current) &&
    isActivePrivateCacheIdentity(scope.accountId, identityGeneration) && privateFamilyCacheGeneration(scope.accountId, scope.familyId) === familyGeneration

  const closeNow = useCallback((fromHistory = false) => {
    setCloseChoice(null)
    if (!fromHistory && historyEntry.current && window.history.state?.__memolyComments === historyEntry.current) {
      closingFromHistory.current = true
      historyEntry.current = null
      window.history.back()
    }
    onClose()
  }, [onClose])
  const requestClose = useCallback((fromHistory = false) => {
    const hasDraft = Boolean(draft.trim() || edit)
    if (busyRef.current || uncertainAttempt) { setCloseChoice('pending'); return }
    if (hasDraft) { setCloseChoice('dirty'); return }
    closeNow(fromHistory)
  }, [closeNow, draft, edit, uncertainAttempt])
  const requestCloseLatest = useRef(requestClose)
  useLayoutEffect(() => { requestCloseLatest.current = requestClose }, [requestClose])

  const cancelCloseChoice = useCallback(() => {
    setCloseChoice(null)
    if (closingFromHistory.current) {
      const token = `comments:${crypto.randomUUID()}`
      window.history.pushState({ ...(window.history.state ?? {}), __memolyComments: token }, '')
      historyEntry.current = token
    }
    closingFromHistory.current = false
  }, [])

  useLayoutEffect(() => {
    const setupGeneration = ++historySetupGeneration.current
    lease.current = open
    if (!open) return
    let token = historyEntry.current
    if (!token || window.history.state?.__memolyComments !== token) {
      token = `comments:${crypto.randomUUID()}`
      const previous = window.history.state
      historyEntry.current = token
      window.history.pushState({ ...(previous && typeof previous === 'object' ? previous : {}), __memolyComments: token }, '')
    }
    const onPopState = () => {
      if (!historyEntry.current) return
      closingFromHistory.current = true
      historyEntry.current = null
      requestCloseLatest.current(true)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      lease.current = false
      window.removeEventListener('popstate', onPopState)
      const ownedToken = historyEntry.current
      queueMicrotask(() => {
        if (historySetupGeneration.current !== setupGeneration || !ownedToken || historyEntry.current !== ownedToken) return
        if (window.history.state?.__memolyComments === ownedToken) {
          historyEntry.current = null
          window.history.back()
        }
      })
    }
  // This effect owns one history entry per panel mount.
  }, [open])

  useEffect(() => {
    if (!open) return
    const summaryScope = { accountId, familyId, membershipEpoch, memoryId }
    void invalidateCommentSummaryForMemory(queryClient, summaryScope)
    const refreshSummary = () => { if (!document.hidden) void invalidateCommentSummaryForMemory(queryClient, summaryScope) }
    window.addEventListener('focus', refreshSummary)
    document.addEventListener('visibilitychange', refreshSummary)
    return () => { window.removeEventListener('focus', refreshSummary); document.removeEventListener('visibilitychange', refreshSummary) }
  }, [open, queryClient, accountId, familyId, membershipEpoch, memoryId])

  useEffect(() => {
    if (!open) return
    return hostBridge.onBack(() => {
      if (closeChoice) { cancelCloseChoice(); return }
      if (deleteTarget) { setDeleteTarget(null); return }
      if (historyEntry.current && window.history.state?.__memolyComments === historyEntry.current) window.history.back()
      else requestClose()
    })
  }, [cancelCloseChoice, closeChoice, deleteTarget, hostBridge, open, requestClose])

  useEffect(() => () => {
    lease.current = false
    mutationController.current?.abort()
    const key = commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
    queryClient.removeQueries({ queryKey: key, exact: true })
  }, [queryClient, scope.accountId, scope.familyId, scope.membershipEpoch, scope.memoryId])

  useEffect(() => {
    if (open) return
    void queryClient.cancelQueries({ queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), exact: true })
  }, [open, queryClient, scope.accountId, scope.familyId, scope.membershipEpoch, scope.memoryId])

  useLayoutEffect(() => {
    const previous = previousListData.current
    if (previous === list.data) return
    previousListData.current = list.data
    if (scrollRestore.current && scrollRestore.current.data === previous && list.data) {
      const anchor = scrollRestore.current
      scrollRestore.current = null
      if (list.data.pages.length > anchor.pageCount && listRef.current) {
        listRef.current.scrollTop = anchor.top + (listRef.current.scrollHeight - anchor.height)
      }
    } else if (!previous && list.data && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [list.data])

  async function submitCreate(attempt: CommentCreateAttempt) {
    const captured = uncertainAttempt ?? createCommentAttempt(attempt.body, attempt.idempotencyKey)
    if (busyRef.current || !leaseIsCurrent()) return
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await createComment(transport, scope.familyId, scope.memoryId, captured, controller.signal)
      if (!leaseIsCurrent()) return
      setUncertainAttempt(null); setDraft('')
      await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, memoryId)
      if (!leaseIsCurrent()) return
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      void invalidateCommentSummaryForMemory(queryClient, { accountId, familyId, membershipEpoch, memoryId })
      updateCachedPages(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), (items) => [result.comment, ...items.filter((item) => item.id !== result.comment.id)])
      await queryClient.invalidateQueries({ queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), exact: true })
      requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight })
    } catch (cause) {
      if (!leaseIsCurrent()) return
      if (cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        setError('Не удалось отправить комментарий. Проверьте текст и повторите попытку.')
        setUncertainAttempt(null)
        if (cause.status === 403) await list.refetch()
      } else {
        setError('Неизвестно, удалось ли отправить комментарий. Повторите запрос, чтобы проверить результат.')
        setUncertainAttempt(captured)
      }
    } finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false) }
  }

  async function saveEdit() {
    if (!edit || busyRef.current) return
    let body: string
    try { body = normalizeCommentBody(edit.body) } catch { setError('Введите комментарий длиной от 1 до 2 000 символов.'); return }
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await updateComment(transport, scope.familyId, scope.memoryId, edit.id, { body, expectedVersion: edit.version }, controller.signal)
      if (!leaseIsCurrent()) return
      setEdit(null); await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, memoryId)
      if (!leaseIsCurrent()) return
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      void invalidateCommentSummaryForMemory(queryClient, { accountId, familyId, membershipEpoch, memoryId })
      updateCachedPages(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), (items) => items.map((item) => item.id === result.comment.id ? result.comment : item))
      await queryClient.invalidateQueries({ queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), exact: true })
    } catch (cause) {
      if (!leaseIsCurrent()) return
      if (cause instanceof ApiRequestError && cause.code === 'VERSION_CONFLICT') {
        setError('Комментарий уже изменён. Черновик сохранён; проверьте актуальную версию и сохраните ещё раз.')
        const refreshed = await list.refetch()
        const latest = refreshed.data?.pages.flatMap((page) => page.items).find((item) => item.id === edit.id)
        if (latest && leaseIsCurrent()) setEdit((current) => current?.id === latest.id ? { ...current, version: latest.version } : current)
      }
      else {
        setError('Не удалось изменить комментарий. Черновик сохранён.')
        if (cause instanceof ApiRequestError && (cause.status === 403 || cause.status === 404 || (cause.status === 409 && cause.code === 'CONFLICT'))) {
          const refreshed = await list.refetch()
          const latest = refreshed.data?.pages.flatMap((page) => page.items).find((item) => item.id === edit.id)
          if (!leaseIsCurrent()) return
          if (!latest && cause.status === 409) setEdit(null)
        }
      }
    } finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false) }
  }

  async function confirmDelete() {
    if (!deleteTarget || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await deleteComment(transport, scope.familyId, scope.memoryId, deleteTarget.id, deleteTarget.version, controller.signal)
      if (!leaseIsCurrent()) return
      setDeleteTarget(null); if (edit?.id === result.deletedId) setEdit(null)
      await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, memoryId)
      if (!leaseIsCurrent()) return
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      void invalidateCommentSummaryForMemory(queryClient, { accountId, familyId, membershipEpoch, memoryId })
      updateCachedPages(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), (items) => items.filter((item) => item.id !== result.deletedId))
      await queryClient.invalidateQueries({ queryKey: commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), exact: true })
    } catch (cause) {
      if (!leaseIsCurrent()) return
      const conflict = cause instanceof ApiRequestError && cause.code === 'VERSION_CONFLICT'
      setError(conflict ? 'Комментарий изменён. Проверьте актуальную версию и подтвердите удаление ещё раз.' : 'Не удалось удалить комментарий.')
      if (conflict) setDeleteTarget(null)
      const refreshed = await list.refetch()
      if (!leaseIsCurrent()) return
      if (deleteTarget && !conflict) {
        const latest = refreshed.data?.pages.flatMap((page) => page.items).find((item) => item.id === deleteTarget.id)
        if (!latest) setDeleteTarget(null)
      }
    }
    finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false) }
  }

  const readAccessLost = Boolean(list.data && list.error instanceof ApiRequestError && [403, 404].includes(list.error.status))
  useEffect(() => {
    if (!readAccessLost || !open) return
    removeCommentScopeQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch)
    onClose()
  }, [onClose, open, queryClient, readAccessLost, scope.accountId, scope.familyId, scope.membershipEpoch])

  return <DialogPrimitive.Root onOpenChange={(next) => { if (!next) requestClose() }} open={open}>
    <DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-overlay" />
      <DialogPrimitive.Content aria-describedby="comments-description" className="comments-panel" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }}>
        <header className="comments-header"><div><DialogPrimitive.Title className="comments-title">Комментарии</DialogPrimitive.Title><DialogPrimitive.Description className="comments-subtitle" id="comments-description">Обсуждение семейного воспоминания</DialogPrimitive.Description></div><div className="comments-header-actions"><button className="comments-refresh" disabled={list.isFetching} onClick={() => void list.refetch()} type="button"><Typography as="span" variant="memoryButton">Обновить</Typography></button><button aria-label="Закрыть комментарии" className="comments-close" onClick={() => requestClose()} type="button"><Typography as="span" aria-hidden="true" variant="memoryToolbar">×</Typography></button></div></header>
        {error ? <Typography as="p" className="comments-error" role="alert" variant="bodyXs">{error}</Typography> : null}
        <div aria-live="polite" className="comments-list" ref={listRef}>
          {list.isPending ? <Typography as="p" className="comments-state" variant="bodySm">Загрузка комментариев…</Typography> : null}
          {list.isError ? <div className="comments-state" role="alert"><Typography as="p" variant="bodySm">Не удалось загрузить комментарии.</Typography><button onClick={() => void list.refetch()} type="button"><Typography as="span" variant="memoryButton">Повторить</Typography></button></div> : null}
          {!list.isPending && !list.isError && comments.length === 0 ? <Typography as="p" className="comments-state" variant="bodySm">Пока нет комментариев. Напишите первым</Typography> : null}
          {comments.length > 0 && list.hasNextPage ? <button className="comments-older" disabled={list.isFetchingNextPage} onClick={() => { if (listRef.current && list.data) scrollRestore.current = { data: list.data, pageCount: list.data.pages.length, height: listRef.current.scrollHeight, top: listRef.current.scrollTop }; void list.fetchNextPage() }} type="button"><Typography as="span" variant="memoryButton">{list.isFetchingNextPage ? 'Загрузка…' : 'Показать более ранние'}</Typography></button> : null}
          <FeedSharedAuthorAvatars authors={comments.map((comment) => ({ path: comment.author.avatarPath }))} enabled={true} familyId={scope.familyId} membershipEpoch={scope.membershipEpoch} transport={transport} userId={scope.accountId}>
            {comments.map((comment) => <CommentItem comment={comment} familyTimezone={familyTimezone} key={comment.id} onDelete={(item) => setDeleteTarget({ id: item.id, version: item.version })} onEdit={(item) => { setError(null); setEdit({ id: item.id, version: item.version, body: item.body }) }} />)}
          </FeedSharedAuthorAvatars>
        </div>
        {edit ? <form className="comments-composer" onSubmit={(event) => { event.preventDefault(); void saveEdit() }}><textarea aria-label="Изменить комментарий" disabled={busy} onChange={(event) => setEdit({ ...edit, body: event.currentTarget.value })} value={edit.body} /><div><button disabled={busy} type="button" onClick={() => setEdit(null)}><Typography as="span" variant="memoryButton">Отмена</Typography></button><button disabled={busy} type="submit"><Typography as="span" variant="memoryButton">Сохранить</Typography></button></div></form> : <CommentComposer busy={busy} onChange={setDraft} onCreate={submitCreate} uncertainAttempt={uncertainAttempt} value={draft} />}
        <DialogPrimitive.Root onOpenChange={(next) => { if (!next) cancelCloseChoice() }} open={closeChoice !== null}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-confirm-overlay" /><DialogPrimitive.Content className="comments-confirm"><DialogPrimitive.Title>{closeChoice === 'pending' ? 'Отправка может быть сохранена' : 'Черновик не сохранён'}</DialogPrimitive.Title><Typography as="p" variant="bodySm">{closeChoice === 'pending' ? 'Запрос ещё не подтверждён. Закрыть обсуждение?' : 'Закрыть обсуждение и удалить черновик?'}</Typography><div><button onClick={cancelCloseChoice} type="button"><Typography as="span" variant="memoryButton">Продолжить писать</Typography></button><button onClick={() => { setDraft(''); setEdit(null); setUncertainAttempt(null); mutationController.current?.abort(); closeNow(closingFromHistory.current); closingFromHistory.current = false }} type="button"><Typography as="span" variant="memoryButton">Закрыть без сохранения</Typography></button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
        <DialogPrimitive.Root onOpenChange={(next) => { if (!next && !busy) setDeleteTarget(null) }} open={deleteTarget !== null}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-confirm-overlay" /><DialogPrimitive.Content className="comments-confirm"><DialogPrimitive.Title className="comments-confirm-title">Удалить комментарий?</DialogPrimitive.Title><Typography as="p" variant="bodySm">Это действие нельзя отменить.</Typography><div><button onClick={() => setDeleteTarget(null)} type="button"><Typography as="span" variant="memoryButton">Отмена</Typography></button><button disabled={busy} onClick={() => void confirmDelete()} type="button"><Typography as="span" variant="memoryButton">Удалить</Typography></button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

function updateCachedPages(client: ReturnType<typeof useQueryClient>, key: readonly unknown[], update: (items: CommentDto[]) => CommentDto[]) {
  const cached = client.getQueryData<InfiniteData<CommentPage>>(key)
  if (!cached) return
  client.setQueryData<InfiniteData<CommentPage>>(key, { ...cached, pages: cached.pages.map((page) => ({ ...page, items: update(page.items) })) })
}
