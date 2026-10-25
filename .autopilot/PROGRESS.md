<!-- autopilot:progress -->
# memoLy — вишлист подарков: что осталось

Последняя сборка: `.autopilot/2026-10-23-wishlist/` — вкладка «Подарки»: список подарков ребёнка, бронь, «Подарено», переход в магазин; ветка `feat/wishlist`, не слита.

## Договорились — не пересматривать

- 2026-10-24 — добавление подарков исключительно через приложение: достаточно ссылки, название/фото подставляются по возможности, цена по желанию. Если магазин не отдаёт карточку: «Сохранить ссылку с иконкой подарка и названием магазина; данные можно дополнить позже».
- Вкладка «Подарки» в нижней навигации, а не раздел внутри «Семьи» (Q1).
- 2026-10-23 — позднейшее решение владельца: «Порядок будет такой Лента, Альбомы, Добавить, Подарки, Семья». Кнопка добавления по центру; для viewer сохраняется прежний режим просмотра в третьей позиции.
- Иконки соответствуют текущему UI v4: молочный фон, зелёный акцент #416D58, неактивные #596858; WebP RGBA, без SVG.
- Список наполняют и правят все участники с правом full (Q2).
- Бронирует любой участник, включая viewer; бронь и имя видны всем; снимает забронировавший, владелец может снять чужую (Q3).
- Ссылка, название и фото обязательны, цена по желанию и текстом (Q4).
- Без автозаполнения по ссылке: Ozon и WB закрыты антиботом, Я.Маркет отвечает только поддельному краулеру (Q5, O1).
- «Куплено» ставит забронировавший; купленное — в свёрнутом «Подарено» (Q6).
- Оповещений семье нет (Q7).
- Внешняя ссылка открывается только по нажатию на карточку подарка (Q8).

## Не доделано

- G01 — записать в `docs/ideas/IDEAS.md`: добавление подарка пересылкой товара боту MAX, если MAX отдаёт боту превью ссылки. Отдельная docs-операция по AGENTS.md.
- До merge: закончить интеграцию актуального main b4cdbbc, профиль FULL на точном candidate SHA (включает memoly-v4, max-family-audit и новые gifts-сценарии), независимое GPT-6 Luna High ревью и evidence в PR #227.
- До deploy: FULL на итоговом release SHA, измеренная recovery-совместимость и guarded Selectel release с migrate. Деструктивный откат БД запрещён без отдельного согласования.

## Известные баги

- `comments.integration` однажды упал сразу после `max/capture` в общем прогоне — похоже на остаток данных capture-тестов.

## Правки без автопилота

- 2026-10-25 — FAMILY-INVITE-ENTRY: исправляется вход по приглашению MAX при наличии собственной незаполненной семьи или старой cookie-сессии. Параметры запуска используются только для маршрутизации токена; личность подтверждается подписанным MAX initData на сервере, семейный ACL сохраняется. Ошибки входа/приглашения не должны открывать создание другой семьи; выбранная после проверки семья сохраняется для обычного запуска. Добавляется минимальное диагностическое событие фактического отзыва доступа без имени, содержимого и секретов. Новых миграций и административного удаления нет; итоговые source-bound FULL/review/deploy/recovery evidence записываются в PR задачи.

- 2026-10-25 — MEMOLY-MEMBER-AVATAR-SYNC: FULL нашёл, что удаление старого App-слушателя `member-avatar-updated` нарушило существующее обновление child-avatar crop и замены в production App. Локальный listener восстановлен рядом с family directory refresh; оба исходных сценария детских аватарок прошли целевую проверку 2/2. Recovery fingerprint пересчитан для точного staged App blob; итоговый FULL ещё не повторён. Backend, contracts и migrations не меняются.

- 2026-10-24 — ALBUM-RECOVERY-ATTESTATION: FULL source 78a5e55 и release a33d220 прошли; normal FULL deploy остановился до promotion на незарегистрированном compatibility fingerprint. Во входах production относительно ab6b9a5 отличается только album-local CSS. Измеренный e0654e5c48ee35800754e7d784ad3b0af1bd5ff5cb7a860e4f3a063ee8609b67 зарегистрирован для прежнего 33a/dc26 wishlist recovery profile; target, ledger, guards и запрет деструктивного отката БД сохранены. Regression принимает точный CSS blob и отклоняет CSS/backend drift. Итоговые exact-source FULL/review/merge/deploy фиксируются в отдельном PR и внешнем HANDOFF.
- 2026-10-24 — ALBUM-UPLOAD-LAYER: PR #234 слит; меню выбора фото поднято только над локальным редактором альбома, обычное добавление в ленту не меняется. Source/final FRONTEND и независимое Luna High review прошли. Выпуск выявил отдельную гонку Selectel readiness: одноразовый HTTP probe завершился до открытия порта Caddy; предыдущий интерфейс восстановлен guard'ом. Блокер доставки исправляется отдельной временной веткой SELECTEL-STATIC-READINESS с обязательным FULL и review; окончательный release evidence — в PR и внешнем HANDOFF.
- 2026-10-24 — GIFT-URL-AUTOFILL: сохранение по одной ссылке, получение карточек Wildberries/Ozon/Яндекс Маркета, необязательная цена, при отказе магазина — его название и существующая иконка. Фото проходят обычную приватную загрузку; схема и миграции не меняются. Независимое Luna High review 8f1f75a без P0/P1/P2; первый FULL остановился на устаревшем требовании title/photo в unit-тесте, оно заменено на согласованный URL-only сценарий с сохранением негативных проверок. Итоговые FULL/merge/deploy фиксируются в PR и внешнем HANDOFF.
<!-- дата — что — почему; пишет обычная сессия, следующая сборка разбирает -->
- 2026-10-24 — интеграция принятых альбомов с вишлистом, пять позиций навигации; закрыты шесть замечаний PR: отзыв доступа очищает приватный список, повтор снятия покупки идемпотентен, форма не закрывается при сохранении, PATCH фото проверен на чужое/нецелевое/занятое медиа и старое фото 404, selector gifts согласован, новая иконка экспортирована в 48/72px с единым alpha и обновлённым manifest.
- 2026-10-24 — добавлена недеструктивная миграция 20261024120000_gift_photo_recovery_guard по существующему паттерну album photos. Реальный frozen-v4 cleanup без guard помечает фото подарка удалённым; с guard сохраняются данные и байты. Синтетический current -> 33a -> current: 1 pass, 44 assertions; exact-ledger regression: 1 pass. Это узкие результаты, не FULL и не production deploy.
- Узкие проверки до общего gate: typecheck PASS; gift units 15/15; gift PostgreSQL 9/9, 203 assertions; gifts E2E 2/2 и album navigation; закрытие двух новых lint errors — targeted ESLint PASS. Окончательный source-bound evidence публикуется в PR после FULL/review.
- 2026-10-24 — независимое GPT-6 Luna High review на 7d47893 нашло один P2: HTTP-cache фото подарков. Исправлено в 5f0f854: original/preview/display GET/HEAD используют private, no-store, conditional GET возвращает 200; обычные memory images сохраняют no-cache/304. Red воспроизведён; green gifts 9/9 (223 assertions), media-access 12/12 (167 assertions), backend typecheck exit 0. Тем же независимым reviewer выполнено узкое closure: P2 закрыт, других P0/P1/P2 нет. Обновлённый FULL ещё не выполнен; прерванный прогон 7d47893 не считается PASS.
- 2026-10-24 — recovery probe повторён после no-store fix: 1 pass / 45 assertions / exit 0; source pin 9bc6fdc22b85fe68e04ab387c1d9ce3c4f8a01471c177f1b61d9ae07bbde13c8. Release regression больше не зависит от producer-коммита: 52 frozen production blobs поверх принятого b4cdbbc, exact fingerprint и отрицательный source-drift control; 52/52 blob IDs доступны в итоговом дереве. Узкие release checks 2 pass / 59 filtered / exit 0. Прерванные FULL на 7d47893 и 39aaa7f не являются PASS; финальный кандидат проверяется отдельно.
- 2026-10-24 — FULL19c6827: FAIL в tool gate (122 pass / 2 fail, exit 1). Причины установлены: историческая frontend rollback fixture ссылалась на отсутствующий несмерженный SHA92b147; album guard test ожидал старый diagnostic после обобщения pre-SQL guard. Исправлены только две test fixtures, реальные ancestry guards и nonzero/no-promotion assertions сохранены. Узкое закрытие: frontend 1 pass / 9 filtered / exit 0; album 1 pass / 60 filtered / exit 0. Полный gate запускается заново на зафиксированном кандидате после диагностических product checks.
- 2026-10-24 — диагностически выполнен весь активный product catalog: contracts 71, backend units 152, webapp 138, website 4; browser MAX/Web/PWA 56/56 exit 0 (включая memoly-v4/max-family-audit/gifts). PostgreSQL suites пройдены частями после расследования двух таймаутов: album race harness исправлен (guaranteed barrier release/settlement + bounded waits; race 1/1, full album 12/12/104 assertions), без production-изменений. Memories timeout не воспроизведён в focused runs; полный файл затем прошёл обычным runner 23/23/209 assertions без правок, последние пять integration suites exit 0. Диагностические логи не являются FULL PASS. Финальный FULL выполняется отдельно на clean exact candidate; итоговый merge/deploy ledger публикуется в PR #227, этот файл является снимком подготовки.

## Интеграция этапа 1 нескольких детей (MEMOLY-CHILDREN-STAGE1)

Статус: IN_PROGRESS, merge origin/main 954640d34f73103a577b497ec237c7701fcfad56 в PR #231 продолжается. Child-ветка содержит stage 1; wishlist/main conflict resolution и обязательные focused checks ещё не завершены. Не объявлять FULL, review, merge или deploy PASS.

Известный интеграционный риск: App.tsx, albums composer и PhotoComposer совмещают multi-child tags с прямой загрузкой фото в альбом из current main. Сохранять оба пути и проверять gifts navigation/cache при завершении интеграции. Проверки по текущему незавершённому merge пока не запускались.

- 2026-10-26 — CONTROL-USER-DELETE Task3 реализовал Control transport/contracts и интерфейс владельца: предпросмотр/удаление/восстановление MAX-пользователя и отдельная очистка семьи, фильтрацию purge в Control, fail-closed обработку 401/403 и состояние legacy inactive. Source HEAD 3c4873e; API/PG 16 тестов, 274 assertions, contracts 84/382, lint/build/typecheck PASS; Chromium+WebKit synthetic owner journey 2/2. Детали и external screenshots — в локальном Task3 evidence report; полный профиль/review/integration остаются за lead.
