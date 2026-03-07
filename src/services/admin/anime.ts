import { supabase, isSupabaseConfigured } from '../../lib/database/supabase'
import type { Tables } from '../../lib/database/supabase'

type Anime = Tables<'anime'>
type Episode = Tables<'episodes'>

const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'

export interface CreateAnimeData {
  title: string
  title_japanese?: string
  description?: string
  poster_url?: string
  banner_url?: string
  trailer_url?: string
  rating?: number
  year?: number
  status?: 'ongoing' | 'completed' | 'upcoming'
  type?: 'tv' | 'movie' | 'ova' | 'special'
  genres?: string[]
  studios?: string[]
  total_episodes?: number
  duration?: number
  age_rating?: 'G' | 'PG' | 'PG-13' | 'R' | '18+'
}

export interface CreateEpisodeData {
  anime_id: string
  episode_number: number
  title?: string
  description?: string
  thumbnail_url?: string
  video_url?: string
  duration?: number
  is_premium?: boolean
  air_date?: string
}

export interface AnimeWithEpisodes extends Anime {
  episodes?: Episode[]
  episode_count?: number
}

export class AdminAnimeService {
  // Get all anime with pagination and filters
  static async getAnimeList(page: number = 1, limit: number = 20, filters?: {
    search?: string
    status?: string
    genre?: string
    type?: string
  }) {
    try {
      // First, get the total count without pagination
      let countQuery = supabase
        .from('anime')
        .select('*', { count: 'exact', head: true })

      // Apply filters to count query
      if (filters?.search) {
        countQuery = countQuery.or(`title.ilike.%${filters.search}%,title_japanese.ilike.%${filters.search}%`)
      }
      if (filters?.status && filters.status !== 'all') {
        countQuery = countQuery.eq('status', filters.status)
      }
      if (filters?.type && filters.type !== 'all') {
        countQuery = countQuery.eq('type', filters.type)
      }
      if (filters?.genre && filters.genre !== 'all') {
        countQuery = countQuery.contains('genres', [filters.genre])
      }

      const { count, error: countError } = await countQuery

      if (countError) {
        console.error('Error fetching anime count:', countError)
        return { anime: [], total: 0, error: countError.message }
      }

      // Now get the actual data with pagination
      let dataQuery = supabase
        .from('anime')
        .select(`
          *,
          episodes (id, episode_number, title, duration, is_premium)
        `)
        .order('created_at', { ascending: false })

      // Apply filters to data query
      if (filters?.search) {
        dataQuery = dataQuery.or(`title.ilike.%${filters.search}%,title_japanese.ilike.%${filters.search}%`)
      }
      if (filters?.status && filters.status !== 'all') {
        dataQuery = dataQuery.eq('status', filters.status)
      }
      if (filters?.type && filters.type !== 'all') {
        dataQuery = dataQuery.eq('type', filters.type)
      }
      if (filters?.genre && filters.genre !== 'all') {
        dataQuery = dataQuery.contains('genres', [filters.genre])
      }

      // Apply pagination
      const from = (page - 1) * limit
      const to = from + limit - 1

      const { data, error } = await dataQuery.range(from, to)

      if (error) {
        console.error('Error fetching anime list:', error)
        return { anime: [], total: 0, error: error.message }
      }

      // Transform data to include episode count
      const animeWithCounts = data?.map((anime: any) => ({
        ...anime,
        episode_count: anime.episodes?.length || 0
      })) || []

      return {
        anime: animeWithCounts,
        total: count || 0,
        page,
        totalPages: Math.ceil((count || 0) / limit)
      }
    } catch (err) {
      console.error('Error fetching anime list:', err)
      return { anime: [], total: 0, error: 'Failed to fetch anime list' }
    }
  }

  // Create new anime (via server to bypass RLS)
  static async createAnime(animeData: CreateAnimeData): Promise<Anime | null> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/anime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(animeData)
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Failed to create anime')
      return json.data
    } catch (err) {
      console.error('Error creating anime:', err)
      throw err
    }
  }

  // Update anime (via server to bypass RLS)
  static async updateAnime(animeId: string, updates: Partial<CreateAnimeData>): Promise<Anime | null> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/anime/${animeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Failed to update anime')
      return json.data
    } catch (err) {
      console.error('Error updating anime:', err)
      return null
    }
  }

  // Delete anime (via server to bypass RLS)
  static async deleteAnime(animeId: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/anime/${animeId}`, { method: 'DELETE' })
      const json = await res.json()
      return json.success === true
    } catch (err) {
      console.error('Error deleting anime:', err)
      return false
    }
  }

  // Get anime by ID with episodes
  static async getAnimeById(animeId: string): Promise<AnimeWithEpisodes | null> {
    try {
      const { data, error } = await supabase
        .from('anime')
        .select(`
          *,
          episodes (*)
        `)
        .eq('id', animeId)
        .single()

      if (error) {
        console.error('Error fetching anime:', error)
        return null
      }

      // Sort episodes by episode number
      const sortedEpisodes = data.episodes?.sort((a: any, b: any) => 
        a.episode_number - b.episode_number
      ) || []

      return {
        ...data,
        episodes: sortedEpisodes,
        episode_count: sortedEpisodes.length
      }
    } catch (err) {
      console.error('Error fetching anime:', err)
      return null
    }
  }

  // Create episode (via server to bypass RLS)
  static async createEpisode(episodeData: CreateEpisodeData): Promise<Episode | null> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(episodeData)
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Failed to create episode')
      return json.data
    } catch (err) {
      console.error('Error creating episode:', err)
      throw err
    }
  }

  // Update episode (via server to bypass RLS)
  static async updateEpisode(episodeId: string, updates: Partial<CreateEpisodeData>): Promise<Episode | null> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/episodes/${episodeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const json = await res.json()
      if (!json.success) return null
      return json.data
    } catch (err) {
      console.error('Error updating episode:', err)
      return null
    }
  }

  // Delete episode (via server to bypass RLS)
  static async deleteEpisode(episodeId: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/episodes/${episodeId}`, { method: 'DELETE' })
      const json = await res.json()
      return json.success === true
    } catch (err) {
      console.error('Error deleting episode:', err)
      return false
    }
  }

  // Bulk delete anime (via server to bypass RLS)
  static async bulkDeleteAnime(animeIds: string[]): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/admin/anime/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: animeIds })
      })
      const json = await res.json()
      return json.success === true
    } catch (err) {
      console.error('Error bulk deleting anime:', err)
      return false
    }
  }

  // Get available genres from existing anime
  static async getAvailableGenres(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('anime')
        .select('genres')
        .not('genres', 'is', null)

      if (error) {
        console.error('Error fetching genres:', error)
        return []
      }

      const allGenres = data.flatMap((anime: any) => anime.genres || [])
      return Array.from(new Set(allGenres)).sort()
    } catch (err) {
      console.error('Error fetching genres:', err)
      return []
    }
  }

  // Get available studios from existing anime
  static async getAvailableStudios(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('anime')
        .select('studios')
        .not('studios', 'is', null)

      if (error) {
        console.error('Error fetching studios:', error)
        return []
      }

      const allStudios = data.flatMap((anime: any) => anime.studios || [])
      return Array.from(new Set(allStudios)).sort()
    } catch (err) {
      console.error('Error fetching studios:', err)
      return []
    }
  }
}
