import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Typography } from '@/components/typography'

export function AvatarLetter({ name }: { name: string }) {
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase('ru-RU') ?? '•'

  return (
    <Avatar aria-hidden data-slot="avatar-letter" size="lg">
      <AvatarFallback className="bg-accent text-accent-foreground">
        <Typography variant="memoryChild">{letter}</Typography>
      </AvatarFallback>
    </Avatar>
  )
}
