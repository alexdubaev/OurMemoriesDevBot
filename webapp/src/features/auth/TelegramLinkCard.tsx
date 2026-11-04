import { telegramLinkStartResponseSchema, telegramLinkStatusResponseSchema } from '@web-app-demo/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Typography } from '@/components/typography'
import { UiV2Button } from '@/components/ui-v2/UiV2Button'
import { useAuth } from './use-auth'
import { ApiRequestError } from '@/platform/api'
import type { HostBridge } from '@/platform/telegram'

const endpoint = '/api/v1/auth/telegram-link'

export function TelegramLinkCard({ hostBridge }: { hostBridge: Pick<HostBridge, 'openExternalLink'> }) {
  const auth = useAuth()
  const userId = auth.user?.id ?? ''
  const generation = useRef(0)
  const busyRef = useRef(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [waitingUntil, setWaitingUntil] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const waiting = waitingUntil !== null

  const refresh = useCallback(async (expectedGeneration = generation.current) => {
    try {
      const result = await auth.transport.request(endpoint, telegramLinkStatusResponseSchema, { timeoutMs: 15_000 })
      if (expectedGeneration !== generation.current) return
      setConnected(result.connected)
      setStatusFailed(false)
      setNotice(null)
    } catch {
      if (expectedGeneration !== generation.current) return
      setStatusFailed(true)
      setNotice('Не удалось проверить подключение. Попробуйте ещё раз.')
    }
  }, [auth.transport])

  useEffect(() => {
    const currentGeneration = ++generation.current
    queueMicrotask(() => {
      if (currentGeneration !== generation.current) return
      busyRef.current = false
      setBusy(false)
      setConnected(null)
      setStatusFailed(false)
      setWaitingUntil(null)
      setNotice(null)
      void refresh(currentGeneration)
    })
    return () => { generation.current = currentGeneration + 1 }
  }, [refresh, userId])
  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [refresh])
  useEffect(() => {
    if (waitingUntil === null) return
    const timer = window.setTimeout(() => setWaitingUntil(null), Math.max(0, waitingUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [waitingUntil])

  async function start() {
    if (busyRef.current || connected !== false || statusFailed) return
    busyRef.current = true
    setBusy(true)
    setNotice(null)
    const currentGeneration = generation.current
    try {
      const result = await auth.transport.request(endpoint, telegramLinkStartResponseSchema, { method: 'POST', body: {}, timeoutMs: 15_000 })
      if (currentGeneration !== generation.current) return
      if (result.connected) {
        setConnected(true)
        setWaitingUntil(null)
        return
      }
      const url = `https://t.me/OurMemoriesDevBot?startapp=${encodeURIComponent(result.startParam)}`
      if (!hostBridge.openExternalLink?.(url)) {
        setNotice('Не удалось открыть Telegram. Проверьте, что он установлен, и попробуйте ещё раз.')
        return
      }
      setWaitingUntil(Date.parse(result.expiresAt))
      setNotice('Откройте memoLy в Telegram в течение 15 секунд. Подключение произойдёт автоматически.')
    } catch (error) {
      if (currentGeneration !== generation.current) return
      setNotice(linkErrorMessage(error))
    } finally {
      if (currentGeneration === generation.current) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  return <section aria-label="Подключение Telegram" className="member-profile-card member-account-card">
    <div className="member-account-form">
      <Typography as="h4" variant="memoryButton">Telegram</Typography>
      {connected === true ? <Typography as="p" variant="memoryMeta" aria-live="polite" className="member-profile-success">Telegram подключён</Typography> : <>
        <Typography as="p" variant="memoryMeta" tone="muted">Подключите Telegram к этому аккаунту, чтобы пользоваться им в обоих приложениях.</Typography>
        {notice ? <Typography as="p" variant="memoryMeta" aria-live="polite" className={waiting ? 'member-profile-success' : 'member-profile-error'}>{notice}</Typography> : null}
        {waiting ? <UiV2Button className="member-profile-save" disabled={busy} onClick={() => void refresh()} type="button" variant="secondary">Проверить подключение</UiV2Button> : null}
        {statusFailed ? <UiV2Button className="member-profile-save" disabled={busy} onClick={() => void refresh()} type="button" variant="secondary">Повторить проверку</UiV2Button> : null}
        <UiV2Button className="member-profile-save" disabled={busy || connected === null || statusFailed} onClick={() => void start()} type="button" variant="primary">{busy ? 'Открываем Telegram…' : 'Привязать Telegram'}</UiV2Button>
        {connected === null ? <Typography as="p" variant="memoryMeta" tone="muted">Проверяем подключение…</Typography> : null}
      </>}
    </div>
  </section>
}

function linkErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 400) return 'Срок подключения истёк. Вернитесь в MAX и создайте новую ссылку.'
  if (error instanceof ApiRequestError && error.status === 409) return 'Этот Telegram-аккаунт нельзя подключить к текущему аккаунту.'
  return 'Не удалось начать подключение. Попробуйте ещё раз.'
}
