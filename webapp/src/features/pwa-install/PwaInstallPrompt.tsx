import { useState, useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'
import type { HostBridge } from '@/platform/host-bridge'
import { installPwaPromptListeners, isPwaInstallDismissed, setPwaInstallDismissed, createPwaInstallUrl } from '@/platform/pwa-install'

import './pwa-install-prompt.css'

export function PwaInstallPrompt({ familyId, hostBridge }: { familyId: string; hostBridge: HostBridge }) {
  const install = typeof window === 'undefined' ? null : installPwaPromptListeners()
  const snapshot = useSyncExternalStore(install?.subscribe ?? noopSubscribe, install?.getSnapshot ?? getServerSnapshot, getServerSnapshot)
  const [dismissed, setDismissed] = useState(() => typeof window !== 'undefined' && isPwaInstallDismissed({ getItem: (key) => window.localStorage.getItem(key) }))
  const [notice, setNotice] = useState<string | null>(null)
  const platform = hostBridge.metadata()?.platform.toLowerCase() ?? ''
  const isMaxAndroid = hostBridge.kind === 'max' && platform === 'android'
  const isMaxIos = hostBridge.kind === 'max' && (platform === 'ios' || platform === 'iphone' || platform === 'ipad')
  const isBrowserAndroid = hostBridge.kind === 'browser' && /android/i.test(navigator.userAgent)
  const available = isMaxAndroid || isMaxIos || (isBrowserAndroid && !snapshot.standalone && !snapshot.installed)

  const dismiss = () => {
    setPwaInstallDismissed({ setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) }, true)
    setDismissed(true)
  }

  const openBrowser = () => {
    const url = isMaxAndroid ? createPwaInstallUrl(window.location.origin, familyId) : safeAppUrl(window.location.origin)
    if (!url || !hostBridge.openExternalUrl?.(url)) setNotice('Не удалось открыть браузер. Продолжайте пользоваться приложением.')
  }

  const promptInstall = () => {
    if (!install) return
    void install.prompt().then((result) => {
      if (result === 'dismissed') setNotice('Установка не выполнена. Приложение продолжит работать в браузере.')
      else if (result === 'error') setNotice('Не удалось открыть установку. Проверьте меню браузера.')
    })
  }

  if (typeof window === 'undefined' || !available || dismissed || snapshot.standalone || snapshot.installed) return null

  return <aside aria-label="Установка memoLy" className="pwa-install-prompt" data-slot="pwa-install-prompt">
    <div className="pwa-install-copy">
      <Typography as="h2" variant="memoryButton">memoLy на вашем телефоне</Typography>
      <Typography as="p" tone="muted" variant="memoryMeta">Добавьте значок на главный экран, чтобы открывать семейный альбом без поиска бота.</Typography>
      {isBrowserAndroid && !snapshot.available ? <Typography as="p" tone="muted" variant="memoryMeta">Установка может быть доступна в меню поддерживающего браузера.</Typography> : null}
      {notice ? <Typography as="p" role="status" tone="muted" variant="memoryMeta">{notice}</Typography> : null}
    </div>
    <div className="pwa-install-actions">
      {isMaxAndroid ? <Button onClick={openBrowser} type="button">Перейти к установке</Button> : null}
      {isMaxIos ? <Button onClick={openBrowser} type="button">Открыть в браузере</Button> : null}
      {isBrowserAndroid && snapshot.available ? <Button onClick={promptInstall} type="button">Установить memoLy</Button> : null}
      <Button onClick={dismiss} type="button" variant="ghost">{isBrowserAndroid ? 'Продолжить без установки' : 'Потом'}</Button>
    </div>
  </aside>
}

const serverSnapshot = { available: false, installed: false, standalone: false }
function getServerSnapshot() { return serverSnapshot }
function noopSubscribe() { return () => undefined }

function safeAppUrl(origin: string) {
  try {
    const url = new URL('/', origin)
    return url.protocol === 'https:' && url.origin === origin ? url.href : null
  } catch { return null }
}
