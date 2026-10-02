import { Avatar, IconButton, Pressable } from '../primitives/controls'
import { PersonName, Typography } from '../primitives/Typography'
import type { FamilyHeroModel } from '../fixtures/models'
export function MemoLyLogo() { return <img className="v2-logo" src="/assets/brand/memoly-logo-correct.webp" alt="memoLy" width={1200} height={400} /> }
export function FamilyHero({ model, onAllFamilies, onOpenChild, onSettings }: { model: FamilyHeroModel; onAllFamilies: () => void; onOpenChild: () => void; onSettings?: () => void }) {
  return <header className="v2-family-hero" data-component="FamilyHero">
    <div className="v2-hero-top"><MemoLyLogo /><Pressable className="v2-family-switcher" onPress={onAllFamilies}><Typography as="span" variant="meta">Все семьи</Typography><Typography as="span" aria-hidden="true" variant="meta">↗</Typography></Pressable></div>
    <div className="v2-hero-profile"><Pressable className="v2-child-link" onPress={onOpenChild} aria-label={'Профиль ребёнка: ' + model.name}><Avatar name={model.name} src={model.avatar} large /><span className="v2-stack"><Typography as="span" variant="title">{model.name}</Typography><Typography as="span" variant="meta">{model.age}</Typography></span></Pressable>{onSettings ? <IconButton name="gear" label="Настройки" onPress={onSettings} /> : <span className="v2-hero-action-spacer" />}</div>
    <div className="v2-album-caption"><PersonName>{model.familyName}</PersonName><Typography as="span" variant="caption">Только для близких</Typography></div>
  </header>
}
