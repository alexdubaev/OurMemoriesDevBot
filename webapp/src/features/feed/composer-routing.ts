import type { MemoryDto } from '@web-app-demo/contracts'

export type ComposerMode = 'photo' | 'note' | 'video'

export function composerModeForAdd(mode: ComposerMode, childId?: string): ComposerMode | null {
  return childId ? mode : null
}

export function memoryActionNames(capabilities: MemoryDto['capabilities']) {
  return [
    'details',
    ...(capabilities.edit ? ['edit'] : []),
    ...(capabilities.delete ? ['delete'] : []),
  ]
}
