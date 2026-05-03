import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

export type HandLandmark = { x: number; y: number; z: number }
export type HandTrackingState = {
  landmarks: HandLandmark[][]
  handsDetected: boolean
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export function useHandTracking(
  videoRef: React.RefObject<HTMLVideoElement>
): HandTrackingState {
  const [landmarks, setLandmarks] = useState<HandLandmark[][]>([])
  const [handsDetected, setHandsDetected] = useState(false)
  const [landmarkerReady, setLandmarkerReady] = useState(false)

  const landmarkerRef = useRef<HandLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef<number>(-1)
  const mountedRef = useRef(true)

  // Effect A: one-shot WASM init / teardown
  useEffect(() => {
    mountedRef.current = true

    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      )
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
      })

      if (!mountedRef.current) {
        landmarker.close()
        return
      }

      landmarkerRef.current = landmarker
      setLandmarkerReady(true)
    }

    init().catch((err) => {
      console.error('[useHandTracking] init failed:', err)
    })

    return () => {
      mountedRef.current = false
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [])

  // Effect B: RAF detection loop, gated on stream + landmarker both ready
  const localStream = videoRef.current?.srcObject as MediaStream | null | undefined

  useEffect(() => {
    const video = videoRef.current
    if (!landmarkerReady || !landmarkerRef.current || !video) return

    // Wait until the video has a valid source and is ready to play
    function startLoop() {
      if (!video || video.readyState < 2) {
        video?.addEventListener('canplay', startLoop, { once: true })
        return
      }

      function detect() {
        if (!video || !landmarkerRef.current) return

        if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime
          const result = landmarkerRef.current.detectForVideo(video, performance.now())
          if (result.landmarks.length > 0) {
            setLandmarks(result.landmarks as HandLandmark[][])
            setHandsDetected(true)
          } else {
            setLandmarks([])
            setHandsDetected(false)
          }
        }

        rafRef.current = requestAnimationFrame(detect)
      }

      rafRef.current = requestAnimationFrame(detect)
    }

    startLoop()

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      lastVideoTimeRef.current = -1
      setLandmarks([])
      setHandsDetected(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream, landmarkerReady])

  return { landmarks, handsDetected }
}
