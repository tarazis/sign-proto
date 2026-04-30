import { io } from 'socket.io-client'

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001'

export const socket = io(SERVER_URL, { autoConnect: false })
