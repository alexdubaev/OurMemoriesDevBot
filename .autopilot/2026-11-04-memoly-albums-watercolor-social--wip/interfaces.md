# Границы, решённые в спецификации

## Владение
Одна ветка/worktree/implementation PR. /root — единственный интегратор и release writer; Product-код пишут последовательные исполнители. Первый backend исполнитель получает исключительное владение Prisma/schema/migration/shared contracts/album composition. Другие не редактируют эти файлы одновременно. package/lockfile/deploy guards запрещены без отдельного необходимого обоснования; новые зависимости не нужны.

## Сервер
Отдельные AlbumEntryComment и AlbumEntryReaction, без Memory. FK (entryId,albumId,familyId) → AlbumEntry(id,albumId,familyId), author/user membership FK. Один current reaction на entry/user; enum и counts существующей ленты.
AlbumEntry.discussionGeneration integer default 1. Полная очистка month атомарно повышает поколение и сбрасывает/скрывает прежние обсуждения. Create durable marker уникален family/author/key; initial hash включает familyId, albumId, entryId, generation, нормализованный body, operation namespace album-entry-comment.create:family. Повтор ключа с другой целью/телом/поколением конфликтует даже после TTL executor. Перед execute и перед replay response проверяется живой scope, album, entry, generation и наполненность. Snapshot содержит только ID; старый retry не воскрешает текст. Обычное редактирование/обложка/порядок не меняют generation. Социальные mutations не повышают aggregate album version и не требуют expectedVersion альбома.
Использовать существующий idempotency executor, commentBodySchema, update body/version, list limit, автор/capabilities/avatar crop projection, реакционный enum и правила; допустимо выделить небольшой общий author projection без изменения feed DTO. Не строить универсальный social subsystem.
Lock order user → live session → active family → active member → live album → live entry. Social write берёт family/member для проверки членства без требования full, album FOR SHARE, entry FOR UPDATE (list/summary FOR SHARE), чтобы сериализоваться с clear/delete/отзывом. Никаких проверок доступа только до transaction. Пустой month без sources/caption/childQuote не принимает/не показывает обсуждение; text-only event полноценный. Проверка заполненности согласована с текущей model.filled и реальной availability источников. Ошибки scope fail closed, private no-store.

## API/contracts
Все новые API: /api/v1/families/{familyId}/albums/{albumId}/entries/{entryId}:
GET /discussion — актуальные familyId/albumId/entryId/discussionGeneration, comments summary и reactionCounts/currentUserReaction.
GET/POST /comments — pagination/create. Query generation для GET, body discussionGeneration для POST + Idempotency-Key.
PATCH/DELETE /comments/{commentId} — своё edit; own/owner delete; expectedVersion комментария, generation body/query, If-Match для delete.
PUT /reaction — {reaction: existing enum|null,discussionGeneration}; natural-idempotent set, aggregate summary.
Названия AlbumEntryCommentDto/Page/Summary и AlbumEntryDiscussionSummary; строгие schemas в packages/contracts/src/album-social.ts, экспорт из index. Существующие memory DTO/endpoints без новых обязательных полей. AlbumEntry DTO можно оставить прежним, поколение получить только для открытой истории через /discussion.

## Общий frontend adapter
CommentScope явно discriminated memory vs albumEntry. Сохранить прежний memory caller (memoryId) и его ключи/поведение; album target содержит albumId,entryId,discussionGeneration, без memoryId. Общие view types берут только одинаковые поля (id,author,body,version,capabilities,times), не подделывают memoryId и не используют any/as для смешивания. API adapter строго парсит соответствующие DTO, затем отображает в общую panel view. CommentsPanel/Composer/Item остаются едиными. Query helper forScope выбирает прежний feed key или новый key с явным target и generation. Mutable draft/attempt/retry scope включают account/family/epoch/target/generation; поздние reads/writes отбрасываются и abort на смену scope/unmount. Подтверждённый create после failed refresh не повторяется. Polling/focus/keyboard/history/MAX Back/safe-area сохраняются.
Только открытый AlbumEntryDetail запрашивает social summary/list; отдельная compact reaction trigger и общая MemoryReactions + очередь, один ряд для всех ракурсов. Никаких social N+1 в WorkshopGallery. Viewer не переделывать. Generation mismatch закрывает/очищает старую панель и обновляет entry/summary, не пересылает старый draft/attempt в новое поколение.

## Продуктовые ограничения
Бриф 0–11 нормативен целиком. Каталог AlbumCatalogPresentation и его styling/data/navigation неизменны. Лента/семья/вишлист/5 пунктов nav сохраняются. Только MAX/Mini App/Web/PWA MAX auth; исторический messenger код не трогать. Ни media storage/private endpoints/import/MAX notifications, ни auth/ACL policy не менять. Synthetic QA only, private photos не в Git. Полный watercolor original важнее reference.html; никаких emoji-декораций или screenshot UI.

## Проверки
Bun 1.4.0 frozen install; targeted contract/typecheck/lint/build, собственная *_test PostgreSQL DB и storage. Итог: bun run verify:local --profile full --base <base SHA> --reason 'AlbumEntry social persistence, contracts and protected family operations; owner requested FULL'. Реальные endpoint integration concurrency/idempotency tests и короткие E2E для shared adapter/feed; final одно independent Luna High technical review, адресное closure. Release по deploy/selectel/README.md и S3 recovery docs без изменения guards. Нет downgrade, skips или fabricated PASS.
