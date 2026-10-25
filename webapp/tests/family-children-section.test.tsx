import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { ChildDto } from '@web-app-demo/contracts'
import { FamilyChildrenSection } from '../src/features/memoly-ui/FamilyChildrenSection'

const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string): ChildDto => ({
  id, name, birthDate: '2022-03-04', sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true,
})
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша')
const render = (props: { childList: ChildDto[]; canEdit: boolean; onAddChild?: () => void }) => renderToStaticMarkup(
  <FamilyChildrenSection onEditChild={() => undefined} timezone="Europe/Moscow" {...props} />,
)

describe('family children section', () => {
  test('a one-child family owner sees only the add button', () => {
    const html = render({ childList: [lilya], canEdit: true, onAddChild: () => undefined })
    expect(html).toContain('Добавить ребёнка')
    expect(html).not.toContain('Лиля')
    expect(html).not.toContain('>Дети<')
  })

  test('a one-child family shows nothing to a member who is not the owner', () => {
    expect(render({ childList: [lilya], canEdit: false })).toBe('')
  })

  test('two children are listed and the owner can open each profile and add another', () => {
    const html = render({ childList: [lilya, misha], canEdit: true, onAddChild: () => undefined })
    expect(html).toContain('>Дети<')
    expect(html).toContain('aria-label="Открыть профиль ребёнка: Лиля"')
    expect(html).toContain('aria-label="Открыть профиль ребёнка: Миша"')
    expect(html).toContain('Добавить ребёнка')
  })

  test('a member who is not the owner sees the children without any buttons', () => {
    const html = render({ childList: [lilya, misha], canEdit: false })
    expect(html).toContain('Лиля')
    expect(html).toContain('Миша')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('Добавить ребёнка')
  })
})
