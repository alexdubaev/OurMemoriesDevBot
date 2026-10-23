window.STATE =
{
  "version": 2,
  "slug": "wishlist",
  "dir": "2026-10-23-wishlist--wip",
  "title": "Вишлист подарков для ребёнка",
  "mode": "interview",
  "depth": "normal",
  "tier": "T1",
  "briefFile": "2026-10-23-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "user",
  "skillDir": "C:/Users/Alexandr/.claude/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-10-23T11:19:12+03:00",
  "updatedAt": "2026-10-23T11:49:32+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-10-23T11:19:12+03:00",
      "finishedAt": "2026-10-23T11:19:25+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-10-23T11:19:25+03:00",
      "finishedAt": "2026-10-23T11:19:57+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-10-23T11:19:57+03:00",
      "finishedAt": "2026-10-23T11:40:01+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-10-23T11:40:01+03:00",
      "finishedAt": "2026-10-23T11:48:42+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-10-23T11:48:42+03:00"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 26,
    "done": 0,
    "inTicket": 25,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 1,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Подарки и бронь на сервере",
      "requirements": [
        "R01",
        "R25i",
        "R03",
        "R05",
        "R18",
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "R11",
        "R14",
        "R15",
        "R16",
        "R17",
        "R19",
        "R20",
        "R21",
        "R22",
        "R23",
        "R24"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "packages/contracts/src/",
        "backend/prisma/",
        "backend/src/modules/gifts/",
        "backend/src/app.ts",
        "backend/src/jobs.ts",
        "backend/src/modules/families/application/family-service.ts",
        "backend/src/modules/media/"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Вкладка «Подарки» в приложении",
      "requirements": [
        "R02",
        "R03",
        "R04",
        "R05",
        "R06",
        "R07",
        "R08",
        "R09",
        "R10",
        "R11",
        "R12",
        "R13",
        "R20",
        "R22",
        "R23",
        "R24"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "webapp/src/",
        "webapp/tests/",
        "webapp/public/assets/icons/",
        "assets/icons/",
        "assets/manifest.json"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 8,
    "fixed": 8,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-10-23T11:19:12+03:00",
    "2026-10-23T11:19:25+03:00",
    "2026-10-23T11:19:42+03:00",
    "2026-10-23T11:19:57+03:00",
    "2026-10-23T11:22:35+03:00",
    "2026-10-23T11:30:46+03:00",
    "2026-10-23T11:32:30+03:00",
    "2026-10-23T11:40:01+03:00",
    "2026-10-23T11:48:41+03:00",
    "2026-10-23T11:48:42+03:00",
    "2026-10-23T11:49:30+03:00",
    "2026-10-23T11:49:31+03:00",
    "2026-10-23T11:49:32+03:00"
  ],
  "rev": 14,
  "waiting": null,
  "waits": [
    {
      "kind": "briefing",
      "from": "2026-10-23T11:22:35+03:00",
      "to": "2026-10-23T11:30:46+03:00"
    },
    {
      "kind": "briefing",
      "from": "2026-10-23T11:32:30+03:00",
      "to": "2026-10-23T11:40:01+03:00"
    }
  ],
  "log": [
    {
      "t": "2026-10-23T11:19:12+03:00",
      "k": "init"
    },
    {
      "t": "2026-10-23T11:19:25+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-10-23T11:19:57+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-10-23T11:22:35+03:00",
      "k": "ask",
      "kind": "briefing",
      "note": "раунд 1: где раздел, кто наполняет, бронь, поля карточки"
    },
    {
      "t": "2026-10-23T11:30:46+03:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-10-23T11:32:30+03:00",
      "k": "ask",
      "kind": "briefing",
      "note": "раунд 2: автозаполнение по ссылке, куплено и архив, оповещения, внешние ссылки"
    },
    {
      "t": "2026-10-23T11:40:01+03:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-10-23T11:40:01+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 25,
      "total": 26
    },
    {
      "t": "2026-10-23T11:40:01+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-10-23T11:48:41+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 8,
      "fixed": 8,
      "deferred": 0
    },
    {
      "t": "2026-10-23T11:48:42+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-10-23T11:49:30+03:00",
      "k": "tier",
      "v": "T1"
    },
    {
      "t": "2026-10-23T11:49:31+03:00",
      "k": "tickets",
      "n": 2
    },
    {
      "t": "2026-10-23T11:49:32+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Создать вишлист для ребёнка»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«который будет доступен где-то в отдельной вкладке или разделе memoLy» / «Где находится раздел: отдельная вкладка, раздел в профиле ребёнка или в разделе семьи»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«Бабушка, дедушка и другие участники семейной группы смогут зайти, когда думают, что подарить ребёнку, увидеть список желаемых подарков»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«и сразу перейти по ссылке в магазин, где можно купить выбранный подарок»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«родители добавляют название, изображение, цену и ссылку на магазин»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«Кто наполняет и редактирует список: только владелец семьи, все с правом full или кто-то ещё»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«родственники просматривают список и могут резервировать подарок, чтобы избежать повторных покупок» / «Нужно ли бронирование»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«и отметка «куплено»» / «как отмечается покупка»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«скрыта ли бронь от родителей, видно ли, кто забронировал»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«кто может снять бронь»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«Что делать с подарком после покупки или удаления: скрывать, архивировать или удалять»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«Платформы: только MAX Mini App и Web/PWA с MAX-авторизацией. Telegram не разрабатывается и не проверяется»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«Интерфейс: принятый memoLy UI v4 и его компоненты. Вишлист выглядит как часть текущего приложения, а не отдельное приложение»",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«Права: только существующие семьи и FamilyAccess (владелец, full, viewer). Никакой своей авторизации, отдельной базы»",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "«или публичных ссылок для людей вне семьи»",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "«Код прав доступа и брони проверить отдельным ревью этого таска, не дожидаясь финального ревью»",
      "status": "in-ticket"
    },
    {
      "id": "R17",
      "text": "«Изменение схемы — новой миграцией Prisma в backend/prisma/migrations, без правки существующих миграций»",
      "status": "in-ticket"
    },
    {
      "id": "R18",
      "text": "«Изображение подарка: если загружается файл, то через существующее приватное хранилище медиа, без новых публичных путей к файлам»",
      "status": "in-ticket"
    },
    {
      "id": "R19",
      "text": "«Первая версия без автозаполнения карточки по ссылке: сервер не скачивает страницы магазинов»",
      "status": "in-ticket"
    },
    {
      "id": "R20",
      "text": "«Ссылка на магазин открывается только по http/https»",
      "status": "in-ticket"
    },
    {
      "id": "R21",
      "text": "«Цена — текст или число без привязки к оплате; никаких платежей внутри memoLy»",
      "status": "in-ticket"
    },
    {
      "id": "R22",
      "text": "«Готовые проекты ниже — только ориентир по сценариям и интерфейсу. Код из них не копировать»",
      "status": "in-ticket"
    },
    {
      "id": "R23",
      "text": "«Не делать push, merge, деплой и изменение production-данных»",
      "status": "in-ticket"
    },
    {
      "id": "R24",
      "text": "«Работать только в этом worktree, ветка feat/wishlist»",
      "status": "in-ticket"
    },
    {
      "id": "R25i",
      "text": "(подразумевается) «для ребёнка» — сейчас в семье один ребёнок, позже несколько (PM-005)",
      "status": "in-ticket"
    },
    {
      "id": "G01",
      "text": "«O3 — добавление подарка пересылкой товара боту MAX, если MAX отдаёт превью ссылки, — записать в идеи как следующий шаг» (раунд 2, «ок»)",
      "status": "deferred",
      "why": "вне рамок сборки: запись в банк идей — отдельная docs-операция по AGENTS.md"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-10-23T11:40:01+03:00",
      "open": 25,
      "total": 26
    },
    "G2": {
      "ok": true,
      "at": "2026-10-23T11:48:41+03:00",
      "found": 8,
      "fixed": 8,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-10-23T11:49:32+03:00",
      "problems": 0
    }
  },
  "result": null
}
