import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { getOrCreateSession, closeSession } from './geminiSessions'

const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'
const PORT = process.env.PORT ?? 3001
const ROOM_CAPACITY = 2
const GEMINI_DEBUG_TEXT_NUDGE_EVERY = Number(process.env.GEMINI_DEBUG_TEXT_NUDGE_EVERY ?? '8')

/** JPEG must start with FFD8FF after base64 decode; junk (e.g. AAAA) as image/jpeg closes Live with 1007 invalid argument. */
function isLikelyJpegBase64(b64: string): boolean {
  if (!b64 || b64.length < 4) return false
  try {
    const buf = Buffer.from(b64, 'base64')
    return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  } catch {
    return false
  }
}

const warnedInvalidJpegByRoom = new Set<string>()

const originPattern = process.env.CORS_ORIGIN_PATTERN
  ? new RegExp(process.env.CORS_ORIGIN_PATTERN)
  : null

function corsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void
) {
  const allowed =
    origin === CLIENT_URL || (!!originPattern && !!origin && originPattern.test(origin))
  console.log(`[cors] origin="${origin}" CLIENT_URL="${CLIENT_URL}" pattern="${originPattern}" allowed=${allowed}`)
  cb(null, allowed)
}

const app = express()
app.use(cors({ origin: corsOrigin }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/turn-credentials', (_req, res) => {
  const { TURN_URL, TURN_USERNAME, TURN_CREDENTIAL } = process.env
  const iceServers: Array<{ urls: string; username?: string; credential?: string }> = [
    { urls: 'stun:stun.l.google.com:19302' },
  ]

  if (TURN_URL && TURN_USERNAME && TURN_CREDENTIAL) {
    iceServers.push({ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_CREDENTIAL })
  } else {
    console.warn('[turn] TURN_URL/TURN_USERNAME/TURN_CREDENTIAL not all set — returning STUN only')
  }

  res.json({ iceServers })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
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

  socket.on('video-frame', async ({ roomId, frameBase64 }: { roomId: string; frameBase64: string }) => {
    if (!rooms.get(roomId)?.has(socket.id)) return
    if (!isLikelyJpegBase64(frameBase64)) {
      if (!warnedInvalidJpegByRoom.has(roomId)) {
        warnedInvalidJpegByRoom.add(roomId)
        console.warn(
          `[frame] skipped: payload is not JPEG (SOI FFD8FF). Placeholders like AAAA break Gemini Live (WS 1007). Use a real frame or omit emits.`,
        )
      }
      return
    }
    const state = await getOrCreateSession(roomId, io)
    if (!state) return
    state.signerSocketId = socket.id
    try {
      state.session.sendRealtimeInput({ video: { data: frameBase64, mimeType: 'image/jpeg' } })
      state.frameCount += 1
      if (GEMINI_DEBUG_TEXT_NUDGE_EVERY > 0 && state.frameCount % GEMINI_DEBUG_TEXT_NUDGE_EVERY === 0) {
        state.session.sendRealtimeInput({ text: 'Output one short word describing the current sign now.' })
      }
    } catch (err) {
      console.error(`[frame] sendRealtimeInput failed for room ${roomId}:`, err)
    }
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

    if (!rooms.has(roomId)) {
      closeSession(roomId)
    }

    io.to(roomId).emit('room-update', { members: remaining })
    io.to(roomId).emit('peer-left', { socketId })
  }
})

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`)
})
