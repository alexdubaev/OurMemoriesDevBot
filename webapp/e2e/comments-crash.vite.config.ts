import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import base from '../vite.config'
import { mergeConfig, type Plugin } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const videoFixture = readFile(path.resolve(here, 'fixtures/landscape-edges.mp4'))
const commentsVariants: Plugin = {
  name: 'comments-crash-test-variants',
  enforce: 'pre',
  transform(source, id) {
    const normalized = id.replaceAll('\\', '/')
    if (!normalized.includes('/src/features/feed/FeedPage.tsx?comments-crash=')) return null
    const variant = normalized.match(/\?comments-crash=([A-D])(?:&|$)/)?.[1]
    const shim = (name: string) => path.resolve(here, name).replaceAll('\\', '/')
    const imports: Record<string, string> = {
      B: `import { CommentsPanel } from '@/features/comments/CommentsPanel'; import { useCommentSummaries } from '${shim('comments-crash.no-summaries.ts')}'`,
      C: `import { CommentsPanel } from '${shim('comments-crash.no-panel.tsx')}'; import { useCommentSummaries } from '${shim('comments-crash.no-panel-summaries.ts')}'`,
      D: `import { CommentsPanel } from '${shim('comments-crash.no-comments.tsx')}'; import { useCommentSummaries } from '${shim('comments-crash.no-comments-summaries.ts')}'`,
    }
    if (!variant || variant === 'A') return null
    let result = source.replace("import { CommentsPanel, useCommentSummaries } from '@/features/comments'", imports[variant] + ';')
    if (variant === 'D') {
      result = result.replace('commentCount={commentSummaries.get(memory.id)}', 'commentCount={undefined}')
      result = result.replace(/\s+onComments=\{\(trigger\) => \{\s+detailReturnFocusRef\.current = trigger\s+setCommentsSelection\(\{ memoryId: memory\.id, familyId, accountId, membershipEpoch: membershipEpoch \?\? 0 \}\)\s+\}\}/, ' onComments={undefined}')
    }
    return result
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (request.method !== 'GET' || !/^\/api\/v1\/families\/[0-9a-f-]{36}\/media\/videos\/44444444-4444-4444-8444-444444444442\/content$/i.test(pathname)) return next()
      void videoFixture.then((body) => {
        const range = request.headers.range
        if (!range) {
          response.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': body.byteLength, 'Content-Type': 'video/mp4' })
          response.end(body)
          return
        }
        const match = /^bytes=(\d+)-(\d*)$/.exec(range)
        if (!match) {
          response.writeHead(416, { 'Content-Range': `bytes */${body.byteLength}` })
          response.end()
          return
        }
        const start = Number(match[1])
        const end = match[2] ? Math.min(Number(match[2]), body.byteLength - 1) : body.byteLength - 1
        if (start >= body.byteLength || end < start) {
          response.writeHead(416, { 'Content-Range': `bytes */${body.byteLength}` })
          response.end()
          return
        }
        const chunk = body.subarray(start, end + 1)
        response.writeHead(206, { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': chunk.byteLength, 'Content-Range': `bytes ${start}-${end}/${body.byteLength}`, 'Content-Type': 'video/mp4' })
        response.end(chunk)
      }).catch(next)
    })
  },
}

export default mergeConfig(base, {
  plugins: [commentsVariants],
  resolve: { alias: { '@': path.resolve(here, '../src') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', strictPort: true },
  build: {
    outDir: path.resolve(here, '.artifacts/comments-crash-dist'),
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(here, 'comments-crash.harness.html') },
  },
})
