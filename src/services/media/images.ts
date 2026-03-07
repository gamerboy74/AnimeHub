import { supabase } from '../../lib/database/supabase'

interface ImageOptimizationOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'jpeg' | 'png'
  blur?: number
}

interface CachedImage {
  id: string
  original_url: string
  optimized_url: string
  width: number
  height: number
  format: string
  size_bytes: number
  created_at: string
  expires_at: string
}

export class ImageOptimizationService {
  private static readonly CACHE_TABLE = 'image_cache'
  private static readonly CACHE_DURATION = 30 * 24 * 60 * 60 * 1000 // 30 days
  private static readonly MAX_CACHE_SIZE = 1000 // Maximum cached images
  private static readonly CDN_BASE = (typeof window !== 'undefined' ? (window as any).__CDN_BASE_URL : undefined) || import.meta.env.VITE_CDN_BASE_URL || ''

  // Initialize image cache table
  static async initializeImageCache() {
    try {
      const { error } = await supabase.rpc('create_image_cache_table')
      if (error) {
        console.log('Image cache table might already exist:', error.message)
      }
    } catch (error) {
      console.error('Error initializing image cache:', error)
    }
  }

  // Optimize and cache anime poster image
  static async optimizeAnimePoster(
    originalUrl: string, 
    options: ImageOptimizationOptions = {}
  ): Promise<string> {
    try {
      // Check if image is already cached
      const cached = await this.getCachedImage(originalUrl, options)
      if (cached) {
        return cached.optimized_url
      }

      // Generate optimized URL using a service like Cloudinary or similar
      const optimizedUrl = await this.generateOptimizedUrl(originalUrl, options)
      
      // Cache the optimized image
      await this.cacheImage(originalUrl, optimizedUrl, options)
      
      return optimizedUrl
    } catch (error) {
      console.error('Error optimizing image:', error)
      return originalUrl // Fallback to original URL
    }
  }

  // Generate optimized URL (this would integrate with your image service)
  private static async generateOptimizedUrl(
    originalUrl: string, 
    options: ImageOptimizationOptions
  ): Promise<string> {
    const params = new URLSearchParams()
    
    if (options.width) params.append('w', options.width.toString())
    if (options.height) params.append('h', options.height.toString())
    if (options.quality) params.append('q', options.quality.toString())
    if (options.format) params.append('f', options.format)
    if (options.blur) params.append('blur', options.blur.toString())
    
    // If a CDN base is configured, rewrite URL through CDN
    if (this.CDN_BASE) {
      const encoded = encodeURIComponent(originalUrl)
      return `${this.CDN_BASE}/optimize?src=${encoded}&${params.toString()}`
    }
    return `${originalUrl}?${params.toString()}`
  }

  // Get cached image if exists
  private static async getCachedImage(
    originalUrl: string, 
    options: ImageOptimizationOptions
  ): Promise<CachedImage | null> {
    try {
      const cacheKey = this.generateCacheKey(originalUrl, options)
      
      const { data, error } = await supabase
        .from(this.CACHE_TABLE)
        .select('*')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (error || !data) {
        return null
      }

      return data
    } catch (error) {
      console.error('Error getting cached image:', error)
      return null
    }
  }

  // Cache optimized image
  private static async cacheImage(
    originalUrl: string, 
    optimizedUrl: string, 
    options: ImageOptimizationOptions
  ): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(originalUrl, options)
      const expiresAt = new Date(Date.now() + this.CACHE_DURATION)
      
      const { error } = await supabase
        .from(this.CACHE_TABLE)
        .insert({
          cache_key: cacheKey,
          original_url: originalUrl,
          optimized_url: optimizedUrl,
          width: options.width || 0,
          height: options.height || 0,
          format: options.format || 'webp',
          size_bytes: 0, // Would be calculated from actual image
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString()
        })

      if (error) {
        console.error('Error caching image:', error)
      }

      // Clean up old cache entries
      await this.cleanupCache()
    } catch (error) {
      console.error('Error caching image:', error)
    }
  }

  // Generate cache key for image
  private static generateCacheKey(
    originalUrl: string, 
    options: ImageOptimizationOptions
  ): string {
    const optionsStr = JSON.stringify(options)
    return btoa(`${originalUrl}:${optionsStr}`)
  }

  // Clean up old cache entries
  private static async cleanupCache(): Promise<void> {
    try {
      // Delete expired entries
      await supabase
        .from(this.CACHE_TABLE)
        .delete()
        .lt('expires_at', new Date().toISOString())

      // Keep only the most recent entries if cache is too large
      const { data: allEntries } = await supabase
        .from(this.CACHE_TABLE)
        .select('id, created_at')
        .order('created_at', { ascending: false })

      if (allEntries && allEntries.length > this.MAX_CACHE_SIZE) {
        const entriesToDelete = allEntries.slice(this.MAX_CACHE_SIZE)
        const idsToDelete = entriesToDelete.map(entry => entry.id)
        
        await supabase
          .from(this.CACHE_TABLE)
          .delete()
          .in('id', idsToDelete)
      }
    } catch (error) {
      console.error('Error cleaning up cache:', error)
    }
  }

  // Preload images for better performance
  static async preloadImages(urls: string[]): Promise<void> {
    const promises = urls.map(url => {
      return new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => resolve() // Don't fail on error
        img.src = url
      })
    })

    await Promise.all(promises)
  }

  // Get image dimensions
  static async getImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
    try {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => {
          resolve({ width: img.naturalWidth, height: img.naturalHeight })
        }
        img.onerror = () => resolve(null)
        img.src = url
      })
    } catch (error) {
      console.error('Error getting image dimensions:', error)
      return null
    }
  }

  // Generate responsive image URLs
  static generateResponsiveUrls(baseUrl: string): {
    thumbnail: string
    small: string
    medium: string
    large: string
    original: string
  } {
    return {
      thumbnail: `${baseUrl}?w=150&h=200&q=80`,
      small: `${baseUrl}?w=300&h=400&q=85`,
      medium: `${baseUrl}?w=600&h=800&q=90`,
      large: `${baseUrl}?w=1200&h=1600&q=95`,
      original: baseUrl
    }
  }

  // Build srcset string for <img>
  static buildSrcSet(baseUrl: string, widths: number[] = [150, 300, 600, 900, 1200]) {
    return widths.map(w => `${baseUrl}?w=${w} ${w}w`).join(', ')
  }

  // Batch optimize multiple images
  static async batchOptimizeImages(
    images: Array<{ url: string; options: ImageOptimizationOptions }>
  ): Promise<string[]> {
    try {
      const promises = images.map(({ url, options }) => 
        this.optimizeAnimePoster(url, options)
      )
      
      return await Promise.all(promises)
    } catch (error) {
      console.error('Error batch optimizing images:', error)
      return images.map(({ url }) => url) // Return original URLs on error
    }
  }

  // Get cache statistics
  static async getCacheStats(): Promise<{
    totalImages: number
    totalSize: number
    oldestEntry: string | null
    newestEntry: string | null
  }> {
    try {
      const { data, error } = await supabase
        .from(this.CACHE_TABLE)
        .select('size_bytes, created_at')
        .order('created_at', { ascending: false })

      if (error || !data) {
        return { totalImages: 0, totalSize: 0, oldestEntry: null, newestEntry: null }
      }

      const totalSize = data.reduce((sum, entry) => sum + (entry.size_bytes || 0), 0)
      const oldestEntry = data.length > 0 ? data[data.length - 1].created_at : null
      const newestEntry = data.length > 0 ? data[0].created_at : null

      return {
        totalImages: data.length,
        totalSize,
        oldestEntry,
        newestEntry
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
      return { totalImages: 0, totalSize: 0, oldestEntry: null, newestEntry: null }
    }
  }

  // Clear all cache
  static async clearCache(): Promise<void> {
    try {
      await supabase
        .from(this.CACHE_TABLE)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all
    } catch (error) {
      console.error('Error clearing cache:', error)
    }
  }
}
