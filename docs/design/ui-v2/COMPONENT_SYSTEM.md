# Canonical component system

All implementation is in `webapp/src/dev/ui-v2`. No imports from product features/platform/contracts.

| Layer | Canonical components | Responsibilities |
|---|---|---|
| Primitives | Screen, Stack, Row, Surface, Divider, Pressable, IconButton, Avatar, Badge, Field, TextField | Flex layout, safe areas, touch/keyboard, semantic input |
| Typography | Typography, PersonName | One semantic scale; system font and 400/500/600 weights |
| Brand/family | MemoLyLogo, FamilyHero, MemberRow, FamilyChannelCard | Official logo, identical hero geometry, consistent people and channel states |
| Navigation | BottomTabs, TopBar | Three existing tabs, back action, viewer role restriction |
| Memories | MemoryCard, Carousel, MediaSurface, VoiceSurface, ReactionPicker | Common header/date/actions/reactions around typed content |
| Feedback | LoadingState, EmptyState, ErrorState, InlineNotice | Readable loading, next-step empty states, recoverable failure |
| Overlays | Modal plus Overlay compositions | Shared sheet/dialog/viewer, Escape, focus trap/restore, background inert, parent scroll lock |
| Screens | FirstRun, Families, Setup, Feed, Family, Child, Member, Composer, Invites, Settings, Channel, Install, Archive, Viewer | Composition and fixture callbacks |
| Lab | Lab, catalog | Scenario, role/theme/viewport selection; fixture state ownership |

Presentation models: FamilyHeroModel, MemoryCardModel, MediaModel, PersonModel, InviteModel,
ChannelStatusModel. They contain display information and status, never endpoint/DTO/Prisma/cache.
Integration later should map product data to these models in adapters outside the component tree.

Components use onPress/onLongPress/onOpen/onClose/onSelect-style actions. Web Pressable maps
pointer/keyboard to conceptual actions; long press has movement cancellation and a visible
keyboard-friendly alternative. Optional onFeedback belongs at the adapter boundary.

Modal DOM access is narrowly for accessibility/focus/scroll. Layout and core models do not measure
or traverse DOM. The root owner controls overlays, selected memory and return state.
React fixture timers are cancelled on unmount. Role gates are presentation mirrors of current
production behaviour, not a replacement for backend authorization.
