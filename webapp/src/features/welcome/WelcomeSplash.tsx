/* eslint-disable typographyPolicy/use-typography-component -- The approved welcome reference uses native semantic HTML for its exact copy hierarchy and caption layout. */
import { useEffect, useRef } from 'react'

import './welcome-splash.css'

const welcomeAsset = (name: string) => `/assets/welcome/${name}.webp`

export function WelcomeSplash({ onComplete }: { onComplete: () => void }) {
  const welcomeRef = useRef<HTMLDivElement>(null)
  const completedRef = useRef(false)

  useEffect(() => {
    const updateVisibility = () => {
      welcomeRef.current?.classList.toggle('is-document-hidden', document.visibilityState === 'hidden')
    }

    updateVisibility()
    document.addEventListener('visibilitychange', updateVisibility)
    return () => document.removeEventListener('visibilitychange', updateVisibility)
  }, [])

  const complete = () => {
    if (completedRef.current) return
    completedRef.current = true
    onComplete()
  }

  return <div className="memolyWelcome" data-slot="welcome-splash" ref={welcomeRef}>
    <main aria-label="Добро пожаловать в memoLy" className="app">
      <section aria-label="Семейный альбом воспоминаний" className="hero">
        <img alt="" className="bg" src={welcomeAsset('bg')} />
        <img alt="memoLy" className="logo" src={welcomeAsset('logo')} />
        <div aria-hidden="true" className="art">
          <img alt="" className="ribbon" src={welcomeAsset('ribbon')} />
          <div className="book"><img alt="" className="animated-art" src={welcomeAsset('book')} /></div>
          <div className="card photo"><img alt="" className="animated-art" src={welcomeAsset('photo')} /></div>
          <div className="card voice"><img alt="" className="animated-art" src={welcomeAsset('voice')} /></div>
          <div className="card video"><img alt="" className="animated-art" src={welcomeAsset('video')} /></div>
          <div className="card note"><img alt="" className="animated-art" src={welcomeAsset('note')} /></div>
          <div className="star"><img alt="" className="animated-art" src={welcomeAsset('star')} /></div>
          <i className="sparkle one" />
          <i className="sparkle two" />
        </div>
      </section>
      <section aria-labelledby="welcome-title" className="copy">
        <h1 id="welcome-title"><span>Маленькие моменты.</span><span>Большая <span className="story">история.</span></span></h1>
        <p className="description">Сохраните детство в уютном альбоме<br />для всей семьи.</p>
      </section>
      <section aria-label="Что можно сохранить" className="formats">
        <figure className="format"><img alt="" src={welcomeAsset('photo')} /><figcaption>Фото</figcaption></figure>
        <figure className="format"><img alt="" src={welcomeAsset('video')} /><figcaption>Видео</figcaption></figure>
        <figure className="format"><img alt="" src={welcomeAsset('voice')} /><figcaption>Голос</figcaption></figure>
        <figure className="format"><img alt="" src={welcomeAsset('note')} /><figcaption>Заметки</figcaption></figure>
      </section>
      <footer className="actions">
        <button className="continue-button" onClick={complete} type="button">
          <span className="continue-label">Продолжить</span>
          <span aria-hidden="true" className="continue-orb">
            <span className="continue-arrow-line" />
            <img alt="" className="continue-arrow-head" src="/assets/icons/chevron-active@3x.webp" />
          </span>
        </button>
      </footer>
    </main>
  </div>
}
