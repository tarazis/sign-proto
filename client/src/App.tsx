import { useEffect, useState } from 'react'
import { io, Socket } from 'socket.io-client'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

const statusStyles: Record<ConnectionStatus, string> = {
  connecting: 'bg-yellow-500',
  connected: 'bg-green-500',
  disconnected: 'bg-red-500',
}

export default function App() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null)
  const [socketId, setSocketId] = useState<string | null>(null)

  useEffect(() => {
    const socket: Socket = io(SERVER_URL, { autoConnect: true })

    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('welcome', (data: { message: string; socketId: string }) => {
      setWelcomeMessage(data.message)
      setSocketId(data.socketId)
    })

    return () => { socket.disconnect() }
  }, [])

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-6">
      <h1 className="text-4xl font-bold tracking-tight">SignBridge</h1>

      <div className="flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${statusStyles[status]}`} />
        <span className="text-sm text-gray-300 capitalize">{status}</span>
      </div>

      {welcomeMessage && (
        <p className="text-gray-400 text-sm">{welcomeMessage}</p>
      )}

      {socketId && (
        <p className="text-gray-600 text-xs font-mono">socket: {socketId}</p>
      )}
    </div>
  )
}
