import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { make as App } from './App.res.mjs'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
