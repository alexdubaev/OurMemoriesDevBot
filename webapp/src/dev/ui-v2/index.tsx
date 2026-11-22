import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Lab } from './lab/Lab'
import './tokens/ui-v2.css'
if (!import.meta.env.DEV) throw new Error('UI v2 Lab is development-only')
createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
