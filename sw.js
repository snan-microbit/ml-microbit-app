// sw.js
// Service Worker for PWA - Network First Strategy

const CACHE_NAME = 'tm-microbit-v6.4';
const urlsToCache = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.json',
  // App scripts
  './js/app.js',
  './js/project-store.js',
  './js/trainer-config.js',
  './js/webcam.js',
  './js/image-trainer.js',
  './js/audio-trainer.js',
  './js/pose-trainer.js',
  './js/bluetooth.js',
  './js/makecode-embed.js',
  // Vendor: TF.js
  './vendor/tfjs/tfjs-4.22.0.min.js',
  // Vendor: Speech Commands
  './vendor/speech-commands/speech-commands-0.5.4.min.js',
  // Vendor: MediaPipe ESM + WASM
  './vendor/mediapipe/tasks-vision-0.10.14.mjs',
  './vendor/mediapipe/wasm-0.10.14/vision_wasm_internal.js',
  './vendor/mediapipe/wasm-0.10.14/vision_wasm_internal.wasm',
  './vendor/mediapipe/wasm-0.10.14/vision_wasm_nosimd_internal.js',
  './vendor/mediapipe/wasm-0.10.14/vision_wasm_nosimd_internal.wasm',
  // Vendor: ML models
  './vendor/mediapipe/models/pose_landmarker_lite-v1.task',
  './vendor/mobilenet/v1-0.25-224/model.json',
  './vendor/mobilenet/v1-0.25-224/group1-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group2-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group3-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group4-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group5-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group6-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group7-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group8-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group9-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group10-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group11-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group12-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group13-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group14-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group15-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group16-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group17-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group18-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group19-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group20-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group21-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group22-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group23-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group24-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group25-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group26-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group27-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group28-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group29-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group30-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group31-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group32-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group33-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group34-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group35-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group36-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group37-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group38-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group39-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group40-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group41-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group42-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group43-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group44-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group45-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group46-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group47-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group48-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group49-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group50-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group51-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group52-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group53-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group54-shard1of1',
  './vendor/mobilenet/v1-0.25-224/group55-shard1of1',
  // Vendor: fonts
  './vendor/fonts/nunito-cyrillic-ext.woff2',
  './vendor/fonts/nunito-cyrillic.woff2',
  './vendor/fonts/nunito-vietnamese.woff2',
  './vendor/fonts/nunito-latin-ext.woff2',
  './vendor/fonts/nunito-latin.woff2'
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
