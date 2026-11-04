# 01 — Telegram-вход без приёма сообщений

**Требования:** R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12
**Зависит от:** —
**Зона:** `backend/src/env.ts` · `backend/src/modules/auth/` · `backend/scripts/telegram-auth-only-verification-server.ts` · `backend/src/telegram-auth-only.test.ts` · `backend/.env.example` · `.env.example` · `webapp/e2e/telegram-auth-only.spec.ts` · `webapp/e2e/telegram-auth-only.playwright.config.ts` · `docs/development/TELEGRAM_AUTH_ONLY.md`
**Волна:** 1
**Ревью:** нет
**Модель:** сильная

Дополнение зоны по D01: `deploy/selectel/redeploy.sh` · `deploy/selectel/README.md` · `tests/selectel-release-exit.test.mjs`. Разрешена только точная metadata привязка измеренного source к прежней immutable S3-safe recovery паре и negative source-drift regression; gate логика и прежние ограничения неизменны. Один whole-change review после этой привязки.

Дополнение зоны по D02: `scripts/verify-local.mjs` · `scripts/verify-local.test.mjs`. Только literal FULL classification трёх разобранных путей и negative adjacent-path regression. Никаких classifier алгоритмов, broad allowlist или снижения проверок.

## Что должно заработать

Существующий memoLy проверяет Telegram initData и выдаёт обычную сессию по отдельному auth-only секрету, пока message-бот выключен. Это один цельный небольшой таск; одно whole-change review покрывает защищённые границы. Операционные действия production и Git выполняет lead после кода/проверок; исполнитель не получает секретов и не выполняет deploy. Lead завершает требования реальной доставки/приёмки только по факту и не считает commit доказательством deploy.

## Из брифа, дословно

> «Проверить доступ к токену именно существующего @OurMemoriesDevBot, не раскрывая его.»
> «Подготовить минимальное восстановление Telegram-авторизации с проверкой подписи, сессий и семейных прав.»
> «Проверить изменения на изолированном стенде, затем безопасно выложить.»
> «Проверить реальный запуск, фотографии и MAX-видео.»
> «Не объединяй учётные записи автоматически и не меняй права.»

## Разделы спецификации

§1–7, границы interfaces.md; source notes.md. Никаких новых пакетов, UI-redesign, linking, migrations или изменения release guards.

## Критерии приёмки

- [ ] Новый `TELEGRAM_AUTH_BOT_TOKEN` позволяет принять корректное подписанное initData при TELEGRAM_ENABLED=false без inbox/webhook и внешнего getMe; legacy message-бот validation остаётся прежней, одновременные разные auth/legacy токены отклоняются без утечки значений.
- [ ] Реальная PostgreSQL integration подтверждает auth-only cookie/session + replay/refresh, provider separation и семейный доступ к photo/MAX-video endpoint; чужой/отозванный доступ не проходит. Новые тесты имеют redproof на старом коде. Существующие негативные HMAC кейсы сохраняются.
- [ ] Короткий browser journey использует настоящий Telegram host/auth backend с синтетическим подписанным initData и законным синтетическим членством: семейная лента, фото/карусель, MAX-video play/pause/seek. Синтетический provider отдаёт MP4/Range; не подменять сам auth/family guard успешными ответами.
- [ ] Документация описывает auth-only переменную, отсутствие linkage и message-бота, сохранение возможностей отката и отдельную menu button без её изменения. Записаны точные команды и реальные ограничения приёмки.
- [ ] Lead перед merge/deploy получает green exact-source FULL и одно независимое review; production использует только существующий protected token и неизменные release guards. Реальный Telegram и iPhone подтверждаются только фактической проверкой, не desktop fixture.
