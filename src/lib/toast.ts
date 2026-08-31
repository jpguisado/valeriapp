/**
 * A three-slot toast queue, deliberately hand-rolled.
 *
 * Lives outside React so any layer can announce something — including the
 * timer helpers, which are plain functions. The behaviour is shadcn's: newest
 * on top, the stack capped, timers that freeze while a finger rests on the
 * card. The looks are ours, so it inherits the palette for free.
 */
export type ToastVariant = 'info' | 'error'

export interface Toast {
  id: string
  text: string
  variant: ToastVariant
  createdAt: number
}

/** Beyond three, the stack stops being a confirmation and becomes a wall. */
const MAX_VISIBLE = 3
export const TOAST_DURATION_MS = 4000

let toasts: Toast[] = []
const listeners = new Set<(list: Toast[]) => void>()

function emit(): void {
  for (const listener of listeners) listener(toasts)
}

export function subscribeToToasts(listener: (list: Toast[]) => void): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => listeners.delete(listener)
}

export function toast(text: string, variant: ToastVariant = 'info'): string {
  const entry: Toast = {
    id: crypto.randomUUID(),
    text,
    variant,
    createdAt: Date.now(),
  }
  // Newest first; the oldest falls off the bottom of the stack.
  toasts = [entry, ...toasts].slice(0, MAX_VISIBLE)
  emit()
  return entry.id
}

export function toastError(text: string): string {
  return toast(text, 'error')
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((entry) => entry.id !== id)
  emit()
}

export function clearToasts(): void {
  toasts = []
  emit()
}
