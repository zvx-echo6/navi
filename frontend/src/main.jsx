import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import { loadConfig } from './config'
import './index.css'
import App from './App.jsx'

// Load deployment config before rendering — non-blocking (fallback kicks in on failure)
loadConfig().then(() => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'var(--bg-overlay)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-sans)',
          },
        }}
      />
    </StrictMode>,
  )
})
