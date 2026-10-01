import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WelcomeSplash } from '../src/features/welcome/WelcomeSplash'
import '../src/production.css'

/* eslint-disable react-refresh/only-export-components -- Development-only fixture mounts a local test root. */
function WelcomeSplashFixture() {
  const [completed, setCompleted] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [callbackVersion, setCallbackVersion] = useState(0)

  return <>
    <output aria-label="Completion count">{completed}</output>
    <button onClick={() => setCallbackVersion((version) => version + 1)} type="button">Rerender parent</button>
    <button onClick={() => setGeneration((key) => key + 1)} type="button">Remount splash</button>
    <span hidden>{callbackVersion}</span>
    <WelcomeSplash key={generation} onComplete={() => setCompleted((count) => count + 1)} />
  </>
}

createRoot(document.getElementById('fixture')!).render(<StrictMode><WelcomeSplashFixture /></StrictMode>)
