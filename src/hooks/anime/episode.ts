import { useState, useEffect } from 'react'
import { EpisodeStatusService } from '../../services/episodes/status'

export function useAnimeEpisodeStatus(animeId: string) {
  const [hasEpisodes, setHasEpisodes] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!animeId) return

    const checkEpisodeStatus = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const hasEpisodesResult = await EpisodeStatusService.hasEpisodes(animeId)
        setHasEpisodes(hasEpisodesResult)
        
        // If anime has episodes, try to update its status from upcoming to ongoing
        if (hasEpisodesResult) {
          await EpisodeStatusService.updateAnimeStatus(animeId)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check episode status')
      } finally {
        setLoading(false)
      }
    }

    checkEpisodeStatus()

    // Set up interval to check periodically (every 5 minutes)
    const interval = setInterval(checkEpisodeStatus, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [animeId])

  return { hasEpisodes, loading, error }
}

export function useAutoUpdateUpcomingAnime() {
  const [isUpdating, setIsUpdating] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [updateStats, setUpdateStats] = useState<{ updated: number; errors: number } | null>(null)

  const triggerUpdate = async () => {
    try {
      setIsUpdating(true)
      const stats = await EpisodeStatusService.autoUpdateUpcomingAnime()
      setUpdateStats(stats)
      setLastUpdate(new Date())
      return stats
    } catch (error) {
      console.error('Error in auto-update:', error)
      return { updated: 0, errors: 1 }
    } finally {
      setIsUpdating(false)
    }
  }

  // Auto-update every 10 minutes
  useEffect(() => {
    const interval = setInterval(triggerUpdate, 10 * 60 * 1000)
    
    // Initial update
    triggerUpdate()

    return () => clearInterval(interval)
  }, [])

  return { 
    triggerUpdate, 
    isUpdating, 
    lastUpdate, 
    updateStats 
  }
}
