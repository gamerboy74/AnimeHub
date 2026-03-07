import { supabase } from '../../lib/database/supabase'
import type { Tables } from '../../lib/database/supabase'

type UserPreferences = Tables<'user_preferences'>

export interface UserPreferencesData {
  favorite_genres: string[]
  preferred_language: string
  auto_play_next: boolean
  quality_preference: string
  theme_preference: string
  notification_settings: {
    email: boolean
    push: boolean
    recommendations: boolean
  }
  privacy_settings: {
    profile_public: boolean
    watch_history_public: boolean
  }
}

export class UserPreferencesService {
  // Get user preferences
  static async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No preferences found, create default ones
          return await this.createDefaultPreferences(userId)
        }
        console.error('Error fetching user preferences:', error)
        return null
      }

      return data
    } catch (err) {
      console.error('Error fetching user preferences:', err)
      return null
    }
  }

  // Create default preferences for new user
  static async createDefaultPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const defaultPreferences = {
        user_id: userId,
        favorite_genres: [],
        preferred_language: 'en',
        auto_play_next: true,
        quality_preference: 'auto',
        theme_preference: 'light',
        notification_settings: {
          email: true,
          push: true,
          recommendations: true,
          new_episodes: true,
          system_updates: false
        },
        privacy_settings: {
          profile_public: true,
          watch_history_public: false,
          profile_visibility: 'public',
          watch_history_visible: false,
          allow_recommendations: true
        },
        playback_settings: {
          subtitles: true,
          skip_intro: true,
          skip_outro: false,
          continuous_play: true,
          volume: 80
        }
      }

      const { data, error } = await supabase
        .from('user_preferences')
        .insert(defaultPreferences)
        .select()
        .single()

      if (error) {
        console.error('Error creating default preferences:', error)
        return null
      }

      return data
    } catch (err) {
      console.error('Error creating default preferences:', err)
      return null
    }
  }

  // Update user preferences (upsert — creates row if missing)
  static async updateUserPreferences(
    userId: string, 
    updates: Partial<UserPreferencesData>
  ): Promise<UserPreferences | null> {
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(
          {
            user_id: userId,
            ...updates,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        )
        .select()
        .single()

      if (error) {
        console.error('Error updating user preferences:', error)
        throw new Error(error.message)
      }

      return data
    } catch (err) {
      console.error('Error updating user preferences:', err)
      throw err
    }
  }

  // Update favorite genres
  static async updateFavoriteGenres(userId: string, genres: string[]): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_preferences')
        .update({
          favorite_genres: genres,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)

      if (error) {
        console.error('Error updating favorite genres:', error)
        return false
      }

      return true
    } catch (err) {
      console.error('Error updating favorite genres:', err)
      return false
    }
  }

  // Get available genres from anime database
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

      // Extract unique genres from all anime
      const allGenres = data.flatMap(anime => anime.genres || [])
      const uniqueGenres = Array.from(new Set(allGenres)).sort()
      
      return uniqueGenres
    } catch (err) {
      console.error('Error fetching genres:', err)
      return []
    }
  }

  // Get recommended anime based on user's favorite genres
  static async getRecommendedAnime(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const preferences = await this.getUserPreferences(userId)
      if (!preferences || preferences.favorite_genres.length === 0) {
        return []
      }

      const { data, error } = await supabase
        .from('anime')
        .select('*')
        .overlaps('genres', preferences.favorite_genres)
        .limit(limit)

      if (error) {
        console.error('Error fetching recommended anime:', error)
        return []
      }

      return data || []
    } catch (err) {
      console.error('Error fetching recommended anime:', err)
      return []
    }
  }
}
