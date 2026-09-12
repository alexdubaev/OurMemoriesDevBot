import { useCallback, useRef } from 'react'

import type { HostBridge } from '@/platform/telegram'

export async function navigateToTelegramVideo(
  hostBridge: HostBridge,
  requestPointer: () => Promise<{ telegramDeepLink: string }>,
) {
  const { telegramDeepLink } = await requestPointer()
  if (!hostBridge.openTelegramVideo(telegramDeepLink)) throw new Error('Telegram host bridge is unavailable')
  // Telegram documents that opening a Telegram link no longer closes modern Mini Apps. The
  // bridge call is intentionally synchronous: the SDK provides no completion value to await.
  hostBridge.close()
}

export function createSingleFlightTelegramVideoHandoff(run: () => Promise<void>) {
  let inFlight = false
  return async () => {
    if (inFlight) return false
    inFlight = true
    try {
      await run()
      return true
    } catch (error) {
      inFlight = false
      throw error
    }
  }
}

export function useSingleFlightTelegramVideoHandoff(run: () => Promise<void>) {
  const inFlight = useRef(false)
  return useCallback(async () => {
    if (inFlight.current) return false
    inFlight.current = true
    try {
      await run()
      return true
    } catch (error) {
      inFlight.current = false
      throw error
    }
  }, [run])
}
