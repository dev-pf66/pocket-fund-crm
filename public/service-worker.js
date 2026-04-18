// Kill-switch service worker: unregisters itself and clears all caches.
// Any browser that still has an old SW will fetch this file, run cleanup,
// and serve future requests directly from the network.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
    const clients = await self.clients.matchAll({ type: 'window' })
    for (const client of clients) {
      client.navigate(client.url)
    }
    await self.registration.unregister()
  })())
})
