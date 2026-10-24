import type { ChildDto } from '@web-app-demo/contracts'

import type { AuthenticatedTransport } from '@/platform/api'
import { ChildAvatar } from './ChildAvatar'
import { useChildAvatar } from './useChildAvatar'

/** One hook per child: the avatar loader is keyed to a single media id, so each list row owns its own. */
export function FamilyChildAvatar({ child, enabled, familyId, membershipEpoch, transport }: {
  child: ChildDto
  enabled: boolean
  familyId: string
  membershipEpoch: number | null
  transport: AuthenticatedTransport
}) {
  const avatar = useChildAvatar(transport, familyId, child.avatarMediaId, { childId: child.id, membershipEpoch, enabled })
  return <ChildAvatar avatarCrop={child.avatarCrop} avatarUrl={avatar.url} name={child.name} size="family-row" status={avatar.status} />
}
