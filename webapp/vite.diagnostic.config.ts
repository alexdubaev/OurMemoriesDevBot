import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = path.dirname(fileURLToPath(import.meta.url))
const canonicalHtml = readFileSync(path.resolve(root, 'index.html'), 'utf8')
const diagnosticsBootstrap = readFileSync(path.resolve(root, 'src/platform/diagnostics/bootstrap.js'), 'utf8')
const base = '/__experiments/minimal-feed/'

function diagnosticHtml(): Plugin {
  return {
    name: 'memoly-minimal-feed-html',
    configureServer(server) {
      const localRuntimeAssets = new Map([
        ['/private-media-sw.js', path.resolve(root, 'public/private-media-sw.js')],
        ['/pwa-runtime-witness-v1.js', path.resolve(root, 'public/pwa-runtime-witness-v1.js')],
        ['/assets/brand/memoly-logo-correct.webp', path.resolve(root, 'public/assets/brand/memoly-logo-correct.webp')],
        ['/assets/icons/home-active@2x.webp', path.resolve(root, 'public/assets/icons/home-active@2x.webp')],
        ['/assets/icons/plus-default@2x.webp', path.resolve(root, 'public/assets/icons/plus-default@2x.webp')],
        ['/assets/icons/family-default@2x.webp', path.resolve(root, 'public/assets/icons/family-default@2x.webp')],
      ])
      server.middlewares.use((request, response, next) => {
        const assetPath = request.url ? localRuntimeAssets.get(new URL(request.url, 'http://localhost').pathname) : undefined
        if (!assetPath) { next(); return }
        response.setHeader('Content-Type', assetPath.endsWith('.webp') ? 'image/webp' : 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(readFileSync(assetPath))
      })
    },
    configurePreviewServer(server) {
      const localRuntimeAssets = new Map([
        ['/private-media-sw.js', path.resolve(root, 'public/private-media-sw.js')],
        ['/pwa-runtime-witness-v1.js', path.resolve(root, 'public/pwa-runtime-witness-v1.js')],
        ['/assets/brand/memoly-logo-correct.webp', path.resolve(root, 'public/assets/brand/memoly-logo-correct.webp')],
        ['/assets/icons/home-active@2x.webp', path.resolve(root, 'public/assets/icons/home-active@2x.webp')],
        ['/assets/icons/plus-default@2x.webp', path.resolve(root, 'public/assets/icons/plus-default@2x.webp')],
        ['/assets/icons/family-default@2x.webp', path.resolve(root, 'public/assets/icons/family-default@2x.webp')],
      ])
      server.middlewares.use((request, response, next) => {
        const assetPath = request.url ? localRuntimeAssets.get(new URL(request.url, 'http://localhost').pathname) : undefined
        if (!assetPath) { next(); return }
        response.setHeader('Content-Type', assetPath.endsWith('.webp') ? 'image/webp' : 'text/javascript; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(readFileSync(assetPath))
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<!-- diagnostic-entry -->')) return html
        return canonicalHtml
          .replace('<!-- memoly-diagnostics-bootstrap -->', `<script>${diagnosticsBootstrap}</script>`)
          .replace(/\s*<link rel="preconnect" href="https:\/\/rsms\.me\/"\s*\/>/g, '')
          .replace(/\s*<link rel="stylesheet" href="https:\/\/rsms\.me\/inter\/inter\.css"[^>]*\/>/g, '')
          .replace(/\s*<noscript><link rel="stylesheet" href="https:\/\/rsms\.me\/inter\/inter\.css"\s*\/><\/noscript>/g, '')
          .replace(/\s*<link rel="manifest" href="\/manifest\.webmanifest"\s*\/>/g, '')
          .replace('<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/src/diagnostic/main.tsx"></script>')
      },
    },
    transform(_code, id) {
      if (/\.css(?:\?|$)/i.test(id) && !id.replaceAll('\\', '/').includes('/src/diagnostic/diagnostic-feed.css')) {
        throw new Error(`Diagnostic build imports disallowed CSS: ${id}`)
      }
      return null
    },
    generateBundle(_options, bundle) {
      const forbiddenSource = /(?:src[\\/](?:components[\\/]|features[\\/]memoly-ui[\\/]|styles[\\/])|memoly-feed\.css|production\.css)/i
      const sourceModules = Object.values(bundle).flatMap((item) => item.type === 'chunk' ? Object.keys(item.modules) : [])
      const forbidden = sourceModules.filter((id) => forbiddenSource.test(id))
      if (forbidden.length) throw new Error(`Diagnostic build includes product UI modules: ${forbidden.join(', ')}`)
      const css = Object.values(bundle).filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
      if (css.length > 1 || css.some((item) => !/^assets\/diagnostic-feed-[A-Za-z0-9_-]+\.css$/.test(item.fileName))) {
        throw new Error(`Diagnostic build emitted CSS outside diagnostic-feed.css: ${css.map((item) => item.fileName).join(', ')}`)
      }
      const files = Object.keys(bundle)
      if (files.some((file) => /(?:^|\/)(?:manifest\.webmanifest|private-media-sw\.js)$/.test(file))) {
        throw new Error('Diagnostic output must not publish the production manifest or service worker')
      }
    },
  }
}

export default defineConfig({
  base,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
  publicDir: false,
  plugins: [diagnosticHtml(), react()],
  resolve: {
    alias: [
      { find: /^@\/features\/auth$/, replacement: path.resolve(root, './src/diagnostic/session-query-keys.ts') },
      { find: '@', replacement: path.resolve(root, './src') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: path.resolve(root, '.scratch/diagnostic-dist'),
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: {
      input: path.resolve(root, 'diagnostic.html'),
      output: {
        entryFileNames: 'assets/index-[hash].js',
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'assets/diagnostic-feed-[hash][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    allowedHosts: ['desktop-7sch55t.tail879033.ts.net'],
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: true },
      '/storage': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: true },
      '/storage': { target: process.env.VITE_API_URL ?? 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})
