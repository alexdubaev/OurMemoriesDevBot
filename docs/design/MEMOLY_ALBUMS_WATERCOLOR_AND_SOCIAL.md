# Альбомы: акварель и обсуждение историй

Задача `MEMOLY-ALBUMS-WATERCOLOR-AND-SOCIAL`, 2026-11-04. Это единая поставка хранения обсуждений AlbumEntry, scoped API, общего frontend adapter и оформления четырёх внутренних экранов. Общий social UI остаётся в открытой истории; у плиток мастерской нет обсуждений и дополнительных social-запросов. Финальные FULL, independent review, интеграцию и guarded release фиксирует интегратор после freeze всего source.

## Оформление

Источник — первый утверждённый вариант PR270, первоначально закреплённый `863610b694c628df4e303032ce3833eeadcc6ea0`, дополненный полным безопасным reference и подлинной графикой в `1906f549`. Перенесены отдельные palette, bear, rabbit, hills и sprig WebP. Файлы имеют непрозрачную бумажную подложку; CSS multiply соединяет её с фоном. Альфа-канал не заявлен. Размеры, фактические байты и SHA256 находятся в `assets/manifest.json`; все пять файлов вместе — 5068 байт, без EXIF/XMP/ICC. На реальном synthetic workshop 390px измерены пять загруженных response body того же суммарного размера.

Внутренние экраны получили короткую шапку, компактное «Добавить», описание и настройки в меню. Фильтры категории/года и подсказка жеста раскрываются из одного ряда со шкалой мастерской. При увеличенном тексте раскладка освобождает место для целых слов и переходит к одной колонке фото. Мастерская сохраняет collage layout, 8/5/3, pinch, pagination, bounded DOM и возврат к работе. Первый год сохраняет 12 durable chapters, фактическую наполненность и обзор. События сохраняют частичные/неизвестные даты, текстовые истории и предложения; свободный альбом — порядок и редактор источников. Каталог, общий shell, пять navigation buttons, viewer и shared social компоненты не менялись.

## Проверено на этапе оформления

- `bun run --cwd webapp typecheck` — PASS; lint — 0 errors, одна прежняя warning в auth/provider.tsx; production build — PASS, прежнее предупреждение о размере chunks.
- Существующий `albums.spec.ts` через `playwright.max.config.ts`: 9 PASS, один устаревший selector заголовка исправлен на доступное имя; narrow closure — 1 PASS. После финальных CSS/fixture изменений affected first-year и 2000 works — 2 PASS. Assertions поведения сохранены; для 2000 добавлена проверка отсутствия social reads до открытия истории.
- Существующий `album-social.spec.ts` через dedicated ignored MAX config — 3 PASS: реальная трёхфотографийная история/retries/reactions, account switch, clear/refill generation. Canonical MAX testMatch ещё требует регистрации этого нового файла интегратором; targeted config не является FULL.
- Реальный App с synthetic transport: 34 captures четырёх экранов на 320/390/430, empty/filled, 200% text и пяти дополнительных темах; нет horizontal overflow/page errors/gallery social reads, Add targets не меньше 44px. Fixture исправлена: sourceCount соответствует доступным источникам, пустые главы не показывают вымышленные материалы.
- Реальные 3 работы: category/year filters, CDP two-finger pinch 5→3, кнопки 3→5→8, одно обсуждение после открытия, возврат в прежний масштаб. Существующий 2000 works journey проверяет progressive pages, DOM ≤320, zoom anchor и viewer return.
- Каталог на одинаковых 24 synthetic работах: все computed style properties и rectangles идентичны при включении/выключении только новых внутренних CSS rules; PNG bytes в одном браузере идентичны. Исторический baseline имеет небольшую разницу по сглаженным краям текста/графики/теней (RGB MAE 0.20/0.24/0.23); его browser environment нельзя восстановить из PNG. Catalog JSX и его CSS не редактировались.

Логи, сценарии, geometry и screenshots находятся вне Git в `D:/codex/TG_OurMemoriesDevBot/task-evidence/MEMOLY-ALBUMS-WATERCOLOR-AND-SOCIAL/`: `visual-watercolor/`, `visual-firstyear/`, `visual-albums-max-e2e.log`, `visual-albums-closure.log`, `visual-final-journeys.log`, `visual-social-journeys.log`, `visual-typecheck.log`, `visual-lint.log`, `visual-build-final.log`. Скриншоты содержат только синтетические материалы. Новых тестов на incidental markup нет.

## Ручная проверка на физическом iPhone / MAX

- Открыть четыре внутренних альбома в MAX и Web/PWA; проверить чтение, темы, крупный текст, клавиатуру и safe areas.
- В мастерской проверить настоящий двухпальцевый жест, прокрутку, открытие фото и возврат к месту.
- В истории проверить один social row для всех вложений, открытие/закрытие общей панели, focus и MAX Back, редактирование и retry при сети.

Desktop Chromium и CDP touch emulation не подтверждают эти действия на физическом устройстве.
