import { useState } from 'react'
import { motion } from 'framer-motion'

interface TrailerSectionProps {
  trailerUrl: string | null
  title: string
}

export default function TrailerSection({ trailerUrl, title }: TrailerSectionProps) {
  const [isPlaying, setIsPlaying] = useState(false)

  if (!trailerUrl) {
    return null
  }

  // Extract video ID from various platforms
  const getVideoId = (url: string): { platform: string, id: string } | null => {
    // YouTube (including nocookie)
    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube-nocookie\.com\/embed\/)([^&\n?#]+)/
    const youtubeMatch = url.match(youtubeRegex)
    if (youtubeMatch) {
      return { platform: 'youtube', id: youtubeMatch[1] }
    }

    // Dailymotion
    const dailymotionRegex = /(?:dailymotion\.com\/embed\/video\/|dailymotion\.com\/video\/)([^&\n?#]+)/
    const dailymotionMatch = url.match(dailymotionRegex)
    if (dailymotionMatch) {
      return { platform: 'dailymotion', id: dailymotionMatch[1] }
    }

    // Vimeo
    const vimeoRegex = /(?:vimeo\.com\/|player\.vimeo\.com\/video\/)([^&\n?#]+)/
    const vimeoMatch = url.match(vimeoRegex)
    if (vimeoMatch) {
      return { platform: 'vimeo', id: vimeoMatch[1] }
    }

    return null
  }

  // Check if it's a supported video platform
  const isYouTube = trailerUrl.includes('youtube.com') || trailerUrl.includes('youtu.be') || trailerUrl.includes('youtube-nocookie.com')
  const isDailymotion = trailerUrl.includes('dailymotion.com')
  const isVimeo = trailerUrl.includes('vimeo.com')
  const videoInfo = getVideoId(trailerUrl)
  
  // For unsupported URLs, we'll show a simple video player
  if (!videoInfo) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
            <i className="ri-play-circle-line mr-3 text-red-500"></i>
            Official Trailer
          </h2>
        </div>

        <div className="aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
          <video
            controls
            className="w-full h-full"
            poster="https://readdy.ai/api/search-image?query=Anime%20trailer%20thumbnail&width=1280&height=720&seq=video-trailer&orientation=landscape"
          >
            <source src={trailerUrl} type="video/mp4" />
            <source src={trailerUrl} type="video/webm" />
            Your browser does not support the video tag.
          </video>
        </div>
      </motion.section>
    )
  }

  if (!videoInfo) {
    return null
  }

  // Get thumbnail and embed URLs based on platform
  const getThumbnailUrl = (platform: string, id: string): string => {
    switch (platform) {
      case 'youtube':
        return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
      case 'dailymotion':
        return `https://www.dailymotion.com/thumbnail/video/${id}`
      case 'vimeo':
        return `https://vumbnail.com/${id}.jpg`
      default:
        return ''
    }
  }

  const getEmbedUrl = (platform: string, id: string): string => {
    switch (platform) {
      case 'youtube':
        return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`
      case 'dailymotion':
        return `https://www.dailymotion.com/embed/video/${id}`
      case 'vimeo':
        return `https://player.vimeo.com/video/${id}?autoplay=1`
      default:
        return ''
    }
  }

  const thumbnailUrl = getThumbnailUrl(videoInfo.platform, videoInfo.id)
  const embedUrl = getEmbedUrl(videoInfo.platform, videoInfo.id)

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="mb-12"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
          <i className="ri-play-circle-line mr-3 text-red-500"></i>
          Official Trailer
        </h2>
      </div>

      <div className="aspect-video bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {!isPlaying ? (
          // Trailer Preview
          <div className="relative group cursor-pointer h-full" onClick={() => setIsPlaying(true)}>
            <img
              src={thumbnailUrl}
              alt={`${title} Trailer`}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              width={1280}
              height={720}
              loading="lazy"
              onError={(e) => {
                // Fallback to a default thumbnail if YouTube thumbnail fails
                e.currentTarget.src = 'https://readdy.ai/api/search-image?query=Anime%20trailer%20thumbnail&width=1280&height=720&seq=trailer-fallback&orientation=landscape'
              }}
            />
            
            {/* Play Button Overlay */}
            <div className="absolute inset-0 bg-black/30 flex items-center justify-center group-hover:bg-black/20 transition-colors duration-300">
              <div className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-300">
                <i className="ri-play-fill text-white text-3xl ml-1"></i>
              </div>
            </div>

            {/* Trailer Label */}
            <div className="absolute top-4 left-4">
              <div className="bg-red-600 text-white px-3 py-1 rounded-full text-sm font-medium">
                <i className="ri-movie-line mr-1"></i>
                Official Trailer
              </div>
            </div>

            {/* Hover Effect */}
            <div className="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-red-500/50 transition-colors duration-300"></div>
          </div>
        ) : (
          // YouTube Embed
          <div className="relative w-full h-full">
            <iframe
              src={embedUrl}
              title={`${title} Official Trailer`}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
      </div>
    </motion.section>
  )
}
