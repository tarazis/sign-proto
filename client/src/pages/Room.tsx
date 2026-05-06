import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { socket } from '../socket'
import { usePeerConnection } from '../usePeerConnection'
import { useHandTracking } from '../useHandTracking'
import { useCaptions } from '../useCaptions'
import { useFrameSampler } from '../useFrameSampler'
import { HandOverlay } from '../HandOverlay'

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>()
  const [members, setMembers] = useState<string[]>([])
  const [isFull, setIsFull] = useState(false)
  const [copied, setCopied] = useState(false)

  const { localStream, remoteStream, error } = usePeerConnection(roomId)

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  // Role assignment by join order: first joiner is the signer (sends frames to
  // Gemini); second joiner is receive-only. Single-user mode is also signer so
  // the captions pipeline is testable solo.
  const isSigner = members.length === 0 || members[0] === socket.id
  const { landmarks, handsDetected } = useHandTracking(localVideoRef, isSigner)
  const { current: caption, status: captionStatus } = useCaptions(roomId)
  useFrameSampler(localVideoRef, handsDetected && isSigner, roomId)

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  useEffect(() => {
    if (!roomId) return

    socket.connect()
    socket.emit('join-room', { roomId })

    socket.on('room-update', ({ members }: { members: string[] }) => {
      setMembers(members)
    })

    socket.on('room-full', () => {
      setIsFull(true)
    })

    return () => {
      socket.emit('leave-room', { roomId })
      socket.off('room-update')
      socket.off('room-full')
      socket.disconnect()
    }
  }, [roomId])

  async function copyUrl() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isFull) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Room Full</h1>
        <p className="text-gray-400 text-sm">This room already has 2 participants.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-4xl font-bold tracking-tight">SignProto</h1>

      {error ? (
        <div className="w-full max-w-3xl bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
          {error}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
          <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {localStream && isSigner && (
              <HandOverlay videoRef={localVideoRef} landmarks={landmarks} />
            )}
          </div>
          <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {captionStatus === 'unavailable' && (
              <div className="absolute top-2 right-2 bg-red-900/70 text-red-200 text-xs px-2 py-1 rounded pointer-events-none">
                Captions unavailable
              </div>
            )}
            {caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xl text-center px-4 py-3 pointer-events-none">
                {caption}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="w-full max-w-md bg-gray-800 rounded-xl p-6 flex flex-col gap-4">
        <div>
          <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-1">Room ID</h2>
          <p className="font-mono text-sm text-gray-300 break-all">{roomId}</p>
        </div>

        <div>
          <h2 className="text-xs text-gray-400 uppercase tracking-widest mb-2">
            Participants ({members.length}/2)
          </h2>
          {members.length === 0 ? (
            <p className="text-gray-500 text-sm">Waiting for members...</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {members.map((id) => (
                <li key={id} className="font-mono text-sm text-gray-300 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  {id}
                  {id === socket.id && (
                    <span className="text-xs text-gray-500">(you)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="w-full max-w-md bg-gray-800 rounded-xl p-6 flex flex-col gap-3">
        <h2 className="text-xs text-gray-400 uppercase tracking-widest">Share this room</h2>
        <p className="font-mono text-xs text-gray-400 break-all">{window.location.href}</p>
        <button
          onClick={copyUrl}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors self-start"
        >
          {copied ? 'Copied!' : 'Copy URL'}
        </button>
      </div>
    </div>
  )
}
