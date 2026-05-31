import { supabase } from '../../lib/database/supabase'
import type { Tables } from '../../lib/database/supabase'
import { invalidateAnimeCache } from '../../utils/cache/request'

type Anime = Tables<'anime'>
type Episode = Tables<'episodes'>

export interface AnimeWithEpisodes extends Anime {
  episodes?: Episode[]
  user_progress?: any[]
  is_favorited?: boolean
  is_in_watchlist?: boolean
}

// Cache for frequently accessed data
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_DURATION = 2 * 60 * 1000 // 2 minutes

// Cache utility functions
const getCacheKey = (method: string, params: any) => 
  `${method}_${JSON.stringify(params)}`

const getCachedData = (key: string) => {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data
  }
  return null
}

const setCachedData = (key: string, data: any) => {
  cache.set(key, { data, timestamp: Date.now() })
}

let searchIndex: any[] | null = null
let indexLoadingPromise: Promise<any[]> | null = null

const clearCache = () => {
  cache.clear()
  searchIndex = null
  indexLoadingPromise = null
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('anime_search_index')
    }
  } catch (e) {}
}

const loadSearchIndex = async (): Promise<any[]> => {
  if (searchIndex) return searchIndex
  if (indexLoadingPromise) return indexLoadingPromise

  try {
    if (typeof window !== 'undefined') {
      const cached = window.sessionStorage.getItem('anime_search_index')
      if (cached) {
        searchIndex = JSON.parse(cached)
        return searchIndex!
      }
    }
  } catch (e) {}

  indexLoadingPromise = (async () => {
    try {
      // Fetch only essential columns for search to reduce payload size
      const { data, error } = await supabase
        .from('anime')
        .select('id, title, title_english, title_romaji, poster_url, year, rating, genres, status, type')
        .limit(3000)

      if (error) throw error
      searchIndex = data || []

      try {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('anime_search_index', JSON.stringify(searchIndex))
        }
      } catch (e) {}

      return searchIndex
    } catch (err) {
      console.error('Failed to pre-fetch search index:', err)
      indexLoadingPromise = null
      return []
    }
  })()

  return indexLoadingPromise
}

export class AnimeService {
  static clearCache() {
    clearCache()
    // Also clear the RequestCache to keep both layers in sync
    invalidateAnimeCache()
  }
  static async getAnimeList(page: number = 1, limit: number = 20, filters?: {
    genre?: string
    year?: number
    status?: string
    search?: string
  }) {
    try {
      // Use the optimized search function for better performance
      if (filters?.search || filters?.genre || filters?.year || filters?.status) {
        // Run both queries in parallel to reduce time (batch call)
        // Build count query with standard Supabase filter chaining
        let countQuery = supabase
          .from('anime')
          .select('*', { count: 'exact', head: true })
        
        if (filters?.genre) countQuery = countQuery.contains('genres', [filters.genre])
        if (filters?.year) countQuery = countQuery.eq('year', filters.year)
        if (filters?.status) countQuery = countQuery.eq('status', filters.status)
        if (filters?.search) {
          countQuery = countQuery.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)
        }

        const [searchResult, countResult] = await Promise.all([
          supabase.rpc('search_anime_optimized', {
            search_term: filters?.search || '',
            genre_filter: filters?.genre || null,
            year_filter: filters?.year || null,
            status_filter: filters?.status || null,
            type_filter: null,
            rating_min: null,
            limit_count: limit,
            offset_count: (page - 1) * limit
          }),
          countQuery
        ])

        if (searchResult.error) {
          console.error('Optimized search failed, falling back to regular query:', searchResult.error)
          // Fallback to regular query
          return this.getAnimeListFallback(page, limit, filters)
        }

        const { data } = searchResult
        const { count } = countResult

        return {
          data: data || [],
          total: count || 0,
          page,
          totalPages: Math.ceil((count || 0) / limit)
        }
      }

      // For simple queries without filters, use single query with count (no batch needed)
      const from = (page - 1) * limit
      const to = from + limit - 1

      const { data, error, count } = await supabase
        .from('anime')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        console.error('Database query error:', error)
        throw error
      }

      return {
        data: data || [],
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      }
    } catch (error) {
      console.error('Anime list fetch error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      throw new Error(`Failed to fetch anime list: ${errorMessage}`)
    }
  }

  // Fallback method for when optimized search fails
  private static async getAnimeListFallback(page: number, limit: number, filters?: {
    genre?: string
    year?: number
    status?: string
    search?: string
  }) {
    let query = supabase
      .from('anime')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    // Apply filters
    if (filters?.genre) {
      query = query.contains('genres', [filters.genre])
    }
    if (filters?.year) {
      query = query.eq('year', filters.year)
    }
    if (filters?.status) {
      query = query.eq('status', filters.status)
    }
    if (filters?.search) {
      query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)
    }

    const from = (page - 1) * limit
    const to = from + limit - 1

    const { data, error, count } = await query.range(from, to)

    if (error) {
      throw error
    }

    return {
      data: data || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    }
  }

  static async getFeaturedAnime(limit: number = 5) {
    try {
      const cacheKey = getCacheKey('featured_anime', { limit })
      const cached = getCachedData(cacheKey)
      if (cached) return cached

      // Use backend API with Redis caching - add timeout
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(`${apiUrl}/api/anime/featured?limit=${limit}`, {
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const result = await response.json()
        const data = result.success ? result.data : []
        
        setCachedData(cacheKey, data)
        return data
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          console.warn('Featured anime request timed out')
          return []
        }
        throw fetchError
      }
    } catch (error) {
      console.error('Featured anime service error:', error)
      return []
    }
  }

  static async getTrendingAnime(limit: number = 10) {
    try {
      // Use backend API with Redis caching - add timeout
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(`${apiUrl}/api/anime/trending?limit=${limit}`, {
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const result = await response.json()
        return result.success ? result.data : []
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          console.warn('Trending anime request timed out')
          return []
        }
        throw fetchError
      }
    } catch (error) {
      console.error('Trending anime service error:', error)
      return []
    }
  }

  static async getPopularAnime(limit: number = 12) {
    try {
      // Use backend API with Redis caching - add timeout
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(`${apiUrl}/api/anime/popular?limit=${limit}`, {
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const result = await response.json()
        return result.success ? result.data : []
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          console.warn('Popular anime request timed out')
          return []
        }
        throw fetchError
      }
    } catch (error) {
      console.error('Popular anime service error:', error)
      return []
    }
  }

  static async getRecentAnime(limit: number = 6) {
    try {
      // Use backend API with Redis caching - add timeout
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
      
      try {
        const response = await fetch(`${apiUrl}/api/anime/recent?limit=${limit}`, {
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`)
        }

        const result = await response.json()
        return result.success ? result.data : []
      } catch (fetchError: any) {
        clearTimeout(timeoutId)
        if (fetchError.name === 'AbortError') {
          console.warn('Recent anime request timed out')
          return []
        }
        throw fetchError
      }
    } catch (error) {
      console.error('Recent anime service error:', error)
      return []
    }
  }

  static async getAnimeById(animeId: string, userId?: string): Promise<AnimeWithEpisodes | null> {
    try {
      // Use the optimized backend API with in-memory caching for public anime details
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      const response = await fetch(`${apiUrl}/api/anime/${animeId}`)
      
      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`)
      }

      const resultPayload = await response.json()
      if (!resultPayload.success || !resultPayload.data) {
        return null
      }

      const animeWithEpisodes = resultPayload.data

      const result: AnimeWithEpisodes = {
        ...animeWithEpisodes,
        user_progress: [],
        is_favorited: false,
        is_in_watchlist: false
      }

      // Fetch user-specific data in parallel if userId is provided
      if (userId) {
        try {
          const [progressResult, favoritesResult, watchlistResult] = await Promise.all([
            supabase
              .from('user_progress')
              .select(`
                id,
                user_id,
                episode_id,
                progress_seconds,
                is_completed,
                last_watched,
                episodes!inner(anime_id)
              `)
              .eq('user_id', userId)
              .eq('episodes.anime_id', animeId),
            
            supabase
              .from('user_favorites')
              .select('id')
              .eq('user_id', userId)
              .eq('anime_id', animeId)
              .maybeSingle(),
            
            supabase
              .from('user_watchlist')
              .select('id')
              .eq('user_id', userId)
              .eq('anime_id', animeId)
              .maybeSingle()
          ])

          result.user_progress = (progressResult.data || []).map((row: any) => ({
            id: row.id,
            user_id: row.user_id,
            episode_id: row.episode_id,
            progress_seconds: row.progress_seconds,
            is_completed: row.is_completed,
            last_watched: row.last_watched
          }))
          result.is_favorited = !!favoritesResult.data
          result.is_in_watchlist = !!watchlistResult.data
        } catch (userError) {
          console.warn('User data fetch error (non-critical):', userError)
          // Don't fail the entire request if user data fails
        }
      }

      return result
    } catch (error) {
      console.error('getAnimeById service error:', error)
      return null
    }
  }

  static async createAnime(animeData: Partial<Anime>) {
    const { data, error } = await supabase
      .from('anime')
      .insert(animeData)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create anime: ${error.message}`)
    }

    return data
  }

  static async updateAnime(animeId: string, updates: Partial<Anime>) {
    const { data, error } = await supabase
      .from('anime')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', animeId)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to update anime: ${error.message}`)
    }

    return data
  }

  static async deleteAnime(animeId: string) {
    const { error } = await supabase
      .from('anime')
      .delete()
      .eq('id', animeId)

    if (error) {
      throw new Error(`Failed to delete anime: ${error.message}`)
    }

    return true
  }

  static async getGenres(): Promise<string[]> {
    try {
      // Try to use the optimized RPC function first
      const { data, error } = await supabase.rpc('get_distinct_genres')

      if (!error && data) {
        return (data as any[] || [])
          .map(row => typeof row === 'object' ? (row.genre || '') : row)
          .filter(Boolean)
          .sort()
      }

      // Fallback if RPC fails/doesn't exist
      const { data: selectData, error: selectError } = await supabase
        .from('anime')
        .select('genres')

      if (selectError) {
        console.error('Genres fallback fetch error:', selectError)
        throw new Error(`Failed to fetch genres: ${selectError.message}`)
      }

      const allGenres = selectData?.flatMap(anime => anime.genres || []) || []
      const uniqueGenres = [...new Set(allGenres)].sort()
      
      return uniqueGenres
    } catch (error) {
      console.error('Genres service error:', error)
      return []
    }
  }

  static async searchAnime(
    query: string,
    limitOrFilters: number | { limit?: number; genres?: string[]; year?: string; status?: string; sortBy?: string } = 20,
    filtersInput?: {
      genres?: string[]
      year?: string
      status?: string
      sortBy?: string
    }
  ) {
    try {
      let limit = 20
      let filters = filtersInput

      if (typeof limitOrFilters === 'number') {
        limit = limitOrFilters
      } else if (limitOrFilters && typeof limitOrFilters === 'object') {
        const obj = limitOrFilters as any
        limit = obj.limit || 20
        filters = obj
      }

      // 1. Try to search client-side if the pre-fetched search index is available
      const index = await loadSearchIndex()
      if (index && index.length > 0) {
        let results = [...index]

        // Match query case-insensitively across multiple title formats
        if (query && query.trim()) {
          const q = query.trim().toLowerCase()
          results = results.filter(anime => 
            (anime.title && anime.title.toLowerCase().includes(q)) ||
            (anime.title_english && anime.title_english.toLowerCase().includes(q)) ||
            (anime.title_romaji && anime.title_romaji.toLowerCase().includes(q))
          )
        }

        // Apply filters locally
        if (filters?.genres && filters.genres.length > 0) {
          results = results.filter(anime => 
            anime.genres && filters!.genres!.every(g => anime.genres.includes(g))
          )
        }

        if (filters?.year) {
          const y = parseInt(filters.year)
          results = results.filter(anime => anime.year === y)
        }

        if (filters?.status) {
          const s = filters.status.toLowerCase()
          results = results.filter(anime => anime.status && anime.status.toLowerCase() === s)
        }

        // Apply sorting locally
        if (!filters?.sortBy || filters.sortBy === 'relevance') {
          // Sort by relevance (exact/prefix match first, then by rating)
          const q = query.trim().toLowerCase()
          results.sort((a, b) => {
            const aTitle = (a.title || '').toLowerCase()
            const bTitle = (b.title || '').toLowerCase()
            const aEng = (a.title_english || '').toLowerCase()
            const bEng = (b.title_english || '').toLowerCase()
            
            const aStartsWith = aTitle.startsWith(q) || aEng.startsWith(q)
            const bStartsWith = bTitle.startsWith(q) || bEng.startsWith(q)
            
            if (aStartsWith && !bStartsWith) return -1
            if (!aStartsWith && bStartsWith) return 1
            
            return (b.rating || 0) - (a.rating || 0)
          })
        } else {
          switch (filters.sortBy) {
            case 'rating':
              results.sort((a, b) => (b.rating || 0) - (a.rating || 0))
              break
            case 'year':
              results.sort((a, b) => (b.year || 0) - (a.year || 0))
              break
            case 'title':
              results.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
              break
          }
        }

        return results.slice(0, limit)
      }

      // 2. Database Fallback (Highly Optimized select projection)
      const hasMultipleGenres = filters?.genres && filters.genres.length > 1;
      const sortByTitle = filters?.sortBy === 'title';

      // Use the optimized search function when filters are compatible
      if (!hasMultipleGenres && !sortByTitle) {
        const { data, error } = await supabase.rpc('search_anime_optimized', {
          search_term: query || '',
          genre_filter: filters?.genres && filters.genres.length === 1 ? filters.genres[0] : null,
          year_filter: filters?.year ? parseInt(filters.year) : null,
          status_filter: filters?.status || null,
          type_filter: null,
          rating_min: null,
          limit_count: limit,
          offset_count: 0
        })

        if (!error && data) {
          return data
        }
        if (error) {
          console.warn('search_anime_optimized RPC failed, falling back to standard query:', error.message)
        }
      }

      // Fallback query (selecting only search-related columns instead of all '*')
      let searchQuery = supabase
        .from('anime')
        .select('id, title, title_english, title_romaji, poster_url, year, rating, genres, status, type')

      // Apply search query
      if (query && query.trim()) {
        searchQuery = searchQuery.or(`title.ilike.%${query}%,title_english.ilike.%${query}%,title_romaji.ilike.%${query}%`)
      }

      // Apply filters
      if (filters?.genres && filters.genres.length > 0) {
        searchQuery = searchQuery.contains('genres', filters.genres)
      }
      
      if (filters?.year) {
        searchQuery = searchQuery.eq('year', parseInt(filters.year))
      }
      
      if (filters?.status) {
        searchQuery = searchQuery.eq('status', filters.status)
      }

      // Apply sorting
      switch (filters?.sortBy) {
        case 'rating':
          searchQuery = searchQuery.order('rating', { ascending: false })
          break
        case 'year':
          searchQuery = searchQuery.order('year', { ascending: false })
          break
        case 'title':
          searchQuery = searchQuery.order('title', { ascending: true })
          break
        case 'relevance':
        default:
          searchQuery = searchQuery.order('rating', { ascending: false })
          break
      }

      const { data, error } = await searchQuery.limit(limit)

      if (error) {
        console.error('Search anime fallback error:', error)
        throw new Error(`Failed to search anime: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Search anime service error:', error)
      return []
    }
  }

  static async getSimilarAnime(animeId: string, genres: string[], limit: number = 6): Promise<any[]> {
    try {
      if (!genres || genres.length === 0) {
        return []
      }

      const { data, error } = await supabase
        .from('anime')
        .select('*')
        .neq('id', animeId) // Exclude the current anime
        .overlaps('genres', genres) // Find anime with overlapping genres
        .order('rating', { ascending: false }) // Sort by rating
        .limit(limit)

      if (error) {
        console.error('Get similar anime error:', error)
        throw new Error(`Failed to get similar anime: ${error.message}`)
      }

      return data || []
    } catch (error) {
      console.error('Get similar anime service error:', error)
      return []
    }
  }

  /**
   * Find all seasons related to an anime by searching for titles that share
   * the same base name (with season suffixes stripped).
   * For movies/specials (e.g. "SPY x FAMILY CODE: White"), progressively
   * shortens the title to find the franchise root.
   */
  static async getRelatedSeasons(
    animeId: string,
    title: string,
    titleEnglish?: string | null,
  ): Promise<Array<{ id: string; title: string; title_english: string | null; poster_url: string | null; total_episodes: number | null; type: string | null }>> {
    try {
      const apiUrl = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '')
      
      const queryParams = new URLSearchParams()
      queryParams.append('title', title)
      if (titleEnglish) {
        queryParams.append('titleEnglish', titleEnglish)
      }

      const response = await fetch(`${apiUrl}/api/anime/${animeId}/seasons?${queryParams.toString()}`)
      if (!response.ok) {
        throw new Error(`Seasons API error: ${response.status}`)
      }

      const result = await response.json()
      return result.success ? result.data : []
    } catch (error) {
      console.error('Get related seasons service error:', error)
      return []
    }
  }

  /**
   * Get anime the user was recently watching but hasn't completed.
   * Returns anime + episode info + progress so the home page can show a
   * "Continue Watching" row.
   */
  static async getContinueWatching(userId: string, limit: number = 10) {
    try {
      // Fetch recent unfinished progress entries from detailed view
      const { data, error } = await supabase
        .from('user_watch_progress_detailed')
        .select('*')
        .eq('user_id', userId)
        .eq('is_completed', false)
        .gt('progress_seconds', 0)
        .order('last_watched', { ascending: false })
        .limit(limit * 3) // Fetch more to allow deduplication

      if (error || !data) {
        console.error('Continue watching query error:', error)
        return []
      }

      // Deduplicate to one entry per anime (most recent episode)
      const seenAnime = new Set<string>()
      const results = data
        .filter((d: any) => {
          const aid = d.anime_id
          if (!aid || seenAnime.has(aid)) return false
          seenAnime.add(aid)
          return true
        })
        .map((d: any) => {
          return {
            id: d.anime_id,
            title: d.anime_title,
            poster_url: d.poster_url,
            banner_url: d.banner_url,
            rating: d.anime_rating,
            total_episodes: d.total_episodes,
            genres: d.genres,
            status: d.anime_status,
            type: d.anime_type,
            studios: d.studios,
            year: d.year,
            description: d.anime_description,
            continueEpisode: d.episode_number,
            continueEpisodeTitle: d.episode_title,
            progressSeconds: d.progress_seconds,
            episodeDuration: d.episode_duration,
            lastWatched: d.last_watched,
          }
        })
        .filter(Boolean)
        .slice(0, limit)

      return results
    } catch (error) {
      console.error('Continue watching service error:', error)
      return []
    }
  }
}