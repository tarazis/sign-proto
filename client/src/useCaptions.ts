import { useEffect, useRef, useState } from 'react'
import { socket } from './socket'

export type CaptionStatus = 'available' | 'unavailable'
export type CaptionsState = {
  current: string | null
  status: CaptionStatus
}

const CLEAR_AFTER_MS = 4000

export function useCaptions(roomId: string | undefined): CaptionsState {
  const [current, setCurrent] = useState<string | null>(null)
  const [status, setStatus] = useState<CaptionStatus>('available')

  const clearTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!roomId) return

    function onCaption({ text, timestamp }: { text: string; timestamp: number }) {
      console.log('[caption]', text, '@', new Date(timestamp).toISOString())
      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current)
      }
      setCurrent(text)
      clearTimeoutRef.current = window.setTimeout(() => {
        setCurrent(null)
        clearTimeoutRef.current = null
      }, CLEAR_AFTER_MS)
    }

    function onCaptionStatus({ status, reason }: { status: CaptionStatus; reason?: string }) {
      console.log('[caption-status]', status, reason ?? '')
      setStatus(status)
    }

    socket.on('caption', onCaption)
    socket.on('caption-status', onCaptionStatus)

    return () => {
      if (clearTimeoutRef.current !== null) {
        window.clearTimeout(clearTimeoutRef.current)
        clearTimeoutRef.current = null
      }
      socket.off('caption', onCaption)
      socket.off('caption-status', onCaptionStatus)
      setCurrent(null)
      setStatus('available')
    }
  }, [roomId])

  return { current, status }
}
