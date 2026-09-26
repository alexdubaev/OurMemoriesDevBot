import { describe, expect, test } from 'bun:test'

import { publishCandidates, choicePayload, parseChoicePayload, readCandidates } from './bot-family-target'

const familyA = '11111111-1111-4111-8111-111111111111'
const familyB = '22222222-2222-4222-8222-222222222222'
const source = '33333333-3333-4333-8333-333333333333'

describe('bot source target', () => {
  test('viewer membership and childless family do not create ambiguity', () => {
    expect(publishCandidates([
      { familyId: familyA, role: 'viewer', family: { name: 'View', children: [{ id: 'a' }] } },
      { familyId: familyB, role: 'full', family: { name: 'Publish', children: [{ id: 'b' }] } },
      { familyId: source, role: 'full', family: { name: 'Empty', children: [] } },
    ])).toEqual([{ familyId: familyB, childId: 'b', name: 'Publish' }])
  })

  test('choice payload binds a source and exact candidate index', () => {
    expect(parseChoicePayload(choicePayload(source, 2))).toEqual({ sourceId: source, index: 2 })
    expect(parseChoicePayload(`family:${source}:not-an-index`)).toBeNull()
  })

  test('invalid persisted candidates cannot authorize a callback', () => {
    expect(readCandidates([{ familyId: familyA, childId: 'child', name: 'A' }])).toEqual([{ familyId: familyA, childId: 'child', name: 'A' }])
    expect(readCandidates([{ familyId: familyA, childId: 'child' }])).toEqual([])
    expect(readCandidates({ familyId: familyA })).toEqual([])
  })
})
