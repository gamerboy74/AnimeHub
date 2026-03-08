export type VideoSourceType = 'youtube' | 'direct' | 'hls' | 'iframe' | 'unknown';

export interface VideoSource {
  quality: string;
  url: string;
  provider: string;
  type: VideoSourceType;
  embedUrl?: string;
}

export interface VideoMetadata {
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  quality: string;
}

export class VideoService {
  /**
   * Detect the type of video source from URL
   */
  static detectVideoSource(url: string): VideoSourceType {
    if (!url) return 'unknown';
    
    const lowerUrl = url.toLowerCase();
    
    // YouTube detection
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
      return 'youtube';
    }
    
    // Anime streaming sites that require iframe embedding
    if (lowerUrl.includes('anikai.to') || 
        lowerUrl.includes('9anime') || 
        lowerUrl.includes('zoro.to') ||
        lowerUrl.includes('gogoanime') ||
        lowerUrl.includes('megaplay') ||
        lowerUrl.includes('megacloud') ||
        lowerUrl.includes('megabackup') ||
        lowerUrl.includes('megacdn') ||
        lowerUrl.includes('megastream') ||
        lowerUrl.match(/mega\./i) || // mega.nz, mega.io, etc.
        lowerUrl.includes('2anime.xyz') ||
        lowerUrl.includes('2m.2anime.xyz') ||
        lowerUrl.includes('hianime.do') ||
        lowerUrl.includes('crunchyroll.com') ||
        lowerUrl.includes('bloggy.click') ||     // megacloud.bloggy.click
        lowerUrl.includes('bysesayeveum.com') ||  // 9anime alternate embed host
        lowerUrl.includes('f75s.com') ||           // bysesayeveum embeddable frame host
        lowerUrl.includes('vidmoly.') ||          // vidmoly embed host (.biz, .net)
        lowerUrl.match(/\/e\/[a-z0-9]+$/i)) {     // Generic /e/<id> embed pattern
      return 'iframe';
    }
    
    // HLS detection - enhanced for better .m3u8 recognition
    if (lowerUrl.includes('.m3u8') || 
        lowerUrl.includes('hls') || 
        lowerUrl.includes('stream') ||
        lowerUrl.match(/\.m3u8(\?|$|#)/)) {
      return 'hls';
    }
    
    // Direct video detection
    if (lowerUrl.match(/\.(mp4|webm|avi|mkv|mov|flv)$/i)) {
      return 'direct';
    }
    
    return 'unknown';
  }

  /**
   * Extract YouTube video ID from various YouTube URL formats
   */
  static extractYouTubeId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
      /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
      /youtube\.com\/embed\/([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Generate YouTube embed URL with optimal settings
   */
  static getYouTubeEmbedUrl(url: string, options: {
    autoplay?: boolean;
    start?: number;
    quality?: string;
    controls?: boolean;
  } = {}): string {
    const videoId = this.extractYouTubeId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    const params = new URLSearchParams({
      autoplay: options.autoplay ? '1' : '0',
      controls: options.controls !== false ? '1' : '0',
      rel: '0', // Don't show related videos
      modestbranding: '1', // Minimal YouTube branding
      fs: '1', // Allow fullscreen
      cc_load_policy: '0', // Don't show captions by default
      iv_load_policy: '3', // Hide annotations
      playsinline: '1', // Play inline on mobile
    });

    if (options.start) {
      params.set('start', options.start.toString());
    }

    if (options.quality) {
      params.set('vq', options.quality);
    }

    return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
  }

  /**
   * Generate proxy URL for direct video sources
   */
  static getDirectVideoProxyUrl(
    originalUrl: string, 
    animeId: string, 
    episodeNumber: number,
    options: {
      quality?: string;
      start?: number;
    } = {}
  ): string {
    const params = new URLSearchParams({
      url: originalUrl,
      animeId,
      episode: episodeNumber.toString(),
    });

    if (options.quality) {
      params.set('quality', options.quality);
    }

    if (options.start) {
      params.set('start', options.start.toString());
    }

    return `/api/video-proxy?${params.toString()}`;
  }

  /**
   * Generate iframe embed URL for streaming sites
   */
  static getIframeEmbedUrl(url: string, options: {
    autoplay?: boolean;
    start?: number;
    quality?: string;
  } = {}): string {
    // For anikai.to and similar sites, we need to use the URL as-is
    // but add necessary parameters for embedding
    const urlObj = new URL(url);
    
    // Add embedding parameters if supported
    if (options.autoplay) {
      urlObj.searchParams.set('autoplay', '1');
    }
    
    if (options.start) {
      urlObj.searchParams.set('t', options.start.toString());
    }
    
    return urlObj.toString();
  }

  /**
   * Check if URL is a streaming site page (not direct video)
   */
  static isStreamingSitePage(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('anikai.to/watch') || 
           lowerUrl.includes('9anime/watch') || 
           lowerUrl.includes('zoro.to/watch') ||
           lowerUrl.includes('gogoanime/watch');
    // Note: HiAnime.do, megaplay, megacloud and other mega variants are embeddable directly
  }

  /**
   * Generate external link fallback for streaming sites
   */
  static getExternalLinkFallback(url: string): { url: string; type: 'external' } {
    return {
      url: url,
      type: 'external'
    };
  }

  /**
   * Process video source and return appropriate URL and metadata
   */
  static processVideoSource(
    source: VideoSource,
    animeId: string,
    episodeNumber: number,
    options: {
      autoplay?: boolean;
      start?: number;
      quality?: string;
    } = {}
  ): { url: string; type: VideoSourceType; metadata: VideoMetadata } {
    const sourceType = this.detectVideoSource(source.url);
    
    let processedUrl: string;
    let metadata: VideoMetadata;

    switch (sourceType) {
      case 'youtube':
        processedUrl = this.getYouTubeEmbedUrl(source.url, {
          autoplay: options.autoplay,
          start: options.start,
          quality: options.quality,
        });
        metadata = {
          title: `Episode ${episodeNumber}`,
          quality: source.quality,
          thumbnail: `https://img.youtube.com/vi/${this.extractYouTubeId(source.url)}/maxresdefault.jpg`
        };
        break;

      case 'iframe':
        // Check if this is a streaming site page (like anikai.to/watch/...)
        if (this.isStreamingSitePage(source.url)) {
          // For streaming site pages, we can't embed them properly
          // Return the URL as-is for external link fallback
          processedUrl = source.url;
          metadata = {
            title: `Episode ${episodeNumber}`,
            quality: source.quality,
          };
        } else {
          // For actual embed URLs, use iframe embedding
          processedUrl = this.getIframeEmbedUrl(source.url, {
            autoplay: options.autoplay,
            start: options.start,
            quality: options.quality,
          });
          metadata = {
            title: `Episode ${episodeNumber}`,
            quality: source.quality,
          };
        }
        break;

      case 'direct':
        processedUrl = this.getDirectVideoProxyUrl(source.url, animeId, episodeNumber, {
          quality: options.quality,
          start: options.start,
        });
        metadata = {
          title: `Episode ${episodeNumber}`,
          quality: source.quality,
        };
        break;

      case 'hls':
        // HLS streams are fetched directly by hls.js — no proxy needed
        // The CDN serves Access-Control-Allow-Origin: * headers
        processedUrl = source.url;
        metadata = {
          title: `Episode ${episodeNumber}`,
          quality: source.quality,
        };
        break;

      default:
        processedUrl = source.url;
        metadata = {
          title: `Episode ${episodeNumber}`,
          quality: source.quality,
        };
    }

    return {
      url: processedUrl,
      type: sourceType,
      metadata
    };
  }

  /**
   * Generate multiple quality sources for YouTube videos
   */
  static generateYouTubeQualities(url: string): VideoSource[] {
    const videoId = this.extractYouTubeId(url);
    if (!videoId) return [];

    return [
      {
        quality: '1080p',
        url: this.getYouTubeEmbedUrl(url, { quality: 'hd1080' }),
        provider: 'YouTube',
        type: 'youtube',
        embedUrl: this.getYouTubeEmbedUrl(url, { quality: 'hd1080' })
      },
      {
        quality: '720p',
        url: this.getYouTubeEmbedUrl(url, { quality: 'hd720' }),
        provider: 'YouTube',
        type: 'youtube',
        embedUrl: this.getYouTubeEmbedUrl(url, { quality: 'hd720' })
      },
      {
        quality: '480p',
        url: this.getYouTubeEmbedUrl(url, { quality: 'medium' }),
        provider: 'YouTube',
        type: 'youtube',
        embedUrl: this.getYouTubeEmbedUrl(url, { quality: 'medium' })
      },
      {
        quality: '360p',
        url: this.getYouTubeEmbedUrl(url, { quality: 'small' }),
        provider: 'YouTube',
        type: 'youtube',
        embedUrl: this.getYouTubeEmbedUrl(url, { quality: 'small' })
      }
    ];
  }

  /**
   * Validate video URL accessibility
   */
  static async validateVideoUrl(url: string, sourceType: VideoSourceType): Promise<boolean> {
    try {
      if (sourceType === 'youtube') {
        // For YouTube, check if video ID is valid
        const videoId = this.extractYouTubeId(url);
        return videoId !== null;
      } else {
        // For direct sources, try to fetch headers
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
      }
    } catch (error) {
      console.error('Video URL validation failed:', error);
      return false;
    }
  }

  /**
   * Get video thumbnail for different source types
   */
  static getVideoThumbnail(url: string, sourceType: VideoSourceType): string {
    switch (sourceType) {
      case 'youtube':
        const videoId = this.extractYouTubeId(url);
        return videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : '';
      
      case 'direct':
      case 'hls':
        // For direct sources, you might want to generate thumbnails
        return '';
      
      default:
        return '';
    }
  }

  /**
   * Parse video duration from various formats
   */
  static parseVideoDuration(duration: string | number): number {
    if (typeof duration === 'number') {
      return duration;
    }

    // Parse formats like "1:23:45" or "23:45" or "45"
    const parts = duration.split(':').map(Number);
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else {
      return parts[0] || 0;
    }
  }

  /**
   * Format duration for display
   */
  static formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
  }
}
