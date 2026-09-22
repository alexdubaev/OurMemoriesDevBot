import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { buildInvitePayload, InviteFlow, submitInvite } from '../src/features/memoly-ui/FamilyPresentation'

const flowProps = {
  errorMessage: 'Не удалось создать приглашение. Попробуйте ещё раз.',
  hasError: false,
  onBack: () => undefined,
  onCreate: async () => undefined,
  onRefresh: () => undefined,
}

describe('family invite submit contract', () => {
  test('keeps role values and trims the optional display name', () => {
    expect(buildInvitePayload('viewer', '  Дед  ')).toEqual({ role: 'viewer', inviteeDisplayName: 'Дед' })
    expect(buildInvitePayload('full', '   ')).toEqual({ role: 'full', inviteeDisplayName: undefined })
  })

  test('sends the semantic payload exactly once for viewer and full roles', async () => {
    const calls: Array<{ role: 'viewer' | 'full'; inviteeDisplayName?: string }> = []
    const onCreate = async (role: 'viewer' | 'full', inviteeDisplayName?: string) => { calls.push({ role, inviteeDisplayName }) }

    await submitInvite(false, 'viewer', '  Дед  ', onCreate)
    await submitInvite(false, 'full', '  Бабушка  ', onCreate)

    expect(calls).toEqual([
      { role: 'viewer', inviteeDisplayName: 'Дед' },
      { role: 'full', inviteeDisplayName: 'Бабушка' },
    ])
  })

  test('does not send a duplicate while the request is busy', async () => {
    let calls = 0
    const onCreate = async () => { calls += 1 }

    expect(submitInvite(true, 'viewer', 'Дед', onCreate)).toBeUndefined()
    expect(calls).toBe(0)
  })

  test('renders an enabled submit boundary after an earlier create error', () => {
    const markup = renderToStaticMarkup(createElement(InviteFlow, { ...flowProps, busy: false }))

    expect(markup).toContain('<form')
    expect(markup).toContain('type="submit"')
    expect(markup).not.toContain('disabled=""')
  })

  test('renders the submit button disabled only while a request is busy', () => {
    const markup = renderToStaticMarkup(createElement(InviteFlow, { ...flowProps, busy: true }))

    expect(markup).toContain('type="submit"')
    expect(markup).toContain('disabled=""')
  })
})
