import React from 'react'
import { createRoot } from 'react-dom/client'
import { StrictMode } from 'react'
import App from './App'
import './index.css'

// Initialize the app
const rootElement = document.getElementById('root')

if (!rootElement) {
  console.error('Could not find root element')
} else {
  const root = createRoot(rootElement)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
