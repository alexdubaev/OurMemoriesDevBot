# Целевое исследование
Base a3b128a36c6a4aa66203a606bed4b2b789fbdc4d; worktree D:/codex/TG_OurMemoriesDevBot/worktrees/memoly-albums-watercolor-social; branch feat/memoly-albums-watercolor-social. Интегратор /root; только один product writer одновременно.

AlbumEntry имеет composite unique (id,albumId,familyId). Первый год создаёт 12 durable month slots. clearEntry удаляет связи источников и текст, повышает версии, сохраняет slot. Социального хранения ещё нет. Каталог и существующая виртуализированная мастерская уже в main.

Backend: backend/src/modules/albums/{application/album-service.ts,infrastructure/prisma-album-repository.ts,transport/routes.ts,index.ts}; Prisma schema; contracts/albums.ts. Album lockScope проверяет пользователя, живую auth_session, активную семью, непросроченное membership; write требует full. Социальный доступ использует read-member policy даже при записи, не даёт Viewer editing album. Lock order user → session → family → member → album → entry; clear использует этот порядок и исключительные locks.

Лента: memories/application/comment-service.ts (normalization/hash/signed cursor), infrastructure/prisma-comment-repository.ts (durable create marker, snapshot-only ID + fresh authorized replay, projections/versions/soft delete). MemoryReactionQueue/reactionCountsAfterChange и MemoryReactions — готовые UI/queue. Схемы комментариев строгие memory-only и сохраняются.

Frontend: CommentsPanel.tsx, CommentComposer.tsx, CommentItem.tsx, comments/{api,queries,state}. Scope сейчас account/family/epoch/memory; adapter должен явно различать target. AlbumEntryDetail.tsx показывает источники, имеет display-only MemoryDto для viewer, запрещено использовать его ID в social API. AlbumsPage.tsx владеет маршрутом/очисткой, scoped by account:family:epoch. Общая панель используется FeedPage, ленту не рефакторить.

Checks: contracts tests; backend comments/album integrations on own loopback *_test PostgreSQL; webapp unit/journeys. Итоговый FULL один раз по объединённому source, после fixes узкие проверки. Frozen Bun 1.4.0 deps; новых библиотек нет. Docker daemon недоступен: исследуется готовый WSL/native PostgreSQL, обычный безопасный fallback из docs/TESTING.md. Secrets не выводить. Прежний PROGRESS исторический, новые source проверки обязательны.
