import { useRef } from 'react'

import { BrandLogo } from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { Typography } from '@/components/typography'

import './welcome-splash.css'

export function WelcomeSplash({ onComplete }: { onComplete: () => void }) {
  const completedRef = useRef(false)
  const complete = () => {
    if (completedRef.current) return
    completedRef.current = true
    onComplete()
  }

  return (
    <main className="astryx-welcome" data-slot="welcome-splash">
      <section aria-labelledby="welcome-title" className="astryx-welcome-panel">
        <BrandLogo />
        <Typography as="h1" id="welcome-title" variant="memoryScreen">Семейные воспоминания</Typography>
        <Typography as="p" tone="muted" variant="memoryBody">
          Сохраняйте фото, видео, голосовые и заметки в приватном альбоме для вашей семьи.
        </Typography>
        <Button onClick={complete} type="button">
          <Typography as="span" variant="memoryButton">Продолжить</Typography>
        </Button>
      </section>
    </main>
  )
}
