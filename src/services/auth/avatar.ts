import { supabase } from '../../lib/database/supabase'

export class AvatarService {
  // Upload avatar image to Supabase storage
  static async uploadAvatar(
    file: File, 
    userId: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('File must be an image')
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      throw new Error('File size must be less than 5MB')
    }

    // Generate unique filename
    const fileExtension = file.name.split('.').pop()
    const fileName = `user-avatars/${userId}/avatar-${Date.now()}.${fileExtension}`
    
    try {
      // Simulate progress for consistency
      if (onProgress) {
        onProgress(50)
      }
      
      // Try to upload to user-avatars bucket first
      let uploadResult = await supabase.storage
        .from('user-avatars')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        })

      // If user-avatars bucket has RLS issues, fallback to anime-posters bucket
      if (uploadResult.error && uploadResult.error.message.includes('row-level security')) {
        console.warn('user-avatars bucket has RLS restrictions, using anime-posters bucket as fallback')
        
        // Use anime-posters bucket as fallback
        const fallbackFileName = `user-avatars/${userId}/avatar-${Date.now()}.${fileExtension}`
        
        uploadResult = await supabase.storage
          .from('anime-posters')
          .upload(fallbackFileName, file, {
            cacheControl: '3600',
            upsert: true
          })
      }

      if (uploadResult.error) {
        throw new Error(`Failed to upload avatar: ${uploadResult.error.message}`)
      }

      // Get public URL from the bucket that worked
      const bucket = uploadResult.data.path.includes('user-avatars') ? 'user-avatars' : 'anime-posters'
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(uploadResult.data.path)

      // Complete progress
      if (onProgress) {
        onProgress(100)
      }

      return urlData.publicUrl
    } catch (error) {
      console.error('Avatar upload error:', error)
      throw error
    }
  }

  // Delete old avatar from storage
  static async deleteAvatar(avatarUrl: string): Promise<void> {
    try {
      // Extract file path from URL
      const url = new URL(avatarUrl)
      const pathParts = url.pathname.split('/')
      const folderPath = pathParts.slice(-2).join('/') // Get folder/filename
      
      // Determine which bucket to use based on URL
      const bucket = avatarUrl.includes('anime-posters') ? 'anime-posters' : 'user-avatars'
      
      // Delete from storage
      const { error } = await supabase.storage
        .from(bucket)
        .remove([folderPath])

      if (error) {
        console.warn('Failed to delete old avatar:', error.message)
        // Don't throw error as this is not critical
      }
    } catch (error) {
      console.warn('Error deleting old avatar:', error)
      // Don't throw error as this is not critical
    }
  }

  // Get avatar URL with fallback
  static getAvatarUrl(avatarUrl?: string | null, userId?: string): string {
    if (avatarUrl) {
      return avatarUrl
    }
    
    // Fallback to generated avatar
    return `https://readdy.ai/api/search-image?query=anime%20character%20avatar%2C%20friendly%20face%2C%20${userId || 'user'}%2C%20simple%20background%2C%20portrait&width=150&height=150&seq=avatar-${userId || 'default'}&orientation=squarish`
  }
}
