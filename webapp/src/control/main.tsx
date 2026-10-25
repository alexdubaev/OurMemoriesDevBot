import { Typography } from '@/components/typography'
import React, { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ControlApp } from './ControlApp'
import './control.css'

class AppBoundary extends Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { /* Keep diagnostics free of API payloads and user data. */ }
  render() {
    if (this.state.failed) return <main className="control-fallback"><Typography as="h1" variant="h3">Не удалось открыть панель</Typography><Typography as="p" variant="bodySm">Данные скрыты. Перезагрузите страницу и попробуйте снова.</Typography><button onClick={() => location.reload()}><Typography as="span" variant="control">Повторить</Typography></button></main>
    return this.props.children
  }
}

const start = document.getElementById('control-start')
try {
  const root = createRoot(document.getElementById('memoly-control-root')!)
  root.render(<StrictMode><AppBoundary><ControlApp onReady={() => { if (start) start.hidden = true }} /></AppBoundary></StrictMode>)
} catch {
  if (start) {
    start.hidden = false
    const message = start.querySelector('[data-error]')
    if (message) message.textContent = 'Не удалось запустить панель. Перезагрузите страницу и попробуйте снова.'
  }
}
