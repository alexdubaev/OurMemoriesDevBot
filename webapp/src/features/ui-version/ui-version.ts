export type UiVersion = 'legacy' | 'v2'

export function resolveUiVersion(value: string | undefined): UiVersion {
  return value === 'v2' ? 'v2' : 'legacy'
}

export function readUiVersion(): UiVersion {
  return resolveUiVersion(import.meta.env?.VITE_MEMOLY_UI_VERSION)
}
