import { describe, expect, test } from 'bun:test'

import { createInviteLink } from '../src/features/family/invite-link'
import { shareInviteWithFallback } from '../src/features/family/InvitationScreens'
import { createMaxInviteLink } from '../src/platform/max-invite-link'
import { createMaxHostBridge, readMaxInviteLaunch } from '../src/platform/max/host-bridge'
import { createTelegramHostBridge } from '../src/platform/telegram/host-bridge'

const token = 'i'.repeat(43)

describe('cross-provider family invite links', () => {
  test('builds MAX and Telegram addresses from the same invite token', () => {
    const maxUrl = createMaxInviteLink(token, 'memoLyBot')
    const telegramUrl = createInviteLink(token)

    expect(maxUrl).toBe(`https://max.ru/memoLyBot?start=invite_${token}`)
    expect(telegramUrl).toBe(`https://t.me/OurMemoriesDevBot?startapp=invite_${token}`)
  })

  test('both provider URLs resolve to the same token through their supported launch carriers', () => {
    const maxUrl = new URL(createMaxInviteLink(token, 'memoLyBot')!)
    const maxStartParam = maxUrl.searchParams.get('start')
    const maxHost = {
      WebApp: { initData: new URLSearchParams({ user: '{}', start_param: maxStartParam ?? '' }).toString(), version: '1.0' },
      location: { search: '' },
    }
    expect(readMaxInviteLaunch(maxHost)).toEqual({ kind: 'valid', token })
    expect(createMaxHostBridge(maxHost).inviteLaunch?.()).toEqual({ kind: 'valid', token })

    const telegramUrl = new URL(createInviteLink(token))
    const telegramStartApp = telegramUrl.searchParams.get('startapp')
    const telegramBridge = createTelegramHostBridge({
      Telegram: { WebApp: { initData: new URLSearchParams({ user: '{}', start_param: telegramStartApp ?? '' }).toString(), version: '6.0' } },
    })
    expect(telegramBridge.inviteToken()).toBe(token)
  })

  test('share falls back to copying only the selected provider URL when sharing is unavailable or fails', async () => {
    const copied: string[] = []
    const fallback = (url: string) => shareInviteWithFallback(url, undefined, async (value) => { copied.push(value) })

    expect(await fallback('https://max.example/invite')).toBe('copied')
    expect(await shareInviteWithFallback('https://t.me/invite', async () => { throw new Error('Share unavailable') }, async (url) => { copied.push(url) })).toBe('copied')
    expect(copied).toEqual(['https://max.example/invite', 'https://t.me/invite'])
  })

  test('share cancellation does not copy, and failed clipboard fallback reports failure', async () => {
    let copyCalls = 0
    expect(await shareInviteWithFallback('https://t.me/invite', async () => { throw { name: 'AbortError' } }, async () => { copyCalls += 1 })).toBe('cancelled')
    expect(copyCalls).toBe(0)
    expect(await shareInviteWithFallback('https://max.example/invite', undefined, async () => { throw new Error('Clipboard unavailable') })).toBe('failed')
  })
})
