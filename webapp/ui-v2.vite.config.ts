import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A separate server/entry: production config, bootstrap and routes remain untouched.
export default defineConfig({
  optimizeDeps: { entries: ['ui-v2.html'] },
  plugins: [
    react(),
    {
      name: 'memoly-ui-v2-dev-entry',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split('?')[0] ?? ''
          if (pathname.startsWith('/api/') || pathname === '/api' || pathname.startsWith('/storage/')) {
            res.statusCode = 403
            res.end('UI Lab has no API transport')
            return
          }
          if (pathname === '/' || pathname === '/__fixtures/ui-v2') {
            req.url = '/ui-v2.html' + (req.url?.includes('?') ? '?' + req.url.split('?')[1] : '')
          }
          next()
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4197, strictPort: true, watch: { ignored: ['**/e2e/.artifacts/**'] } },
})
