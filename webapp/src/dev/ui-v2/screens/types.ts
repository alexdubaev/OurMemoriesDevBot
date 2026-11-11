import type { FamilyHeroModel, MediaModel, MemoryCardModel, PersonModel } from '../fixtures/models'
import type { CatalogEntry, Role } from '../states/catalog'
import type { Theme } from '../tokens/design-tokens'
export type ScreenActions = {
  go: (id: string, personId?: string) => void; open: (kind: string, memoryId?: string, index?: number) => void
  onNotice: (message: string) => void; onTheme: (theme: Theme) => void
  onReact: (memoryId: string, emoji: string) => void; onDelete: (memoryId: string) => void
  onSaveChild: (name: string, birthDate: string, sex: string, avatar: string) => void
  onSaveMemory: (body: string, kind: string, media: MediaModel[], date: string) => void
  onSavePerson: (id: string, name: string, role?: 'full' | 'viewer', avatar?: string) => void
  onSaveFamily: (name: string, timezone: string) => void
  onRemovePerson: () => void
}
export type ScreenProps = { entry: CatalogEntry; role: Role; theme: Theme; family: FamilyHeroModel; memories: MemoryCardModel[]; people: PersonModel[]; selectedPerson?: PersonModel; editingMemory?: MemoryCardModel; actions: ScreenActions }
