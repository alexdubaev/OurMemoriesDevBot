import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import type { CommentDto, CommentPage } from '@web-app-demo/contracts'
import { Typography } from '@/components/typography'
import { CommentComposer } from './CommentComposer'
import { CommentItem } from './CommentItem'
import { FeedSharedAuthorAvatars } from '@/features/feed'
import { createComment, deleteComment, updateComment } from './api'
import { cancelCommentSummaryQueries, commentsQueryKeys, removeCommentScopeQueries, useCommentsList, writeCommentSummary } from './queries'
import { COMMENT_ACTIVE_REFRESH_MS, COMMENT_IDLE_AFTER_MS, COMMENT_IDLE_REFRESH_MS, compareCommentPosition, createCommentAttempt, isCurrentCommentScope, mergeCommentPages, normalizeCommentBody, type CommentCreateAttempt, type CommentScope } from './state'
import { isActivePrivateCacheIdentity, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import './comments.css'

export function CommentsPanel({ open, scope, familyTimezone, transport, hostBridge, onClose, returnFocusRef, hostInsets }: {
  open: boolean
  scope: CommentScope
  familyTimezone: string
  transport: AuthenticatedTransport
  hostBridge: { onBack: (callback: () => void) => () => void }
  onClose: () => void
  returnFocusRef: React.RefObject<HTMLElement | null>
  hostInsets?: { top: number; right: number; bottom: number; left: number }
}) {
  const queryClient = useQueryClient()
  const lease = useRef(true)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const historyEntry = useRef<string | null>(null)
  const historySetupGeneration = useRef({ generation: 0 })
  const closingFromHistory = useRef(false)
  const [closeChoice, setCloseChoice] = useState<'dirty' | 'pending' | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const busyRef = useRef(false)
  const mutationController = useRef<AbortController | null>(null)
  const [uncertainAttempt, setUncertainAttempt] = useState<CommentCreateAttempt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newCommentsCount, setNewCommentsCount] = useState(0)
  const unreadNewCommentIds = useRef(new Set<string>())
  const [edit, setEdit] = useState<{ id: string; version: number; body: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; version: number } | null>(null)
  const readingAnchor = useRef<{ id: string | null; offset: number; atBottom: boolean; ids: Set<string>; newest: CommentDto | null } | null>(null)
  const previousListData = useRef<InfiniteData<CommentPage> | undefined>(undefined)
  const captureReadingAnchor = useCallback(() => {
    const element = listRef.current
    if (!element) return
    const atBottom = element.scrollHeight - element.clientHeight - element.scrollTop <= 24
    const rows = [...element.querySelectorAll<HTMLElement>('[data-comment-id]')]
    const firstVisible = rows.find((row) => row.getBoundingClientRect().bottom > element.getBoundingClientRect().top)
    const rowRect = firstVisible?.getBoundingClientRect()
    const previousItems = previousListData.current?.pages.flatMap((page) => page.items) ?? []
    readingAnchor.current = {
      id: firstVisible?.dataset.commentId ?? null,
      offset: rowRect ? rowRect.top - element.getBoundingClientRect().top : 0,
      atBottom,
      ids: new Set(previousItems.map((item) => item.id)),
      newest: previousItems[0] ?? null,
    }
  }, [])
  const list = useCommentsList(transport, scope, open, lease, captureReadingAnchor)
  const refreshOlderWindow = list.refreshOlderWindow
  const suspendBackgroundReads = list.suspendBackgroundReads
  useLayoutEffect(() => { lease.current = open }, [open])
  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])
  const comments = useMemo(() => mergeCommentPages((list.data?.pages ?? []).map((page) => page.items)), [list.data])
  const currentScope = useRef(scope)
  const { accountId, familyId, membershipEpoch, memoryId } = scope
  const { refreshCurrentWindow, retryAt } = list
  const retryAtRef = useRef(retryAt)
  useLayoutEffect(() => { retryAtRef.current = retryAt }, [retryAt])
  const clearUnreadComments = useCallback(() => {
    unreadNewCommentIds.current.clear()
    setNewCommentsCount(0)
  }, [])
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
    const owner = historySetupGeneration.current
    const setupGeneration = ++owner.generation
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
        if (owner.generation !== setupGeneration || !ownedToken || historyEntry.current !== ownedToken) return
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
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    let generation = 0
    const commentsListElement = listRef.current
    let lastRefreshAt = Date.now()
    let lastActivityAt = Date.now()
    const clearTimer = () => { generation += 1; if (timer !== undefined) clearTimeout(timer); timer = undefined }
    const refreshReadingWindow = async () => {
      const key = commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
      const element = listRef.current
      const bounds = element?.getBoundingClientRect()
      const visibleCommentIds = element && bounds
        ? [...element.querySelectorAll<HTMLElement>('[data-comment-id]')]
          .filter((row) => {
            const rowBounds = row.getBoundingClientRect()
            return rowBounds.bottom > bounds.top && rowBounds.top < bounds.bottom
          })
          .map((row) => row.dataset.commentId)
          .filter((id): id is string => Boolean(id))
        : []
      await refreshCurrentWindow()
      const refreshedCursors = new Set<string>()
      const refreshedCommentIds = new Set<string>()
      for (let pass = 0; pass < visibleCommentIds.length; pass += 1) {
        const data = queryClient.getQueryData<InfiniteData<CommentPage, string | null>>(key)
        if (!data) break
        const cursor = visibleCommentIds.map((id) => {
          if (refreshedCommentIds.has(id)) return null
          const pageIndex = data.pages.findIndex((page) => page.items.some((item) => item.id === id))
          return pageIndex > 0 ? { index: pageIndex, cursor: data.pageParams[pageIndex] } : null
        }).filter((candidate): candidate is { index: number; cursor: string | null } => candidate !== null)
          .sort((left, right) => left.index - right.index)
          .find((candidate) => candidate.cursor !== null && !refreshedCursors.has(candidate.cursor))
        if (!cursor) break
        refreshedCursors.add(cursor.cursor!)
        await refreshOlderWindow(cursor.cursor!)
        const updated = queryClient.getQueryData<InfiniteData<CommentPage, string | null>>(key)
        const refreshedIndex = updated?.pageParams.findIndex((item) => item === cursor.cursor) ?? -1
        for (const comment of updated?.pages[refreshedIndex]?.items ?? []) refreshedCommentIds.add(comment.id)
      }
    }
    const schedule = (immediate = false) => {
      if (disposed) return
      clearTimer()
      if (!open || document.hidden || !navigator.onLine) return
      const scheduledGeneration = generation
      const delay = immediate ? 0 : (Date.now() - lastActivityAt >= COMMENT_IDLE_AFTER_MS ? COMMENT_IDLE_REFRESH_MS : COMMENT_ACTIVE_REFRESH_MS) - (Date.now() - lastRefreshAt)
      const retryDelay = Math.max(0, retryAtRef.current - Date.now())
      timer = setTimeout(async () => {
        timer = undefined
        if (disposed || scheduledGeneration !== generation) return
        if (document.hidden || !navigator.onLine) { suspendBackgroundReads(); return }
        if (Date.now() < retryAtRef.current) { schedule(false); return }
        await refreshReadingWindow()
        if (disposed || scheduledGeneration !== generation) return
        lastRefreshAt = Date.now()
        schedule(false)
      }, Math.max(0, delay, retryDelay))
    }
    const activity = () => { lastActivityAt = Date.now(); schedule(false) }
    const onScroll = () => {
      const element = listRef.current
      if (element && element.scrollHeight - element.clientHeight - element.scrollTop <= 24) clearUnreadComments()
      activity()
    }
    const trigger = () => { if (document.hidden || !navigator.onLine) { clearTimer(); suspendBackgroundReads(); return }; schedule(true) }
    const panel = panelRef.current
    panel?.addEventListener('pointerdown', activity, { passive: true })
    panel?.addEventListener('keydown', activity)
    commentsListElement?.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('focus', trigger)
    window.addEventListener('online', trigger)
    window.addEventListener('offline', trigger)
    document.addEventListener('visibilitychange', trigger)
    schedule(true)
    return () => {
      disposed = true
      clearTimer()
      suspendBackgroundReads()
      panel?.removeEventListener('pointerdown', activity)
      panel?.removeEventListener('keydown', activity)
      commentsListElement?.removeEventListener('scroll', onScroll)
      window.removeEventListener('focus', trigger)
      window.removeEventListener('online', trigger)
      window.removeEventListener('offline', trigger)
      document.removeEventListener('visibilitychange', trigger)
    }
  }, [clearUnreadComments, open, queryClient, refreshCurrentWindow, refreshOlderWindow, scope.accountId, scope.familyId, scope.membershipEpoch, scope.memoryId, suspendBackgroundReads])

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
    const dataChanged = previous !== list.data
    if (!dataChanged && !readingAnchor.current) return
    if (dataChanged) previousListData.current = list.data
    const element = listRef.current
    if (!element || !list.data) return
    const anchor = readingAnchor.current
    if (!anchor && !previous && list.data) {
      element.scrollTop = element.scrollHeight
    }
    else if (anchor?.atBottom) {
      if (unreadNewCommentIds.current.size > 0 || newCommentsCount > 0) { clearUnreadComments(); return }
      element.scrollTop = element.scrollHeight
    }
    else if (anchor) {
      for (const item of mergeCommentPages(list.data.pages.map((page) => page.items))) {
        if (!anchor.ids.has(item.id) && (!anchor.newest || compareCommentPosition(item, anchor.newest) > 0)) unreadNewCommentIds.current.add(item.id)
      }
      const nextCount = unreadNewCommentIds.current.size
      if (nextCount !== newCommentsCount) { setNewCommentsCount(nextCount); return }
      const row = anchor.id ? element.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(anchor.id)}"]`) : null
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
    }
    readingAnchor.current = null
  }, [clearUnreadComments, list.data, newCommentsCount])

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return
    const panel = panelRef.current
    const viewport = window.visualViewport
    let frame = 0
    const updateViewport = () => {
      captureReadingAnchor()
      const height = viewport?.height ?? window.innerHeight
      const offsetTop = viewport?.offsetTop ?? 0
      panel.style.setProperty('--comments-vv-height', `${height}px`)
      panel.style.setProperty('--comments-vv-top', `${offsetTop}px`)
      panel.style.setProperty('--comments-vv-bottom', `${Math.max(0, window.innerHeight - offsetTop - height)}px`)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const element = listRef.current
        const anchor = readingAnchor.current
        readingAnchor.current = null
        if (!element || !anchor) return
        if (anchor.atBottom) element.scrollTop = element.scrollHeight
        else if (anchor.id) {
          const row = element.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(anchor.id)}"]`)
          if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - anchor.offset
        }
      })
    }
    updateViewport()
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      cancelAnimationFrame(frame)
    }
  }, [captureReadingAnchor, open])

  async function submitCreate(attempt: CommentCreateAttempt) {
    const captured = uncertainAttempt ?? createCommentAttempt(attempt.body, attempt.idempotencyKey)
    if (busyRef.current || !leaseIsCurrent()) return
    list.beginMutation()
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await createComment(transport, scope.familyId, scope.memoryId, captured, controller.signal)
      if (!leaseIsCurrent()) return
      await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
      if (!leaseIsCurrent()) return
      setUncertainAttempt(null); setDraft('')
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      captureReadingAnchor()
      upsertConfirmedComment(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), result.comment, result.summary, true)
    } catch (cause) {
      if (!leaseIsCurrent()) return
      if (cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        setError('Не удалось отправить комментарий. Проверьте текст и повторите попытку.')
        setUncertainAttempt(null)
        if (cause.status === 403) await list.refreshCurrentWindow(true)
      } else {
        setError('Неизвестно, удалось ли отправить комментарий. Повторите запрос, чтобы проверить результат.')
        setUncertainAttempt(captured)
      }
    } finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false); list.endMutation(); void list.refreshCurrentWindow() }
  }

  async function saveEdit() {
    if (!edit || busyRef.current) return
    let body: string
    try { body = normalizeCommentBody(edit.body) } catch { setError('Введите комментарий длиной от 1 до 2 000 символов.'); return }
    let refreshedTargetWindow = false
    list.beginMutation()
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await updateComment(transport, scope.familyId, scope.memoryId, edit.id, { body, expectedVersion: edit.version }, controller.signal)
      if (!leaseIsCurrent()) return
      await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
      if (!leaseIsCurrent()) return
      setEdit(null)
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      captureReadingAnchor()
      upsertConfirmedComment(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), result.comment, result.summary, false)
    } catch (cause) {
      if (!leaseIsCurrent()) return
      if (cause instanceof ApiRequestError && cause.code === 'VERSION_CONFLICT') {
        setError('Комментарий уже изменён. Черновик сохранён; проверьте актуальную версию и сохраните ещё раз.')
        list.endMutation()
        await refreshCommentTarget(edit.id)
        refreshedTargetWindow = true
        const latest = queryClient.getQueryData<InfiniteData<CommentPage>>(commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId))?.pages.flatMap((page) => page.items).find((item) => item.id === edit.id)
        if (latest && leaseIsCurrent()) setEdit((current) => current?.id === latest.id ? { ...current, version: latest.version } : current)
      }
      else {
        setError('Не удалось изменить комментарий. Черновик сохранён.')
        if (cause instanceof ApiRequestError && (cause.status === 403 || cause.status === 404 || (cause.status === 409 && cause.code === 'CONFLICT'))) {
          list.endMutation()
          await refreshCommentTarget(edit.id)
          refreshedTargetWindow = true
          const latest = queryClient.getQueryData<InfiniteData<CommentPage>>(commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId))?.pages.flatMap((page) => page.items).find((item) => item.id === edit.id)
          if (!leaseIsCurrent()) return
          if (!latest && cause.status === 409) setEdit(null)
        }
      }
    } finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false); list.endMutation(); if (!refreshedTargetWindow) void list.refreshCurrentWindow() }
  }

  async function confirmDelete() {
    if (!deleteTarget || busyRef.current) return
    let refreshedTargetWindow = false
    list.beginMutation()
    busyRef.current = true; setBusy(true); setError(null)
    const controller = new AbortController(); mutationController.current = controller
    try {
      const result = await deleteComment(transport, scope.familyId, scope.memoryId, deleteTarget.id, deleteTarget.version, controller.signal)
      if (!leaseIsCurrent()) return
      await cancelCommentSummaryQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
      if (!leaseIsCurrent()) return
      setDeleteTarget(null); if (edit?.id === result.deletedId) setEdit(null)
      writeCommentSummary(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch, result.summary)
      captureReadingAnchor()
      removeConfirmedComment(queryClient, commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId), result.deletedId, result.summary)
    } catch (cause) {
      if (!leaseIsCurrent()) return
      const conflict = cause instanceof ApiRequestError && cause.code === 'VERSION_CONFLICT'
      setError(conflict ? 'Комментарий изменён. Проверьте актуальную версию и подтвердите удаление ещё раз.' : 'Не удалось удалить комментарий.')
      if (conflict) setDeleteTarget(null)
      list.endMutation()
      await refreshCommentTarget(deleteTarget.id)
      refreshedTargetWindow = true
      if (!leaseIsCurrent()) return
      if (deleteTarget && !conflict) {
        const latest = queryClient.getQueryData<InfiniteData<CommentPage>>(commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId))?.pages.flatMap((page) => page.items).find((item) => item.id === deleteTarget.id)
        if (!latest) setDeleteTarget(null)
      }
    }
    finally { if (mutationController.current === controller) mutationController.current = null; busyRef.current = false; setBusy(false); list.endMutation(); if (!refreshedTargetWindow) void list.refreshCurrentWindow() }
  }

  async function refreshCommentTarget(commentId: string) {
    const key = commentsQueryKeys.list(scope.familyId, scope.accountId, scope.membershipEpoch, scope.memoryId)
    const data = queryClient.getQueryData<InfiniteData<CommentPage, string | null>>(key)
    const pageIndex = data?.pages.findIndex((page) => page.items.some((item) => item.id === commentId)) ?? -1
    const cursor = pageIndex > 0 ? data?.pageParams[pageIndex] : null
    if (cursor) await list.refreshOlderWindow(cursor)
    else await list.refreshCurrentWindow(true)
  }

  const readAccessLost = Boolean(list.data && list.error instanceof ApiRequestError && [403, 404].includes(list.error.status))
  useEffect(() => {
    if (!readAccessLost || !open) return
    removeCommentScopeQueries(queryClient, scope.familyId, scope.accountId, scope.membershipEpoch)
    onClose()
  }, [onClose, open, queryClient, readAccessLost, scope.accountId, scope.familyId, scope.membershipEpoch])

  return <DialogPrimitive.Root onOpenChange={(next) => { if (!next) requestClose() }} open={open}>
    <DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-overlay" />
      <DialogPrimitive.Content aria-describedby={undefined} aria-label="Комментарии" className="comments-panel" onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true }) }} onOpenAutoFocus={(event) => { event.preventDefault(); closeButtonRef.current?.focus({ preventScroll: true }) }} ref={panelRef} style={{ '--comments-host-top': `${hostInsets?.top ?? 0}px`, '--comments-host-right': `${hostInsets?.right ?? 0}px`, '--comments-host-bottom': `${hostInsets?.bottom ?? 0}px`, '--comments-host-left': `${hostInsets?.left ?? 0}px` } as React.CSSProperties}>
        <header className="comments-header"><DialogPrimitive.Title asChild><Typography as="h2" className="comments-title" variant="memoryBody">Комментарии</Typography></DialogPrimitive.Title><button aria-label="Закрыть комментарии" className="comments-close" onClick={() => requestClose()} ref={closeButtonRef} type="button"><Typography as="span" aria-hidden="true" variant="memoryToolbar">×</Typography></button></header>
        {error ? <Typography as="p" className="comments-error" role="alert" variant="bodyXs">{error}</Typography> : null}
        {list.error && comments.length > 0 ? <Typography as="p" className="comments-sync-status" role="status" variant="bodyXs">Не удалось обновить комментарии. Повторим позже.</Typography> : null}
        <div aria-live="polite" className="comments-list" ref={listRef}>
          {list.isPending ? <Typography as="p" className="comments-state" role="status" variant="bodySm">{online ? 'Загрузка комментариев…' : 'Нет подключения. Комментарии загрузятся после восстановления сети.'}</Typography> : null}
          {list.isError && comments.length === 0 ? <div className="comments-state" role="alert"><Typography as="p" variant="bodySm">Не удалось загрузить комментарии.</Typography><button onClick={() => void list.refreshCurrentWindow(true)} type="button"><Typography as="span" variant="memoryButton">Повторить</Typography></button></div> : null}
          {!list.isPending && !list.isError && comments.length === 0 ? <Typography as="p" className="comments-state" variant="bodySm">Пока нет комментариев. Напишите первым</Typography> : null}
          {comments.length > 0 && list.hasNextPage ? <button className="comments-older" disabled={list.isFetchingNextPage} onClick={() => { captureReadingAnchor(); void list.loadOlder() }} type="button"><Typography as="span" variant="memoryButton">{list.isFetchingNextPage ? 'Загрузка…' : 'Показать более ранние'}</Typography></button> : null}
          {newCommentsCount > 0 ? <button className="comments-new-messages" onClick={() => { if (listRef.current) listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); clearUnreadComments() }} type="button"><Typography as="span" variant="memoryButton">Новые комментарии · {newCommentsCount}</Typography></button> : null}
          <FeedSharedAuthorAvatars authors={comments.map((comment) => ({ path: comment.author.avatarPath }))} enabled={true} familyId={scope.familyId} membershipEpoch={scope.membershipEpoch} transport={transport} userId={scope.accountId}>
            {comments.map((comment) => <CommentItem comment={comment} familyTimezone={familyTimezone} key={comment.id} onDelete={(item) => setDeleteTarget({ id: item.id, version: item.version })} onEdit={(item) => { setError(null); setEdit({ id: item.id, version: item.version, body: item.body }) }} />)}
          </FeedSharedAuthorAvatars>
        </div>
        {edit ? <form className="comments-composer comments-edit-composer" onSubmit={(event) => { event.preventDefault(); void saveEdit() }}><textarea aria-label="Изменить комментарий" disabled={busy} onChange={(event) => setEdit({ ...edit, body: event.currentTarget.value })} value={edit.body} /><div><button disabled={busy} type="button" onClick={() => setEdit(null)}><Typography as="span" variant="memoryButton">Отмена</Typography></button><button disabled={busy} type="submit"><Typography as="span" variant="memoryButton">Сохранить</Typography></button></div></form> : <CommentComposer busy={busy} onChange={setDraft} onCreate={submitCreate} uncertainAttempt={uncertainAttempt} value={draft} />}
        <DialogPrimitive.Root onOpenChange={(next) => { if (!next) cancelCloseChoice() }} open={closeChoice !== null}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-confirm-overlay" /><DialogPrimitive.Content className="comments-confirm"><DialogPrimitive.Title>{closeChoice === 'pending' ? 'Отправка может быть сохранена' : 'Черновик не сохранён'}</DialogPrimitive.Title><Typography as="p" variant="bodySm">{closeChoice === 'pending' ? 'Запрос ещё не подтверждён. Закрыть обсуждение?' : 'Закрыть обсуждение и удалить черновик?'}</Typography><div><button onClick={cancelCloseChoice} type="button"><Typography as="span" variant="memoryButton">Продолжить писать</Typography></button><button onClick={() => { setDraft(''); setEdit(null); setUncertainAttempt(null); mutationController.current?.abort(); closeNow(closingFromHistory.current); closingFromHistory.current = false }} type="button"><Typography as="span" variant="memoryButton">Закрыть без сохранения</Typography></button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
        <DialogPrimitive.Root onOpenChange={(next) => { if (!next && !busy) setDeleteTarget(null) }} open={deleteTarget !== null}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="comments-confirm-overlay" /><DialogPrimitive.Content className="comments-confirm"><DialogPrimitive.Title className="comments-confirm-title">Удалить комментарий?</DialogPrimitive.Title><Typography as="p" variant="bodySm">Это действие нельзя отменить.</Typography><div><button onClick={() => setDeleteTarget(null)} type="button"><Typography as="span" variant="memoryButton">Отмена</Typography></button><button disabled={busy} onClick={() => void confirmDelete()} type="button"><Typography as="span" variant="memoryButton">Удалить</Typography></button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

function upsertConfirmedComment(client: ReturnType<typeof useQueryClient>, key: readonly unknown[], comment: CommentDto, summary: CommentPage['summary'], prepend: boolean) {
  const cached = client.getQueryData<InfiniteData<CommentPage, string | null>>(key)
  if (!cached || cached.pages.length === 0) {
    client.setQueryData<InfiniteData<CommentPage, string | null>>(key, { pages: [{ items: [comment], nextCursor: null, summary }], pageParams: [null] })
    return
  }
  let placed = false
  const pages = cached.pages.map((page) => {
    const hasItem = page.items.some((item) => item.id === comment.id)
    if (hasItem && !placed) {
      placed = true
    return { ...page, summary, items: page.items.map((item) => item.id === comment.id ? comment : item) }
    }
    return { ...page, summary, items: page.items.filter((item) => item.id !== comment.id) }
  })
  if (!placed && prepend) pages[0] = { ...pages[0]!, items: [comment, ...pages[0]!.items] }
  client.setQueryData<InfiniteData<CommentPage, string | null>>(key, { ...cached, pages })
}

function removeConfirmedComment(client: ReturnType<typeof useQueryClient>, key: readonly unknown[], commentId: string, summary: CommentPage['summary']) {
  const cached = client.getQueryData<InfiniteData<CommentPage, string | null>>(key)
  if (!cached) return
  client.setQueryData<InfiniteData<CommentPage, string | null>>(key, { ...cached, pages: cached.pages.map((page) => ({ ...page, summary, items: page.items.filter((item) => item.id !== commentId) })) })
}
