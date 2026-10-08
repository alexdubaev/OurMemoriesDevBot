import { mergeConfig, type Plugin } from 'vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import baseConfig from '../vite.config.ts'
import type { MemoryDto } from '@web-app-demo/contracts'

const artifacts = fileURLToPath(new URL('.artifacts/', import.meta.url))
const familyId = '22222222-2222-4222-8222-222222222222'
const memoriesPath = `/api/v1/families/${familyId}/memories`
let rangedPlaybackRequests = 0
let posterRenditionReady = true
let failedPlaybackMode = false

function fixtureMemories() {
  return JSON.parse(readFileSync(resolve(artifacts, 'private-video-poster-memories.json'), 'utf8')) as MemoryDto[]
}

function memoryAtCurrentPosterState(memory: MemoryDto): MemoryDto {
  return {
    ...memory,
    attachments: memory.attachments.map((attachment) => {
      if (attachment.source !== 'private_storage' || attachment.kind !== 'video') return attachment
      if (failedPlaybackMode) {
        return {
          ...attachment,
          renditionStatus: 'failed',
          playbackPath: null,
          previewPath: posterRenditionReady ? `/api/v1/families/${familyId}/media/${attachment.id}/content?variant=preview` : null,
          displayPath: null,
        }
      }
      return posterRenditionReady ? attachment : { ...attachment, previewPath: null, displayPath: null }
    }),
  }
}

const privateMediaFixture: Plugin = {
  name: 'private-video-poster-fixture-media',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/__fixture__/range-status') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ rangedPlaybackRequests }))
        return
      }
      if (url.pathname === '/__fixture__/poster-ready' && request.method === 'POST') {
        posterRenditionReady = true
        response.statusCode = 204
        response.end()
        return
      }
      if (url.pathname === '/__fixture__/poster-reset' && request.method === 'POST') {
        failedPlaybackMode = url.searchParams.has('playback-failed')
        posterRenditionReady = !failedPlaybackMode && !url.searchParams.has('poster-processing')
        response.statusCode = 204
        response.end()
        return
      }
      if (!url.pathname.startsWith(`/api/v1/families/${familyId}/`)) return next()
      if (url.pathname === memoriesPath && request.method === 'GET') {
        const queryKind = url.searchParams.get('kind')
        const cursor = url.searchParams.get('cursor')
        const requestedLimit = Number(url.searchParams.get('limit') ?? '20')
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 20
        const allMemories = fixtureMemories()
        const matchingMemories = queryKind ? allMemories.filter((memory) => memory.kind === queryKind) : allMemories
        const items = cursor ? [] : matchingMemories.slice(0, limit).map(memoryAtCurrentPosterState)
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ items, nextCursor: null }))
        return
      }
      if (url.pathname.endsWith('/media/playback-session') && request.method === 'POST') {
        response.statusCode = 204
        response.end()
        return
      }
      if (request.method === 'GET') {
        const memoryMatch = new RegExp(`^/api/v1/families/${familyId}/memories/([0-9a-f-]{36})$`, 'i').exec(url.pathname)
        if (memoryMatch) {
          const memory = fixtureMemories().find((item) => item.id === memoryMatch[1])
          if (memory) {
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify(memoryAtCurrentPosterState(memory)))
            return
          }
        }
      }
      if (!url.pathname.endsWith('/content')) return next()
      let body: Buffer
      let contentType: string
      const mediaId = /\/media\/([0-9a-f-]{36})\/content$/i.exec(url.pathname)?.[1]
      if (url.searchParams.get('variant') === 'playback') {
        if (mediaId?.endsWith('5556')) {
          body = readFileSync(resolve(artifacts, 'private-video-poster-audio-synthetic.wav'))
          contentType = 'audio/wav'
        } else {
          body = readFileSync(resolve(artifacts, mediaId?.endsWith('5555') || mediaId?.endsWith('5552') ? 'private-video-poster-portrait-synthetic.mp4' : 'private-video-poster-synthetic.mp4'))
          contentType = 'video/mp4'
        }
      } else if (['preview', 'display'].includes(url.searchParams.get('variant') ?? '')) {
        body = readFileSync(resolve(artifacts, mediaId?.endsWith('5555') || mediaId?.endsWith('5552') ? 'private-video-poster-portrait-synthetic.png' : 'private-video-poster-synthetic.png'))
        contentType = 'image/png'
      } else return next()
      response.setHeader('accept-ranges', 'bytes')
      response.setHeader('content-type', contentType)
      const match = /^bytes=(\d+)-(\d*)$/i.exec(request.headers.range ?? '')
      if (contentType === 'video/mp4' && match) {
        rangedPlaybackRequests += 1
        const start = Number(match[1])
        const end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1)
        response.statusCode = 206
        response.setHeader('content-range', `bytes ${start}-${end}/${body.length}`)
        response.setHeader('content-length', String(end - start + 1))
        response.end(body.subarray(start, end + 1))
        return
      }
      response.statusCode = 200
      response.setHeader('content-length', String(body.length))
      response.end(body)
    })
  },
}

export default mergeConfig(baseConfig, { plugins: [privateMediaFixture] })
