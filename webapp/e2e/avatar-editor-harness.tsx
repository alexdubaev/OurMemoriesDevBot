/* eslint-disable react-refresh/only-export-components -- test-only static Vite harness. */
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { AvatarEditor } from '../src/features/avatar/AvatarEditor'
import type { AvatarCrop } from '../src/features/avatar/avatar-crop'
import '../src/index.css'

function Harness() {
  const [open, setOpen] = useState(true)
  const [crop, setCrop] = useState<AvatarCrop | null>(null)
  const [attempt, setAttempt] = useState<AvatarCrop | null>(null)
  const [saves, setSaves] = useState(0)
  const [failed, setFailed] = useState(false)
  const landscape = new URLSearchParams(location.search).get('orientation') === 'landscape'
  const width = landscape ? 900 : 600, height = landscape ? 600 : 900
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#d77'; context.fillRect(0, 0, width, height)
  context.fillStyle = '#7af'; context.beginPath(); context.arc(width / 2, height / 2, 120, 0, Math.PI * 2); context.fill()
  const image = canvas.toDataURL('image/png')
  return <main><button onClick={() => setOpen(true)}>Open editor</button><output data-testid="saved-crop">{crop ? JSON.stringify(crop) : ''}</output><output data-testid="attempt-crop">{attempt ? JSON.stringify(attempt) : ''}</output><output data-testid="save-count">{saves}</output>{open ? <AvatarEditor image={image} initialCrop={crop} onChooseAnother={() => undefined} onCancel={() => setOpen(false)} onConfirm={async (area) => { if (new URLSearchParams(location.search).has('retry') && !failed) { setAttempt(area); setFailed(true); throw new Error('Synthetic save failure') } setSaves((n) => n + 1); setCrop(area); setOpen(false) }} /> : null}</main>
}

createRoot(document.getElementById('root')!).render(<Harness />)
