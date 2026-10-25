# ACCEPTANCE — реальные pixels и реальные функции

Task: `MEMOLY-UI-V4-PIXEL-IMPLEMENTATION`. Не заменяет [SPEC](SPEC.md).

## 1. Как готовить сравнение

Распаковать `reference.zip` в принадлежащий задаче временный каталог. Прочитать `reference.html`/`reference.css`, fixture dimensions и provenance. Эталон static/no-JS — не приложение.

В existing frontend test harness отрисовать **настоящие active React presentation-компоненты** с теми же синтетическими DTO/картинками, временем, ролью и темой, что в reference. Для layout сравнения: canonical 390×844, DPR1,100% text,zero host inset; тот же браузер и platform font. Отключить только необязательные анимации и network randomness, не убирать проверяемые компоненты.

Не изменять product auth/API для тестового входа. Тестовые providers допустимы только в изолированном dev/E2E harness, не в production. Несовпадающее разрешение фотографии не исправлять crop оригинала: сравнивать одинаковую fixture.

Получить `getBoundingClientRect()` и computed styles, сделать before/after и overlay. Скриншоты эталона и настоящего компонента должны быть подписаны source SHA, viewport, role/theme. Текст и размеры сравнивать численно, не только визуальным мнением.

## 2. Canonical координаты сырого v4

**390×844 CSS px, DPR1, insets=0.** Геометрия measured в Chromium144.0.7559.96; эти значения повторно проверены на публичном обезличенном варианте.

| Элемент | x | y | w | h |
|---|---:|---:|---:|---:|
| Feed header | 0 | 0 | 390 | 96 |
| Первое media city | 16 | 175 | 358 | 216.1875 |
| Bottom navigation | 0 | 782 | 390 | 62 |
| Family toolbar | 16 | 0 | 358 | 58 |
| Family profile | 16 | 70 | 358 | 96 |
| Family people heading | 16 | 191 | 358 | 21 |
| First member row | 16 | 221 | 358 | 71 |
| Invite action | 16 | 379 | 358 | 46 |
| MAX connection row | 16 | 487 | 358 | 69 |

При production hit44 авторского action row первое медиа может начинаться на **176**, не175. Pagination row24 даёт +5px после album media. Это два предписанных сдвига из SPEC; остальные отличия не прятать за ними. Контраст secondary в production темнее raw reference по SPEC.

**320×844:** gutter14, header320×96, city media x14/y175/w292/h176.328125, nav y782/h62. **430×932:** gutter16, media x16/y175/w398/h240.34375, nav y870/h62. Значения media height вычисляются как width/ratio, не хардкодятся по viewport.

Desktop reference содержит демонстрационный phone frame и пояснение. Их координаты **не** являются product layout. Production desktop сохраняет существующую центральную app surface и visual tokens; screenshot comparison проводить внутри её content box.

## 3. Обязательная визуальная выборка

Одной длинной детерминированной лентой покрыть: horizontal single, vertical single, square, three-photo mixed-orientation album, mixed photo/video/photo, video posterior duration, без подписи, длинная многострочная подпись, voice с кнопкой слева, note. Минимум три даты; первая запись после обновления не прижата к шапке.

Отдельные screenshots:

- Feed first viewport390/320/430, промежуточная часть и самый низ.
- Family Owner390/320, Full non-owner, Viewer;2 и10 участников; long child/member names.
- Fullscreen: открытие второго вложения, соседний video, last slide, close/reopen.
- Add sheet, реальная invite form/pending/committed-read-failed, terminal invite, member/profile/child editor, settings.
- Empty/error/pagination retry/unread; канал connected/disconnected/error.
- Все действующие темы: одинаковая геометрия, реальные соответствующие artwork и текстовый контраст.

Не превращать это в сотни комбинаций без риска: основные геометрии на390, узкий320 и широкий430 smoke, role/state variants на подходящем одном viewport. Функциональные tests переиспользовать.

## 4. Функциональные проверки, которые дизайн не может отменить

1. MAX и PWA вход/повторное открытие; family selection и real callbacks остаются подключены. Схема auth не меняется.
2. Owner/Full/Viewer видят ровно прежние actions. Full non-owner видео разрешено, Viewer denied. Нельзя удалить кнопку и заявить, что исправлена серверная безопасность.
3. Принятие приглашения → правильная семья → старая история → повторное открытие. Pending/save/read error и idempotency прежние.
4. Пагинация, unread и доступность последней записи над bottom bar; режим новых не пропадает вместе с декоративной шапкой.
5. Avatar загрузка делится карточками одного автора. Не появилось по fetch/objectURL на каждую карточку; тема/scroll не создают повторную загрузку.
6. Media рамка стабильна при swipe, poster readiness и загрузке следующих слайдов. Native ratios/contain сохраняют всё изображение.
7. В fullscreen swipe photo→video→photo; previous video paused и resources released; seek/control/multitouch не вызывают случайное листание; после close сохранён индекс.
8. Voice: play/pause слева, настоящий audio, seek/progress/ошибка, корректное отключение при уходе по прежней policy.
9. Реакции: picker/long press/add/change/remove, настоящий count, pending/error rollback, разные account/family/epoch не смешиваются.
10. Caption Unicode/переносы/emoji выводятся без изменения; source dates/порядок не переопределяются.
11. Late familyA response/optimistic callback не возвращают данные вB или другой account; existing query/cache/session guards остаются нетронутыми.
12. Empty/missing media не маскируют Access revoked; нет глобального сброса кеша из-за единственного404 файла.

Узкие существующие тесты выбирать по actual changed boundaries. Не выполнять новый аудит всех перечисленных подсистем, когда их code/contract не менялся; проверить wiring и наиболее рискованные пользовательские стыки.

## 5. Accessibility и платформы

- Keyboard: все видимые actions доступны, focus visible, modal focus trap/return, Escape/host Back без двойного закрытия.
- Text200%: без обрезанных имени/возраста/роли/кнопок; horizontal scroll всей страницы отсутствует на320; control labels читаемы.
- Contrast: обычный текст минимум4.5:1 на фактическом фоне; status не только цвет; icons/control boundaries проверять отдельно. Small typography сама по себе не доказывает доступность.
- Hit areas:44px основных controls,24px отдельных pagination targets, без пересечений и поглощения swipe/seek.
- Safe area:0 и действительные ненулевые top/bottom; никакой суммы одинакового host/browser inset дважды; клавиатура не скрывает единственный submit.
- Reduced motion и native selection; не блокировать zoom, не использовать user-scalable=no.
- Chromium и доступный WebKit; эмуляция не является реальным iPhone/MAX. Physical acceptance в отчёте отдельным статусом.

## 6. Проверка отсутствия scope drift

Diff не содержит backend/Prisma/migration/auth/SW/cache/query-key/provider/deploy edits. При реально нужном выходе за эти границы — конкретный BLOCKED и решение владельца, а не тихая правка.

Нет demo data/фиктивных counters/пустых проигрывателей/checkbox reactions в production bundle. Нет draft headers/logo/slogan, вторых приглашений, больших отдельных member cards, новой рамки телефона/guide, выдуманных комментариев/статистики/поиска.

Все новые production иконки через действующий `WebpIcon`/WebP RGBA. Не подключён другой icon library, font file, CDN или design framework. Не заменён media engine. Root config и manifests не изменены ради visual convenience.

## 7. Итоговые доказательства

Приложить к implementation PR:

- точный main/base/head и reference commit/hash;
- allowed/changed paths и объяснение необходимых исключений;
- 390/320/430 и семейные/медиа screenshots настоящего приложения;
- numeric table и overlay против reference, названные accessibility deltas;
- status matrix PASS/FAIL/BLOCKED/NOT RUN без подмены старой evidence;
- команды, profile, реальные counts/exit codes; тесты на изолированной synthetic DB/storage;
- один independent review, затем один bounded fix/recheck при необходимости;
- физическая приёмка неподтверждена, если устройства не использовались.

Статус `READY_FOR_OWNER_VISUAL_ACCEPTANCE` допустим, когда обязательные программные проверки и точное сравнение пройдены, а настоящие действия не заменены макетом. `DEPLOYED` здесь не ставить: merge/deploy нового UI ждут согласования владельца.

## 8. Что проверено при публикации самого эталона

Static reference проверен локальным Playwright Chromium144, без JS, на320/390/430/1280.10 записей присутствуют; отсутствие общего горизонтального overflow; header/media/nav coordinates совпадают с исходным v4; навигация feed→family→invite→settings→feed, реакция, viewer open/close и режим4:5 проверены. Иллюстрация шапки совпадает по SHA256. Runtime production/test suites и real devices не запускались. Это пакет дизайна, а не доказательство реализации в memoLy.
