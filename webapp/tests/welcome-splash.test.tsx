import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import postcss from 'postcss'

import { WelcomeSplash, WELCOME_INTRO_MS } from '../src/features/welcome/WelcomeSplash'

const repositoryRoot = resolve(import.meta.dir, '../..')
const frozenPath = resolve(repositoryRoot, 'docs/design/welcome-first-run/memoly-welcome-final-ios.html')
const assetRoot = resolve(repositoryRoot, 'webapp/public/assets/welcome')
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

test('keeps the owner-approved reference byte-identical', () => {
  const source = readFileSync(frozenPath)
  expect(source.length).toBe(779_815)
  expect(sha256(source)).toBe('ea2969128a6856d59e0d1bfb698c8185cb3a89a3776acd24e3b57bcebc496c8c')
})

test('serves the original nine WebP byte streams without re-encoding', () => {
  const source = readFileSync(frozenPath, 'utf8')
  const encoded = [...source.matchAll(/data:image\/webp;base64,([A-Za-z0-9+/=]+)/g)]
  const expectedNames = ['bg', 'logo', 'ribbon', 'star', 'photo', 'voice', 'video', 'note', 'book']
  const unique = new Map<string, Buffer>()
  for (const [, value] of encoded) {
    const bytes = Buffer.from(value!, 'base64')
    unique.set(sha256(bytes), bytes)
  }
  expect(encoded).toHaveLength(14)
  expect(unique.size).toBe(9)
  for (const [index, bytes] of Array.from(unique.values()).entries()) {
    expect(readFileSync(resolve(assetRoot, `${expectedNames[index]}.webp`))).toEqual(bytes)
  }
})

test('keeps all production CSS selectors inside the welcome root', () => {
  const sheet = postcss.parse(readFileSync(resolve(repositoryRoot, 'webapp/src/features/welcome/welcome-splash.css'), 'utf8'))
  sheet.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return
    for (const selector of rule.selector.split(',')) expect(selector.trim().startsWith('.memolyWelcome')).toBe(true)
  })
})

test('renders the explicit continuation control after the welcome copy', () => {
  const markup = renderToStaticMarkup(createElement(WelcomeSplash, { onComplete: () => undefined }))
  expect(markup).toContain('data-slot="welcome-splash"')
  expect(markup).toContain('Большая история.')
  expect(markup).toContain('class="footer"')
  expect(markup).toContain('Продолжить')
  expect(markup).toContain('class="continue-button"')
  expect(markup).not.toContain('pause')
  expect(WELCOME_INTRO_MS).toBe(4_250)
})
