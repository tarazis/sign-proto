import { useEffect, useRef } from 'react'
import type { HandLandmark } from './useHandTracking'

// MediaPipe hand landmark connections (pairs of indices forming bones)
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [5, 9], [9, 10], [10, 11], [11, 12],  // middle
  [9, 13], [13, 14], [14, 15], [15, 16],// ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                               // palm
]

interface HandOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement>
  landmarks: HandLandmark[][]
}

export function HandOverlay({ videoRef, landmarks }: HandOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Sync canvas intrinsic dimensions to video's decoded frame size
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    function syncSize() {
      if (video && canvas && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
    }

    syncSize()
    video.addEventListener('loadedmetadata', syncSize)
    window.addEventListener('resize', syncSize)

    return () => {
      video.removeEventListener('loadedmetadata', syncSize)
      window.removeEventListener('resize', syncSize)
    }
  }, [videoRef])

  // Redraw landmarks whenever they change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const hand of landmarks) {
      // Draw connections
      ctx.strokeStyle = '#00ff88'
      ctx.lineWidth = 2
      for (const [a, b] of HAND_CONNECTIONS) {
        const p1 = hand[a]
        const p2 = hand[b]
        if (!p1 || !p2) continue
        ctx.beginPath()
        ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height)
        ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height)
        ctx.stroke()
      }

      // Draw landmark dots
      for (const point of hand) {
        ctx.beginPath()
        ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.strokeStyle = '#00ff88'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
  }, [landmarks])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  )
}
