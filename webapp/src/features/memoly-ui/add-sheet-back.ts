import type { HostBridge } from '@/platform/host-bridge'

export function subscribeAddSheetBack(
  hostBridge: Pick<HostBridge, 'onBack'>,
  close: () => void,
) {
  let consumed = false
  return hostBridge.onBack(() => {
    if (consumed) return
    consumed = true
    close()
  })
}
