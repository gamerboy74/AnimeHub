// Service Worker for AnimeHub
// Implements caching strategies for better performance and offline support

const CACHE_NAME = 'animehub-v3';
const STATIC_CACHE = 'animehub-static-v3';
const DYNAMIC_CACHE = 'animehub-dynamic-v3';
const API_CACHE = 'animehub-api-v3';

// Cache strategies
const CACHE_STRATEGIES = {
  // Static assets - cache first
  static: ['/static/', '/assets/', '.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico'],
  // API responses - stale while revalidate
  api: ['/api/', '/supabase/'],
  // Images - cache first with fallback
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  // Videos - network first
  videos: ['.mp4', '.webm', '.m3u8']
};

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll([
        '/',
        '/anime',
        '/player',
        '/favorites',
        '/watchlist',
        '/profile',
        '/manifest.json'
      ]);
    })
  );
  
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && 
              cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE && 
              cacheName !== API_CACHE) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  
  self.clients.claim();
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Bypass streaming/video segment and HLS manifests
  const lowerPath = url.pathname.toLowerCase();
  if (lowerPath.endsWith('.m3u8') || lowerPath.endsWith('.mpd') || lowerPath.endsWith('.ts')) {
    return;
  }
  
  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Skip external domains - let browser handle CORS directly
  // Only cache same-origin and known-safe domains
  if (isExternalDomain(url)) {
    return; // Let browser handle external requests without Service Worker
  }
  
  event.respondWith(handleRequest(request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  
  try {
    // Determine cache strategy based on request type
    if (isStaticAsset(request)) {
      return await cacheFirst(request, STATIC_CACHE);
    } else if (isApiRequest(request)) {
      return await staleWhileRevalidate(request, API_CACHE);
    } else if (isImageRequest(request)) {
      return await cacheFirstWithFallback(request, DYNAMIC_CACHE);
    } else if (isVideoRequest(request)) {
      return await networkFirst(request, DYNAMIC_CACHE);
    } else {
      return await networkFirst(request, DYNAMIC_CACHE);
    }
  } catch (error) {
    console.error('Service Worker: Error handling request:', error);
    return await getOfflineFallback(request);
  }
}

// Cache First Strategy - for static assets
async function cacheFirst(request, cacheName) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('Cache first failed:', error);
    throw error;
  }
}

// Stale While Revalidate Strategy - for API requests
// Cached API responses older than 5 minutes are treated as expired
const API_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Check if cached response is too old
  let usableCached = cachedResponse;
  if (cachedResponse) {
    const cachedDate = cachedResponse.headers.get('date');
    if (cachedDate && (Date.now() - new Date(cachedDate).getTime()) > API_CACHE_MAX_AGE) {
      usableCached = null; // Too old, don't serve stale
    }
  }
  
  // Return cached response immediately if available and fresh enough
  const fetchPromise = fetch(request).then(async (networkResponse) => {
    if (networkResponse.ok) {
      // Clone response immediately before it's consumed
      const clonedResponse = networkResponse.clone();
      cache.put(request, clonedResponse).catch((error) => {
        console.error('Cache put failed:', error);
      });
    }
    return networkResponse;
  }).catch((error) => {
    console.error('Network request failed:', error);
    return cachedResponse; // Fall back to any cached version when offline
  });
  
  return usableCached || await fetchPromise;
}

// Network First Strategy - for dynamic content
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    
    // Only cache if it's not a partial response (206)
    if (networkResponse.ok && networkResponse.status !== 206) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// Cache First with Fallback - for images
async function cacheFirstWithFallback(request, cacheName) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Return a placeholder image or default image
    return new Response('', {
      status: 404,
      statusText: 'Image not found'
    });
  }
}

// Helper functions to determine request type
function isExternalDomain(url) {
  // Get current origin from self.location or registration scope
  const currentOrigin = self.location.origin;
  const requestOrigin = url.origin;
  
  // Allow same-origin requests
  if (currentOrigin === requestOrigin) {
    return false;
  }
  
  // List of external domains that should bypass Service Worker caching
  // These domains either don't allow CORS or should be handled by browser directly
  const externalDomains = [
    'anilist.co',
    's4.anilist.co',
    'readdy.ai',
    'youtube.com',
    'youtu.be',
    'img.youtube.com',
    'i.ytimg.com',
    'vimeo.com',
    'player.vimeo.com'
  ];
  
  return externalDomains.some(domain => requestOrigin.includes(domain));
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return CACHE_STRATEGIES.static.some(pattern => 
    url.pathname.includes(pattern) || url.pathname.endsWith(pattern)
  );
}

function isApiRequest(request) {
  const url = new URL(request.url);
  return CACHE_STRATEGIES.api.some(pattern => 
    url.pathname.startsWith(pattern)
  );
}

function isImageRequest(request) {
  const url = new URL(request.url);
  return CACHE_STRATEGIES.images.some(ext => 
    url.pathname.toLowerCase().endsWith(ext)
  );
}

function isVideoRequest(request) {
  const url = new URL(request.url);
  return CACHE_STRATEGIES.videos.some(ext => 
    url.pathname.toLowerCase().endsWith(ext)
  );
}

// Offline fallback
async function getOfflineFallback(request) {
  const url = new URL(request.url);
  
  // Return offline page for navigation requests
  if (request.mode === 'navigate') {
    const offlinePage = await caches.match('/offline.html');
    if (offlinePage) {
      return offlinePage;
    }
  }
  
  // Return cached response if available
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  // Return a generic offline response
  return new Response('Offline - Content not available', {
    status: 503,
    statusText: 'Service Unavailable'
  });
}

// Background sync for failed requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

async function doBackgroundSync() {
  // Retry failed requests when back online
  console.log('Service Worker: Background sync triggered');
  
  // You can implement retry logic here for failed API calls
  // This is useful for saving user progress, favorites, etc.
}

// Push notifications (if needed)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      tag: data.tag || 'animehub-notification',
      data: data.data
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Background prefetch support via postMessage
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (type === 'BACKGROUND_PREFETCH' && Array.isArray(payload?.urls)) {
    payload.urls.forEach((u) => {
      try {
        const url = new URL(u, self.location.href);
        
        // Skip external domains that might have CORS issues
        if (isExternalDomain(url)) {
          return; // Skip external domains silently
        }
        
        fetch(u, { 
          mode: 'cors',
          credentials: 'omit' // Don't send credentials for prefetch
        }).then((resp) => {
          if (!resp || !resp.ok) return;
          const contentType = resp.headers.get('content-type') || '';
          const cacheName = contentType.includes('application/json') ? API_CACHE : DYNAMIC_CACHE;
          caches.open(cacheName).then((cache) => cache.put(u, resp.clone()));
        }).catch((err) => {
          // Silently ignore CORS/network errors for background prefetch
          // These are non-critical prefetch operations
        });
      } catch (err) {
        // Silently ignore invalid URLs or other errors
      }
    });
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});

console.log('Service Worker: Loaded successfully');
