/* eslint-disable typographyPolicy/use-typography-component -- catalog labels/selects are dev tooling; product text uses canonical UI v2 Typography. */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { catalog, getEntry, groups, screenKeys, screenLabels } from '../states/catalog'
import type { Role, CatalogEntry } from '../states/catalog'
import { family as initialFamily, memories as initialMemories, people as initialPeople } from '../fixtures/data'
import { childAge } from '../fixtures/child'
import { themes, tokenVariables } from '../tokens/design-tokens'
import type { Theme } from '../tokens/design-tokens'
import { Screen } from '../primitives/layout'
import { BottomTabs } from '../components/BottomTabs'
import { FirstRun } from '../screens/FirstRun'
import { Families } from '../screens/Families'
import { Feed, selectedMemory } from '../screens/Feed'
import { Setup, Composer } from '../screens/Forms'
import { Family, Child } from '../screens/Family'
import { Member } from '../screens/Member'
import { IncomingInvite, InviteCreate, Invites } from '../screens/Invites'
import { Archive, Channel, Install, Settings } from '../screens/Settings'
import { Components } from '../screens/Components'
import { Viewer } from '../screens/Viewer'
import { Overlay } from './Overlay'
import type { ScreenActions, ScreenProps } from '../screens/types'
import { Typography } from '../primitives/Typography'
import { Pressable } from '../primitives/controls'
const viewports = [320, 360, 390, 430, 768]
function initialSelection() {
  const search = new URLSearchParams(window.location.search)
  const entry = getEntry(search.get('entry'))
  const role = search.get('role') as Role
  const theme = search.get('theme') as Theme
  return { entry, role: ['owner', 'full', 'viewer'].includes(role) ? role : entry.screen === 'family' && entry.state.startsWith('leave') ? 'full' as Role : entry.screen === 'family' && ['full', 'viewer'].includes(entry.state) ? entry.state as Role : 'owner' as Role, theme: theme in themes ? theme : entry.screen === 'themes' ? entry.state as Theme : 'mint' as Theme, width: viewports.includes(Number(search.get('width'))) ? Number(search.get('width')) : 390, preview: search.get('preview') === '1' }
}
export function Lab() {
  const [initial] = useState(initialSelection)
  const [entry, setEntry] = useState(initial.entry)
  const [role, setRole] = useState<Role>(initial.role)
  const [theme, setTheme] = useState<Theme>(initial.theme)
  const [width, setWidth] = useState(initial.width)
  const [family, setFamily] = useState(initialFamily)
  const [people, setPeople] = useState(initialPeople)
  const [selectedPersonId, setSelectedPersonId] = useState<string | undefined>()
  const [editingId, setEditingId] = useState('photo')
  const [memories, setMemories] = useState(() => scenarioMemories(initial.entry, initialMemories))
  const [notice, setNotice] = useState('')
  const [overlay, setOverlay] = useState<{ kind: string; memoryId: string; index: number } | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const query = new URLSearchParams({ entry: entry.id, role, theme, width: String(width) })
    if (initial.preview) query.set('preview', '1')
    window.history.replaceState(null, '', '/__fixtures/ui-v2?' + query.toString())
  }, [entry.id, role, theme, width, initial.preview])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(timer) }, [notice])
  function select(next: CatalogEntry) {
    setEntry(next); setOverlay(null); setNotice(''); setRevision(v => v + 1)
    setSelectedPersonId(undefined)
    if (next.screen === 'family' && ['owner', 'full', 'viewer'].includes(next.state)) setRole(next.state as Role)
    if (next.screen === 'family' && next.state.startsWith('leave')) setRole('full')
    if (next.screen === 'themes') setTheme(next.state as Theme)
    if (next.screen === 'feed' && ['no-reactions', 'own-reaction', 'reactions'].includes(next.state)) setMemories(current => scenarioMemories(next, current))
  }
  const actions: ScreenActions = {
    go: (id, personId) => { select(getEntry(id)); if (personId) setSelectedPersonId(personId); if (id.startsWith('composer:edit')) setEditingId(overlay?.memoryId ?? memories[0]?.id ?? 'photo') }, open: (kind, memoryId = memories[0]?.id ?? 'photo', index = 0) => setOverlay({ kind, memoryId, index }),
    onNotice: setNotice, onTheme: setTheme,
    onSaveChild: (name, birthDate, sex, avatar) => setFamily(current => ({ ...current, name, birthDate, sex, avatar, age: childAge(birthDate) })),
    onSaveFamily: (name, timezone) => setFamily(current => ({ ...current, familyName: name, timezone })),
    onSavePerson: (id, name, access, avatar) => setPeople(current => current.map(p => p.id === id ? { ...p, name, avatar, role: p.owner ? 'owner' : access ?? p.role, subtitle: p.owner ? 'Владелец семьи' : access === 'full' ? 'Полный доступ' : access === 'viewer' ? 'Просмотр' : p.subtitle } : p)),
    onRemovePerson: () => { if (role === 'owner') setPeople(current => current.filter(p => p.owner || p.id !== (selectedPersonId ?? 'grandma'))) },
    onSaveMemory: (body, kind, media, date) => setMemories(current => kind === 'edit' ? current.map(m => m.id === editingId ? { ...m, body, date } : m) : [{ ...initialMemories[kind === 'note' ? 2 : kind === 'video' ? 4 : 0], id: 'local-' + Date.now(), body, media: kind === 'note' ? [] : media, date, reactions: [], ownReaction: undefined }, ...current]),
    onDelete: id => { if (role !== 'viewer') setMemories(current => current.filter(m => m.id !== id)) },
    onReact: (id, emoji) => setMemories(current => current.map(m => {
      if (m.id !== id) return m
      const own = m.ownReaction === emoji ? undefined : emoji
      const counts = new Map(m.reactions.map(r => [r.emoji, r.count]))
      if (m.ownReaction) counts.set(m.ownReaction, Math.max(0, (counts.get(m.ownReaction) ?? 1) - 1))
      if (own) counts.set(own, (counts.get(own) ?? 0) + 1)
      return { ...m, ownReaction: own, reactions: [...counts].filter(([, count]) => count > 0).map(([emoji, count]) => ({ emoji, count })) }
    })),
  }
  const props: ScreenProps = { entry, role, theme, family, people, memories, selectedPerson: people.find(p => p.id === selectedPersonId), editingMemory: memories.find(m => m.id === editingId), actions }
  const activeModel = memories.find(m => m.id === overlay?.memoryId) ?? selectedMemory(entry.state, memories)
  const hasCatalogOverlay = entry.screen === 'overlay'
  const overlayNode = overlay ? <Overlay {...overlay} model={activeModel} role={role} actions={actions} onClose={() => setOverlay(null)} /> : hasCatalogOverlay ? <Overlay kind={entry.state} role={role} model={activeModel} actions={actions} onClose={() => actions.go('feed:all')} /> : undefined
  const hasTabs = ['feed', 'family', 'overlay'].includes(entry.screen)
  const style = { ...tokenVariables(theme), '--lab-width': width + 'px' } as CSSProperties
  return <div className={'v2-root ' + (initial.preview ? 'v2-root--preview' : 'v2-root--catalog')} style={style} data-theme={theme} data-role={role}>
    {!initial.preview && <><header className="lab-header"><Typography as="h1" variant="section">MEMOLY UI V2 LAB</Typography><Typography variant="meta">Modern family storybook · {catalog.length} состояний · локальные fixtures</Typography><Typography variant="caption">Дизайн для просмотра владельцем · production не подключён</Typography></header>
      <div className="lab-controls"><label>SCREEN<select aria-label="SCREEN" value={entry.screen} onChange={e => select(catalog.find(item => item.screen === e.target.value)!)}>{screenKeys.map(key => <option value={key} key={key}>{screenLabels[key]}</option>)}</select></label><label>STATE<select aria-label="STATE" value={entry.id} onChange={e => select(getEntry(e.target.value))}>{catalog.filter(item => item.screen === entry.screen).map(item => <option key={item.id} value={item.id}>{item.state}</option>)}</select></label><label>ROLE<select aria-label="ROLE" value={role} onChange={e => { setRole(e.target.value as Role); setOverlay(null) }}>{(['owner', 'full', 'viewer'] as const).map(value => <option key={value}>{value}</option>)}</select></label><label>THEME<select aria-label="THEME" value={theme} onChange={e => setTheme(e.target.value as Theme)}>{Object.keys(themes).map(value => <option key={value}>{value}</option>)}</select></label><label>VIEWPORT<select aria-label="VIEWPORT" value={width} onChange={e => setWidth(Number(e.target.value))}>{viewports.map(value => <option key={value}>{value}</option>)}</select></label></div></>}
    <div className="lab-workspace">{!initial.preview && <aside className="lab-catalog" aria-label="Каталог экранов">{groups.map(group => <details key={group} open={group === entry.group}><summary>{group}</summary>{catalog.filter(item => item.group === group).map(item => <div className="lab-catalog-item" key={item.id}><span>{screenLabels[item.screen]} / {item.state}</span><Pressable aria-label={'OPEN ' + item.id} aria-current={item.id === entry.id ? 'page' : undefined} onPress={() => select(item)}><Typography as="span" variant="caption">OPEN</Typography></Pressable></div>)}</details>)}</aside>}
      <div className="lab-preview-area">{!initial.preview && <div className="lab-preview-title"><Typography variant="meta">{screenLabels[entry.screen]} / {entry.state}</Typography><a href={'/__fixtures/ui-v2?' + new URLSearchParams({ entry: entry.id, role, theme, width: String(width), preview: '1' })} target="_blank" rel="noreferrer">Чистый preview ↗</a></div>}
        <div className="lab-preview" data-entry={entry.id} data-viewport={width}>
          <Screen navigation={hasTabs ? <BottomTabs active={entry.screen === 'family' ? 'family' : 'feed'} role={role} onFeed={() => actions.go('feed:all')} onAdd={() => actions.open('add')} onFamily={() => actions.go('family:' + role)} /> : undefined} overlay={overlayNode}>
            <ScreenComposition key={entry.id + ':' + revision} {...props} />
          </Screen>
          {notice && <div className="v2-toast" role="status"><Typography variant="meta">{notice}</Typography></div>}
        </div>{!initial.preview && <Typography className="lab-caption" variant="caption">Фото синтетические. Playback, copy/share и установка моделируются локально. Никаких API-запросов.</Typography>}
      </div>
    </div>
  </div>
}
function scenarioMemories(entry: CatalogEntry, current: typeof initialMemories) {
  if (entry.screen !== 'feed') return current
  return current.map(m => m.id !== 'photo' ? m : entry.state === 'no-reactions' ? { ...m, reactions: [], ownReaction: undefined } : entry.state === 'own-reaction' ? { ...m, reactions: initialMemories[0].reactions, ownReaction: '❤️' } : entry.state === 'reactions' ? { ...m, reactions: initialMemories[0].reactions, ownReaction: undefined } : m)
}
function ScreenComposition(props: ScreenProps) {
  const { entry, actions, memories } = props
  switch (entry.screen) {
    case 'first-run': return <FirstRun {...props} />
    case 'families': return <Families {...props} />
    case 'setup': return <Setup {...props} />
    case 'feed': return <Feed {...props} />
    case 'overlay': return <Feed {...props} entry={{ ...entry, state: 'photo' }} />
    case 'family': return <Family {...props} />
    case 'child': return <Child {...props} />
    case 'member': return <Member {...props} />
    case 'composer': return <Composer {...props} />
    case 'invite': return <IncomingInvite {...props} />
    case 'invite-create': return <InviteCreate {...props} />
    case 'invites': return <Invites {...props} />
    case 'channel': return <Channel {...props} />
    case 'install': return <Install {...props} />
    case 'settings': return <Settings {...props} />
    case 'archive': return <Archive {...props} />
    case 'viewer': return entry.state === 'return' ? <Feed {...props} entry={{ ...entry, screen: 'feed', state: 'photo' }} /> : <Viewer state={entry.state} model={selectedMemory(entry.state === 'carousel' || entry.state === 'mixed' ? 'mixed' : entry.state === 'note' ? 'note' : entry.state.startsWith('video') ? 'max-video' : 'photo', memories)} onClose={() => actions.go('feed:photo')} />
    case 'components': case 'themes': return <Components {...props} />
  }
}
