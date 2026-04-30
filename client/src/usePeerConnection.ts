import { useEffect, useRef, useState } from 'react'
import type { Instance as PeerInstance, SignalData } from 'simple-peer'
// Use the pre-built browser bundle to avoid Vite externalizing Node's stream/events,
// which causes "Cannot read properties of undefined (reading 'call')" in simple-peer's CJS build
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import Peer from 'simple-peer/simplepeer.min.js'
import { socket, SERVER_URL } from './socket'

let iceServersCache: RTCIceServer[] | null = null
let iceServersPromise: Promise<RTCIceServer[]> | null = null

const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

function getIceServers(): Promise<RTCIceServer[]> {
  if (iceServersCache) return Promise.resolve(iceServersCache)
  if (iceServersPromise) return iceServersPromise

  iceServersPromise = fetch(`${SERVER_URL}/turn-credentials`)
    .then((r) => r.json())
    .then((data: { iceServers: RTCIceServer[] }) => {
      iceServersCache = data.iceServers
      return iceServersCache
    })
    .catch((err) => {
      console.warn('[peer] failed to fetch /turn-credentials, falling back to STUN:', err)
      iceServersCache = FALLBACK_ICE
      return FALLBACK_ICE
    })

  return iceServersPromise
}

export type PeerState = {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  error: string | null
}

export function usePeerConnection(roomId: string | undefined): PeerState {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const peerRef = useRef<PeerInstance | null>(null)
  const remoteIdRef = useRef<string | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const iceServersRef = useRef<RTCIceServer[] | null>(null)

  // Buffers for events that arrive before getUserMedia or ICE servers resolve
  const pendingPeerJoinedRef = useRef<string | null>(null)
  const pendingSignalsRef = useRef<Array<{ from: string; signal: unknown }>>([])

  useEffect(() => {
    console.log('[peer] effect mounted, roomId:', roomId, 'socket:', socket.id)

    if (!roomId) return

    function teardownPeer() {
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }
      remoteIdRef.current = null
      setRemoteStream(null)
    }

    function flushPending() {
      if (!localStreamRef.current || !iceServersRef.current) return
      const stream = localStreamRef.current

      if (pendingPeerJoinedRef.current) {
        createPeer(true, pendingPeerJoinedRef.current, stream)
        pendingPeerJoinedRef.current = null
      }

      const pending = pendingSignalsRef.current.splice(0)
      for (const { from, signal } of pending) {
        processSignal(from, signal)
      }
    }

    function createPeer(initiator: boolean, remoteId: string, stream: MediaStream) {
      console.log('[peer] createPeer called — initiator:', initiator, 'remoteId:', remoteId, 'already exists:', !!peerRef.current)
      if (peerRef.current) return

      remoteIdRef.current = remoteId
      const peer = new Peer({ initiator, trickle: true, stream, config: { iceServers: iceServersRef.current! } })
      peerRef.current = peer

      peer.on('signal', (sig: SignalData) => {
        console.log('[peer] signal outbound → to:', remoteId, '| type:', (sig as any).type ?? 'candidate')
        socket.emit('signal', { to: remoteId, signal: sig })
      })

      peer.on('stream', (s: MediaStream) => {
        console.log('[peer] remote stream received')
        setRemoteStream(s)
      })

      peer.on('connect', () => {
        console.log('[peer] data channel open')
      })

      peer.on('close', () => {
        console.log('[peer] closed')
        teardownPeer()
      })

      peer.on('error', (err: Error) => {
        console.error('[peer] error:', err)
        teardownPeer()
        setError('Connection failed. Please refresh.')
      })
    }

    function processSignal(from: string, signal: unknown) {
      if (!peerRef.current) {
        const stream = localStreamRef.current!
        createPeer(false, from, stream)
      }
      if (peerRef.current && remoteIdRef.current === from) {
        peerRef.current.signal(signal as SignalData)
      }
    }

    // Register all socket listeners immediately, before getUserMedia
    function onPeerJoined({ socketId }: { socketId: string }) {
      console.log('[peer] peer-joined fired — socketId:', socketId, '| stream ready:', !!localStreamRef.current, '| ice ready:', !!iceServersRef.current)
      if (!localStreamRef.current || !iceServersRef.current) {
        // Buffer — will flush once both stream and ICE servers are ready
        pendingPeerJoinedRef.current = socketId
        return
      }
      createPeer(true, socketId, localStreamRef.current)
    }

    function onPeerLeft({ socketId }: { socketId: string }) {
      console.log('[peer] peer-left:', socketId)
      if (remoteIdRef.current === socketId) {
        teardownPeer()
      }
      // Discard any buffered state for this peer
      if (pendingPeerJoinedRef.current === socketId) {
        pendingPeerJoinedRef.current = null
      }
    }

    function onSignal({ from, signal }: { from: string; signal: unknown }) {
      console.log('[peer] signal inbound from:', from, '| stream ready:', !!localStreamRef.current, '| ice ready:', !!iceServersRef.current, '| peerRef exists:', !!peerRef.current)
      if (!localStreamRef.current || !iceServersRef.current) {
        // Buffer — will flush once both stream and ICE servers are ready
        pendingSignalsRef.current.push({ from, signal })
        return
      }
      processSignal(from, signal)
    }

    socket.on('peer-joined', onPeerJoined)
    socket.on('peer-left', onPeerLeft)
    socket.on('signal', onSignal)

    getIceServers().then((servers) => {
      iceServersRef.current = servers
      flushPending()
    })

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        console.log('[peer] getUserMedia resolved | peerRef already exists:', !!peerRef.current, '| remoteId:', remoteIdRef.current, '| pendingPeerJoined:', pendingPeerJoinedRef.current, '| pendingSignals:', pendingSignalsRef.current.length)
        localStreamRef.current = stream
        setLocalStream(stream)
        flushPending()
      })
      .catch((err) => {
        console.error('[peer] getUserMedia failed:', err)
        setError('Camera/mic access denied. Refresh and allow access to continue.')
      })

    return () => {
      console.log('[peer] effect cleanup, roomId:', roomId)

      // 1. Destroy peer first
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }
      remoteIdRef.current = null
      iceServersRef.current = null
      pendingPeerJoinedRef.current = null
      pendingSignalsRef.current = []
      setRemoteStream(null)

      // 2. Remove socket listeners
      socket.off('peer-joined', onPeerJoined)
      socket.off('peer-left', onPeerLeft)
      socket.off('signal', onSignal)

      // 3. Stop local tracks last
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      setLocalStream(null)
      setError(null)
    }
  }, [roomId])

  return { localStream, remoteStream, error }
}
