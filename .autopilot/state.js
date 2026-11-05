window.STATE =
{
  "version": 2,
  "slug": "memoly-month-photo-collage",
  "dir": "2026-11-05-memoly-month-photo-collage--wip",
  "title": "Месяцы первого года memoLy",
  "mode": "full",
  "depth": "strict",
  "tier": "T2",
  "briefFile": null,
  "memoryFile": "AGENTS.md",
  "memoryOwner": "user",
  "skillDir": "C:/Users/Alexandr/.codex/skills/autopilot",
  "baseCommit": "ccea672708b6ae60bdcb737ed4515e547876d233",
  "startedAt": "2026-11-05T22:37:01+03:00",
  "updatedAt": "2026-11-05T23:54:45+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-05T22:37:01+03:00",
      "finishedAt": "2026-11-05T22:37:03+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-05T22:37:03+03:00",
      "finishedAt": "2026-11-05T22:38:41+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "startedAt": "2026-11-05T22:38:40+03:00",
      "finishedAt": "2026-11-05T22:38:40+03:00",
      "note": "ТЗ определяет пользовательские сценарии"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-05T22:38:41+03:00",
      "finishedAt": "2026-11-05T22:38:42+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-11-05T22:38:42+03:00",
      "finishedAt": "2026-11-05T22:39:37+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-11-05T22:39:37+03:00",
      "finishedAt": "2026-11-05T23:54:45+03:00"
    },
    {
      "id": "review",
      "status": "active",
      "startedAt": "2026-11-05T23:54:45+03:00"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 15,
    "done": 14,
    "inTicket": 1,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "month-api",
      "requirements": [
        "R03",
        "R04",
        "R07",
        "R08",
        "R09",
        "R12",
        "R13",
        "R14"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "backend/prisma",
        "backend/src/modules/albums",
        "packages/contracts"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-05T22:39:38+03:00",
      "finishedAt": "2026-11-05T23:07:55+03:00",
      "tests": {
        "passed": 13,
        "failed": 0
      },
      "commit": "949b6493"
    },
    {
      "id": "02",
      "title": "photo-queue",
      "requirements": [
        "R05",
        "R06",
        "R07",
        "R11",
        "R12",
        "R14"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "webapp/src/features/composer",
        "webapp/src/features/albums"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-05T23:07:56+03:00",
      "finishedAt": "2026-11-05T23:17:41+03:00",
      "tests": {
        "passed": 2,
        "failed": 0
      },
      "commit": "9399a961"
    },
    {
      "id": "03",
      "title": "collage",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R08",
        "R10",
        "R13",
        "R14"
      ],
      "blockedBy": [
        "01",
        "02"
      ],
      "wave": 3,
      "zone": [
        "webapp/src/features/albums",
        "webapp/src/features/media"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-05T23:17:42+03:00",
      "finishedAt": "2026-11-05T23:43:28+03:00",
      "tests": {
        "passed": 2,
        "failed": 0
      },
      "commit": "27d8b15d"
    },
    {
      "id": "04",
      "title": "release",
      "requirements": [
        "R15"
      ],
      "blockedBy": [
        "01",
        "02",
        "03"
      ],
      "wave": 4,
      "zone": [
        "webapp/e2e",
        "deploy/selectel"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "in-progress",
      "retries": 0,
      "repairs": 0,
      "startedAt": "2026-11-05T23:43:28+03:00"
    }
  ],
  "tests": {
    "passed": 2,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": null,
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-05T22:37:01+03:00",
    "2026-11-05T22:37:03+03:00",
    "2026-11-05T22:38:40+03:00",
    "2026-11-05T22:38:41+03:00",
    "2026-11-05T22:38:42+03:00",
    "2026-11-05T22:38:43+03:00",
    "2026-11-05T22:38:44+03:00",
    "2026-11-05T22:39:22+03:00",
    "2026-11-05T22:39:25+03:00",
    "2026-11-05T22:39:36+03:00",
    "2026-11-05T22:39:37+03:00",
    "2026-11-05T22:39:38+03:00",
    "2026-11-05T23:07:55+03:00",
    "2026-11-05T23:07:56+03:00",
    "2026-11-05T23:17:41+03:00",
    "2026-11-05T23:17:42+03:00",
    "2026-11-05T23:43:28+03:00",
    "2026-11-05T23:54:45+03:00"
  ],
  "rev": 21,
  "waiting": null,
  "waits": [],
  "log": [
    {
      "t": "2026-11-05T22:37:01+03:00",
      "k": "init"
    },
    {
      "t": "2026-11-05T22:37:03+03:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-05T22:38:40+03:00",
      "k": "stage",
      "id": "briefing",
      "act": "skip",
      "note": "ТЗ определяет пользовательские сценарии"
    },
    {
      "t": "2026-11-05T22:38:41+03:00",
      "k": "gate",
      "g": "G1",
      "ok": true,
      "open": 0,
      "total": 15
    },
    {
      "t": "2026-11-05T22:38:41+03:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-05T22:38:42+03:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-05T22:38:43+03:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-05T22:38:43+03:00",
      "k": "tickets",
      "n": 4
    },
    {
      "t": "2026-11-05T22:38:44+03:00",
      "k": "gate",
      "g": "G3",
      "ok": false,
      "problems": 4
    },
    {
      "t": "2026-11-05T22:39:22+03:00",
      "k": "tickets",
      "n": 4
    },
    {
      "t": "2026-11-05T22:39:25+03:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    },
    {
      "t": "2026-11-05T22:39:37+03:00",
      "k": "stage",
      "id": "build",
      "act": "start"
    },
    {
      "t": "2026-11-05T22:39:38+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-05T23:07:55+03:00",
      "k": "ticket",
      "ids": [
        "01"
      ],
      "act": "done",
      "tests": {
        "passed": 13,
        "failed": 0
      }
    },
    {
      "t": "2026-11-05T23:07:56+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-05T23:17:41+03:00",
      "k": "ticket",
      "ids": [
        "02"
      ],
      "act": "done",
      "tests": {
        "passed": 2,
        "failed": 0
      }
    },
    {
      "t": "2026-11-05T23:17:42+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-05T23:43:28+03:00",
      "k": "ticket",
      "ids": [
        "03"
      ],
      "act": "done",
      "tests": {
        "passed": 2,
        "failed": 0
      }
    },
    {
      "t": "2026-11-05T23:43:28+03:00",
      "k": "ticket",
      "ids": [
        "04"
      ],
      "act": "start"
    },
    {
      "t": "2026-11-05T23:54:45+03:00",
      "k": "stage",
      "id": "review",
      "act": "start"
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Заменить вертикальный список больших фотографий плотным красивым коллажем.»",
      "status": "done"
    },
    {
      "id": "R02",
      "text": "«Вверху месяца сохранить: … название „Нам N месяцев“»",
      "status": "done"
    },
    {
      "id": "R03",
      "text": "«У каждого из 12 месяцев может быть своя главная фотография.»",
      "status": "done"
    },
    {
      "id": "R04",
      "text": "«Сервер обязан проверить: семья → альбом → месяц → доступный источник-фотография.»",
      "status": "done"
    },
    {
      "id": "R05",
      "text": "«Из смешанной публикации можно выбрать отдельную фотографию.»",
      "status": "done"
    },
    {
      "id": "R06",
      "text": "«Использовать существующий direct-album photo pipeline»",
      "status": "done"
    },
    {
      "id": "R07",
      "text": "«Пользователь может выбрать большой набор фотографий за один раз и продолжать добавлять новые позже.»",
      "status": "done"
    },
    {
      "id": "R08",
      "text": "«Нельзя возвращать весь многотысячный месяц одним неограниченным JSON или монтировать все изображения сразу.»",
      "status": "done"
    },
    {
      "id": "R09",
      "text": "«Старый full-replace API не должен трактовать усечённую страницу как полную коллекцию.»",
      "status": "done"
    },
    {
      "id": "R10",
      "text": "«Листание должно работать через границы страниц.»",
      "status": "done"
    },
    {
      "id": "R11",
      "text": "«Большой выбранный набор обрабатывается очередью.»",
      "status": "done"
    },
    {
      "id": "R12",
      "text": "«При смене семьи/аккаунта, отзыве доступа, удалении или очистке месяца запоздалые операции не должны пополнять новый либо уже очищенный контекст.»",
      "status": "done"
    },
    {
      "id": "R13",
      "text": "«Уже существующие видео, голосовые и заметки не удалять, не скрывать и не терять при сохранении месяца.»",
      "status": "done"
    },
    {
      "id": "R14",
      "text": "«Не расширять задачу до общего аудита или переделки архитектуры.»",
      "status": "done"
    },
    {
      "id": "R15",
      "text": "«Финальный FULL относится к готовому объединённому source.»",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": true,
      "at": "2026-11-05T22:38:41+03:00",
      "open": 0,
      "total": 15
    },
    "G3": {
      "ok": true,
      "at": "2026-11-05T22:39:25+03:00",
      "problems": 0
    }
  },
  "result": null
}
