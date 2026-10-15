import '../src/production.css'
import { createRoot } from 'react-dom/client'
import { MemoryCardPresentation } from '@/features/feed/presentation/MemoryCardPresentation'
import { MaxVideoPreview } from '@/features/feed/FeedPage'

function Harness() {
  return <div className="memoly-app-root" data-ui-version="v2"><main data-memoly-feed=""><MemoryCardPresentation
    actions={null} authorInitials="S" authorName="Synthetic" body="A synthetic MAX video post" kind="video"
    reactionCounts={{}} currentUserReaction={null} memoryId="synthetic-max-video"
    media={<div className="memoly-max-video-readiness"><MaxVideoPreview durationMs={12000} height={1280} onOpen={() => undefined} poster="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" readinessState="ready" sourceStatus="loading" src={null} width={720} /></div>}
    occurredTime="14 Oct, 11:14" onReaction={() => undefined} onOpen={() => undefined}
  /></main></div>
}

createRoot(document.getElementById('root')!).render(<Harness />)

