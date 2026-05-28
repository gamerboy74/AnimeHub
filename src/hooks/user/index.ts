import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthContext } from '../../contexts/auth/AuthContext'
import { queryKeys } from '../queryKeys'
import { UserService } from '../../services/user'
import type { Tables } from '../../lib/database/supabase'

type Anime = Tables<'anime'>

export interface UserProgressDetailed {
  id: string
  user_id: string
  episode_id: string
  progress_seconds: number
  is_completed: boolean
  last_watched: string
  episode: {
    id: string
    episode_number: number
    title: string | null
    anime_id: string
    duration: number | null
    anime: {
      id: string
      title: string
      poster_url: string | null
    }
  }
}

interface ContinueWatching {
  id: string
  title: string
  episode: number
  episodeId: string
  progress: number
  progressSeconds: number
  duration: number
  thumbnail?: string
  anime?: {
    id: string
    title: string
    poster_url: string | null
    rating?: number | null
    year?: number | null
    genres?: string[] | null
    status?: string | null
    total_episodes?: number | null
  }
}

export function useUserProgress(userId?: string) {
  const [progress, setProgress] = useState<UserProgressDetailed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setProgress([])
      setLoading(false)
      return
    }

    const fetchProgress = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await UserService.getUserProgress(userId)
        setProgress(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch user progress')
      } finally {
        setLoading(false)
      }
    }

    fetchProgress()
  }, [userId])

  const updateProgress = async (episodeId: string, progressSeconds: number) => {
    if (!userId) return

    try {
      await UserService.updateWatchProgress(userId, episodeId, progressSeconds)
      // Refresh progress data
      const data = await UserService.getUserProgress(userId)
      setProgress(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update progress')
      throw err
    }
  }

  const markCompleted = async (episodeId: string) => {
    if (!userId) return

    try {
      await UserService.markEpisodeCompleted(userId, episodeId)
      // Refresh progress data
      const data = await UserService.getUserProgress(userId)
      setProgress(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark episode as completed')
      throw err
    }
  }

  return { progress, loading, error, updateProgress, markCompleted }
}

export function useContinueWatching(userId?: string) {
  const [continueWatching, setContinueWatching] = useState<ContinueWatching[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setContinueWatching([])
      setLoading(false)
      return
    }

    const fetchContinueWatching = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await UserService.getContinueWatching(userId, 10)
        
        // Transform data to match frontend format
        const transformed = data.map(item => {
          const progressSeconds = item.progress_seconds || 0
          const duration = item.episode?.duration || 1440 // Default to 24 minutes (1440 seconds) if missing
          
          // Calculate progress percentage, ensuring we don't exceed 100%
          // Handle edge cases: missing duration, zero duration, or progress > duration
          let progress = 0
          if (duration > 0) {
            progress = Math.min(Math.round((progressSeconds / duration) * 100), 100)
          } else if (progressSeconds > 0) {
            // If duration is missing but we have progress, assume a default duration
            progress = Math.min(Math.round((progressSeconds / 1440) * 100), 100)
          }
          
          return {
            id: item.episode?.anime_id || '',
            title: item.episode?.anime?.title || '',
            episode: item.episode?.episode_number || 1,
            episodeId: item.episode_id || '',
            progress,
            progressSeconds,
            duration,
            thumbnail: item.episode?.thumbnail_url,
            anime: item.episode?.anime
          }
        })

        setContinueWatching(transformed)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch continue watching')
      } finally {
        setLoading(false)
      }
    }

    fetchContinueWatching()
  }, [userId])

  return { continueWatching, loading, error }
}

export function useUserFavorites(userId?: string) {
  const [favorites, setFavorites] = useState<Anime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setFavorites([])
      setLoading(false)
      return
    }

    const fetchFavorites = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await UserService.getUserFavorites(userId)
        setFavorites(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch favorites')
      } finally {
        setLoading(false)
      }
    }

    fetchFavorites()
  }, [userId])

  const addToFavorites = async (animeId: string) => {
    if (!userId) return

    try {
      await UserService.addToFavorites(userId, animeId)
      // Refresh favorites data
      const data = await UserService.getUserFavorites(userId)
      setFavorites(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to favorites')
      throw err
    }
  }

  const removeFromFavorites = async (animeId: string) => {
    if (!userId) return

    try {
      await UserService.removeFromFavorites(userId, animeId)
      // Refresh favorites data
      const data = await UserService.getUserFavorites(userId)
      setFavorites(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from favorites')
      throw err
    }
  }

  const toggleFavorite = async (animeId: string) => {
    const isFavorite = favorites.some(fav => fav.id === animeId)
    if (isFavorite) {
      await removeFromFavorites(animeId)
    } else {
      await addToFavorites(animeId)
    }
  }

  return { 
    favorites, 
    loading, 
    error, 
    addToFavorites, 
    removeFromFavorites, 
    toggleFavorite,
    isFavorite: (animeId: string) => favorites.some(fav => fav.id === animeId)
  }
}

export function useUserWatchlist(userId?: string) {
  const [watchlist, setWatchlist] = useState<Anime[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setWatchlist([])
      setLoading(false)
      return
    }

    const fetchWatchlist = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await UserService.getUserWatchlist(userId)
        setWatchlist(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch watchlist')
      } finally {
        setLoading(false)
      }
    }

    fetchWatchlist()
  }, [userId])

  const addToWatchlist = async (animeId: string) => {
    if (!userId) return

    try {
      await UserService.addToWatchlist(userId, animeId)
      // Refresh watchlist data
      const data = await UserService.getUserWatchlist(userId)
      setWatchlist(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to watchlist')
      throw err
    }
  }

  const removeFromWatchlist = async (animeId: string) => {
    if (!userId) return

    try {
      await UserService.removeFromWatchlist(userId, animeId)
      // Refresh watchlist data
      const data = await UserService.getUserWatchlist(userId)
      setWatchlist(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove from watchlist')
      throw err
    }
  }

  const toggleWatchlist = async (animeId: string) => {
    const isInWatchlist = watchlist.some(item => item.id === animeId)
    if (isInWatchlist) {
      await removeFromWatchlist(animeId)
    } else {
      await addToWatchlist(animeId)
    }
  }

  return { 
    watchlist, 
    loading, 
    error, 
    addToWatchlist, 
    removeFromWatchlist, 
    toggleWatchlist,
    isInWatchlist: (animeId: string) => watchlist.some(item => item.id === animeId)
  }
}

export interface UserStats {
  completedEpisodes: number
  totalFavorites: number
  totalWatchlist: number
  totalReviews: number
  totalEpisodesWatched: number
  watchTime: string
  watchTimeHours: number
  currentlyWatching: number
}

export function useUserStats(userId?: string) {
  const [stats, setStats] = useState<UserStats>({
    completedEpisodes: 0,
    totalFavorites: 0,
    totalWatchlist: 0,
    totalReviews: 0,
    totalEpisodesWatched: 0,
    watchTime: '0 hours',
    watchTimeHours: 0,
    currentlyWatching: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setStats({
        completedEpisodes: 0,
        totalFavorites: 0,
        totalWatchlist: 0,
        totalReviews: 0,
        totalEpisodesWatched: 0,
        watchTime: '0 hours',
        watchTimeHours: 0,
        currentlyWatching: 0
      })
      setLoading(false)
      return
    }

    const fetchStats = async () => {
      try {
        setLoading(true)
        setError(null)
        const data = await UserService.getUserStats(userId)
        setStats(data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch user stats')
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [userId])

  return { stats, loading, error }
}

export function useUserAnimeProgress() {
  const { user } = useAuthContext()
  const queryClient = useQueryClient()

  // 1. Fetch DB watch progress map if logged in
  const q = useQuery({
    queryKey: queryKeys.user.watchProgress(user?.id ?? null),
    queryFn: () => UserService.getUserAnimeProgressMap(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  // 2. Read local watch progress for fallback
  const getLocalProgressMap = (): Record<string, number> => {
    try {
      return JSON.parse(localStorage.getItem('watchProgress') || '{}')
    } catch {
      return {}
    }
  }

  // 3. Merged map helper
  const getProgress = (animeId: string): number => {
    if (user?.id) {
      // Return DB progress if logged in, fallback to local storage
      const dbProgress = q.data?.[animeId] || 0
      const localProgress = getLocalProgressMap()[animeId] || 0
      return Math.max(dbProgress, localProgress)
    } else {
      // Guest: local storage only
      return getLocalProgressMap()[animeId] || 0
    }
  }

  const updateProgressLocal = (animeId: string, episodeNumber: number) => {
    try {
      const savedProgress = getLocalProgressMap()
      savedProgress[animeId] = Math.max(savedProgress[animeId] || 0, episodeNumber)
      localStorage.setItem('watchProgress', JSON.stringify(savedProgress))
      
      // If logged in, invalidate queries so it fetches/recalculates
      if (user?.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.user.watchProgress(user.id) })
      }
    } catch (e) {
      console.error('Error saving local watch progress:', e)
    }
  }

  return {
    progressMap: q.data ?? {},
    loading: q.isLoading,
    getProgress,
    updateProgressLocal,
    refetch: q.refetch
  }
}

