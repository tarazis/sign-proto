import { useEffect, useRef } from 'react'
import { socket } from './socket'

const HYSTERESIS_MS = 500
const JPEG_QUALITY = 0.7

export function useFrameSampler(
  videoRef: React.RefObject<HTMLVideoElement>,
  handsDetected: boolean,
  roomId: string | undefined,
  intervalMs: number = 500,
): void {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const effectiveRef = useRef<boolean>(false)
  const hysteresisTimeoutRef = useRef<number | null>(null)

  // Effect A: owns the interval. Runs while a roomId is set; ticks gate on
  // effectiveRef + readiness. Restarts only when roomId/intervalMs change.
  useEffect(() => {
    if (!roomId) return

    function captureAndEmit() {
      if (!effectiveRef.current) return
      const video = videoRef.current
      if (!video) return
      if (!socket.connected) return
      if (video.readyState < 2) return
      if (!video.videoWidth || !video.videoHeight) return

      try {
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas')
        }
        const canvas = canvasRef.current
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        const frameBase64 = dataUrl.split(',')[1]
        if (!frameBase64) return
        socket.emit('video-frame', { roomId, frameBase64 })
      } catch (err) {
        console.warn('[frame-sampler] capture failed:', err)
      }
    }

    const intervalId = window.setInterval(captureAndEmit, intervalMs)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [videoRef, roomId, intervalMs])

  // Effect B: debounce handsDetected → effectiveRef with hysteresis on stop.
  // Never restarts the interval; only flips the gate.
  useEffect(() => {
    if (handsDetected) {
      if (hysteresisTimeoutRef.current !== null) {
        window.clearTimeout(hysteresisTimeoutRef.current)
        hysteresisTimeoutRef.current = null
      }
      effectiveRef.current = true
      return
    }

    if (effectiveRef.current && hysteresisTimeoutRef.current === null) {
      hysteresisTimeoutRef.current = window.setTimeout(() => {
        effectiveRef.current = false
        hysteresisTimeoutRef.current = null
      }, HYSTERESIS_MS)
    }
  }, [handsDetected])

  // Effect C: unmount cleanup for hysteresis timeout + effective state.
  useEffect(() => {
    return () => {
      if (hysteresisTimeoutRef.current !== null) {
        window.clearTimeout(hysteresisTimeoutRef.current)
        hysteresisTimeoutRef.current = null
      }
      effectiveRef.current = false
    }
  }, [])
}
