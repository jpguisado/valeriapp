import { useEffect, useRef, useState } from 'react'
import { subscribeToToasts, dismissToast, TOAST_DURATION_MS, type Toast } from '@/lib/toast'
import { X } from './icons'

/** How far up you have to drag before the card lets go. */
const SWIPE_THRESHOLD = 40

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToToasts(setToasts), [])

  if (toasts.length === 0) return null

  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((entry) => (
        <ToastCard key={entry.id} toast={entry} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: Toast }) {
  const [offset, setOffset] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const startY = useRef<number | null>(null)
  const timer = useRef<number | null>(null)
  const isError = toast.variant === 'error'

  /** An error is the one thing that must not vanish before you read it. */
  useEffect(() => {
    if (isError) return
    startTimer()
    return stopTimer
  }, [isError])

  function startTimer(): void {
    stopTimer()
    timer.current = window.setTimeout(() => leave(), TOAST_DURATION_MS)
  }

  function stopTimer(): void {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  function leave(): void {
    setLeaving(true)
    window.setTimeout(() => dismissToast(toast.id), 180)
  }

  return (
    <div
      className={`toast${isError ? ' error' : ''}${leaving ? ' leaving' : ''}`}
      role={isError ? 'alert' : undefined}
      style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
      onPointerDown={(event) => {
        startY.current = event.clientY
        stopTimer()
      }}
      onPointerMove={(event) => {
        if (startY.current === null) return
        // Only upwards: dragging down would fight the page scroll.
        setOffset(Math.min(0, event.clientY - startY.current))
      }}
      onPointerUp={() => {
        const dismissed = offset <= -SWIPE_THRESHOLD
        startY.current = null
        setOffset(0)
        if (dismissed) leave()
        else if (!isError) startTimer()
      }}
      onPointerCancel={() => {
        startY.current = null
        setOffset(0)
        if (!isError) startTimer()
      }}
    >
      <span className="grow">{toast.text}</span>
      {isError && (
        <button
          className="toast-close"
          onClick={() => dismissToast(toast.id)}
          aria-label="Cerrar aviso"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
