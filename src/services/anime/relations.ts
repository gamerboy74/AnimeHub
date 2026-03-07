import { supabase } from '../../lib/database/supabase'

export interface AnimeRelation {
  id: string
  anime_id: string
  related_anime_id: string
  relation_type: 'sequel' | 'prequel' | 'alternative_setting' | 'alternative_version' | 'side_story' | 'parent_story' | 'summary' | 'other'
  created_at: string
  related_anime?: {
    id: string
    title: string
    title_japanese?: string
    poster_url?: string
    banner_url?: string
    year: number
    type: string
    status: string
    total_episodes?: number
    rating?: number
    genres: string[]
  }
}

export interface AnimeCharacter {
  id: string
  anime_id: string
  name: string
  name_japanese?: string
  name_romaji?: string
  image_url?: string
  role: 'main' | 'supporting' | 'antagonist' | 'background'
  description?: string
  voice_actor?: string
  voice_actor_japanese?: string
}

export class AnimeRelationsService {
  // Get related anime by relation type
  static async getRelatedAnime(animeId: string, relationTypes?: string[]): Promise<AnimeRelation[]> {
    try {
      let query = supabase
        .from('anime_relations')
        .select('*')
        .eq('anime_id', animeId)

      if (relationTypes && relationTypes.length > 0) {
        query = query.in('relation_type', relationTypes)
      }

      const { data, error } = await query.order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching related anime:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getRelatedAnime:', error)
      return []
    }
  }

  // Get similar anime by genres and studios
  static async getSimilarAnime(animeId: string, limit: number = 12): Promise<any[]> {
    try {
      // First get the current anime details
      const { data: currentAnime, error: currentError } = await supabase
        .from('anime')
        .select('genres, studios')
        .eq('id', animeId)
        .single()

      if (currentError || !currentAnime) {
        console.error('Error fetching current anime:', commonError)
        return []
      }

      const { genres, studios } = currentAnime

      // Build query for similar anime
      let query = supabase
        .from('anime')
        .select('*')
        .neq('id', animeId)

      // Build filters for genres and studios
      let genreFilters = ''
      let studioFilters = ''
      
      // Add genre filters if available
      if (genres && genres.length > 0) {
        genreFilters = genres.map(genre => `genres.cs.{${genre}}`).join(',')
      }

      // Add studio filters if available
      if (studios && studios.length > 0) {
        studioFilters = studios.map(studio => `studios.cs.{${studio}}`).join(',')
      }

      // Apply filters
      if (genreFilters && studioFilters) {
        // Combine both genre and studio filters
        query = query.or(`${genreFilters},${studioFilters}`)
      } else if (genreFilters) {
        // Only genre filters
        query = query.or(genreFilters)
      } else if (studioFilters) {
        // Only studio filters
        query = query.or(studioFilters)
      }

      const { data, error } = await query
        .order('rating', { ascending: false })
        .limit(limit)

      if (error) {
        console.error('Error fetching similar anime:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getSimilarAnime:', error)
      return []
    }
  }

  // Get anime by title similarity (for seasons detection)
  static async getAnimeByTitleSimilarity(baseTitle: string, excludeId: string, limit: number = 10): Promise<any[]> {
    try {
      // Clean the title for better matching
      const cleanedTitle = baseTitle
        .replace(/\s+(Season|S)\s*\d+/gi, '')
        .replace(/\s+\d{4}/g, '')
        .replace(/\s+(Movie|OVA|ONA|Special)/gi, '')
        .trim()

      // Split title into words for better matching
      const titleWords = cleanedTitle.split(' ').filter(word => word.length > 2)
      
      if (titleWords.length === 0) {
        return []
      }

      // Build search query
      const searchTerms = titleWords.map(word => `title.ilike.%${word}%`).join(',')
      const japaneseSearchTerms = titleWords.map(word => `title_japanese.ilike.%${word}%`).join(',')

      const { data, error } = await supabase
        .from('anime')
        .select('*')
        .neq('id', excludeId)
        .or(`${searchTerms},${japaneseSearchTerms}`)
        .order('year', { ascending: true })
        .limit(limit)

      if (error) {
        console.error('Error fetching anime by title similarity:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getAnimeByTitleSimilarity:', error)
      return []
    }
  }

  // Get anime characters
  static async getAnimeCharacters(animeId: string): Promise<AnimeCharacter[]> {
    try {
      const { data, error } = await supabase
        .from('anime_characters')
        .select('*')
        .eq('anime_id', animeId)
        .order('role', { ascending: true })

      if (error) {
        console.error('Error fetching anime characters:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getAnimeCharacters:', error)
      return []
    }
  }

  // Get anime studios
  static async getAnimeStudios(animeId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('anime_studio_relations')
        .select(`
          role,
          anime_studios (
            id,
            name,
            name_japanese,
            logo_url,
            website,
            founded_year
          )
        `)
        .eq('anime_id', animeId)

      if (error) {
        console.error('Error fetching anime studios:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in getAnimeStudios:', error)
      return []
    }
  }

  // Create anime relation
  static async createAnimeRelation(
    animeId: string, 
    relatedAnimeId: string, 
    relationType: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('anime_relations')
        .insert({
          anime_id: animeId,
          related_anime_id: relatedAnimeId,
          relation_type: relationType
        })

      if (error) {
        console.error('Error creating anime relation:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Error in createAnimeRelation:', error)
      return false
    }
  }

  // Create anime character
  static async createAnimeCharacter(characterData: Omit<AnimeCharacter, 'id' | 'anime_id'> & { anime_id: string }): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('anime_characters')
        .insert(characterData)

      if (error) {
        console.error('Error creating anime character:', error)
        return false
      }

      return true
    } catch (error) {
      console.error('Error in createAnimeCharacter:', error)
      return false
    }
  }

  // Get comprehensive anime details with relations
  static async getAnimeWithRelations(animeId: string) {
    try {
      const [anime, relatedAnime, similarAnime, characters, studios] = await Promise.all([
        supabase.from('anime').select('*').eq('id', animeId).single(),
        this.getRelatedAnime(animeId),
        this.getSimilarAnime(animeId, 6),
        this.getAnimeCharacters(animeId),
        this.getAnimeStudios(animeId)
      ])

      return {
        anime: anime.data,
        relatedAnime: relatedAnime,
        similarAnime: similarAnime,
        characters: characters,
        studios: studios
      }
    } catch (error) {
      console.error('Error in getAnimeWithRelations:', error)
      return null
    }
  }

  // Search anime by multiple criteria
  static async searchAnimeByCriteria(criteria: {
    genres?: string[]
    studios?: string[]
    year?: number
    type?: string
    status?: string
    minRating?: number
    limit?: number
  }): Promise<any[]> {
    try {
      let query = supabase.from('anime').select('*')

      // Build filters for genres and studios
      let genreFilters = ''
      let studioFilters = ''
      
      if (criteria.genres && criteria.genres.length > 0) {
        genreFilters = criteria.genres.map(genre => `genres.cs.{${genre}}`).join(',')
      }

      if (criteria.studios && criteria.studios.length > 0) {
        studioFilters = criteria.studios.map(studio => `studios.cs.{${studio}}`).join(',')
      }

      // Apply filters
      if (genreFilters && studioFilters) {
        // Combine both genre and studio filters
        query = query.or(`${genreFilters},${studioFilters}`)
      } else if (genreFilters) {
        // Only genre filters
        query = query.or(genreFilters)
      } else if (studioFilters) {
        // Only studio filters
        query = query.or(studioFilters)
      }

      if (criteria.year) {
        query = query.eq('year', criteria.year)
      }

      if (criteria.type) {
        query = query.eq('type', criteria.type)
      }

      if (criteria.status) {
        query = query.eq('status', criteria.status)
      }

      if (criteria.minRating) {
        query = query.gte('rating', criteria.minRating)
      }

      const { data, error } = await query
        .order('rating', { ascending: false })
        .limit(criteria.limit || 20)

      if (error) {
        console.error('Error searching anime by criteria:', error)
        return []
      }

      return data || []
    } catch (error) {
      console.error('Error in searchAnimeByCriteria:', error)
      return []
    }
  }
}
