import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import postcss from 'postcss'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = readFileSync(resolve(root, 'docs/design/welcome-first-run/memoly-welcome-final-ios.html'), 'utf8')
const css = source.match(/<style>\n([\s\S]*?)\n<\/style>/)?.[1]
if (!css) throw new Error('Frozen welcome CSS not found')

const sheet = postcss.parse(css)
sheet.walkRules((rule) => {
  if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return
  const selectors = rule.selector.split(',').map((selector) => selector.trim()).filter((selector) =>
    selector !== 'button' && !selector.startsWith('.pause') && !selector.startsWith('.cta') && !selector.startsWith('.spark-burst') && !selector.startsWith('body.paused') && selector !== '.feat:active')
  if (selectors.length === 0) {
    rule.remove()
    return
  }
  rule.selector = selectors.map((selector) => {
    if (selector === ':root' || selector === 'html' || selector === 'body') return '.memolyWelcome'
    if (selector === '*') return '.memolyWelcome, .memolyWelcome *'
    if (selector.startsWith('*::')) return `.memolyWelcome ${selector}`
    return `.memolyWelcome ${selector}`
  }).join(', ')
  if (selectors.includes('.star')) rule.walkDecls('cursor', (decl) => decl.remove())
})
sheet.walkAtRules('keyframes', (rule) => {
  if (rule.params === 'ctaGlow' || rule.params === 'burst') rule.remove()
})
const output = `/* Source-derived from docs/design/welcome-first-run/memoly-welcome-final-ios.html. */\n.memolyWelcome{position:fixed;inset:0;z-index:1000;overflow:hidden;overscroll-behavior:none;background:linear-gradient(180deg,#f8fbf7 0%,#f5f7f1 55%,#fcf4ef 100%);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Rounded","SF Pro Display","Segoe UI",system-ui,sans-serif;color:#17345f}\n${sheet.toString()}\n/* Use the larger of CSS safe area and the host's normalized inset; never add them twice. */\n.memolyWelcome{--safe-top:max(env(safe-area-inset-top,0px),var(--host-inset-top,0px));--safe-bottom:max(env(safe-area-inset-bottom,0px),var(--host-inset-bottom,0px))}\n/* Tailwind's global img max-width would otherwise cap the source's 104%/106% artwork. */\n.memolyWelcome .bg,.memolyWelcome .ribbon{max-width:none}\n`
writeFileSync(resolve(root, 'webapp/src/features/welcome/welcome-splash.css'), output)
