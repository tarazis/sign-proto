import { Server } from 'socket.io'

// Real SDK is imported here but only used when GEMINI_ENABLED=true (next session)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type {} from '@google/genai'

const GEMINI_ENABLED = process.env.GEMINI_ENABLED === 'true'

interface GeminiSession {
  close(): void
}

export type RoomGeminiState = {
  session: GeminiSession
  signerSocketId: string
  lastCaption: string
  lastCaptionAt: number
  reconnectAttempted: boolean
}

const geminiSessions = new Map<string, RoomGeminiState>()
// In-flight dedup: prevents duplicate session creation when frames arrive during init
const sessionsBeingCreated = new Map<string, Promise<RoomGeminiState | null>>()

function createMockSession(roomId: string, io: Server, state: RoomGeminiState): GeminiSession {
  const interval = setInterval(() => {
    if (!state.signerSocketId) return
    const text = 'mock caption'
    const now = Date.now()
    state.lastCaption = text
    state.lastCaptionAt = now
    io.to(roomId).except(state.signerSocketId).emit('caption', { text, timestamp: now })
  }, 2000)

  return {
    close() {
      clearInterval(interval)
    },
  }
}

export async function getOrCreateSession(
  roomId: string,
  io: Server,
): Promise<RoomGeminiState | null> {
  const existing = geminiSessions.get(roomId)
  if (existing) return existing

  const inFlight = sessionsBeingCreated.get(roomId)
  if (inFlight) return inFlight

  const promise = (async (): Promise<RoomGeminiState | null> => {
    try {
      if (!GEMINI_ENABLED) {
        const state: RoomGeminiState = {
          session: null as unknown as GeminiSession,
          signerSocketId: '',
          lastCaption: '',
          lastCaptionAt: 0,
          reconnectAttempted: false,
        }
        state.session = createMockSession(roomId, io, state)
        geminiSessions.set(roomId, state)
        console.log(`[gemini] mock session created for room ${roomId}`)
        return state
      }

      // Real Gemini Live integration — next session (GEMINI_ENABLED=true path)
      console.warn(`[gemini] GEMINI_ENABLED=true but real SDK not yet wired; returning null`)
      return null
    } catch (err) {
      console.error(`[gemini] failed to create session for room ${roomId}:`, err)
      return null
    } finally {
      sessionsBeingCreated.delete(roomId)
    }
  })()

  sessionsBeingCreated.set(roomId, promise)
  return promise
}

export function closeSession(roomId: string): void {
  const state = geminiSessions.get(roomId)
  if (!state) return
  try {
    state.session.close()
  } catch (err) {
    console.error(`[gemini] error closing session for room ${roomId}:`, err)
  }
  geminiSessions.delete(roomId)
  console.log(`[gemini] closed session for room ${roomId}`)
}
