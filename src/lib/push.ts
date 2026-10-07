import { api } from './api'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

/**
 * `serviceWorker.ready` never settles if the worker failed to install, which
 * left the button looking dead. Fail loudly instead.
 */
async function swRegistration(): Promise<ServiceWorkerRegistration> {
  let timer = 0
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
      () => reject(new Error('el service worker no está activo; cierra la app y vuelve a abrirla')),
      10_000,
    )
  })
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout])
  } finally {
    window.clearTimeout(timer)
  }
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** True on iOS unless the PWA was added to the home screen: push needs that. */
export function requiresInstall(): boolean {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  return isIos && !standalone
}

function sameKey(subscription: PushSubscription, vapidPublicKey: string): boolean {
  const current = subscription.options.applicationServerKey
  if (!current) return true
  const expected = urlBase64ToUint8Array(vapidPublicKey)
  const actual = new Uint8Array(current)
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i])
}

/**
 * Permission alone says nothing: Safari revokes subscriptions and the server
 * drops the ones the push service rejects, while permission stays "granted".
 */
export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const registration = await swRegistration()
  return (await registration.pushManager.getSubscription()) !== null
}

/** Re-sends this device's subscription so the server has it even after it dropped it. */
export async function resyncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return
  const registration = await swRegistration()
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) await api.post('/api/push/subscribe', subscription.toJSON())
}

export async function enablePush(vapidPublicKey: string): Promise<'ok' | 'denied' | 'unsupported'> {
  if (!pushSupported() || !vapidPublicKey) return 'unsupported'
  const result = await Notification.requestPermission()
  if (result !== 'granted') return 'denied'

  const registration = await swRegistration()
  let existing = await registration.pushManager.getSubscription()
  // Made with an older VAPID key: the server can no longer sign for it.
  if (existing && !sameKey(existing, vapidPublicKey)) {
    await existing.unsubscribe()
    existing = null
  }
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }))

  await api.post('/api/push/subscribe', subscription.toJSON())
  return 'ok'
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return
  const registration = await swRegistration()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {})
  await subscription.unsubscribe()
}
