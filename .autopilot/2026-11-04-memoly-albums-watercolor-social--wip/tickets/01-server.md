# 01 — Обсуждения AlbumEntry на сервере

**Требования:** R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30, R31, R32, R33, R34, R35, R36, R37, R38, R39, R40
**Зависит от:** —
**Зона:** `backend/src/modules/albums/` · `backend/prisma/` · `packages/contracts/src/` · `backend/src/modules/memories/infrastructure/prisma-comment-repository.ts`
**Волна:** 1
**Ревью:** нет — одно итоговое review по прямому заданию владельца
**Модель:** сильная

## Что должно заработать
Новые scoped album social endpoints с real persistence, roles, replay и generation lifecycle, пока без visual rewrite. interfaces.md — обязательное решение лида. Исполнитель является единственным владельцем общих Prisma/contracts/composition файлов; не менять memory DTO. Не менять dependencies/deploy/auth/media behavior. Минимальное выделение общего author projection допустимо через public module boundary.

## Из брифа, дословно
> «Объект комментариев и реакций — отдельная запись альбома AlbumEntry, а не весь альбом и не исходный файл фотографии.»
> «Использовать реальные транзакции изолированной PostgreSQL.»
> «Запоздалый запрос или retry старой отправки после очистки не должен вернуть комментарии в новую главу.»

## Разделы спецификации
Истории 1–6, последовательность доказательств server; interfaces.md целиком.

## Критерии приёмки
- [ ] Строгие additive schemas/routes/migration, composite family/album/entry FK, private no-store, old memory contracts unchanged.
- [ ] Real endpoint PG tests: durable read/create/update/delete roles owner/full/viewer, owner moderation delete-only; foreign family/album/entry, revoked/expired session; no Viewer album edit grant.
- [ ] Durable idempotency same key replay after lost response and executor TTL; different body/target conflict; normalization/NUL/limit, signed pagination target+generation isolation, CAS comment versions.
- [ ] Reaction set/replace/null/repeat unique counts; social writes independent of album version; ordinary edits/reorder preserve discussion; feed/source/same file targets isolated; direct upload without Memory and text-only event.
- [ ] Empty month blocked; clear atomic generation increment/reset; old retry cannot restore content after refill; delete entry/album inaccessible without deleting media; observed-lock controlled revoke and clear/delete races settle without hangs.
- [ ] Targeted contracts + backend typecheck + affected PostgreSQL integration green, redproof before implementation. No FULL in this ticket. Root will provide test DB details privately by nonsecret config paths; do not inspect unrelated env values.
