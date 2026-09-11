import { createContext } from 'react'

export type PlaybackCoordinator = {
  activate(id: string): void
  pauseAll(): void
  register(id: string, pause: () => void): () => void
}

export const PlaybackContext = createContext<PlaybackCoordinator | null>(null)
