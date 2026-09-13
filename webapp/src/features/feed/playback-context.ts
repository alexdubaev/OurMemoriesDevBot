import { createContext } from 'react'

export type PlaybackCoordinator = {
  activate(token: symbol): void
  pauseAll(): void
  register(token: symbol, pause: () => void): () => void
}

export const PlaybackContext = createContext<PlaybackCoordinator | null>(null)
