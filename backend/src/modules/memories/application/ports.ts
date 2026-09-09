import type { FamilyScope } from '../../families'

/**
 * Block 03 replaces the production rejection with a catalog that verifies family ownership,
 * stored originals, and deletion lifecycle before a media memory can be published.
 */
export type MediaMemoryCatalog = {
  assertReadyForPublication(scope: FamilyScope, mediaIds: string[]): Promise<void>
}
