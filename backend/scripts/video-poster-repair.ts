import 'dotenv/config'

import { createPrisma } from '../src/db'
import { loadEnv } from '../src/env'
import { insertTask } from '../src/outbox/store'

const env = loadEnv(Bun.env)
const prisma = createPrisma(env.DATABASE_URL)
const taskType = 'media:video-poster'
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const apply = process.argv.includes('--apply')
if (process.argv.slice(2).some((argument) => argument !== '--apply')) {
  throw new Error('Only --apply is supported')
}

const missingWhere = {
  mediaKind: 'video' as const,
  purpose: 'memory' as const,
  originalStatus: 'stored' as const,
  deletedAt: null,
  storageDeletedAt: null,
  originalKey: { startsWith: 'media-originals/' },
  maxVideoThumbnailFor: { is: null },
  telegramVideoThumbnailFor: { is: null },
  AND: [
    { variants: { none: { variant: 'preview' as const } } },
    { variants: { none: { variant: 'display' as const, mime: { startsWith: 'image/' } } } },
  ],
}

try {
  if (!apply) {
    const missingPrivateVideos = await prisma.mediaAsset.count({ where: missingWhere })
    console.log(JSON.stringify({ mode: 'dry-run', missingPrivateVideos }))
  } else {
    const input = (await Bun.stdin.text()).trim()
    const suppliedIds = input ? input.split(/\s+/) : []
    if (suppliedIds.length === 0 || suppliedIds.length > 500 || suppliedIds.some((id) => !idPattern.test(id))) {
      throw new Error('Supply 1 to 500 valid media IDs on stdin when using --apply')
    }
    const uniqueIds = [...new Set(suppliedIds)]
    const eligible = await prisma.mediaAsset.findMany({
      where: { ...missingWhere, id: { in: uniqueIds } },
      select: { id: true },
    })
    let enqueuedThisRun = 0
    for (const { id } of eligible) {
      const result = await insertTask(prisma, {
        type: taskType,
        dedupeKey: `media-video-poster:v1:${id}`,
        payload: { mediaId: id },
      })
      if (result.created) enqueuedThisRun += 1
    }

    const taskRows = await prisma.taskOutbox.findMany({
      where: { type: taskType, dedupeKey: { in: uniqueIds.map((id) => `media-video-poster:v1:${id}`) } },
      select: { status: true },
    })
    const statusCounts = Object.fromEntries(['pending', 'processing', 'done', 'skipped', 'failed'].map((status) => [
      status,
      taskRows.filter((row) => row.status === status).length,
    ]))
    console.log(JSON.stringify({
      mode: 'apply', suppliedIds: suppliedIds.length, uniqueIds: uniqueIds.length,
      eligibleIds: eligible.length, skippedIds: uniqueIds.length - eligible.length,
      enqueuedThisRun, taskStatuses: statusCounts,
    }))
  }
} finally {
  await prisma.$disconnect()
}
