// Service Worker Registration and Management
// Handles service worker lifecycle and cache management

import { useState, useEffect } from 'react';

interface ServiceWorkerConfig {
  enableCaching: boolean;
  enableOfflineSupport: boolean;
  enableBackgroundSync: boolean;
  cacheVersion: string;
}

interface PerformanceMetrics {
  cacheHitRate: number;
  networkRequests: number;
  cacheRequests: number;
  averageResponseTime: number;
  errors: number;
  lastUpdated: number;
}

class ServiceWorkerManager {
  private config: ServiceWorkerConfig;
  private registration: ServiceWorkerRegistration | null = null;
  private performanceMetrics: PerformanceMetrics = {
    cacheHitRate: 0,
    networkRequests: 0,
    cacheRequests: 0,
    averageResponseTime: 0,
    errors: 0,
    lastUpdated: Date.now()
  };

  constructor(config: Partial<ServiceWorkerConfig> = {}) {
    this.config = {
      enableCaching: true,
      enableOfflineSupport: true,
      enableBackgroundSync: true,
      cacheVersion: 'v1',
      ...config
    };
  }

  async register(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported');
      return null;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('Service Worker registered successfully');

      // Handle updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration?.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              this.showUpdateNotification();
            }
          });
        }
      });

      return this.registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }

  async unregister(): Promise<boolean> {
    if (this.registration) {
      return await this.registration.unregister();
    }
    return false;
  }

  async clearCaches(): Promise<void> {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
      console.log('All caches cleared');
    }
  }

  async getCacheStats(): Promise<{ name: string; size: number }[]> {
    if (!('caches' in window)) {
      return [];
    }

    const cacheNames = await caches.keys();
    const stats = await Promise.all(
      cacheNames.map(async (cacheName) => {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        return {
          name: cacheName,
          size: keys.length
        };
      })
    );

    return stats;
  }

  // Performance tracking methods
  private updatePerformanceMetrics(type: 'cache_hit' | 'network_request' | 'error', responseTime?: number): void {
    const now = Date.now();
    
    switch (type) {
      case 'cache_hit':
        this.performanceMetrics.cacheRequests++;
        break;
      case 'network_request':
        this.performanceMetrics.networkRequests++;
        if (responseTime) {
          const totalRequests = this.performanceMetrics.networkRequests + this.performanceMetrics.cacheRequests;
          this.performanceMetrics.averageResponseTime = 
            (this.performanceMetrics.averageResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
        }
        break;
      case 'error':
        this.performanceMetrics.errors++;
        break;
    }

    // Calculate cache hit rate
    const totalRequests = this.performanceMetrics.networkRequests + this.performanceMetrics.cacheRequests;
    this.performanceMetrics.cacheHitRate = totalRequests > 0 
      ? (this.performanceMetrics.cacheRequests / totalRequests) * 100 
      : 0;

    this.performanceMetrics.lastUpdated = now;

    // Log metrics in development
    if (import.meta.env.DEV) {
      console.log('Service Worker Performance:', {
        cacheHitRate: `${this.performanceMetrics.cacheHitRate.toFixed(1)}%`,
        totalRequests: totalRequests,
        averageResponseTime: `${this.performanceMetrics.averageResponseTime.toFixed(0)}ms`,
        errors: this.performanceMetrics.errors
      });
    }
  }

  private resetPerformanceMetrics(): void {
    this.performanceMetrics = {
      cacheHitRate: 0,
      networkRequests: 0,
      cacheRequests: 0,
      averageResponseTime: 0,
      errors: 0,
      lastUpdated: Date.now()
    };
  }

  public getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  public async sendPerformanceMetrics(): Promise<void> {
    if (!import.meta.env.PROD) return;

    try {
      // Send metrics to analytics endpoint if configured
      const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
      if (analyticsEndpoint) {
        await fetch(analyticsEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'service_worker_metrics',
            metrics: this.performanceMetrics,
            timestamp: Date.now(),
            url: window.location.href
          })
        });
      }
    } catch (error) {
      console.error('Failed to send performance metrics:', error);
    }
  }

  async precacheResources(urls: string[]): Promise<void> {
    if (!this.registration || !this.config.enableCaching) {
      return;
    }

    try {
      const cache = await caches.open('animehub-precache');
      await cache.addAll(urls);
      console.log('Resources precached:', urls.length);
    } catch (error) {
      console.error('Precaching failed:', error);
    }
  }

  async cacheAnimeData(animeId: string, data: any): Promise<void> {
    if (!this.config.enableCaching) {
      return;
    }

    try {
      const cache = await caches.open('animehub-api');
      const response = new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
      await cache.put(`/api/anime/${animeId}`, response);
    } catch (error) {
      console.error('Failed to cache anime data:', error);
    }
  }

  async getCachedAnimeData(animeId: string): Promise<any | null> {
    if (!this.config.enableCaching) {
      return null;
    }

    try {
      const cache = await caches.open('animehub-api');
      const response = await cache.match(`/api/anime/${animeId}`);
      
      if (response) {
        return await response.json();
      }
    } catch (error) {
      console.error('Failed to get cached anime data:', error);
    }

    return null;
  }

  private showUpdateNotification(): void {
    // Show notification to user about available update
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('AnimeHub Update Available', {
        body: 'A new version is available. Click to update.',
        icon: '/icon-192x192.png',
        tag: 'animehub-update'
      });
    }
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  async sendBackgroundSync(tag: string, data?: any): Promise<void> {
    if (!this.registration || !this.config.enableBackgroundSync) {
      return;
    }

    try {
      await this.registration.sync.register(tag);
      
      if (data) {
        // Store data for background sync
        localStorage.setItem(`sync-${tag}`, JSON.stringify(data));
      }
    } catch (error) {
      console.error('Background sync registration failed:', error);
    }
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  addOnlineListener(callback: () => void): void {
    window.addEventListener('online', callback);
  }

  addOfflineListener(callback: () => void): void {
    window.addEventListener('offline', callback);
  }
}

// Global service worker manager instance
export const serviceWorkerManager = new ServiceWorkerManager({
  enableCaching: true,
  enableOfflineSupport: true,
  enableBackgroundSync: true,
  cacheVersion: 'v1'
});

// React hook for service worker
export function useServiceWorker() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    // Register service worker
    serviceWorkerManager.register().then(setSwRegistration);

    // Set up online/offline listeners
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    serviceWorkerManager.addOnlineListener(handleOnline);
    serviceWorkerManager.addOfflineListener(handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    isOnline,
    swRegistration,
    clearCaches: serviceWorkerManager.clearCaches.bind(serviceWorkerManager),
    getCacheStats: serviceWorkerManager.getCacheStats.bind(serviceWorkerManager),
    precacheResources: serviceWorkerManager.precacheResources.bind(serviceWorkerManager),
    cacheAnimeData: serviceWorkerManager.cacheAnimeData.bind(serviceWorkerManager),
    getCachedAnimeData: serviceWorkerManager.getCachedAnimeData.bind(serviceWorkerManager),
    getPerformanceMetrics: serviceWorkerManager.getPerformanceMetrics.bind(serviceWorkerManager),
    sendPerformanceMetrics: serviceWorkerManager.sendPerformanceMetrics.bind(serviceWorkerManager)
  };
}

export default serviceWorkerManager;

// Lightweight background prefetch helper using SW postMessage
export function backgroundPrefetch(urls: string[]) {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller && urls?.length) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'BACKGROUND_PREFETCH', payload: { urls } });
    } catch {}
  }
}