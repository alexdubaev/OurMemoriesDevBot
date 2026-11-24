window.STATE =
{
  "version": 2,
  "slug": "feed-date-period",
  "dir": "2026-11-24-feed-date-period--wip",
  "title": "Фильтр дат в ленте Memoly",
  "mode": "semi",
  "depth": "normal",
  "tier": "T0",
  "briefFile": "2026-11-24-brief.md",
  "memoryFile": "CLAUDE.md",
  "memoryOwner": "user",
  "skillDir": "C:/Users/Alexandr/.codex/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-24T20:34:42+03:00",
  "updatedAt": "2026-11-24T20:38:47+03:00",
  "finishedAt": null,
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
      "status": "active",
      "startedAt": "2026-11-24T20:38:44+03:00"
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
    "total": 7,
    "done": 0,
    "inTicket": 7,
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
    "found": 2,
    "fixed": 2,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
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
    "2026-11-24T20:38:47+03:00"
  ],
  "rev": 11,
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
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Реализуй» · «Даты» справа от «Лента воспоминаний»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«выбор года»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«выбор месяца»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«диапазон месяцев»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«дня»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«выбранный период находится под заголовком и сбрасывается крестиком»",
      "status": "in-ticket"
    },
    {
      "id": "R07i",
      "text": "«Реализуй» · рабочая лента воспоминаний",
      "status": "in-ticket"
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
      "at": "2026-11-24T20:38:47+03:00",
      "problems": 0
    }
  },
  "result": null
}
