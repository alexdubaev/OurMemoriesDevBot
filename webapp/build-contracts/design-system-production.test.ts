import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workspaceRoot = fileURLToPath(new URL('..', import.meta.url))
const distDirectory = path.join(workspaceRoot, 'dist')

test('production excludes the design-system fixture while shipping every runtime icon', async () => {
  assert.ok(
    existsSync(distDirectory),
    `${distDirectory} is missing: build the webapp before running build contracts`,
  )

  const files = await allFiles(distDirectory)
  const textFiles = files.filter((file) => /\.(?:css|html|js)$/.test(file))
  const productionText = (
    await Promise.all(textFiles.map((file) => readFile(file, 'utf8')))
  ).join('\n')

  assert.ok(!productionText.includes('/__fixtures/design-system'))
  assert.ok(!productionText.includes('data-fixture-state'))
  assert.ok(!productionText.includes('Сегодня сама придумала историю про облако'))
  assert.ok(!files.some((file) => path.basename(file) === 'beach.webp'))

  for (const name of [
    'chevron', 'close', 'family', 'home', 'info', 'lock', 'more',
    'note', 'photo', 'plus', 'retry', 'voice', 'warning',
  ]) {
    for (const state of ['active', 'default']) {
      for (const density of [2, 3]) {
        const icon = path.join(
          distDirectory,
          'assets/icons',
          `${name}-${state}@${density}x.webp`,
        )
        assert.ok(existsSync(icon), `missing production icon ${path.relative(distDirectory, icon)}`)
      }
    }
  }
})

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? allFiles(entryPath) : [entryPath]
  }))
  return nested.flat()
}
