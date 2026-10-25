import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChildDto } from '@web-app-demo/contracts'

import { FamilyHeaderV2 } from '../src/components/ui-v2/FamilyHeaderV2'
import { childCountLabel } from '../src/components/ui-v2/child-count'
import { ChildFilterChips, childFilterChips } from '../src/features/feed'

const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string): ChildDto => ({ id, name, birthDate: '2022-01-01', sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true })
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша')

describe('family header', () => {
  test('shows the family name and an avatar button for every child', () => {
    const html = renderToStaticMarkup(<FamilyHeaderV2 childList={[lilya, misha]} familyName="Семья Ивановых" mode="feed" onSelectChild={() => undefined} theme="mint" />)
    expect(html).toContain('Семья Ивановых')
    expect(html).toContain('aria-label="Открыть страницу ребёнка: Лиля"')
    expect(html).toContain('aria-label="Открыть страницу ребёнка: Миша"')
    expect(html.indexOf('Лиля')).toBeLessThan(html.indexOf('Миша'))
  })

  test('avatars are not buttons when there is nothing to open', () => {
    const html = renderToStaticMarkup(<FamilyHeaderV2 childList={[lilya, misha]} familyName="Семья" mode="family" theme="mint" />)
    expect(html).not.toContain('Открыть страницу ребёнка')
    expect(html).toContain('Миша')
  })

  test('counts children in Russian', () => {
    expect([1, 2, 5, 11, 12, 21, 22].map(childCountLabel)).toEqual(['1 ребёнок', '2 ребёнка', '5 детей', '11 детей', '12 детей', '21 ребёнок', '22 ребёнка'])
  })
})

describe('child filter chips', () => {
  test('mark only the selected filter as pressed, in reading order', () => {
    const html = renderToStaticMarkup(<ChildFilterChips chips={childFilterChips([lilya, misha], true)} onChange={() => undefined} value={misha.id} />)
    const pressed = [...html.matchAll(/aria-pressed="(true|false)"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((match) => [match[2], match[1]])
    expect(pressed).toEqual([['Все', 'false'], ['Лиля', 'false'], ['Миша', 'true'], ['Без отметки', 'false']])
  })

  test('a one-child family renders no chips', () => {
    expect(renderToStaticMarkup(<ChildFilterChips chips={childFilterChips([lilya], true)} onChange={() => undefined} value={null} />)).toBe('')
  })
})
