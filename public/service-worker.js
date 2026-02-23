// Simple service worker for PWA
const CACHE_NAME = 'pf-crm-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html'
      ])
    })
  )
})

self.addEventListener('fetch', (event) => {
  // Let Supabase and API requests go through without caching
  if (event.request.url.includes('supabase.co') ||
      event.request.url.includes('/api/')) {
    return
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request)
    })
  )
})
