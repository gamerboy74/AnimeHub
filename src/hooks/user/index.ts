import { useState, useEffect } from 'react'
import { UserService } from '../../services/user'
import type { Tables } from '../../lib/database/supabase'

type Anime = Tables<'anime'>
type UserProgress = Tables<'user_progress'>

interface ContinueWatching {
  id: string
  title: string
  episode: number
  episodeId: string
  progress: number
  progressSeconds: number
  duration: number
  thumbnail?: string
  anime: Anime
}

export function useUserProgress(userId?: string) {
  const [progress, setProgress] = useState<UserProgress[]>([])
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

export function useUserStats(userId?: string) {
  const [stats, setStats] = useState({
    completedEpisodes: 0,
    totalEpisodes: 0,
    favoritesCount: 0,
    watchlistCount: 0,
    reviewsCount: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setStats({
        completedEpisodes: 0,
        totalEpisodes: 0,
        favoritesCount: 0,
        watchlistCount: 0,
        reviewsCount: 0
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
