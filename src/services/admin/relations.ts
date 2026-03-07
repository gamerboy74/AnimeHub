import { supabase } from '../../lib/database/supabase'
import { AnimeRelationsService } from '../anime/relations'

export class AdminRelationsService {
  // Add anime relation
  static async addAnimeRelation(
    animeId: string, 
    relatedAnimeId: string, 
    relationType: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await AnimeRelationsService.createAnimeRelation(animeId, relatedAnimeId, relationType)
      
      if (success) {
        return { success: true }
      } else {
        return { success: false, error: 'Failed to create anime relation' }
      }
    } catch (error) {
      console.error('Error adding anime relation:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  // Remove anime relation
  static async removeAnimeRelation(relationId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('anime_relations')
        .delete()
        .eq('id', relationId)

      if (error) {
        console.error('Error removing anime relation:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error removing anime relation:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  // Add anime character
  static async addAnimeCharacter(
    animeId: string,
    characterData: {
      name: string
      name_japanese?: string
      name_romaji?: string
      image_url?: string
      role: string
      description?: string
      voice_actor?: string
      voice_actor_japanese?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const success = await AnimeRelationsService.createAnimeCharacter({
        anime_id: animeId,
        ...characterData
      })

      if (success) {
        return { success: true }
      } else {
        return { success: false, error: 'Failed to create anime character' }
      }
    } catch (error) {
      console.error('Error adding anime character:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  // Update anime character
  static async updateAnimeCharacter(
    characterId: string,
    characterData: {
      name?: string
      name_japanese?: string
      name_romaji?: string
      image_url?: string
      role?: string
      description?: string
      voice_actor?: string
      voice_actor_japanese?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('anime_characters')
        .update(characterData)
        .eq('id', characterId)

      if (error) {
        console.error('Error updating anime character:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error updating anime character:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  // Delete anime character
  static async deleteAnimeCharacter(characterId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('anime_characters')
        .delete()
        .eq('id', characterId)

      if (error) {
        console.error('Error deleting anime character:', error)
        return { success: false, error: error.message }
      }

      return { success: true }
    } catch (error) {
      console.error('Error deleting anime character:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }
    }
  }

  // Bulk import anime relations from external APIs
  static async importAnimeRelationsFromAPI(animeId: string): Promise<{ 
    success: boolean; 
    imported: number; 
    errors: string[] 
  }> {
    try {
      // This would integrate with external APIs like AniList or MyAnimeList
      // to automatically fetch and import relations
      
      // For now, return a placeholder response
      return {
        success: true,
        imported: 0,
        errors: ['API integration not yet implemented']
      }
    } catch (error) {
      console.error('Error importing anime relations:', error)
      return {
        success: false,
        imported: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  // Get all anime relations for admin management
  static async getAllAnimeRelations(
    page: number = 1, 
    limit: number = 20
  ): Promise<{ 
    data: any[]; 
    total: number; 
    error?: string 
  }> {
    try {
      const from = (page - 1) * limit
      const to = from + limit - 1

      const { data, error, count } = await supabase
        .from('anime_relations')
        .select(`
          *,
          anime:anime!anime_relations_anime_id_fkey (id, title, poster_url),
          related_anime:anime!anime_relations_related_anime_id_fkey (id, title, poster_url)
        `, { count: 'exact' })
        .range(from, to)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching anime relations:', error)
        return { data: [], total: 0, error: error.message }
      }

      return {
        data: data || [],
        total: count || 0
      }
    } catch (error) {
      console.error('Error in getAllAnimeRelations:', error)
      return {
        data: [],
        total: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Get all anime characters for admin management
  static async getAllAnimeCharacters(
    animeId?: string,
    page: number = 1, 
    limit: number = 20
  ): Promise<{ 
    data: any[]; 
    total: number; 
    error?: string 
  }> {
    try {
      const from = (page - 1) * limit
      const to = from + limit - 1

      let query = supabase
        .from('anime_characters')
        .select(`
          *,
          anime:anime!anime_characters_anime_id_fkey (id, title, poster_url)
        `, { count: 'exact' })

      if (animeId) {
        query = query.eq('anime_id', animeId)
      }

      const { data, error, count } = await query
        .range(from, to)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching anime characters:', error)
        return { data: [], total: 0, error: error.message }
      }

      return {
        data: data || [],
        total: count || 0
      }
    } catch (error) {
      console.error('Error in getAllAnimeCharacters:', error)
      return {
        data: [],
        total: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  // Search anime for relation management
  static async searchAnimeForRelations(
    query: string, 
    limit: number = 10
  ): Promise<{ 
    data: any[]; 
    error?: string 
  }> {
    try {
      const { data, error } = await supabase
        .from('anime')
        .select('id, title, title_japanese, poster_url, year, type, status')
        .or(`title.ilike.%${query}%,title_japanese.ilike.%${query}%`)
        .order('title')
        .limit(limit)

      if (error) {
        console.error('Error searching anime:', error)
        return { data: [], error: error.message }
      }

      return {
        data: data || []
      }
    } catch (error) {
      console.error('Error in searchAnimeForRelations:', error)
      return {
        data: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }
}
