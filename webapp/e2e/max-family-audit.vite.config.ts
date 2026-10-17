import { mergeConfig } from 'vite'
import baseConfig from '../vite.config.ts'

const apiPort = process.env.MAX_FAMILY_AUDIT_API_PORT ?? '56601'

export default mergeConfig(baseConfig, {
  server: {
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/storage': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
      '/storage': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
})
