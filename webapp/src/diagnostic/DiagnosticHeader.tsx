import { usePrivateImageUrl } from '@/platform/media/use-private-image-url'
import type { AuthenticatedTransport } from '@/platform/api'
import type { FamilyResponse } from '@web-app-demo/contracts'

export function DiagnosticHeader({ child, familyId, transport, userId }: {
  child: FamilyResponse['child']
  familyId: string
  transport: AuthenticatedTransport
  userId: string
}) {
  const avatarPath = child?.avatarMediaId
    ? `/api/v1/families/${encodeURIComponent(familyId)}/media/${encodeURIComponent(child.avatarMediaId)}/content?variant=display`
    : null
  const avatarUrl = usePrivateImageUrl(userId, avatarPath, transport)

  return <header className="diagnostic-identity-header">
    <img alt="memoLy" className="diagnostic-wordmark" decoding="async" height="400" src="/assets/brand/memoly-logo-correct.webp" width="1200" />
    {child ? <div className="diagnostic-child-identity">
      {avatarUrl
        ? <img alt={`${child.name} — фотография`} className="diagnostic-child-avatar" decoding="async" src={avatarUrl} />
        : <span aria-label={`${child.name} — инициалы`} className="diagnostic-child-avatar diagnostic-child-initials" role="img">{child.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('ru-RU')}</span>}
      <span className="diagnostic-child-name">{child.name}</span>
    </div> : <p className="diagnostic-child-unavailable">Профиль ребёнка не настроен</p>}
  </header>
}
