// Request Cache Utility for AnimeHub
// Implements request deduplication and caching to prevent duplicate API calls

interface CacheEntry {
  data: any;
  timestamp: number;
  promise?: Promise<any>;
}

interface RequestOptions {
  ttl?: number; // Time to live in milliseconds
  dedupe?: boolean; // Whether to deduplicate identical requests
  jitterMs?: number; // Optional jitter to avoid thundering herd
}

class RequestCache {
  private cache = new Map<string, CacheEntry>();
  private pendingRequests = new Map<string, Promise<any>>();
  private defaultTTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Get cached data or execute request
   */
  async get<T>(
    key: string, 
    requestFn: () => Promise<T>, 
    options: RequestOptions = {}
  ): Promise<T> {
    const { ttl = this.defaultTTL, dedupe = true, jitterMs = 0 } = options;
    const now = Date.now();

    // Check if we have valid cached data
    const cached = this.cache.get(key);
    if (cached && (now - cached.timestamp) < ttl) {
      return cached.data;
    }

    // Check if request is already pending (deduplication)
    if (dedupe && this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key)!;
    }

    // Execute request and cache result
    const requestPromise = requestFn().then(async data => {
      if (jitterMs > 0) {
        try { await new Promise(r => setTimeout(r, Math.random() * jitterMs)); } catch {}
      }
      this.cache.set(key, { data, timestamp: now });
      this.pendingRequests.delete(key);
      return data;
    }).catch(error => {
      this.pendingRequests.delete(key);
      throw error;
    });

    if (dedupe) {
      this.pendingRequests.set(key, requestPromise);
    }

    return requestPromise;
  }

  /**
   * Set data in cache manually
   */
  set(key: string, data: any, ttl?: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Get data from cache without executing request
   */
  getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.defaultTTL) {
      return cached.data;
    }
    return null;
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
    this.pendingRequests.delete(key);
  }

  /**
   * Invalidate cache entries matching pattern
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
    for (const key of this.pendingRequests.keys()) {
      if (regex.test(key)) {
        this.pendingRequests.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
      memoryUsage: this.estimateMemoryUsage()
    };
  }

  /**
   * Estimate memory usage of cache
   */
  private estimateMemoryUsage(): number {
    let totalSize = 0;
    for (const [key, entry] of this.cache.entries()) {
      totalSize += key.length * 2; // Rough estimate for string
      totalSize += JSON.stringify(entry.data).length * 2;
      totalSize += 16; // timestamp and other metadata
    }
    return totalSize;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if ((now - entry.timestamp) >= this.defaultTTL) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance
export const requestCache = new RequestCache();

// Utility functions for common cache patterns

/**
 * Cache anime list requests
 */
export const cacheAnimeList = async <T>(
  params: { page: number; limit: number; filters?: any },
  requestFn: () => Promise<T>
): Promise<T> => {
  const key = `anime_list_${JSON.stringify(params)}`;
  return requestCache.get(key, requestFn, { ttl: 2 * 60 * 1000 }); // 2 minutes
};

/**
 * Cache anime details requests
 */
export const cacheAnimeDetails = async <T>(
  animeId: string,
  requestFn: () => Promise<T>
): Promise<T> => {
  const key = `anime_details_${animeId}`;
  return requestCache.get(key, requestFn, { ttl: 10 * 60 * 1000 }); // 10 minutes
};

/**
 * Cache user progress requests
 */
export const cacheUserProgress = async <T>(
  userId: string,
  requestFn: () => Promise<T>
): Promise<T> => {
  const key = `user_progress_${userId}`;
  return requestCache.get(key, requestFn, { ttl: 1 * 60 * 1000 }); // 1 minute
};

/**
 * Cache search results
 */
export const cacheSearchResults = async <T>(
  query: string,
  filters: any,
  requestFn: () => Promise<T>
): Promise<T> => {
  const key = `search_${query}_${JSON.stringify(filters)}`;
  return requestCache.get(key, requestFn, { ttl: 3 * 60 * 1000 }); // 3 minutes
};

/**
 * Invalidate anime-related cache when anime is updated
 */
export const invalidateAnimeCache = (animeId?: string) => {
  if (animeId) {
    requestCache.invalidatePattern(`anime_details_${animeId}`);
    requestCache.invalidatePattern(`anime_list_.*`);
  } else {
    requestCache.invalidatePattern('anime_.*');
  }
};

/**
 * Invalidate user-related cache when user data changes
 */
export const invalidateUserCache = (userId: string) => {
  requestCache.invalidatePattern(`user_.*${userId}.*`);
};

// Auto-cleanup every 5 minutes
setInterval(() => {
  requestCache.cleanup();
}, 5 * 60 * 1000);

export default requestCache;
