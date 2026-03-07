import { useState, useEffect, useCallback, useRef } from 'react'
import { AdminAnimeService } from '../../services/admin/anime'

// Custom hook for managing admin anime data with persistence
export function useAdminAnimeData() {
  const [animes, setAnimes] = useState<any[]>([])
  const [filteredAnimes, setFilteredAnimes] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [genreFilter, setGenreFilter] = useState('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [totalAnimeCount, setTotalAnimeCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [notification, setNotification] = useState<string | null>(null)

  const itemsPerPage = 12
  
  // Cache management
  const cacheRef = useRef<Map<string, { data: any; timestamp: number }>>(new Map())
  const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes cache
  const lastFetchRef = useRef<{ params: string; timestamp: number } | null>(null)

  // Fetch anime data with caching
  const fetchAnime = useCallback(async () => {
    const cacheKey = `${currentPage}-${searchTerm}-${statusFilter}-${genreFilter}`
    const now = Date.now()
    
    // Check if we have valid cache
    const cached = cacheRef.current.get(cacheKey)
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      console.log('Using cached data for:', cacheKey)
      const result = cached.data
      setAnimes(result.anime)
      setFilteredAnimes(result.anime)
      setTotalPages(result.totalPages || 1)
      setTotalAnimeCount(result.total || 0)
      setIsLoading(false)
      return
    }

    // Check if we're already fetching the same data
    if (lastFetchRef.current?.params === cacheKey && (now - lastFetchRef.current.timestamp) < 1000) {
      console.log('Preventing duplicate fetch for:', cacheKey)
      return
    }

    try {
      setIsLoading(true)
      lastFetchRef.current = { params: cacheKey, timestamp: now }
      
      const result = await AdminAnimeService.getAnimeList(currentPage, itemsPerPage, {
        search: searchTerm || undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        genre: genreFilter !== 'all' ? genreFilter : undefined
      })
      
      if (result.error) {
        setNotification(`Error: ${result.error}`)
      } else {
        // Cache the result
        cacheRef.current.set(cacheKey, { data: result, timestamp: now })
        
        setAnimes(result.anime)
        setFilteredAnimes(result.anime)
        setTotalPages(result.totalPages || 1)
        setTotalAnimeCount(result.total || 0)
      }
    } catch (error) {
      console.error('Error fetching anime:', error)
      setNotification('Failed to load anime data')
    } finally {
      setIsLoading(false)
    }
  }, [currentPage, searchTerm, statusFilter, genreFilter, itemsPerPage])

  // Auto-fetch when dependencies change
  useEffect(() => {
    fetchAnime()
  }, [fetchAnime])

  // Clear cache function
  const clearCache = useCallback(() => {
    cacheRef.current.clear()
    lastFetchRef.current = null
    console.log('Cache cleared')
  }, [])

  // Handle anime creation
  const handleAnimeCreated = useCallback((newAnime: any) => {
    clearCache() // Clear cache when data changes
    setAnimes(prev => [newAnime, ...prev])
    setFilteredAnimes(prev => [newAnime, ...prev])
    setTotalAnimeCount(prev => prev + 1)
    setNotification('Anime created successfully!')
    setTimeout(() => setNotification(null), 3000)
  }, [clearCache])

  // Handle episode creation
  const handleEpisodeCreated = useCallback(() => {
    clearCache() // Clear cache when data changes
    setNotification('Episode created successfully!')
    setTimeout(() => setNotification(null), 3000)
    // Refresh the anime list to show updated episode count after a short delay
    setTimeout(() => {
      fetchAnime()
    }, 500)
  }, [fetchAnime, clearCache])

  // Clear notification
  const clearNotification = useCallback(() => {
    setNotification(null)
  }, [])

  return {
    // State
    animes,
    filteredAnimes,
    searchTerm,
    statusFilter,
    genreFilter,
    currentPage,
    isLoading,
    totalAnimeCount,
    totalPages,
    notification,
    
    // Actions
    setSearchTerm,
    setStatusFilter,
    setGenreFilter,
    setCurrentPage,
    handleAnimeCreated,
    handleEpisodeCreated,
    clearNotification,
    refetch: fetchAnime,
    clearCache
  }
}
