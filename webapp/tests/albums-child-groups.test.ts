import { describe, expect, test } from 'bun:test'
import type { AlbumDto, ChildDto } from '@web-app-demo/contracts'

import { albumChildChoices, defaultAlbumChildId, groupAlbumsByChild } from '../src/features/albums/child-groups'

const crop = { x: 0, y: 0, width: 1, height: 1 }
const child = (id: string, name: string, birthDate: string): ChildDto => ({ id, name, birthDate, sex: 'girl', avatarMediaId: null, avatarCrop: crop, version: 1, isComplete: true })
const lilya = child('019c0000-0000-7000-8000-0000000000a1', 'Лиля', '2021-02-03')
const misha = child('019c0000-0000-7000-8000-0000000000a2', 'Миша', '2023-04-05')
const album = (id: string, childId: string | null, kind: AlbumDto['kind'] = 'year') => ({ id, childId, kind, title: id }) as AlbumDto

describe('albums grouped by child', () => {
  test('groups follow the children order, family albums last, empty groups dropped', () => {
    const groups = groupAlbumsByChild([album('free', null, 'free'), album('m-year', misha.id), album('l-year', lilya.id), album('l-work', lilya.id, 'workshop')], [lilya, misha])
    expect(groups.map((group) => [group.title, group.albums.map((item) => item.id)])).toEqual([
      ['Лиля', ['l-year', 'l-work']], ['Миша', ['m-year']], ['Семейные', ['free']],
    ])
    expect(groups.map((group) => group.childId)).toEqual([lilya.id, misha.id, null])
  })

  test('a child without albums gets no group, and no family albums no «Семейные»', () => {
    const groups = groupAlbumsByChild([album('m-year', misha.id)], [lilya, misha])
    expect(groups.map((group) => group.title)).toEqual(['Миша'])
  })

  test('an album of an unknown child is kept among the family albums, not lost', () => {
    const groups = groupAlbumsByChild([album('x', '019c0000-0000-7000-8000-0000000000a9')], [lilya, misha])
    expect(groups.map((group) => [group.title, group.albums.length])).toEqual([['Семейные', 1]])
  })
})

describe('the child for a new album', () => {
  test('the child selected in the feed is the default, otherwise the oldest', () => {
    expect(defaultAlbumChildId([lilya, misha], misha.id)).toBe(misha.id)
    expect(defaultAlbumChildId([lilya, misha], null)).toBe(lilya.id)
    expect(defaultAlbumChildId([lilya, misha], 'untagged')).toBe(lilya.id)
    expect(defaultAlbumChildId([lilya, misha], '019c0000-0000-7000-8000-0000000000a9')).toBe(lilya.id)
    expect(defaultAlbumChildId([], null)).toBeNull()
  })

  test('the choice appears only with two or more children', () => {
    expect(albumChildChoices([lilya])).toEqual([])
    expect(albumChildChoices([lilya, misha]).map((item) => item.id)).toEqual([lilya.id, misha.id])
  })
})
