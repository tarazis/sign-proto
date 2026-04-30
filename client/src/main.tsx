import { Buffer } from 'buffer'
;(window as any).Buffer = Buffer

import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode disabled: its double-mount disconnects the socket mid-handshake,
// causing peer-left/peer-joined churn and dropped WebRTC signals.
createRoot(document.getElementById('root')!).render(<App />)
