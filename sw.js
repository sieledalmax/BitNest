// Service worker with no caching for API calls
const CACHE_NAME = 'bitnest-static-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles/main.css',
  '/scripts/app.js',
  '/manifest.json',
  '/icons/icon.192.png',
  '/icons/icon.512.png'
];

// Install - Cache only static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

// Fetch - Serve static assets from cache, bypass API calls
self.addEventListener('fetch', (event) => {
  // Bypass caching for any API requests or external resources
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('coingecko') ||
      !event.request.url.startsWith('http')) {
    return fetch(event.request);
  }
  
  // For static assets, try cache first
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});