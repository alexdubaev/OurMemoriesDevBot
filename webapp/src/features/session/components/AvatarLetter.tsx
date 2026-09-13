import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Typography } from '@/components/typography'
import { cn } from '@/lib/utils'

export function AvatarLetter({ className, name, size = 'lg' }: { className?: string; name: string; size?: 'default' | 'sm' | 'lg' | 'xl' }) {
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase('ru-RU') ?? '•'

  return (
    <Avatar aria-hidden className={cn(className)} data-slot="avatar-letter" size={size}>
      <AvatarFallback className="bg-accent text-accent-foreground">
        <Typography variant="memoryChild">{letter}</Typography>
      </AvatarFallback>
    </Avatar>
  )
}
