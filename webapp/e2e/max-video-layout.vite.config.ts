import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config'

export default mergeConfig(base, defineConfig({
  resolve: { alias: [{ find: '@web-app-demo/contracts', replacement: fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)) }] },
}))
