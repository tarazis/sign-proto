import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'
const PORT = process.env.PORT ?? 3001
const ROOM_CAPACITY = 2

const app = express()
app.use(cors({ origin: CLIENT_URL }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
})

// roomId -> Set of socketIds
const rooms = new Map<string, Set<string>>()

function addToRoom(roomId: string, socketId: string) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set())
  rooms.get(roomId)!.add(socketId)
}

function removeFromRoom(roomId: string, socketId: string) {
  const room = rooms.get(roomId)
  if (!room) return
  room.delete(socketId)
  if (room.size === 0) rooms.delete(roomId)
}

function getRoomMembers(roomId: string): string[] {
  return Array.from(rooms.get(roomId) ?? [])
}

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`)

  socket.on('join-room', ({ roomId }: { roomId: string }) => {
    const members = getRoomMembers(roomId)

    if (members.length >= ROOM_CAPACITY) {
      console.log(`[room] ${socket.id} tried to join full room: ${roomId}`)
      socket.emit('room-full', { roomId })
      return
    }

    addToRoom(roomId, socket.id)
    socket.join(roomId)

    const updatedMembers = getRoomMembers(roomId)
    console.log(`[room] ${socket.id} joined ${roomId} (${updatedMembers.length}/${ROOM_CAPACITY})`)

    // Tell everyone in the room (including joiner) the updated member list
    io.to(roomId).emit('room-update', { members: updatedMembers })

    // Tell existing members a new peer arrived (not the joiner)
    socket.to(roomId).emit('peer-joined', { socketId: socket.id })
  })

  socket.on('leave-room', ({ roomId }: { roomId: string }) => {
    handleLeave(socket.id, roomId)
  })

  socket.on('signal', ({ to, signal }: { to: string; signal: unknown }) => {
    if (typeof to !== 'string') return
    io.to(to).emit('signal', { from: socket.id, signal })
  })

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`)
    // Clean up all rooms this socket was in
    for (const [roomId, members] of rooms.entries()) {
      if (members.has(socket.id)) {
        handleLeave(socket.id, roomId)
      }
    }
  })

  function handleLeave(socketId: string, roomId: string) {
    const room = rooms.get(roomId)
    if (!room?.has(socketId)) return

    removeFromRoom(roomId, socketId)
    socket.leave(roomId)

    const remaining = getRoomMembers(roomId)
    console.log(`[room] ${socketId} left ${roomId} (${remaining.length}/${ROOM_CAPACITY})`)

    io.to(roomId).emit('room-update', { members: remaining })
    io.to(roomId).emit('peer-left', { socketId })
  }
})

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`)
})
