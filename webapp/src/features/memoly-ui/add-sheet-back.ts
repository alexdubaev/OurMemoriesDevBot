import type { HostBridge } from '@/platform/host-bridge'

export function subscribeAddSheetBack(
  hostBridge: Pick<HostBridge, 'onBack'>,
  close: () => void,
) {
  return hostBridge.onBack(close)
}
