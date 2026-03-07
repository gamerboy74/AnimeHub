import { supabase } from '../../lib/database/supabase'

export interface VideoStreamInfo {
  url: string
  quality: '360p' | '480p' | '720p' | '1080p'
  format: 'mp4' | 'webm' | 'm3u8'
  size?: number
  bitrate?: number
}

export class StreamingService {
  // Get video stream URL for an episode
  static async getVideoStream(episodeId: string, userId?: string): Promise<VideoStreamInfo[]> {
    // First, check if user has access to this episode
    const { data: episode, error } = await supabase
      .from('episodes')
      .select(`
        *,
        anime:anime_id (
          id,
          title,
          age_rating
        )
      `)
      .eq('id', episodeId)
      .single()

    if (error || !episode) {
      throw new Error('Episode not found')
    }

    // Check if episode is premium and user has access
    if (episode.is_premium && userId) {
      const { data: user } = await supabase
        .from('users')
        .select('subscription_type')
        .eq('id', userId)
        .single()

      if (!user || user.subscription_type === 'free') {
        throw new Error('Premium content requires subscription')
      }
    }

    // For now, return single quality stream
    // In production, you'd return multiple qualities
    return [
      {
        url: episode.video_url || '',
        quality: '720p',
        format: 'mp4'
      }
    ]
  }

  // Get signed URL for private video files
  static async getSignedVideoUrl(videoPath: string, expiresIn: number = 3600): Promise<string> {
    const { data, error } = await supabase.storage
      .from('anime-videos')
      .createSignedUrl(videoPath, expiresIn)

    if (error) {
      throw new Error(`Failed to get signed URL: ${error.message}`)
    }

    return data.signedUrl
  }

  // Upload video file to storage
  static async uploadVideo(
    file: File, 
    animeId: string, 
    episodeNumber: number,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const fileName = `${animeId}/episode-${episodeNumber}.${file.name.split('.').pop()}`
    
    const { data, error } = await supabase.storage
      .from('anime-videos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
        onUploadProgress: (progress) => {
          if (onProgress) {
            onProgress((progress.loaded / progress.total) * 100)
          }
        }
      })

    if (error) {
      throw new Error(`Failed to upload video: ${error.message}`)
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('anime-videos')
      .getPublicUrl(fileName)

    return urlData.publicUrl
  }

  // Upload thumbnail
  static async uploadThumbnail(
    file: File,
    animeId: string,
    episodeNumber: number
  ): Promise<string> {
    const fileName = `${animeId}/episode-${episodeNumber}-thumb.${file.name.split('.').pop()}`
    
    const { data, error } = await supabase.storage
      .from('anime-thumbnails')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      })

    if (error) {
      throw new Error(`Failed to upload thumbnail: ${error.message}`)
    }

    const { data: urlData } = supabase.storage
      .from('anime-thumbnails')
      .getPublicUrl(fileName)

    return urlData.publicUrl
  }

  // Upload poster/banner
  static async uploadPoster(
    file: File,
    animeId: string,
    type: 'poster' | 'banner'
  ): Promise<string> {
    const bucket = type === 'poster' ? 'anime-posters' : 'anime-banners'
    const fileName = `${animeId}/${type}.${file.name.split('.').pop()}`
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      })

    if (error) {
      throw new Error(`Failed to upload ${type}: ${error.message}`)
    }

    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName)

    return urlData.publicUrl
  }

  // Delete video file
  static async deleteVideo(animeId: string, episodeNumber: number): Promise<boolean> {
    const fileName = `${animeId}/episode-${episodeNumber}`
    
    // Try to delete different video formats
    const formats = ['mp4', 'webm', 'mkv', 'avi']
    const deletePromises = formats.map(format => 
      supabase.storage
        .from('anime-videos')
        .remove([`${fileName}.${format}`])
    )

    const results = await Promise.allSettled(deletePromises)
    
    // Check if at least one deletion was successful
    return results.some(result => result.status === 'fulfilled')
  }

  // Get video analytics (views, completion rate, etc.)
  static async getVideoAnalytics(episodeId: string, dateRange?: { from: string, to: string }) {
    let query = supabase
      .from('user_progress')
      .select('*')
      .eq('episode_id', episodeId)

    if (dateRange) {
      query = query
        .gte('last_watched', dateRange.from)
        .lte('last_watched', dateRange.to)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to get video analytics: ${error.message}`)
    }

    const totalViews = data?.length || 0
    const completedViews = data?.filter(p => p.is_completed).length || 0
    const averageProgress = data?.reduce((sum, p) => sum + p.progress_seconds, 0) / totalViews || 0

    return {
      totalViews,
      completedViews,
      completionRate: totalViews > 0 ? (completedViews / totalViews) * 100 : 0,
      averageProgress
    }
  }

  // Check if user can access premium content
  static async checkPremiumAccess(userId: string): Promise<boolean> {
    if (!userId) return false

    const { data: user, error } = await supabase
      .from('users')
      .select('subscription_type')
      .eq('id', userId)
      .single()

    if (error || !user) return false

    return user.subscription_type !== 'free'
  }

  // Get video quality options based on user subscription
  static getAvailableQualities(subscriptionType: 'free' | 'premium' | 'vip'): VideoStreamInfo['quality'][] {
    switch (subscriptionType) {
      case 'free':
        return ['360p', '480p']
      case 'premium':
        return ['360p', '480p', '720p']
      case 'vip':
        return ['360p', '480p', '720p', '1080p']
      default:
        return ['360p']
    }
  }

  // Generate HLS playlist (for advanced streaming)
  static async generateHLSPlaylist(episodeId: string): Promise<string> {
    // This would typically involve:
    // 1. Checking if HLS files exist
    // 2. Generating m3u8 playlist with different bitrates
    // 3. Returning the playlist URL
    
    // For now, return a placeholder
    return `/api/hls/${episodeId}/playlist.m3u8`
  }

  // Get streaming statistics for admin dashboard
  static async getStreamingStats(dateRange?: { from: string, to: string }) {
    let query = supabase
      .from('user_progress')
      .select(`
        *,
        episode:episode_id (
          anime_id,
          anime:anime_id (
            title
          )
        )
      `)

    if (dateRange) {
      query = query
        .gte('last_watched', dateRange.from)
        .lte('last_watched', dateRange.to)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`Failed to get streaming stats: ${error.message}`)
    }

    // Calculate statistics
    const totalViews = data?.length || 0
    const uniqueUsers = new Set(data?.map(p => p.user_id)).size
    const completedViews = data?.filter(p => p.is_completed).length || 0
    
    // Group by anime
    const animeStats = data?.reduce((acc, progress) => {
      const animeId = progress.episode?.anime_id
      if (animeId) {
        acc[animeId] = (acc[animeId] || 0) + 1
      }
      return acc
    }, {} as Record<string, number>) || {}

    return {
      totalViews,
      uniqueUsers,
      completedViews,
      completionRate: totalViews > 0 ? (completedViews / totalViews) * 100 : 0,
      topAnime: Object.entries(animeStats)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
    }
  }
}
