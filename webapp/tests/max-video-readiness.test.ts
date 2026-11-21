import { describe, expect, test } from 'bun:test'
import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/react-query'
import type { MaxVideoPosterReadiness, MaxVideoReadiness } from '@web-app-demo/contracts'

import { MAX_VIDEO_FINAL_READINESS_GC_MS, maxVideoPosterReadinessCache, maxVideoReadinessCache } from '../src/features/feed/max-video-readiness'

type CacheOptions<T> = (cached: T | undefined) => { staleTime: number | ((query: { state: { data?: T } }) => number); gcTime: number }

/**
 * One slide observes a readiness answer, leaves and returns three times (the query is disabled
 * and enabled again, as a swipe does), then mounts once more. Returns how often it was fetched.
 */
async function swipeAround<T>(answer: T, cache: CacheOptions<T>) {
  const client = new QueryClient()
  const queryKey: QueryKey = ['session', 'feed', 'max-video-readiness-test']
  let fetches = 0
  const options = (enabled: boolean) => ({
    queryKey,
    queryFn: async () => { fetches += 1; return answer },
    enabled,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    ...cache(client.getQueryData<T>(queryKey)),
  })
  const observer = new QueryObserver(client, options(true))
  const unsubscribe = observer.subscribe(() => undefined)
  await Bun.sleep(1)
  for (let swipe = 0; swipe < 3; swipe += 1) {
    observer.setOptions(options(false))
    observer.setOptions(options(true))
    await Bun.sleep(1)
  }
  unsubscribe()
  const remounted = new QueryObserver(client, options(false))
  const unsubscribeRemounted = remounted.subscribe(() => undefined)
  remounted.setOptions(options(true))
  await Bun.sleep(1)
  const gcTime = client.getQueryCache().find({ queryKey })?.gcTime
  unsubscribeRemounted()
  client.clear()
  return { fetches, gcTime }
}

describe('MAX video readiness answers across swipes', () => {
  test('a final poster answer is fetched once and kept for a long time', async () => {
    for (const answer of [
      { state: 'ready', posterPath: '/api/v1/families/11111111-1111-4111-8111-111111111111/media/max-videos/22222222-2222-4222-8222-222222222222/poster' },
      { state: 'failed' },
    ] satisfies MaxVideoPosterReadiness[]) {
      expect(await swipeAround<MaxVideoPosterReadiness>(answer, maxVideoPosterReadinessCache)).toEqual({ fetches: 1, gcTime: MAX_VIDEO_FINAL_READINESS_GC_MS })
    }
  })

  test('a pending poster is checked again on every activation', async () => {
    const { fetches } = await swipeAround<MaxVideoPosterReadiness>({ state: 'pending' }, maxVideoPosterReadinessCache)
    expect(fetches).toBe(5)
  })

  test('a final video readiness answer is fetched once and kept for a long time', async () => {
    for (const answer of [{ state: 'ready', recheckable: false }, { state: 'unavailable', recheckable: false }] satisfies MaxVideoReadiness[]) {
      expect(await swipeAround<MaxVideoReadiness>(answer, maxVideoReadinessCache)).toEqual({ fetches: 1, gcTime: MAX_VIDEO_FINAL_READINESS_GC_MS })
    }
  })

  test('a recheckable video readiness answer is checked again on every activation', async () => {
    const { fetches } = await swipeAround<MaxVideoReadiness>({ state: 'processing', recheckable: true }, maxVideoReadinessCache)
    expect(fetches).toBe(5)
  })
})
