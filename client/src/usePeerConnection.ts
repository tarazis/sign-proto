import { useEffect, useRef, useState } from 'react'
import Peer from 'simple-peer'
import { socket } from './socket'

export type PeerState = {
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  error: string | null
}

export function usePeerConnection(roomId: string | undefined): PeerState {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const peerRef = useRef<Peer.Instance | null>(null)
  const remoteIdRef = useRef<string | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!roomId) return

    function teardownPeer() {
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }
      remoteIdRef.current = null
      setRemoteStream(null)
    }

    function createPeer(initiator: boolean, remoteId: string, stream: MediaStream) {
      if (peerRef.current) return // guard against double-construction

      remoteIdRef.current = remoteId
      const peer = new Peer({ initiator, trickle: true, stream })
      peerRef.current = peer

      peer.on('signal', (sig) => {
        console.log('[peer] signal outbound, initiator:', initiator)
        socket.emit('signal', { to: remoteId, signal: sig })
      })

      peer.on('stream', (s) => {
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

      peer.on('error', (err) => {
        console.error('[peer] error:', err)
        teardownPeer()
        setError('Connection failed. Please refresh.')
      })
    }

    // Register all socket listeners immediately, before getUserMedia
    function onPeerJoined({ socketId }: { socketId: string }) {
      console.log('[peer] peer-joined, we are initiator for:', socketId)
      const stream = localStreamRef.current
      if (!stream) return
      createPeer(true, socketId, stream)
    }

    function onPeerLeft({ socketId }: { socketId: string }) {
      console.log('[peer] peer-left:', socketId)
      if (remoteIdRef.current === socketId) {
        teardownPeer()
      }
    }

    function onSignal({ from, signal }: { from: string; signal: unknown }) {
      console.log('[peer] signal inbound from:', from)
      const stream = localStreamRef.current
      if (!stream) return

      if (!peerRef.current) {
        // We are the non-initiator — create peer and signal immediately
        createPeer(false, from, stream)
      }

      if (peerRef.current && remoteIdRef.current === from) {
        peerRef.current.signal(signal as Peer.SignalData)
      }
    }

    socket.on('peer-joined', onPeerJoined)
    socket.on('peer-left', onPeerLeft)
    socket.on('signal', onSignal)

    // Acquire local media
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        console.log('[peer] local stream acquired')
        localStreamRef.current = stream
        setLocalStream(stream)
      })
      .catch((err) => {
        console.error('[peer] getUserMedia failed:', err)
        setError('Camera/mic access denied. Refresh and allow access to continue.')
      })

    return () => {
      // 1. Destroy peer first
      if (peerRef.current) {
        peerRef.current.destroy()
        peerRef.current = null
      }
      remoteIdRef.current = null
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
