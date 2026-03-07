import { useState, useEffect } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T) {
  // Get from local storage then parse stored json or return initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Return a wrapped version of useState's setter function that persists the new value to localStorage
  const setValue = (value: T | ((val: T) => T)) => {
    try {
      // Allow value to be a function so we have the same API as useState
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(`Error setting localStorage key "${key}":`, error);
    }
  };

  return [storedValue, setValue] as const;
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useLocalStorage('watchlist', []);
  
  const addToWatchlist = (anime: any) => {
    const animeData = {
      ...anime,
      addedAt: new Date().toISOString()
    };
    setWatchlist((prev: any[]) => [...prev, animeData]);
  };

  const removeFromWatchlist = (animeId: string | number) => {
    setWatchlist((prev: any[]) => prev.filter((item: any) => item.id !== animeId));
  };

  const isInWatchlist = (animeId: string | number) => {
    return watchlist.some((item: any) => item.id === animeId);
  };

  return {
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist
  };
}

export function useFavorites() {
  const [favorites, setFavorites] = useLocalStorage('favorites', []);
  
  const addToFavorites = (anime: any) => {
    const animeData = {
      ...anime,
      addedAt: new Date().toISOString()
    };
    setFavorites((prev: any[]) => [...prev, animeData]);
  };

  const removeFromFavorites = (animeId: string | number) => {
    setFavorites((prev: any[]) => prev.filter((item: any) => item.id !== animeId));
  };

  const isFavorite = (animeId: string | number) => {
    return favorites.some((item: any) => item.id === animeId);
  };

  return {
    favorites,
    addToFavorites,
    removeFromFavorites,
    isFavorite
  };
}

export function useWatchProgress() {
  const [watchProgress, setWatchProgress] = useLocalStorage('watchProgress', {});
  
  const updateProgress = (animeId: string | number, episodes: number) => {
    setWatchProgress((prev: any) => ({
      ...prev,
      [animeId]: episodes
    }));
  };

  const getProgress = (animeId: string | number) => {
    return watchProgress[animeId] || 0;
  };

  return {
    watchProgress,
    updateProgress,
    getProgress
  };
}