import { io } from 'socket.io-client'

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

export const socket = io(SERVER_URL, { autoConnect: false })

if (import.meta.env.DEV) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__socket = socket
}
