import { Avatar, Icon, IconButton, Pressable } from '../primitives/controls'
import { Typography } from '../primitives/Typography'
import type { FamilyHeroModel } from '../fixtures/models'
export function MemoLyLogo() { return <img className="v2-logo" src="/assets/brand/memoly-logo-correct.webp" alt="memoLy" width={1200} height={400} /> }
export function FamilyHero({ model, onAllFamilies, onOpenChild, onSettings }: { model: FamilyHeroModel; onAllFamilies: () => void; onOpenChild: () => void; onSettings?: () => void }) {
  return <header className="v2-family-hero" data-component="FamilyHero">
    {model.cover && <img className="v2-hero-cover" src={model.cover} alt="" />}
    <div className="v2-hero-top"><Pressable className="v2-family-switcher" onPress={onAllFamilies}><Icon name="back" size={16} /><Typography as="span" variant="meta">Все семьи</Typography></Pressable><div className="v2-hero-brand"><MemoLyLogo /><Typography variant="caption">Маленькие моменты<br />большое счастье</Typography></div>{onSettings ? <IconButton name="gear" label="Настройки" onPress={onSettings} /> : <span className="v2-hero-action-spacer" />}</div>
    <Pressable className="v2-child-link" onPress={onOpenChild} aria-label={'Профиль ребёнка: ' + model.name}>
      <Avatar name={model.name} src={model.avatar} large />
      <span className="v2-hero-identity"><Typography as="span" variant="display">{model.name}</Typography><Typography as="span" variant="meta">{model.age.split(' · ')[0]}</Typography></span>
    </Pressable>
  </header>
}
