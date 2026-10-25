import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendProxyTarget = process.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const diagnosticsBootstrap = readFileSync(path.resolve(__dirname, 'src/platform/diagnostics/bootstrap.js'), 'utf8')

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        family: path.resolve(__dirname, 'index.html'),
        control: path.resolve(__dirname, 'control/index.html'),
      },
      output: {
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: 'tanstack-vendor',
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  plugins: [
    {
      name: 'memoly-diagnostics-bootstrap',
      transformIndexHtml(html) {
        return html.replace('<!-- memoly-diagnostics-bootstrap -->', `<script>${diagnosticsBootstrap}</script>`)
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    allowedHosts: ['desktop-7sch55t.tail879033.ts.net'],
    watch: {
      ignored: ['**/e2e/.artifacts/**'],
    },
    proxy: {
      '/api': { target: backendProxyTarget, changeOrigin: true },
      '/storage': { target: backendProxyTarget, changeOrigin: true },
    },
  },
})
