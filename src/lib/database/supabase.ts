import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Check if Supabase is properly configured
const hasValidConfig = supabaseUrl && 
  supabaseAnonKey && 
  supabaseUrl !== 'your-supabase-url' && 
  supabaseAnonKey !== 'your-supabase-anon-key' &&
  supabaseUrl.startsWith('https://') &&
  supabaseUrl.includes('.supabase.co')

export const isSupabaseConfigured = hasValidConfig

// Create Supabase client
export const supabase = hasValidConfig 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    })

// Log configuration status
if (!hasValidConfig) {
  console.warn(`
🚨 Supabase Authentication Not Configured

Your app is running in demo mode. To enable authentication:

1. Create a .env.local file in your project root
2. Add your Supabase credentials:

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

3. Restart the development server

Get your credentials from: https://supabase.com/dashboard
  `)
} else {
  console.log('✅ Supabase Authentication Configured Successfully!')
}

// Database types
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          username: string
          avatar_url: string | null
          subscription_type: 'free' | 'premium' | 'vip'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          email: string
          username: string
          avatar_url?: string | null
          subscription_type?: 'free' | 'premium' | 'vip'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string
          username?: string
          avatar_url?: string | null
          subscription_type?: 'free' | 'premium' | 'vip'
          created_at?: string
          updated_at?: string
        }
      }
      anime: {
        Row: {
          id: string
          title: string
          title_english: string | null
          title_romaji: string | null
          title_japanese: string | null
          title_synonyms: string[] | null
          mal_id: number | null
          nine_anime_slug: string | null
          description: string | null
          poster_url: string | null
          banner_url: string | null
          trailer_url: string | null
          rating: number | null
          year: number | null
          status: 'ongoing' | 'completed' | 'upcoming' | null
          type: 'tv' | 'movie' | 'ova' | 'special' | null
          genres: string[] | null
          studios: string[] | null
          total_episodes: number | null
          duration: number | null
          age_rating: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          title_english?: string | null
          title_romaji?: string | null
          title_japanese?: string | null
          title_synonyms?: string[] | null
          mal_id?: number | null
          nine_anime_slug?: string | null
          description?: string | null
          poster_url?: string | null
          banner_url?: string | null
          trailer_url?: string | null
          rating?: number | null
          year?: number | null
          status?: 'ongoing' | 'completed' | 'upcoming' | null
          type?: 'tv' | 'movie' | 'ova' | 'special' | null
          genres?: string[] | null
          studios?: string[] | null
          total_episodes?: number | null
          duration?: number | null
          age_rating?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          title_english?: string | null
          title_romaji?: string | null
          title_japanese?: string | null
          title_synonyms?: string[] | null
          mal_id?: number | null
          nine_anime_slug?: string | null
          description?: string | null
          poster_url?: string | null
          banner_url?: string | null
          trailer_url?: string | null
          rating?: number | null
          year?: number | null
          status?: 'ongoing' | 'completed' | 'upcoming' | null
          type?: 'tv' | 'movie' | 'ova' | 'special' | null
          genres?: string[] | null
          studios?: string[] | null
          total_episodes?: number | null
          duration?: number | null
          age_rating?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      episodes: {
        Row: {
          id: string
          anime_id: string
          episode_number: number
          title: string | null
          description: string | null
          thumbnail_url: string | null
          video_url: string | null
          duration: number | null
          is_premium: boolean
          air_date: string | null
          created_at: string
        }
        Insert: {
          id?: string
          anime_id: string
          episode_number: number
          title?: string | null
          description?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
          duration?: number | null
          is_premium?: boolean
          air_date?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          anime_id?: string
          episode_number?: number
          title?: string | null
          description?: string | null
          thumbnail_url?: string | null
          video_url?: string | null
          duration?: number | null
          is_premium?: boolean
          air_date?: string | null
          created_at?: string
        }
      }
      user_progress: {
        Row: {
          id: string
          user_id: string
          episode_id: string
          progress_seconds: number
          is_completed: boolean
          last_watched: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          episode_id: string
          progress_seconds?: number
          is_completed?: boolean
          last_watched?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          episode_id?: string
          progress_seconds?: number
          is_completed?: boolean
          last_watched?: string
          created_at?: string
        }
      }
      user_favorites: {
        Row: {
          id: string
          user_id: string
          anime_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          anime_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          anime_id?: string
          created_at?: string
        }
      }
      user_watchlist: {
        Row: {
          id: string
          user_id: string
          anime_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          anime_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          anime_id?: string
          created_at?: string
        }
      }
      reviews: {
        Row: {
          id: string
          user_id: string
          anime_id: string
          rating: number
          review_text: string | null
          is_spoiler: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          anime_id: string
          rating: number
          review_text?: string | null
          is_spoiler?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          anime_id?: string
          rating?: number
          review_text?: string | null
          is_spoiler?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      user_preferences: {
        Row: {
          id: string
          user_id: string
          favorite_genres: string[]
          preferred_language: string
          auto_play_next: boolean
          quality_preference: string
          theme_preference: string
          notification_settings: any
          privacy_settings: any
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          favorite_genres?: string[]
          preferred_language?: string
          auto_play_next?: boolean
          quality_preference?: string
          theme_preference?: string
          notification_settings?: any
          privacy_settings?: any
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          favorite_genres?: string[]
          preferred_language?: string
          auto_play_next?: boolean
          quality_preference?: string
          theme_preference?: string
          notification_settings?: any
          privacy_settings?: any
          created_at?: string
          updated_at?: string
        }
      }
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
