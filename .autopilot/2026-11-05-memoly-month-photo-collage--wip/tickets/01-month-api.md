# 01 — month-api

**Требования:** R03, R04, R07, R08, R09, R12, R13, R14
**Зависит от:** —
**Зона:** `backend/prisma` · `backend/src/modules/albums` · `packages/contracts`
**Волна:** 1
**Ревью:** нет
**Модель:** сильная

## Критерии приёмки

Изолированная PostgreSQL, курсор/точный счётчик, ручной выбор и fallback, 2000 источников, защита старого PUT и stale queue.
