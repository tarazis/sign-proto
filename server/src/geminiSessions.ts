import { GoogleGenAI, Modality } from '@google/genai'
import { Server } from 'socket.io'

const GEMINI_ENABLED = process.env.GEMINI_ENABLED === 'true'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-live-2.5-flash-preview'

const SYSTEM_INSTRUCTION = `You are an ASL (American Sign Language) interpreter. You will receive a stream of JPEG frames showing a person signing. Your job is to recognize the signs and output the corresponding English word or short phrase.

Rules:
- Output only the recognized English text, one sign or phrase at a time.
- Do not add commentary, punctuation other than what is part of the word, or explanations.
- If you fingerspell, output the assembled word (e.g., "C-A-T" -> "cat").
- If a sign is unclear or you are not confident, output nothing — do not guess.
- Do not repeat yourself. Wait for the next distinct sign.
- ASL only. Do not interpret signs from other sign languages.`

interface GeminiSession {
  sendRealtimeInput(params: { media?: { data?: string; mimeType?: string } }): void
  close(): void
}

export type RoomGeminiState = {
  session: GeminiSession
  signerSocketId: string
  lastCaption: string
  lastCaptionAt: number
  reconnectAttempted: boolean
  // Incremented on each openRealSession call so stale callbacks from the old
  // session self-discard when onerror and onclose both fire for the same failure.
  sessionGeneration: number
  closing: boolean
}

const geminiSessions = new Map<string, RoomGeminiState>()
// In-flight dedup: prevents duplicate session creation when frames arrive during init
const sessionsBeingCreated = new Map<string, Promise<RoomGeminiState | null>>()

// --- mock path ---

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
    sendRealtimeInput() {},
    close() {
      clearInterval(interval)
    },
  }
}

// --- real Gemini path ---

function degradeSession(roomId: string, io: Server): void {
  console.error(`[gemini] session permanently unavailable for room ${roomId}`)
  geminiSessions.delete(roomId)
  io.to(roomId).emit('caption-status', { status: 'unavailable', reason: 'Gemini session failed' })
}

function handleSessionFailure(roomId: string, io: Server, state: RoomGeminiState): void {
  if (state.reconnectAttempted) {
    degradeSession(roomId, io)
    return
  }
  state.reconnectAttempted = true
  console.log(`[gemini] attempting reconnect for room ${roomId}`)
  openRealSession(roomId, io, state).catch((err) => {
    console.error(`[gemini] reconnect failed for room ${roomId}:`, err)
    degradeSession(roomId, io)
  })
}

async function openRealSession(roomId: string, io: Server, state: RoomGeminiState): Promise<void> {
  // Capture generation before the async connect so stale callbacks from the
  // previous session can check state.sessionGeneration !== generation and bail.
  const generation = ++state.sessionGeneration

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const session = await ai.live.connect({
    model: GEMINI_MODEL,
    callbacks: {
      onopen: () => {
        if (state.sessionGeneration !== generation) return
        console.log(`[gemini] session open for room ${roomId}`)
        io.to(roomId).emit('caption-status', { status: 'available' })
      },
      onmessage: (msg) => {
        if (state.sessionGeneration !== generation || !state.signerSocketId) return
        const text = msg.text
        if (!text) return
        const now = Date.now()
        if (text === state.lastCaption && now - state.lastCaptionAt < 1000) return
        state.lastCaption = text
        state.lastCaptionAt = now
        io.to(roomId).except(state.signerSocketId).emit('caption', { text, timestamp: now })
      },
      onerror: (e) => {
        if (state.sessionGeneration !== generation || state.closing) return
        console.error(`[gemini] session error for room ${roomId}:`, e)
        handleSessionFailure(roomId, io, state)
      },
      onclose: (e) => {
        if (state.sessionGeneration !== generation || state.closing || e.wasClean) return
        console.warn(`[gemini] session closed unexpectedly for room ${roomId}: code=${e.code}`)
        handleSessionFailure(roomId, io, state)
      },
    },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseModalities: [Modality.TEXT],
    },
  })

  state.session = session
}

// --- public API ---

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
      const state: RoomGeminiState = {
        session: null as unknown as GeminiSession,
        signerSocketId: '',
        lastCaption: '',
        lastCaptionAt: 0,
        reconnectAttempted: false,
        sessionGeneration: 0,
        closing: false,
      }

      if (!GEMINI_ENABLED) {
        state.session = createMockSession(roomId, io, state)
        console.log(`[gemini] mock session created for room ${roomId}`)
      } else {
        await openRealSession(roomId, io, state)
        console.log(`[gemini] real session created for room ${roomId}`)
      }

      geminiSessions.set(roomId, state)
      return state
    } catch (err) {
      console.error(`[gemini] failed to create session for room ${roomId}:`, err)
      if (GEMINI_ENABLED) {
        io.to(roomId).emit('caption-status', { status: 'unavailable', reason: 'Gemini session failed to start' })
      }
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
  state.closing = true
  try {
    state.session.close()
  } catch (err) {
    console.error(`[gemini] error closing session for room ${roomId}:`, err)
  }
  geminiSessions.delete(roomId)
  console.log(`[gemini] closed session for room ${roomId}`)
}
