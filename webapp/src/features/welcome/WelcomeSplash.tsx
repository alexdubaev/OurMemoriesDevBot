/* eslint-disable typographyPolicy/use-typography-component -- The frozen welcome source's exact DOM and text CSS are preserved. */
import { useEffect, useRef } from 'react'

import './welcome-splash.css'

const asset = (name: string) => `/assets/welcome/${name}.webp`

// The frozen source's last finite intro is .footer: copyIn .8s after 3.45s.
export const WELCOME_INTRO_MS = 4_250
export const WELCOME_FALLBACK_MS = WELCOME_INTRO_MS + 250
export const WELCOME_REDUCED_DWELL_MS = 180

export function WelcomeSplash({ onComplete }: { onComplete: () => void }) {
  const finishRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const bodyOverflow = document.body.style.overflow
    const rootOverflow = document.documentElement.style.overflow
    const bodyOverscroll = document.body.style.overscrollBehavior
    const rootOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    document.documentElement.style.overscrollBehavior = 'none'

    let timer: number | undefined
    let startedAt = 0
    let remaining = motion.matches ? WELCOME_REDUCED_DWELL_MS : WELCOME_FALLBACK_MS
    let pendingFinish = false
    let finished = false
    const finish = () => {
      if (finished) return
      if (document.visibilityState === 'hidden') { pendingFinish = true; return }
      finished = true
      window.clearTimeout(timer)
      onComplete()
    }
    finishRef.current = finish
    const schedule = () => {
      if (finished || document.visibilityState === 'hidden') return
      if (pendingFinish) { finish(); return }
      startedAt = performance.now()
      timer = window.setTimeout(finish, Math.max(0, remaining))
    }
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(timer)
        if (timer !== undefined) remaining = Math.max(0, remaining - (performance.now() - startedAt))
      } else schedule()
    }
    const motionChanged = () => {
      window.clearTimeout(timer)
      remaining = motion.matches ? WELCOME_REDUCED_DWELL_MS : WELCOME_FALLBACK_MS
      schedule()
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    motion.addEventListener('change', motionChanged)
    schedule()
    return () => {
      finished = true
      finishRef.current = () => undefined
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibilityChanged)
      motion.removeEventListener('change', motionChanged)
      document.body.style.overflow = bodyOverflow
      document.documentElement.style.overflow = rootOverflow
      document.body.style.overscrollBehavior = bodyOverscroll
      document.documentElement.style.overscrollBehavior = rootOverscroll
    }
  }, [onComplete])

  return <div className="memolyWelcome" data-slot="welcome-splash">
    <div className="app">
      <section aria-label="Добро пожаловать в memoLy" className="hero">
        <img alt="" className="bg" src={asset('bg')} />
        <div className="logo-wrap"><img alt="memoLy" className="logo" src={asset('logo')} /></div>
        <img alt="" className="ribbon" src={asset('ribbon')} />
        <div aria-hidden="true" className="float-note">Большие истории<br />начинаются<br />с маленьких<br />моментов <span className="heart">♡</span></div>
        <div className="logo-star"><img alt="" src={asset('star')} /></div>
        <img alt="" className="card photo" src={asset('photo')} />
        <img alt="" className="card voice" src={asset('voice')} />
        <img alt="" className="card video" src={asset('video')} />
        <img alt="" className="card note" src={asset('note')} />
        <img alt="" className="star" src={asset('star')} />
        <img alt="" className="book" src={asset('book')} />
        <i aria-hidden="true" className="sparkle s1" /><i aria-hidden="true" className="sparkle s2" /><i aria-hidden="true" className="sparkle s3" /><i aria-hidden="true" className="sparkle s4" /><i aria-hidden="true" className="sparkle s5" /><i aria-hidden="true" className="sparkle s6" />
      </section>
      <section className="copy">
        <div className="kicker">Добро пожаловать в memoLy</div>
        <h1>Маленькие моменты.<span>Большая история.</span></h1>
        <p>Фото, видео, любимый голос и первые слова. Сохраните детство в уютном альбоме для всей семьи.</p>
        <div aria-label="Что можно сохранить" className="features">
          <div className="feat active"><img alt="" className="ico" src={asset('photo')} /><span>Фото</span></div>
          <div className="feat"><img alt="" className="ico" src={asset('video')} /><span>Видео</span></div>
          <div className="feat"><img alt="" className="ico" src={asset('voice')} /><span>Голос</span></div>
          <div className="feat"><img alt="" className="ico" src={asset('note')} /><span>Заметки</span></div>
        </div>
        <div className="feature-desc">Сохраняйте любимые фотографии и возвращайтесь к ним всей семьёй.</div>
        <div className="privacy">🔒 Личная история, которой делятся только с близкими</div>
        <div className="footer" onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === 'copyIn') finishRef.current()
        }}>Создано с теплом <span style={{ color: '#e58cab' }}>♥</span> для самых близких</div>
      </section>
    </div>
  </div>
}
