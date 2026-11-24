window.STATE =
{
  "version": 2,
  "slug": "feed-date-period",
  "dir": "2026-11-24-feed-date-period",
  "title": "Фильтр дат в ленте Memoly",
  "mode": "semi",
  "depth": "normal",
  "tier": "T0",
  "briefFile": "2026-11-24-brief.md",
  "memoryFile": "CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "C:/Users/Alexandr/.codex/skills/autopilot",
  "baseCommit": "84c501cd",
  "startedAt": "2026-11-24T20:34:42+03:00",
  "updatedAt": "2026-11-24T21:08:00+03:00",
  "finishedAt": "2026-11-24T21:08:00+03:00",
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-24T20:34:42+03:00",
      "finishedAt": "2026-11-24T20:34:57+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-24T20:34:57+03:00",
      "finishedAt": "2026-11-24T20:35:45+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "startedAt": "2026-11-24T20:35:43+03:00",
      "finishedAt": "2026-11-24T20:35:43+03:00",
      "note": "сценарии и расположение определены макетом"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-24T20:35:45+03:00",
      "finishedAt": "2026-11-24T20:38:44+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-11-24T20:38:44+03:00",
      "finishedAt": "2026-11-24T20:39:22+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-24T20:39:22+03:00",
      "finishedAt": "2026-11-24T21:00:58+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-11-24T21:00:58+03:00",
      "finishedAt": "2026-11-24T21:07:36+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-11-24T21:07:36+03:00",
      "finishedAt": "2026-11-24T21:08:00+03:00"
    }
  ],
  "requirements": {
    "total": 7,
    "done": 7,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Фильтр дат в ленте",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R04",
        "R05",
        "R06",
        "R07i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "packages/contracts/src",
        "backend/src/modules/memories",
        "backend/tests",
        "webapp/src/features/feed",
        "webapp/src/styles",
        "webapp/tests",
        "webapp/e2e"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "done",
      "startedAt": "2026-11-24T20:39:23+03:00",
      "finishedAt": "2026-11-24T21:00:57+03:00",
      "retries": 0,
      "repairs": 0,
      "tests": {
        "passed": 161,
        "failed": 0
      },
      "commit": "06b6a677"
    },
    {
      "id": "F1",
      "title": "Правки по ревью фильтра дат",
      "requirements": [
        "R01",
        "R05",
        "R06",
        "R07i"
      ],
      "blockedBy": [],
      "wave": 2,
      "zone": [
        "packages/contracts/src",
        "webapp/src/features/feed",
        "webapp/tests",
        "webapp/e2e"
      ],
      "review": "да — ремонт ветки",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-24T21:03:37+03:00",
      "finishedAt": "2026-11-24T21:07:35+03:00",
      "tests": {
        "passed": 398,
        "failed": 0
      },
      "commit": "874abdf0"
    }
  ],
  "tests": {
    "passed": 398,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 2,
    "fixed": 2,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": {
    "checked": 7,
    "matched": 7,
    "mismatches": []
  },
  "beats": [
    "2026-11-24T20:34:42+03:00",
    "2026-11-24T20:34:57+03:00",
    "2026-11-24T20:35:40+03:00",
    "2026-11-24T20:35:43+03:00",
    "2026-11-24T20:35:45+03:00",
    "2026-11-24T20:38:43+03:00",
    "2026-11-24T20:38:44+03:00",
    "2026-11-24T20:38:45+03:00",
    "2026-11-24T20:38:46+03:00",
    "2026-11-24T20:38:47+03:00",
    "2026-11-24T20:39:21+03:00",
    "2026-11-24T20:39:22+03:00",
    "2026-11-24T20:39:23+03:00",
    "2026-11-24T21:00:57+03:00",
    "2026-11-24T21:00:58+03:00",
    "2026-11-24T21:03:35+03:00",
    "2026-11-24T21:03:36+03:00",
    "2026-11-24T21:03:37+03:00",
    "2026-11-24T21:03:38+03:00",
    "2026-11-24T21:05:49+03:00",
    "2026-11-24T21:07:35+03:00",
    "2026-11-24T21:07:36+03:00",
    "2026-11-24T21:08:00+03:00"
  ],
  "rev": 25,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-24T20:34:42+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-24T20:34:57+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-24T20:35:43+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "skip",
      "note": "сценарии и расположение определены макетом"
    },
    {
      "t": "2026-11-24T20:35:45+03:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 7,
      "total": 7
    },
    {
      "t": "2026-11-24T20:35:45+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-24T20:38:43+03:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 2,
      "fixed": 2,
      "deferred": 0
    },
    {
      "t": "2026-11-24T20:38:44+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-24T20:38:45+03:00",
      "k": "tier",
      "v": "T0"
    },
    {
      "t": "2026-11-24T20:38:46+03:00",
      "k": "tickets",
      "n": 1
    },
    {
      "t": "2026-11-24T20:38:47+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-24T20:39:22+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-24T20:39:23+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-24T21:00:57+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 161,
        "failed": 0
      }
    },
    {
      "t": "2026-11-24T21:00:58+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    },
    {
      "t": "2026-11-24T21:03:35+03:00",
      "k": "tickets",
      "n": 2
    },
    {
      "t": "2026-11-24T21:03:36+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-24T21:03:37+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-24T21:03:38+03:00",
      "k": "add",
      "key": "report",
      "n": 1
    },
    {
      "t": "2026-11-24T21:05:49+03:00",
      "k": "gate",
      "g": "G4",
      "ok": true,
      "checked": 7,
      "matched": 7
    },
    {
      "t": "2026-11-24T21:07:35+03:00",
      "k": "ticket",
      "ids": [
        "F1"
      ],
      "act": "done",
      "tests": {
        "passed": 398,
        "failed": 0
      }
    },
    {
      "t": "2026-11-24T21:07:36+03:00",
      "k": "stage",
      "id": "final",
      "act": "start"
    },
    {
      "t": "2026-11-24T21:08:00+03:00",
      "k": "finish",
      "result": "Фильтр дат работает в тестовой ленте и прошёл независимую приёмку. Состояние выпуска определяется проверкой FULL."
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Реализуй» · «Даты» справа от «Лента воспоминаний»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«выбор года»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«выбор месяца»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«диапазон месяцев»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«дня»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«выбранный период находится под заголовком и сбрасывается крестиком»",
      "status": "done"
    },
    {
      "id": "R07i",
      "text": "«Реализуй» · рабочая лента воспоминаний",
      "status": "done"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-24T20:35:45+03:00",
      "open": 7,
      "total": 7
    },
    "G2": {
      "ok": true,
      "at": "2026-11-24T20:38:43+03:00",
      "found": 2,
      "fixed": 2,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-24T21:03:36+03:00",
      "problems": 0
    },
    "G4": {
      "ok": true,
      "at": "2026-11-24T21:05:49+03:00",
      "checked": 7,
      "matched": 7
    }
  },
  "result": "Фильтр дат работает в тестовой ленте и прошёл независимую приёмку. Состояние выпуска определяется проверкой FULL.",
  "report": [
    "В редких исторических переходах часовых поясов местный день может состоять из двух раздельных интервалов. Один запрос использует один интервал UTC."
  ]
}
