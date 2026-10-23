# Визуальный и интерактивный эталон

Источник — переданный владельцу `memoly-albums-workshop-v2.html`: плотная мастерская, не прежние отдельно подписанные карточки. Добавлено последнее решение: **Лента / Альбомы / Добавить / Семья**, включая активную вкладку во вложенных album screens.

## Как открыть из checkout

В каталоге этого пакета:

```sh
python restore-reference.py
cd reference
node build.cjs
node --test model.test.cjs workshop-layout.test.cjs
```

На некоторых Unix системах Python называется `python3`. Нужны Python ≥3.9 и Node; npm install и сеть не требуются. Открыть `reference/index.html` в браузере. При ограниченном просмотрщике файлов запустить `python -m http.server 8765` из `reference` и открыть локальный адрес. Это локальный пример, не production server.

Исходники упакованы в tar.xz и разделены на три Base64-файла для надёжной текстовой передачи через подключение GitHub. Restore проверяет SHA256, отсутствие traversal/symlinks, размер и не перезаписывает изменённые исходники. Сборка создаёт 63 встроенных нейтральных SVG-изображения исходных пропорций и полноценный HTML с CSS/JS.

Archive SHA256: `e9fe1a698d2993d2a3ce095419001fc67f0142c0ce5c31ae29bef2395bacaab7`, 36020 bytes. Blob SHA трёх ASCII-файлов:
- source-01: `27518bac3041f79c6aac4776581695d094206a78`;
- source-02: `46ce00ecf6b6eb18f3f09a02aea4c815f340aa29`;
- source-03: `b945a18a1d87a03674f895ec8696659ecc7d8dec`.

## Содержимое

`styles.css`, `render.js`, `app.js`, `seed.js`, `model.js`, `workshop-layout.js`, `build.cjs`, `make-fixtures.cjs`, `fixture-dimensions.json`, два test файла и README. Сохранены каталог, формы, 12 месяцев и обзор, события, мастерская по годам с масштабом, свободные альбомы, picker и viewer. Пять demo albums: year с 8 заполненными слотами из 12, пять событий, 224 работы и два свободных альбома. Изменения сохраняются локально только для демонстрации.

В опубликованном reference заменены изображения, чтобы не выкладывать непроверенные фото людей. Они имеют исходные width/height и не являются production assets. Демоимена, даты и профили не являются требованиями к настоящим семейным данным. Полноцветный HTML с новым меню передан в чате как `memoly-albums-implementation-reference.html`. Для реализации достаточно репозиторного источника: геометрия, CSS и действия сохранены.

## Сценарии

- `#albums` — каталог;
- `#templates` — выбор типа;
- `#album-year` — временная линия;
- `#overview-year` — общий обзор 12 месяцев;
- `#chapter-year-m5` — пустая глава для заполнения;
- `#album-events` — первые открытия;
- `#album-workshop` — мастерская, −/+, годы, фильтры и работы;
- `#album-trip` — свободный альбом.

Вспомогательные feed/family экраны — обвязка прототипа, не замена настоящих экранов memoLy.

## Намеренные различия production

SPEC имеет приоритет. Global Plus остаётся существующим composer, в demo он местами контекстный. «Дети» и второй тестовый ребёнок не означают задачу multi-child. Пустые экземпляры создаются только после действия пользователя. Полная loading/error/permissions матрица — ACCEPTANCE, не одна успешная demo-сессия. Использовать настоящие Typography, WebP icons, palette и artwork текущей темы; neutral fixture background не заменяет family header. Категории работ можно уточнить в рамках согласованных типов рисунков, аппликаций, лепки/поделок и построек, без отдельного менеджера категорий.

Не переносить localStorage JSON, export/reset HTML, fake delays/video/реакции, hash router, data URLs, загрузку всего архива, все скрытые главы в DOM и демозагрузчик как production architecture. Переносить album surfaces в реальные React-компоненты с настоящими Memory/media IDs и ACL.

## Реальные проверки при подготовке

2026-10-23: восстановление трёх частей и SHA256, идемпотентное повторное восстановление, offline build и 6 Node tests. Chromium 144.0.7559.96: две версии (original/public) × четыре viewport 320×844, 390×844, 430×932, 1280×900 = 8 проверок навигации, отсутствия overflow и runtime error. Проверены активные Albums в каталоге/годе/мастерской, переход Family и возврат. Скриншоты original-library и public-workshop просмотрены: четыре позиции, активное состояние и dense layout на месте; различие изображений раскрыто.

Browser connector предоставляет только чтение вкладок. Для проверки использован локальный Playwright. Прямой file:// заблокирован средой; HTML загружен через set_content в новую about:blank. Это не проверка файла внутри MAX, физического pinch на iPhone, backend integration или FULL production. Подробнее — REFERENCE_CHECKS.json.
