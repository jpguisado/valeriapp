/// <reference lib="webworker" />
/**
 * Hand-written service worker: precaches the build, serves the shell offline,
 * and handles push. No Workbox runtime — the caching rules here fit in a
 * screen, and a baby log has exactly two kinds of request.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

interface PushPayload {
  kind: 'reminder' | 'cancel' | 'test'
  tag: string
  title?: string
  body?: string
  url?: string
  firedAt?: string
  maxLateMinutes?: number
}

const manifest = self.__WB_MANIFEST
const CACHE = `valeriapp-${manifest.map((entry) => entry.revision ?? entry.url).join('').length}`
const PRECACHE_URLS = ['/', ...manifest.map((entry) => entry.url)]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // The API is never cached: stale baby data is worse than no data.
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/')) ?? Response.error()),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone()
            void caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    return
  }

  if (payload.kind === 'cancel') {
    event.waitUntil(
      self.registration
        .getNotifications({ tag: payload.tag })
        .then((notifications) => notifications.forEach((notification) => notification.close())),
    )
    return
  }

  // A reminder that arrives long after it was due is noise, not information.
  if (payload.firedAt && payload.maxLateMinutes) {
    const lateMinutes = (Date.now() - Date.parse(payload.firedAt)) / 60_000
    if (lateMinutes > payload.maxLateMinutes) return
  }

  const originalTime = payload.firedAt
    ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(
        new Date(payload.firedAt),
      )
    : null
  const late = payload.firedAt ? Date.now() - Date.parse(payload.firedAt) > 5 * 60_000 : false

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Valeriapp', {
      body: late && originalTime ? `${payload.body ?? ''} (aviso de las ${originalTime})` : payload.body,
      tag: payload.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: payload.url ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          void client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string })?.type === 'SKIP_WAITING') void self.skipWaiting()
})

export {}
