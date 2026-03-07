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
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

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

const clearCache = () => {
  cache.clear()
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
          supabase
            .from('anime')
            .select('*', { count: 'exact', head: true })
            .modify((query) => {
              if (filters?.genre) query.contains('genres', [filters.genre])
              if (filters?.year) query.eq('year', filters.year)
              if (filters?.status) query.eq('status', filters.status)
              if (filters?.search) {
                query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%`)
              }
            })
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
      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
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
      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
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
      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
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
      const apiUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
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
      // Use a single query with joins for better performance
      const { data: animeWithEpisodes, error: animeError } = await supabase
        .from('anime')
        .select(`
          *,
          episodes (*)
        `)
        .eq('id', animeId)
        .single()

      if (animeError || !animeWithEpisodes) {
        console.error('Anime fetch error:', animeError)
        return null
      }

      // Sort episodes by episode number
      const sortedEpisodes = animeWithEpisodes.episodes?.sort((a: any, b: any) => 
        a.episode_number - b.episode_number
      ) || []

      const result: AnimeWithEpisodes = {
        ...animeWithEpisodes,
        episodes: sortedEpisodes
      }

      // Fetch user-specific data in parallel if userId is provided
      if (userId) {
        try {
          const episodeIds = sortedEpisodes.map((e: any) => e.id)
          
          const [progressResult, favoritesResult, watchlistResult] = await Promise.all([
            episodeIds.length > 0 ? supabase
              .from('user_progress')
              .select('*')
              .eq('user_id', userId)
              .in('episode_id', episodeIds) : Promise.resolve({ data: [] }),
            
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

          result.user_progress = progressResult.data || []
          result.is_favorited = !!favoritesResult.data
          result.is_in_watchlist = !!watchlistResult.data
        } catch (userError) {
          console.warn('User data fetch error (non-critical):', userError)
          // Don't fail the entire request if user data fails
          result.user_progress = []
          result.is_favorited = false
          result.is_in_watchlist = false
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
      const { data, error } = await supabase
        .from('anime')
        .select('genres')

      if (error) {
        console.error('Genres fetch error:', error)
        throw new Error(`Failed to fetch genres: ${error.message}`)
      }

      const allGenres = data?.flatMap(anime => anime.genres || []) || []
      const uniqueGenres = [...new Set(allGenres)].sort()
      
      return uniqueGenres
    } catch (error) {
      console.error('Genres service error:', error)
      return []
    }
  }

  static async searchAnime(query: string, limit: number = 20, filters?: {
    genres?: string[]
    year?: string
    status?: string
    sortBy?: string
  }) {
    try {
      let searchQuery = supabase
        .from('anime')
        .select('*')

      // Apply search query
      if (query && query.trim()) {
        searchQuery = searchQuery.or(`title.ilike.%${query}%,description.ilike.%${query}%,title_japanese.ilike.%${query}%`)
      }

      // Apply filters
      if (filters?.genres && filters.genres.length > 0) {
        searchQuery = searchQuery.contains('genres', filters.genres)
      }
      
      if (filters?.year) {
        searchQuery = searchQuery.eq('release_year', parseInt(filters.year))
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
          searchQuery = searchQuery.order('release_year', { ascending: false })
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
        console.error('Search anime error:', error)
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
      const { extractSeasonInfo } = await import('../../utils/anime/seasons')
      const infoEng = titleEnglish ? extractSeasonInfo(titleEnglish) : null
      const infoRaw = extractSeasonInfo(title)
      const baseTitle = infoEng?.baseTitle || infoRaw.baseTitle

      if (!baseTitle || baseTitle.length < 3) return []

      // Generate candidate search terms: full base title, then progressively shorter
      const searchCandidates = this.generateFranchisePrefixes(baseTitle)

      for (const candidate of searchCandidates) {
        if (candidate.length < 3) continue

        const escapedBase = candidate.replace(/[%_]/g, '\\$&')

        const { data, error } = await supabase
          .from('anime')
          .select('id, title, title_english, poster_url, total_episodes, type')
          .or(`title.ilike.%${escapedBase}%,title_english.ilike.%${escapedBase}%`)
          .order('title', { ascending: true })

        if (error) {
          console.error('Get related seasons error:', error)
          continue
        }

        // If we found 2+ results, we've likely found the franchise
        if (data && data.length >= 2) {
          return data
        }
      }

      // Fallback: return just the single result from the full base title search
      const escapedBase = baseTitle.replace(/[%_]/g, '\\$&')
      const { data } = await supabase
        .from('anime')
        .select('id, title, title_english, poster_url, total_episodes, type')
        .or(`title.ilike.%${escapedBase}%,title_english.ilike.%${escapedBase}%`)
        .order('title', { ascending: true })

      return data || []
    } catch (error) {
      console.error('Get related seasons service error:', error)
      return []
    }
  }

  /**
   * Generate progressively shorter prefixes of a title for franchise matching.
   * "SPY x FAMILY CODE: White" → ["SPY x FAMILY CODE: White", "SPY x FAMILY CODE", "SPY x FAMILY"]
   */
  private static generateFranchisePrefixes(title: string): string[] {
    const prefixes: string[] = [title]

    // Split on common subtitle separators: ":", " - ", " – ", " — "
    const separatorSplit = title.split(/\s*[:\–\—]\s*|\s+-\s+/)
    if (separatorSplit.length > 1) {
      // Add each progressively shorter prefix
      for (let i = separatorSplit.length - 1; i >= 1; i--) {
        const prefix = separatorSplit.slice(0, i).join(': ').trim()
        if (prefix && !prefixes.includes(prefix)) {
          prefixes.push(prefix)
        }
      }
    }

    // Also try stripping last word progressively (minimum 2 words)
    const words = title.split(/\s+/)
    for (let len = words.length - 1; len >= 2; len--) {
      const prefix = words.slice(0, len).join(' ').trim()
      if (prefix && !prefixes.includes(prefix)) {
        prefixes.push(prefix)
      }
    }

    return prefixes
  }

  /**
   * Get anime the user was recently watching but hasn't completed.
   * Returns anime + episode info + progress so the home page can show a
   * "Continue Watching" row.
   */
  static async getContinueWatching(userId: string, limit: number = 10) {
    try {
      const cacheKey = getCacheKey('continueWatching', { userId, limit })
      const cached = getCachedData(cacheKey)
      if (cached) return cached

      // Fetch recent unfinished progress entries joined with episode + anime
      const { data, error } = await supabase
        .from('user_progress')
        .select(`
          id,
          progress_seconds,
          is_completed,
          last_watched,
          episodes!inner (
            id,
            anime_id,
            episode_number,
            title,
            duration
          )
        `)
        .eq('user_id', userId)
        .eq('is_completed', false)
        .gt('progress_seconds', 0)
        .order('last_watched', { ascending: false })
        .limit(limit)

      if (error || !data) {
        console.error('Continue watching query error:', error)
        return []
      }

      // Collect unique anime IDs
      const animeIds = [...new Set(data.map((d: any) => d.episodes?.anime_id).filter(Boolean))]
      if (animeIds.length === 0) return []

      // Fetch anime metadata in one call
      const { data: animeData, error: animeError } = await supabase
        .from('anime')
        .select('id, title, poster_url, banner_url, rating, total_episodes, genres, status, type, studios, year, description')
        .in('id', animeIds)

      if (animeError) {
        console.error('Continue watching anime fetch error:', animeError)
        return []
      }

      const animeMap = new Map((animeData || []).map((a: any) => [a.id, a]))

      // Deduplicate to one entry per anime (most recent episode)
      const seenAnime = new Set<string>()
      const results = data
        .filter((d: any) => {
          const aid = d.episodes?.anime_id
          if (!aid || seenAnime.has(aid)) return false
          seenAnime.add(aid)
          return true
        })
        .map((d: any) => {
          const ep = d.episodes
          const anime = animeMap.get(ep.anime_id)
          if (!anime) return null
          return {
            ...anime,
            continueEpisode: ep.episode_number,
            continueEpisodeTitle: ep.title,
            progressSeconds: d.progress_seconds,
            episodeDuration: ep.duration,
            lastWatched: d.last_watched,
          }
        })
        .filter(Boolean)

      setCachedData(cacheKey, results)
      return results
    } catch (error) {
      console.error('Continue watching service error:', error)
      return []
    }
  }
}