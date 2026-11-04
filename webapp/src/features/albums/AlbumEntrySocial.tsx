import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CancelledError, useQuery, useQueryClient } from '@tanstack/react-query'
import { albumEntryDiscussionSummarySchema, type AlbumEntryDiscussionSummary, type MemoryReaction } from '@web-app-demo/contracts'
import { Typography } from '@/components/typography'
import { WebpIcon } from '@/components/WebpIcon'
import { CommentsPanel, commentsQueryKeys, albumDiscussionPath, discussionChanged, loadAlbumDiscussion, type AlbumCommentScope } from '@/features/comments'
import { MemoryReactions, MemoryReactionQueue, reactionCountsAfterChange } from '@/features/feed'
import { ApiRequestError, type AuthenticatedTransport } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'
import { isActivePrivateCacheIdentity, privateCacheIdentityGeneration, privateFamilyCacheGeneration } from '@/platform/persistence/private-cache'
import { requestReactionHaptic } from '@/platform/reaction-haptics'

type Props = {
  accountId: string; familyId: string; membershipEpoch: number; albumId: string; entryId: string
  transport: AuthenticatedTransport; hostBridge: HostBridge; timezone: string; onInvalidated: (error: ApiRequestError) => void
}
export function AlbumEntrySocial(props: Props) {
  const { accountId, familyId, membershipEpoch, albumId, entryId, transport, onInvalidated } = props
  const client = useQueryClient()
  const identity = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(accountId, familyId)
  const scope = useMemo(() => ({ accountId, familyId, membershipEpoch, albumId, entryId }), [accountId, familyId, membershipEpoch, albumId, entryId])
  const key = useMemo(() => commentsQueryKeys.discussion(scope), [scope])
  const lease = useRef(true)
  const current = () => lease.current && isActivePrivateCacheIdentity(accountId, identity) && privateFamilyCacheGeneration(accountId, familyId) === familyGeneration
  useLayoutEffect(() => {
    lease.current = true
    return () => {
      lease.current = false
      void client.cancelQueries({ queryKey: key, exact: true })
      client.removeQueries({ queryKey: key, exact: true })
    }
  }, [client, key])
  const discussion = useQuery({
    queryKey: key, retry: false, gcTime: 0, staleTime: 0, refetchInterval: 30_000, refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      try {
        const result = await loadAlbumDiscussion(transport, scope, signal)
        if (!current()) throw new CancelledError()
        const previous = client.getQueryData<AlbumEntryDiscussionSummary>(key)
        if (previous && previous.discussionGeneration !== result.discussionGeneration) throw discussionChanged()
        return result
      } catch (cause) {
        if (current() && cause instanceof ApiRequestError && [401, 403, 404, 409].includes(cause.status)) onInvalidated(cause)
        throw cause
      }
    },
  })
  if (!discussion.data) return <section aria-label="Обсуждение истории" className="albums-entry-social">
    {discussion.isPending ? <Typography as="p" role="status" variant="bodySm">Загружаем обсуждение…</Typography> : <div role="alert"><Typography as="p" variant="bodySm">Не удалось загрузить обсуждение.</Typography><button onClick={() => void discussion.refetch()} type="button"><Typography as="span" variant="memoryButton">Повторить</Typography></button></div>}
  </section>
  return <AlbumDiscussionControls {...props} key={discussion.data.discussionGeneration} summary={discussion.data} />
}

function AlbumDiscussionControls({ accountId, familyId, membershipEpoch, albumId, entryId, transport, hostBridge, timezone, onInvalidated, summary }: Props & { summary: AlbumEntryDiscussionSummary }) {
  const client = useQueryClient()
  const identity = privateCacheIdentityGeneration()
  const familyGeneration = privateFamilyCacheGeneration(accountId, familyId)
  const scope = useMemo<AlbumCommentScope>(() => ({ accountId, familyId, membershipEpoch, albumId, entryId, target: 'albumEntry', discussionGeneration: summary.discussionGeneration }), [accountId, familyId, membershipEpoch, albumId, entryId, summary.discussionGeneration])
  const key = useMemo(() => commentsQueryKeys.discussion(scope), [scope])
  const lease = useRef(true)
  const current = () => lease.current && isActivePrivateCacheIdentity(accountId, identity) && privateFamilyCacheGeneration(accountId, familyId) === familyGeneration
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [writing, setWriting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [optimistic, setOptimistic] = useState<{ current: MemoryReaction | null; counts: AlbumEntryDiscussionSummary['reactionCounts'] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reactionTrigger = useRef<HTMLButtonElement>(null)
  const commentTrigger = useRef<HTMLButtonElement>(null)
  const controller = useRef<AbortController | null>(null)
  const queue = useRef<MemoryReactionQueue | null>(null)
  useLayoutEffect(() => {
    lease.current = true
    return () => { lease.current = false; controller.current?.abort() }
  }, [])
  const invalidate = (cause: ApiRequestError) => {
    if (!current()) return
    controller.current?.abort(); queue.current = null
    setCommentsOpen(false); setPickerOpen(false); setOptimistic(null); setWriting(false)
    client.removeQueries({ queryKey: key, exact: true })
    onInvalidated(cause)
  }
  function react(next: MemoryReaction | null) {
    if (!current()) return
    if (!queue.current) {
      controller.current = new AbortController()
      const signal = controller.current.signal
      queue.current = new MemoryReactionQueue(summary.currentUserReaction, summary.reactionCounts, async (reaction) => {
        try {
          const result = await transport.request(`${albumDiscussionPath(scope)}/reaction`, albumEntryDiscussionSummarySchema, { method: 'PUT', body: { reaction, discussionGeneration: scope.discussionGeneration }, signal, timeoutMs: 15_000 })
          await client.cancelQueries({ queryKey: key, exact: true })
          if (!current() || result.discussionGeneration !== scope.discussionGeneration || result.familyId !== familyId || result.albumId !== albumId || result.entryId !== entryId) throw new CancelledError()
          client.setQueryData(key, result)
          return result
        } catch (cause) {
          if (cause instanceof ApiRequestError && [401, 403, 404, 409].includes(cause.status)) invalidate(cause)
          throw cause
        }
      }, (desired, counts, confirmed) => {
        if (current()) setOptimistic({ current: desired, counts: reactionCountsAfterChange(counts, confirmed, desired) })
      }, () => { if (current()) setError('Не удалось подтвердить реакцию. Обновите обсуждение и повторите.') })
    }
    setWriting(true); setError(null)
    const activeQueue = queue.current
    void activeQueue.submit(next).finally(() => {
      if (!current() || queue.current !== activeQueue) return
      queue.current = null; setWriting(false); setOptimistic(null)
      void client.invalidateQueries({ queryKey: key, exact: true })
    })
  }
  const value = writing && optimistic ? optimistic : { current: summary.currentUserReaction, counts: summary.reactionCounts }
  return <>
    <section aria-label="Обсуждение истории" className="albums-entry-social">
      <MemoryReactions counts={value.counts} current={value.current} interactive onSelect={react} open={pickerOpen} point={{ x: 0, y: 0 }} onOpenChange={setPickerOpen} returnFocusRef={reactionTrigger} onHaptic={(style) => requestReactionHaptic(hostBridge, style)} trigger={<button aria-label={value.current ? 'Изменить или убрать реакцию' : 'Поставить реакцию'} className="albums-social-reaction" onClick={() => requestReactionHaptic(hostBridge, 'light')} ref={reactionTrigger} type="button"><WebpIcon decorative monochrome name={value.current ? 'heart-filled' : 'heart'} size={20} /><Typography as="span" variant="memoryMeta">Реакция</Typography></button>} />
      <button className="albums-social-comments" onClick={() => setCommentsOpen(true)} ref={commentTrigger} type="button"><WebpIcon decorative monochrome name="comments" size={20} /><Typography as="span" variant="memoryMeta">Комментарии · {summary.comments.count}</Typography></button>
      {error ? <div className="albums-social-error" role="alert"><Typography as="p" variant="bodySm">{error}</Typography><button onClick={() => { setError(null); void client.invalidateQueries({ queryKey: key, exact: true }) }} type="button"><Typography as="span" variant="memoryButton">Повторить</Typography></button></div> : null}
    </section>
    {commentsOpen ? <CommentsPanel familyTimezone={timezone} hostBridge={hostBridge} hostInsets={hostBridge.getInsets()} onClose={() => setCommentsOpen(false)} onTargetInvalidated={invalidate} open returnFocusRef={commentTrigger} scope={scope} transport={transport} /> : null}
  </>
}
