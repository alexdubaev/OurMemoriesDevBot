# 02 — Общая панель и реакции в открытой истории

**Требования:** R41, R42, R43, R44, R45, R46, R47, R48, R49, R50, R51
**Зависит от:** 01
**Зона:** `webapp/src/features/comments/` · `webapp/src/features/albums/` · `webapp/src/features/feed/index.ts` · `webapp/src/platform/persistence/private-cache.ts` · `webapp/src/features/feed/reaction-queue.ts` · `webapp/src/features/feed/presentation/MemoryReactions.tsx` · `webapp/e2e/` · `webapp/tests/`
**Волна:** 2
**Ревью:** нет — одно итоговое review
**Модель:** сильная

## Что должно заработать
Shared CommentsPanel, Composer, Item принимают typed target/data adapter; feed behavior remains. Открытый detail читает summary/generation, показывает один compact row reactions+Комментарии; реальная серверная запись. No N+1; no viewer redesign. Новый scope не принимает old reads/draft/retry/cache. При clear generation mismatch old scope cleared, never rebased into new chapter.

## Из брифа, дословно
> «Не копировать целиком CommentsPanel в отдельный почти идентичный AlbumCommentsPanel.»
> «Не подставлять entryId в memoryId.»
> «сохранённый комментарий + failed refresh не отправляется заново.»

## Разделы спецификации
Истории 7–8, общая приёмка §8 брифа. interfaces.md frontend adapter и публичные backend результаты.

## Критерии приёмки
- [ ] Общая типизированная panel без as/any identity masking; feed caller/strict DTO behavior сохраняются, targeted feed social regressions pass.
- [ ] Account/family/epoch/target/generation query and draft scopes, abort stale reads/writes, guard late responses/unmount; unknown save retry uses same immutable attempt, confirmed-save/failed-refresh clears attempt.
- [ ] One reaction row/detail for three photos, existing six emotion picker/serialized queue, count+comments, known server errors/retry, no panel per tile or query per 2000 items.
- [ ] Unsaved warning/edit/delete/owner moderation, active polling, keyboard/focus/safe-area/history/MAX Back and viewer return; clear confirmation explicitly mentions discussion/reactions reset, empty month hides social, text-only supports.
- [ ] Focused unit/integration browser cases direct photo no Memory, feed source separated, two entries same file separate, family/account switch, late/failed response, fast reaction sequences. Use existing dedicated config; no giant matrix. Do not change contracts/schema from ticket01; return integration mismatch to lead.
