import { Icon, Pressable } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import type { Role } from '../states/catalog'
export function BottomTabs({ active, role, onFeed, onAdd, onFamily }: { active: 'feed' | 'family'; role: Role; onFeed: () => void; onAdd: () => void; onFamily: () => void }) {
  return <nav className="v2-tabs" aria-label="Основная навигация" data-component="BottomTabs">
    <Pressable aria-current={active === 'feed' ? 'page' : undefined} onPress={onFeed}><span className="v2-tab-symbol"><Icon name="feed" /></span><Typography as="span" variant="caption">Лента</Typography></Pressable>
    <Pressable className="v2-tabs-add" aria-label={role === 'viewer' ? 'Добавление доступно участникам с полным доступом' : 'Добавить воспоминание'} disabled={role === 'viewer'} onPress={onAdd}><span className="v2-add-symbol"><Icon name="plus" /></span><Typography as="span" variant="caption">Добавить</Typography></Pressable>
    <Pressable aria-current={active === 'family' ? 'page' : undefined} onPress={onFamily}><span className="v2-tab-symbol"><Icon name="family" /></span><Typography as="span" variant="caption">Семья</Typography></Pressable>
  </nav>
}
