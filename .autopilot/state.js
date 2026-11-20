window.STATE =
{
  "version": 2,
  "slug": "carousel-albums-smoothness",
  "dir": "2026-11-20-carousel-albums-smoothness--wip",
  "title": "Плавность ленты, карусели и альбомов memoLy",
  "mode": "semi",
  "depth": "normal",
  "tier": "T1",
  "briefFile": "2026-11-20-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "C:/Users/Alexandr/.claude/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-20T14:14:39+03:00",
  "updatedAt": "2026-11-20T14:34:14+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-20T14:14:39+03:00",
      "finishedAt": "2026-11-20T14:15:06+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-20T14:15:06+03:00",
      "finishedAt": "2026-11-20T14:15:31+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-11-20T14:15:31+03:00",
      "finishedAt": "2026-11-20T14:24:22+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-20T14:24:22+03:00",
      "finishedAt": "2026-11-20T14:33:22+03:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-11-20T14:33:22+03:00"
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
    "total": 8,
    "done": 0,
    "inTicket": 8,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Карусель и полноэкранный просмотр листаются и выглядят одинаково",
      "requirements": [
        "R05",
        "R05.1",
        "R05.2",
        "R05.3",
        "R05.4",
        "R06",
        "R06.1",
        "R06.2",
        "R02",
        "R02.1",
        "R02.2",
        "R01",
        "R07i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "webapp/src/features/feed/",
        "webapp/src/components/ui/drawer.tsx",
        "webapp/src/features/memoly-ui/AddSheetPresentation.tsx",
        "webapp/e2e/fullscreen-swipe.*",
        "webapp/e2e/fixed-carousel.*",
        "webapp/e2e/memoly-v4.*",
        "webapp/tests/feed-gestures*.test.ts"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Фото в альбомах появляются сразу, кэш не тормозит",
      "requirements": [
        "R03",
        "R03.1",
        "R03.2",
        "R03.3",
        "R04",
        "R04.1",
        "R04.2",
        "R04.3",
        "R02",
        "R01",
        "R07i",
        "G01"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "webapp/src/platform/persistence/private-cache.ts",
        "webapp/src/platform/media/use-private-image-url.ts",
        "webapp/public/private-media-sw.js",
        "webapp/src/features/albums/",
        "webapp/tests/private-cache*.test.ts",
        "webapp/tests/private-media-sw.test.ts",
        "webapp/e2e/albums.spec.ts",
        "webapp/e2e/fixtures/albums.ts"
      ],
      "review": "нет",
      "model": "сильная",
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
    "found": 5,
    "fixed": 4,
    "deferred": 1,
    "items": [
      "G01 — «сразу merge и выпуск»: перед фактическим merge и выкладкой остаётся подтверждение да/нет — правило безопасности, не сокращается"
    ]
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-20T14:14:39+03:00",
    "2026-11-20T14:14:46+03:00",
    "2026-11-20T14:15:06+03:00",
    "2026-11-20T14:15:26+03:00",
    "2026-11-20T14:15:31+03:00",
    "2026-11-20T14:15:45+03:00",
    "2026-11-20T14:24:22+03:00",
    "2026-11-20T14:33:15+03:00",
    "2026-11-20T14:33:22+03:00",
    "2026-11-20T14:34:04+03:00",
    "2026-11-20T14:34:05+03:00",
    "2026-11-20T14:34:06+03:00",
    "2026-11-20T14:34:13+03:00",
    "2026-11-20T14:34:14+03:00"
  ],
  "rev": 15,
  "waiting": null,
  "waits": [
    {
      "kind": "briefing",
      "from": "2026-11-20T14:15:45+03:00",
      "to": "2026-11-20T14:24:22+03:00"
    }
  ],
  "log": [
    {
      "t": "2026-11-20T14:14:39+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-20T14:15:06+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-20T14:15:31+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-20T14:15:45+03:00",
      "k": "ask",
      "kind": "briefing",
      "note": "четыре вопроса — устройство, эталон полноэкранного фото, рамки ревью, выпуск"
    },
    {
      "t": "2026-11-20T14:24:22+03:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-11-20T14:24:22+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 8,
      "total": 8
    },
    {
      "t": "2026-11-20T14:24:22+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-20T14:33:15+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 5,
      "fixed": 4,
      "deferred": 1
    },
    {
      "t": "2026-11-20T14:33:22+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-20T14:34:04+03:00",
      "k": "tier",
      "v": "T1"
    },
    {
      "t": "2026-11-20T14:34:05+03:00",
      "k": "tickets",
      "n": 2
    },
    {
      "t": "2026-11-20T14:34:06+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 2
    },
    {
      "t": "2026-11-20T14:34:13+03:00",
      "k": "tickets",
      "n": 2
    },
    {
      "t": "2026-11-20T14:34:14+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«проведи ревью, посмотри что еще надо доработать»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«у меня есть вопросы к плавности интерфейса»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«фотографии в альбомах появляются с задержкой»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«может че то с кешем не так»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«в ленте открыл карусель, с фотографии на видео перелистнул, а с видео уже не могу не вперед ни назад листать»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«фотографии из ленты если одиночные открыть в полный просмотр отличаются от фотографий если их несколько и открывается карусель»",
      "status": "in-ticket"
    },
    {
      "id": "R07i",
      "text": "(подразумевается) найденное ревью оформлено списком с приоритетами, исправления не ломают уже принятое поведение (тесты, UI v4/Astryx)",
      "status": "in-ticket"
    },
    {
      "id": "G01",
      "text": "«сразу merge и короткий выпуск фронтенда по правилам проекта»",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-20T14:24:22+03:00",
      "open": 8,
      "total": 8
    },
    "G2": {
      "ok": true,
      "at": "2026-11-20T14:33:15+03:00",
      "found": 5,
      "fixed": 4,
      "deferred": 1
    },
    "G3": {
      "ok": true,
      "at": "2026-11-20T14:34:14+03:00",
      "problems": 0
    }
  },
  "result": null
}
