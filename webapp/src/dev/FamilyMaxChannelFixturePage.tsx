import { useMemo, useRef, useState } from 'react'
import type { FamilyMaxChannelStatus, FamilyMemberDto, FamilyResponse } from '@web-app-demo/contracts'

import { FamilyScreen } from '@/features/family'
import { ThemeProvider } from '@/features/theme'
import type { AuthenticatedTransport } from '@/platform/api'
import { Typography } from '@/components/typography'

const userIds = ['22222222-2222-4222-8222-222222222221', '22222222-2222-4222-8222-222222222222']
const familyIds = ['11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111112']
const channelStates: FamilyMaxChannelStatus['state'][] = ['unconfigured', 'connected', 'disconnected', 'permission_problem']

export function FamilyMaxChannelFixturePage() {
  const [state, setState] = useState<FamilyMaxChannelStatus['state']>(() => new URLSearchParams(location.search).get('state') as FamilyMaxChannelStatus['state'] || 'unconfigured')
  const [role, setRole] = useState<'full' | 'viewer'>(() => new URLSearchParams(location.search).get('role') === 'viewer' ? 'viewer' : 'full')
  const [familyIndex, setFamilyIndex] = useState(0)
  const [userIndex, setUserIndex] = useState(0)
  const [fail, setFail] = useState(false)
  const [transportVersion, setTransportVersion] = useState(0)
  const controls = useRef({ state, fail, delayNextMs: 0 })
  const transport = useMemo<AuthenticatedTransport>(() => ({
    request: async (path, schema) => {
      if (path.endsWith('/max-channel')) {
        const delay = controls.current.delayNextMs || (transportVersion % 2 === 0 ? 150 : 151)
        controls.current.delayNextMs = 0
        await new Promise((resolve) => window.setTimeout(resolve, delay))
        if (controls.current.fail) throw new Error('synthetic network error')
        const value: FamilyMaxChannelStatus = {
          state: controls.current.state,
          title: controls.current.state === 'connected' ? 'Семейный канал' : null,
          canManage: true,
        }
        return schema.parse(value)
      }
      if (path.endsWith('/usage')) return schema.parse({ usedBytes: 0, quotaBytes: null })
      throw new Error('fixture route is unavailable')
    },
    raw: async () => { throw new Error('fixture route is unavailable') },
  }), [transportVersion])
  const familyResponse: FamilyResponse = {
    family: { id: familyIds[familyIndex]!, name: 'Синтетическая семья', timezone: 'Europe/Moscow', ownerUserId: '33333333-3333-4333-8333-333333333333' },
    child: { id: '44444444-4444-4444-8444-444444444444', name: 'Ребёнок', birthDate: null, sex: null, avatarMediaId: null, avatarCrop: null, version: 1, isComplete: false },
  }
  const members: FamilyMemberDto[] = [{
    userId: userIds[userIndex]!, avatarPath: null, displayName: `Синтетический участник ${userIndex + 1}`, familyDisplayName: null,
    role, isOwner: false, joinedAt: '2026-01-01T00:00:00.000Z', version: 1,
  }]
  const hostBridge = { onBack: () => () => undefined }

  return <ThemeProvider>
    <div className="family-max-channel-fixture" data-testid="family-max-channel-fixture">
      <Typography as="h1" variant="memoryMeta">Проверка семейного канала</Typography>
      <label><Typography as="span" variant="memoryMeta">Состояние</Typography><select onChange={(event) => { const nextState = event.target.value as FamilyMaxChannelStatus['state']; controls.current.state = nextState; controls.current.fail = false; setFail(false); setState(nextState); setTransportVersion((version) => version + 1) }} value={state}>{channelStates.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label><Typography as="span" variant="memoryMeta">Роль</Typography><select onChange={(event) => setRole(event.target.value as 'full' | 'viewer')} value={role}><option value="full">Полный доступ</option><option value="viewer">Просмотр</option></select></label>
      <button onClick={() => setFamilyIndex((value) => (value + 1) % familyIds.length)} type="button"><Typography as="span" variant="memoryMeta">Сменить семью</Typography></button>
      <button onClick={() => setUserIndex((value) => (value + 1) % userIds.length)} type="button"><Typography as="span" variant="memoryMeta">Сменить аккаунт</Typography></button>
      <button onClick={() => { controls.current.delayNextMs = 1_000; setTransportVersion((version) => version + 1) }} type="button"><Typography as="span" variant="memoryMeta">Задержать ответ</Typography></button>
      <button onClick={() => { controls.current.fail = !controls.current.fail; setFail(controls.current.fail); setTransportVersion((version) => version + 1) }} type="button"><Typography as="span" variant="memoryMeta">{fail ? 'Восстановить ответ' : 'Имитировать ошибку'}</Typography></button>
    </div>
    <FamilyScreen childProfileOpen={false} familyResponse={familyResponse} invites={[]} members={members} transport={transport} hostBridge={hostBridge} currentUserId={userIds[userIndex]!} onAdd={() => undefined} onEditChild={() => undefined} onChangeChildPhoto={() => undefined} onOpenChild={() => undefined} onCloseChild={() => undefined} onFeed={() => undefined} onRefresh={async () => undefined} createInviteLink={() => null} />
  </ThemeProvider>
}
