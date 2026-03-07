import { supabase } from '../../lib/database/supabase'

export interface AdminStats {
  totalUsers: number
  totalAnime: number
  totalEpisodes: number
  totalReviews: number
  recentUsers: number
  activeUsers: number
  premiumUsers: number
  totalWatchTime: string
}

export interface UserManagement {
  id: string
  email: string
  username: string
  avatar_url: string | null
  subscription_type: 'free' | 'premium' | 'vip'
  role: 'user' | 'moderator' | 'admin'
  is_admin: boolean
  created_at: string
  last_login?: string
  total_watch_time?: number
  anime_watched?: number
}

export interface SystemHealth {
  database_status: 'healthy' | 'warning' | 'error'
  api_response_time: number
  storage_usage: number
  active_connections: number
  error_rate: number
}

export interface ContentReport {
  id: string
  content_id: string
  content_type: 'anime' | 'episode'
  report_type: 'inappropriate_content' | 'copyright' | 'spam' | 'other'
  title: string
  description: string
  status: 'pending' | 'investigating' | 'resolved' | 'dismissed'
  priority: 'low' | 'medium' | 'high'
  reported_by: string
  created_at: string
  updated_at: string
  resolved_by?: string
  resolution_notes?: string
}

export interface AnalyticsData {
  userGrowth: Array<{ date: string; users: number }>
  animeViews: Array<{ anime: string; views: number }>
  popularGenres: Array<{ genre: string; count: number }>
  deviceStats: Array<{ device: string; percentage: number }>
  revenueData?: Array<{ date: string; revenue: number }>
}

export interface AdminSettings {
  site_name: string
  site_description: string
  maintenance_mode: boolean
  allow_registration: boolean
  max_file_size: number
  allowed_file_types: string[]
  email_notifications: boolean
  analytics_enabled: boolean
  cache_enabled: boolean
  cache_duration: number
  social_login_enabled: boolean
  premium_features_enabled: boolean
}

export class AdminService {
  // Check if current user is admin
  static async isAdmin(): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return false

      const { data: profile } = await supabase
        .from('users')
        .select('role, is_admin')
        .eq('id', user.id)
        .single()

      return !!(profile?.is_admin || profile?.role === 'admin')
    } catch (error) {
      console.error('Error checking admin status:', error)
      return false
    }
  }

  // Get admin dashboard statistics
  static async getAdminStats(): Promise<AdminStats> {
    try {
      const [
        usersResult,
        animeResult,
        episodesResult,
        reviewsResult,
        recentUsersResult,
        premiumUsersResult
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact' }),
        supabase.from('anime').select('id', { count: 'exact' }),
        supabase.from('episodes').select('id', { count: 'exact' }),
        supabase.from('reviews').select('id', { count: 'exact' }),
        supabase.from('users').select('id', { count: 'exact' }).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
        supabase.from('users').select('id', { count: 'exact' }).neq('subscription_type', 'free')
      ])

      // Calculate active users (users with recent activity)
      const activeUsersResult = await supabase
        .from('user_progress')
        .select('user_id', { count: 'exact' })
        .gte('last_watched', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

      // Calculate total watch time (simplified)
      const watchTimeResult = await supabase
        .from('user_progress')
        .select('progress_seconds')

      const totalWatchTimeSeconds = watchTimeResult.data?.reduce((total, progress) => 
        total + (progress.progress_seconds || 0), 0) || 0

      const totalWatchTimeHours = Math.round(totalWatchTimeSeconds / 3600)

      return {
        totalUsers: usersResult.count || 0,
        totalAnime: animeResult.count || 0,
        totalEpisodes: episodesResult.count || 0,
        totalReviews: reviewsResult.count || 0,
        recentUsers: recentUsersResult.count || 0,
        activeUsers: activeUsersResult.count || 0,
        premiumUsers: premiumUsersResult.count || 0,
        totalWatchTime: `${totalWatchTimeHours} hours`
      }
    } catch (error) {
      console.error('Error fetching admin stats:', error)
      throw new Error('Failed to fetch admin statistics')
    }
  }

  // Get all users for management
  static async getAllUsers(page: number = 1, limit: number = 20): Promise<{ users: UserManagement[], total: number }> {
    try {
      const offset = (page - 1) * limit

      const { data: users, count, error } = await supabase
        .from('users')
        .select(`
          id,
          email,
          username,
          avatar_url,
          subscription_type,
          role,
          is_admin,
          created_at
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      // Get additional user stats
      const userIds = users?.map(u => u.id) || []
      
      const [watchTimeResult, animeWatchedResult] = await Promise.all([
        supabase
          .from('user_progress')
          .select('user_id, progress_seconds')
          .in('user_id', userIds),
        supabase
          .from('user_progress')
          .select('user_id, episode_id')
          .in('user_id', userIds)
          .eq('is_completed', true)
      ])

      // Calculate stats per user
      const userStats = new Map()
      watchTimeResult.data?.forEach(progress => {
        const current = userStats.get(progress.user_id) || { watchTime: 0, animeWatched: 0 }
        userStats.set(progress.user_id, {
          ...current,
          watchTime: current.watchTime + (progress.progress_seconds || 0)
        })
      })

      animeWatchedResult.data?.forEach(progress => {
        const current = userStats.get(progress.user_id) || { watchTime: 0, animeWatched: 0 }
        userStats.set(progress.user_id, {
          ...current,
          animeWatched: current.animeWatched + 1
        })
      })

      const enrichedUsers: UserManagement[] = users?.map(user => ({
        ...user,
        total_watch_time: userStats.get(user.id)?.watchTime || 0, // Keep in seconds
        anime_watched: userStats.get(user.id)?.animeWatched || 0
      })) || []

      return {
        users: enrichedUsers,
        total: count || 0
      }
    } catch (error) {
      console.error('Error fetching users:', error)
      throw new Error('Failed to fetch users')
    }
  }

  // Update user role/subscription
  static async updateUser(userId: string, updates: Partial<UserManagement>): Promise<UserManagement> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Error updating user:', error)
      throw new Error('Failed to update user')
    }
  }

  // Delete user
  static async deleteUser(userId: string): Promise<boolean> {
    try {
      // Check if user is an admin
      const { data: user } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single()

      if (user?.role === 'admin') {
        throw new Error('Cannot delete admin users. Use database directly.')
      }

      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error deleting user:', error)
      throw new Error('Failed to delete user')
    }
  }

  // Get system health
  static async getSystemHealth(): Promise<SystemHealth> {
    try {
      const startTime = Date.now()
      
      // Test database connection
      const { error: dbError } = await supabase
        .from('users')
        .select('id')
        .limit(1)

      const apiResponseTime = Date.now() - startTime
      const database_status = dbError ? 'error' : (apiResponseTime > 1000 ? 'warning' : 'healthy')

      // Get storage usage (simplified)
      const { count: totalRecords } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })

      // Simulate other metrics (in real app, these would come from monitoring)
      const storage_usage = Math.min(100, (totalRecords || 0) / 1000 * 10) // Simplified calculation
      const active_connections = Math.floor(Math.random() * 50) + 10 // Simulated
      const error_rate = dbError ? 100 : Math.random() * 5 // Simulated

      return {
        database_status,
        api_response_time: apiResponseTime,
        storage_usage: Math.round(storage_usage),
        active_connections,
        error_rate: Math.round(error_rate * 100) / 100
      }
    } catch (error) {
      console.error('Error fetching system health:', error)
      return {
        database_status: 'error',
        api_response_time: 0,
        storage_usage: 0,
        active_connections: 0,
        error_rate: 100
      }
    }
  }

  // Get recent activity
  static async getRecentActivity(limit: number = 10): Promise<any[]> {
    try {
      const [newUsers, newReviews, newProgress] = await Promise.all([
        supabase
          .from('users')
          .select('id, username, email, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('reviews')
          .select(`
            id, rating, created_at,
            user:user_id (username),
            anime:anime_id (title)
          `)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('user_progress')
          .select(`
            id, is_completed, last_watched,
            user:user_id (username),
            episode:episode_id (
              title,
              anime:anime_id (title)
            )
          `)
          .order('last_watched', { ascending: false })
          .limit(limit)
      ])

      const activities: any[] = []

      // Add user registrations
      newUsers.data?.forEach(user => {
        activities.push({
          type: 'user_registration',
          user: user.username,
          timestamp: user.created_at,
          description: `${user.username} registered`
        })
      })

      // Add reviews
      newReviews.data?.forEach((review: any) => {
        activities.push({
          type: 'review',
          user: review.user?.username,
          anime: review.anime?.title,
          rating: review.rating,
          timestamp: review.created_at,
          description: `${review.user?.username} rated ${review.anime?.title} ${review.rating}/10`
        })
      })

      // Add watch progress
      newProgress.data?.forEach((progress: any) => {
        activities.push({
          type: progress.is_completed ? 'episode_completed' : 'episode_watched',
          user: progress.user?.username,
          anime: progress.episode?.anime?.title,
          episode: progress.episode?.title,
          timestamp: progress.last_watched,
          description: `${progress.user?.username} ${progress.is_completed ? 'completed' : 'watched'} ${progress.episode?.title}`
        })
      })

      // Sort by timestamp and return top activities
      return activities
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)
    } catch (error) {
      console.error('Error fetching recent activity:', error)
      return []
    }
  }

  // Create admin user (for initial setup)
  static async createAdminUser(email: string, password: string, username: string): Promise<boolean> {
    try {
      // First create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

      if (authError) throw authError

      // Then create user profile with admin role
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: authData.user.id,
          email,
          username,
          role: 'admin',
          is_admin: true,
          subscription_type: 'vip'
        })

      if (profileError) throw profileError
      return true
    } catch (error) {
      console.error('Error creating admin user:', error)
      throw new Error('Failed to create admin user')
    }
  }

  // Content Reports Management
  static async getContentReports(page: number = 1, limit: number = 20): Promise<{ reports: ContentReport[], total: number }> {
    try {
      const offset = (page - 1) * limit

      const { data: reports, count, error } = await supabase
        .from('content_reports')
        .select(`
          *,
          reporter:reported_by(username),
          resolver:resolved_by(username)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      return {
        reports: reports || [],
        total: count || 0
      }
    } catch (error) {
      console.error('Error fetching content reports:', error)
      // Return empty results if table doesn't exist
      return {
        reports: [],
        total: 0
      }
    }
  }

  static async updateReportStatus(reportId: string, status: ContentReport['status'], resolutionNotes?: string): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('content_reports')
        .update({
          status,
          resolved_by: user.id,
          resolution_notes: resolutionNotes,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating report status:', error)
      throw new Error('Failed to update report status')
    }
  }

  static async createContentReport(reportData: Omit<ContentReport, 'id' | 'created_at' | 'updated_at'>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('content_reports')
        .insert({
          ...reportData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error creating content report:', error)
      throw new Error('Failed to create content report')
    }
  }

  // Analytics Data
  static async getAnalyticsData(timeRange: '7d' | '30d' | '90d' = '7d'): Promise<AnalyticsData> {
    try {
      const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

      // User growth data
      const { data: userGrowth } = await supabase
        .from('users')
        .select('created_at')
        .gte('created_at', startDate.toISOString())

      // Process user growth by date
      const growthMap = new Map()
      userGrowth?.forEach(user => {
        const date = new Date(user.created_at).toISOString().split('T')[0]
        growthMap.set(date, (growthMap.get(date) || 0) + 1)
      })

      const userGrowthData = Array.from(growthMap.entries()).map(([date, users]) => ({
        date,
        users
      }))

      // Popular genres
      const { data: genreData } = await supabase
        .from('anime')
        .select('genres')
        .not('genres', 'is', null)

      const genreCount = new Map()
      genreData?.forEach(anime => {
        if (anime.genres) {
          anime.genres.forEach((genre: string) => {
            genreCount.set(genre, (genreCount.get(genre) || 0) + 1)
          })
        }
      })

      const popularGenres = Array.from(genreCount.entries())
        .map(([genre, count]) => ({ genre, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      // Top anime by views (simplified - using watchlist as proxy)
      const { data: animeViews } = await supabase
        .from('user_watchlist')
        .select(`
          anime_id,
          anime:anime_id(title)
        `)

      const animeViewCount = new Map()
      animeViews?.forEach(watchlist => {
        if (watchlist.anime && typeof watchlist.anime === 'object' && 'title' in watchlist.anime) {
          const title = (watchlist.anime as any).title
          animeViewCount.set(title, (animeViewCount.get(title) || 0) + 1)
        }
      })

      const topAnime = Array.from(animeViewCount.entries())
        .map(([anime, views]) => ({ anime, views }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 10)

      // Device stats (mock data for now)
      const deviceStats = [
        { device: 'Desktop', percentage: 45 },
        { device: 'Mobile', percentage: 40 },
        { device: 'Tablet', percentage: 15 }
      ]

      return {
        userGrowth: userGrowthData,
        animeViews: topAnime,
        popularGenres,
        deviceStats
      }
    } catch (error) {
      console.error('Error fetching analytics data:', error)
      throw new Error('Failed to fetch analytics data')
    }
  }

  // Admin Settings
  static async getAdminSettings(): Promise<AdminSettings> {
    try {
      const { data: settings, error } = await supabase
        .from('admin_settings')
        .select('*')
        .single()

      if (error && error.code !== 'PGRST116') throw error

      // Return default settings if none exist
      if (!settings) {
        return {
          site_name: 'AnimeHub',
          site_description: 'Your ultimate anime streaming platform',
          maintenance_mode: false,
          allow_registration: true,
          max_file_size: 5242880,
          allowed_file_types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
          email_notifications: true,
          analytics_enabled: true,
          cache_enabled: true,
          cache_duration: 3600,
          social_login_enabled: true,
          premium_features_enabled: true
        }
      }

      return settings
    } catch (error) {
      console.error('Error fetching admin settings:', error)
      throw new Error('Failed to fetch admin settings')
    }
  }

  static async updateAdminSettings(settings: Partial<AdminSettings>): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('admin_settings')
        .upsert({
          ...settings,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating admin settings:', error)
      throw new Error('Failed to update admin settings')
    }
  }

  // Anime Management Methods
  static async getAllAnime(page: number = 1, limit: number = 20): Promise<{ anime: any[], total: number }> {
    try {
      const offset = (page - 1) * limit

      const { data: anime, count, error } = await supabase
        .from('anime')
        .select(`
          *,
          episodes:episodes(id, title, episode_number, duration, video_url, created_at),
          reviews:reviews(id, rating, created_at)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) throw error

      // Calculate additional stats for each anime
      const enrichedAnime = await Promise.all(anime?.map(async (item) => {
        // Get unique viewers count (users who have watched any episode of this anime)
        const { data: viewers } = await supabase
          .from('user_progress')
          .select('user_id')
          .in('episode_id', item.episodes?.map((ep: any) => ep.id) || [])
          .not('user_id', 'is', null)

        const uniqueViewers = new Set(viewers?.map((v: any) => v.user_id) || []).size

        // Get content reports count for this anime
        let reports = null;
        try {
          const { data: reportsData } = await supabase
            .from('content_reports')
            .select('id')
            .eq('content_id', item.id)
            .eq('content_type', 'anime');
          reports = reportsData;
        } catch (error) {
          // If content_reports table doesn't exist, just return empty array
          console.warn('content_reports table not found, skipping reports count');
          reports = [];
        }

        return {
          ...item,
          episode_count: item.episodes?.length || 0,
          average_rating: item.reviews?.length > 0 
            ? (item.reviews.reduce((sum: number, review: any) => sum + review.rating, 0) / item.reviews.length).toFixed(1)
            : 'N/A',
          total_reviews: item.reviews?.length || 0,
          views: uniqueViewers,
          reports: reports?.length || 0
        }
      }) || [])

      return {
        anime: enrichedAnime,
        total: count || 0
      }
    } catch (error) {
      console.error('Error fetching anime:', error)
      throw new Error('Failed to fetch anime')
    }
  }

  static async createAnime(animeData: any): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('anime')
        .insert({
          ...animeData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error creating anime:', error)
      throw new Error('Failed to create anime')
    }
  }

  static async updateAnime(animeId: string, updates: any): Promise<boolean> {
    try {
      console.log('Updating anime with data:', updates)
      
      // Clean the updates object - remove null/undefined values and convert empty strings to null
      const cleanedUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
        if (value === '' || value === null || value === undefined) {
          acc[key] = null
        } else if (Array.isArray(value) && value.length === 0) {
          acc[key] = null
        } else {
          acc[key] = value
        }
        return acc
      }, {} as any)

      // Add updated_at timestamp
      cleanedUpdates.updated_at = new Date().toISOString()

      console.log('Cleaned updates:', cleanedUpdates)

      const { error } = await supabase
        .from('anime')
        .update(cleanedUpdates)
        .eq('id', animeId)

      if (error) {
        console.error('Supabase update error:', error)
        throw error
      }
      
      console.log('Anime updated successfully')
      return true
    } catch (error) {
      console.error('Error updating anime:', error)
      throw new Error(`Failed to update anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  static async deleteAnime(animeId: string): Promise<boolean> {
    try {
      console.log(`Deleting anime ${animeId} and all related data...`);

      // Get all episodes for this anime first (needed for user_progress cleanup)
      const { data: episodes } = await supabase
        .from('episodes')
        .select('id')
        .eq('anime_id', animeId);

      const episodeIds = episodes?.map(ep => ep.id) || [];

          // Delete related data in proper order
          await Promise.all([
            // Delete user progress for all episodes of this anime
            episodeIds.length > 0 ? supabase.from('user_progress').delete().in('episode_id', episodeIds) : Promise.resolve(),
            
            // Delete reviews for this anime
            supabase.from('reviews').delete().eq('anime_id', animeId),
            
            // Delete user watchlist entries for this anime
            supabase.from('user_watchlist').delete().eq('anime_id', animeId),
            
            // Delete user favorites for this anime
            supabase.from('user_favorites').delete().eq('anime_id', animeId),
            
            // Delete content reports for this anime (with fallback)
            supabase.from('content_reports').delete().eq('content_id', animeId).eq('content_type', 'anime'),
            
            // Delete episodes for this anime (this will cascade to user_progress via ON DELETE CASCADE)
            supabase.from('episodes').delete().eq('anime_id', animeId)
          ]);

      // Finally delete the anime itself
      const { error } = await supabase
        .from('anime')
        .delete()
        .eq('id', animeId);

      if (error) throw error;
      
      console.log(`Successfully deleted anime ${animeId} and all related data`);
      return true;
    } catch (error) {
      console.error('Error deleting anime:', error);
      throw new Error('Failed to delete anime');
    }
  }

  static async updateAnimeStatus(animeId: string, status: 'published' | 'pending' | 'draft'): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('anime')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', animeId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating anime status:', error)
      throw new Error('Failed to update anime status')
    }
  }

  static async bulkUpdateAnimeStatus(animeIds: string[], status: 'published' | 'pending' | 'draft'): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('anime')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .in('id', animeIds)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error bulk updating anime status:', error)
      throw new Error('Failed to bulk update anime status')
    }
  }

  static async bulkDeleteAnime(animeIds: string[]): Promise<boolean> {
    try {
      console.log(`Bulk deleting ${animeIds.length} anime and all related data...`);

      // Get all episodes for these anime first
      const { data: episodes } = await supabase
        .from('episodes')
        .select('id')
        .in('anime_id', animeIds);

      const episodeIds = episodes?.map(ep => ep.id) || [];

          // Delete related data for all anime
          await Promise.all([
            // Delete user progress for all episodes of these anime
            episodeIds.length > 0 ? supabase.from('user_progress').delete().in('episode_id', episodeIds) : Promise.resolve(),
            
            // Delete reviews for these anime
            supabase.from('reviews').delete().in('anime_id', animeIds),
            
            // Delete user watchlist entries for these anime
            supabase.from('user_watchlist').delete().in('anime_id', animeIds),
            
            // Delete user favorites for these anime
            supabase.from('user_favorites').delete().in('anime_id', animeIds),
            
            // Delete content reports for these anime (with fallback)
            supabase.from('content_reports').delete().in('content_id', animeIds).eq('content_type', 'anime'),
            
            // Delete episodes for these anime
            supabase.from('episodes').delete().in('anime_id', animeIds)
          ]);

      // Delete the anime
      const { error } = await supabase
        .from('anime')
        .delete()
        .in('id', animeIds);

      if (error) throw error;
      
      console.log(`Successfully bulk deleted ${animeIds.length} anime and all related data`);
      return true;
    } catch (error) {
      console.error('Error bulk deleting anime:', error);
      throw new Error('Failed to bulk delete anime');
    }
  }

  // Episode Management Methods
  static async getAnimeEpisodes(animeId: string): Promise<any[]> {
    try {
      const { data: episodes, error } = await supabase
        .from('episodes')
        .select('id, episode_number, title, description, duration, thumbnail_url, video_url, created_at')
        .eq('anime_id', animeId)
        .order('episode_number', { ascending: true })
        .limit(50) // Reduced limit for faster queries

      if (error) throw error
      return episodes || []
    } catch (error) {
      console.error('Error fetching anime episodes:', error)
      throw new Error('Failed to fetch episodes')
    }
  }

  static async createEpisode(episodeData: any): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('episodes')
        .insert({
          ...episodeData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error creating episode:', error)
      throw new Error('Failed to create episode')
    }
  }

  static async updateEpisode(episodeId: string, updates: any): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('episodes')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', episodeId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating episode:', error)
      throw new Error('Failed to update episode')
    }
  }

  static async deleteEpisode(episodeId: string): Promise<boolean> {
    try {
      // Delete related data first
      await Promise.all([
        supabase.from('user_progress').delete().eq('episode_id', episodeId),
        supabase.from('reviews').delete().eq('episode_id', episodeId)
      ])

      // Delete the episode
      const { error } = await supabase
        .from('episodes')
        .delete()
        .eq('id', episodeId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error deleting episode:', error)
      throw new Error('Failed to delete episode')
    }
  }

  static async reorderEpisodes(_animeId: string, episodeOrders: { id: string; episode_number: number }[]): Promise<boolean> {
    try {
      const updates = episodeOrders.map(({ id, episode_number }) => 
        supabase
          .from('episodes')
          .update({ 
            episode_number,
            updated_at: new Date().toISOString()
          })
          .eq('id', id)
      )

      await Promise.all(updates)
      return true
    } catch (error) {
      console.error('Error reordering episodes:', error)
      throw new Error('Failed to reorder episodes')
    }
  }

  // User Management Methods
  static async updateUserRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<boolean> {
    try {
      // Check if user is trying to change an admin's role
      const { data: currentUser } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single()

      if (currentUser?.role === 'admin') {
        throw new Error('Cannot change admin role through UI. Use database directly.')
      }

      const { error } = await supabase
        .from('users')
        .update({
          role,
          is_admin: role === 'admin'
        })
        .eq('id', userId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating user role:', error)
      throw new Error('Failed to update user role')
    }
  }

  static async updateUserSubscription(userId: string, subscriptionType: 'free' | 'premium' | 'vip'): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('users')
        .update({
          subscription_type: subscriptionType
        })
        .eq('id', userId)

      if (error) throw error
      return true
    } catch (error) {
      console.error('Error updating user subscription:', error)
      throw new Error('Failed to update user subscription')
    }
  }

  static async getAnimeAnalytics(animeId: string): Promise<any> {
    try {
      // Get anime basic info
      const { data: anime, error: animeError } = await supabase
        .from('anime')
        .select('*')
        .eq('id', animeId)
        .single()

      if (animeError) throw animeError

      // Get episodes for this anime
      const { data: episodes } = await supabase
        .from('episodes')
        .select('id, title, episode_number, duration, video_url, created_at')
        .eq('anime_id', animeId)
        .order('episode_number', { ascending: true })

      // Get reviews for this anime
      const { data: reviews } = await supabase
        .from('reviews')
        .select('id, rating, review_text, created_at, user_id')
        .eq('anime_id', animeId)
        .order('created_at', { ascending: false })

      // Get unique viewers count (users who have watched any episode of this anime)
      const { data: viewers } = await supabase
        .from('user_progress')
        .select('user_id, episode_id, progress_seconds, is_completed, last_watched')
        .in('episode_id', episodes?.map(ep => ep.id) || [])

        // Get content reports for this anime
        let reports = null;
        try {
          const { data: reportsData } = await supabase
            .from('content_reports')
            .select('id, report_type, status, priority, created_at')
            .eq('content_id', animeId)
            .eq('content_type', 'anime');
          reports = reportsData;
        } catch (error) {
          // If content_reports table doesn't exist, just return empty array
          console.warn('content_reports table not found, skipping reports');
          reports = [];
        }

      // Calculate analytics
      const uniqueViewers = new Set(viewers?.map(v => v.user_id) || []).size
      const completedViews = viewers?.filter(v => v.is_completed).length || 0
      const totalWatchTime = viewers?.reduce((sum, v) => sum + (v.progress_seconds || 0), 0) || 0
      const averageRating = reviews && reviews.length > 0 
        ? (reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(1)
        : 'N/A'

      return {
        ...anime,
        episodes: episodes || [],
        reviews: reviews || [],
        analytics: {
          views: uniqueViewers,
          completedViews,
          totalWatchTime,
          averageRating,
          totalReviews: reviews?.length || 0,
          reports: reports?.length || 0,
          episodeCount: episodes?.length || 0
        },
        reports: reports || []
      }
    } catch (error) {
      console.error('Error fetching anime analytics:', error)
      throw new Error('Failed to fetch anime analytics')
    }
  }
}
