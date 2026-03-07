// Shared Cache Hook for AnimeHub
// Consolidates caching logic across different hooks

import { useState, useEffect, useCallback, useRef } from 'react';
import { requestCache } from '../../utils/cache/request';

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  dedupe?: boolean; // Whether to deduplicate identical requests
  staleWhileRevalidate?: boolean; // Return stale data while fetching fresh data
}

interface CacheState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
}

export function useCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  options: CacheOptions = {}
) {
  const {
    ttl = 5 * 60 * 1000, // 5 minutes default
    dedupe = true,
    staleWhileRevalidate = false
  } = options;

  const [state, setState] = useState<CacheState<T>>({
    data: null,
    loading: false,
    error: null,
    lastUpdated: null,
    isStale: false
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (forceRefresh = false) => {
    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const result = await requestCache.get(
        key,
        async () => {
          const data = await fetchFn();
          return data;
        },
        { ttl, dedupe }
      );

      if (!abortControllerRef.current.signal.aborted) {
        setState(prev => ({
          ...prev,
          data: result,
          loading: false,
          lastUpdated: Date.now(),
          isStale: false
        }));
      }
    } catch (error) {
      if (!abortControllerRef.current.signal.aborted) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }));
      }
    }
  }, [key, fetchFn, ttl, dedupe]);

  const refresh = useCallback(() => {
    requestCache.invalidate(key);
    fetchData(true);
  }, [key, fetchData]);

  const clear = useCallback(() => {
    requestCache.invalidate(key);
    setState({
      data: null,
      loading: false,
      error: null,
      lastUpdated: null,
      isStale: false
    });
  }, [key]);

  // Check if data is stale
  const checkStaleness = useCallback(() => {
    if (state.lastUpdated && Date.now() - state.lastUpdated > ttl) {
      setState(prev => ({ ...prev, isStale: true }));
      
      if (staleWhileRevalidate) {
        fetchData(true);
      }
    }
  }, [state.lastUpdated, ttl, staleWhileRevalidate, fetchData]);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set up staleness checking
  useEffect(() => {
    if (state.lastUpdated) {
      const interval = setInterval(checkStaleness, 60000); // Check every minute
      return () => clearInterval(interval);
    }
  }, [state.lastUpdated, checkStaleness]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    ...state,
    refresh,
    clear,
    refetch: fetchData
  };
}

// Specialized hooks for common use cases

export function useAnimeCache(animeId: string, fetchFn: () => Promise<any>) {
  return useCache(`anime_${animeId}`, fetchFn, {
    ttl: 10 * 60 * 1000, // 10 minutes for anime details
    staleWhileRevalidate: true
  });
}

export function useAnimeListCache(
  params: { page: number; limit: number; filters?: any },
  fetchFn: () => Promise<any>
) {
  const key = `anime_list_${JSON.stringify(params)}`;
  return useCache(key, fetchFn, {
    ttl: 2 * 60 * 1000, // 2 minutes for anime lists
    staleWhileRevalidate: true
  });
}

export function useUserDataCache(userId: string, fetchFn: () => Promise<any>) {
  return useCache(`user_${userId}`, fetchFn, {
    ttl: 1 * 60 * 1000, // 1 minute for user data
    staleWhileRevalidate: true
  });
}

export function useSearchCache(query: string, fetchFn: () => Promise<any>) {
  const key = `search_${query}`;
  return useCache(key, fetchFn, {
    ttl: 3 * 60 * 1000, // 3 minutes for search results
    staleWhileRevalidate: true
  });
}

// Cache management utilities
export const useCacheManager = () => {
  const clearAllCache = useCallback(() => {
    requestCache.clear();
  }, []);

  const clearPattern = useCallback((pattern: string) => {
    requestCache.invalidatePattern(pattern);
  }, []);

  const getCacheStats = useCallback(() => {
    return requestCache.getStats();
  }, []);

  return {
    clearAllCache,
    clearPattern,
    getCacheStats
  };
};

export default useCache;
