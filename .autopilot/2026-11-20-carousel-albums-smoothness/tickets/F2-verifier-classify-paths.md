# F2 — Классификатор проверки знает пути этой сборки

**Требования:** G01, R07i
**Зависит от:** —
**Зона:** `scripts/verify-local.mjs` · `scripts/verify-local.test.mjs`
**Волна:** 4
**Ревью:** да — инструмент проверки выпуска
**Модель:** сильная

## Что должно заработать

Профиль FULL (`bun run verify:full`) на ветке стартует, а не останавливается на `REVIEW_REQUIRED: verification scope is unresolved`. Сейчас его блокируют два пути, которые внесла ветка: архивное состояние прошлого прогона Autopilot `.autopilot/2026-11-05-memoly-month-photo-collage--wip/state.js` (unknown-path) и браузерный стенд `webapp/e2e/fixed-carousel.harness.tsx` (unresolved-frontend-path). Правило проекта уже знает такие пути по точному имени: `REVIEWED_FULL_PATHS` содержит архивные `state.js` прошлых прогонов (`2026-10-23-wishlist`, `2026-11-04-memoly-albums-watercolor-social--wip`) и стенд `webapp/e2e/selected-family-app.harness.tsx` — их классифицируют как FULL (`reviewed-exact-critical-path`).

## Из брифа, дословно

> «сразу merge и короткий выпуск фронтенда по правилам проекта»

## Разделы спецификации

История 20, Решение «Проверка и выпуск».

## Критерии приёмки

- [ ] `explainChanges` классифицирует `.autopilot/2026-11-05-memoly-month-photo-collage--wip/state.js` и `webapp/e2e/fixed-carousel.harness.tsx` как `full` с правилом `reviewed-exact-critical-path`. Тест в `verify-local.test.mjs` сначала красный.
- [ ] Соседние и новые пути не захватываются: например `.autopilot/2026-11-05-other--wip/state.js` и `webapp/e2e/other.harness.tsx` по-прежнему `review-required`. Тест.
- [ ] Классификация остальных путей не изменилась, существующие тесты `verify-local.test.mjs` зелёные без ослабления.
- [ ] `bun test scripts/verify-local.test.mjs` (из корня) зелёный. План `bun run verify:local --plan` или эквивалентный режим без запуска стадий для диапазона `origin/main..HEAD` больше не даёт `REVIEW_REQUIRED` (если такой режим есть; иначе — тест на `explainChanges` по фактическому списку путей ветки).
