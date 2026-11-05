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
  "baseCommit": null,
  "startedAt": "2026-11-05T22:37:01+03:00",
  "updatedAt": "2026-11-05T22:39:25+03:00",
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
      "status": "active",
      "startedAt": "2026-11-05T22:38:42+03:00"
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
    "total": 15,
    "done": 0,
    "inTicket": 15,
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
      "status": "pending",
      "retries": 0,
      "repairs": 0
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
      "status": "pending",
      "retries": 0,
      "repairs": 0
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
      "status": "pending",
      "retries": 0,
      "repairs": 0
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
    "2026-11-05T22:39:25+03:00"
  ],
  "rev": 11,
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
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Заменить вертикальный список больших фотографий плотным красивым коллажем.»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«Вверху месяца сохранить: … название „Нам N месяцев“»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«У каждого из 12 месяцев может быть своя главная фотография.»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«Сервер обязан проверить: семья → альбом → месяц → доступный источник-фотография.»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«Из смешанной публикации можно выбрать отдельную фотографию.»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«Использовать существующий direct-album photo pipeline»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«Пользователь может выбрать большой набор фотографий за один раз и продолжать добавлять новые позже.»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«Нельзя возвращать весь многотысячный месяц одним неограниченным JSON или монтировать все изображения сразу.»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«Старый full-replace API не должен трактовать усечённую страницу как полную коллекцию.»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«Листание должно работать через границы страниц.»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«Большой выбранный набор обрабатывается очередью.»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«При смене семьи/аккаунта, отзыве доступа, удалении или очистке месяца запоздалые операции не должны пополнять новый либо уже очищенный контекст.»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«Уже существующие видео, голосовые и заметки не удалять, не скрывать и не терять при сохранении месяца.»",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«Не расширять задачу до общего аудита или переделки архитектуры.»",
      "status": "in-ticket"
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
