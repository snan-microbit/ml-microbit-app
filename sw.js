// sw.js
// Service Worker for PWA - Network First Strategy

const CACHE_NAME = 'tm-microbit-v3.9';
const urlsToCache = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/model-loader.js',
  './js/image-trainer.js',
  './js/audio-trainer.js',
  './js/bluetooth.js',
  './js/predictions.js',
  './js/makecode-embed.js',
  './manifest.json'
];

// Install event - skip waiting to activate immediately
self.addEventListener('install', (event) => {
  console.log('[SW] Installing new version:', CACHE_NAME);
  self.skipWaiting(); // Force activate immediately
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event - clean up old caches and take control
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating new version:', CACHE_NAME);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch event - NETWORK FIRST strategy (better for development)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Network success - update cache and return
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // Network failed - try cache
        return caches.match(event.request);
      })
  );
});