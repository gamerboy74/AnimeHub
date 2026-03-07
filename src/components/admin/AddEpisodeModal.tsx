import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AdminAnimeService } from '../../services/admin/anime'
import Button from '../../components/base/Button'
import Input from '../../components/base/Input'

interface AddEpisodeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (episode: any) => void
  animeId: string
  animeTitle: string
  nextEpisodeNumber: number
}

export default function AddEpisodeModal({ 
  isOpen, 
  onClose, 
  onSuccess, 
  animeId, 
  animeTitle, 
  nextEpisodeNumber 
}: AddEpisodeModalProps) {
  const [formData, setFormData] = useState({
    episode_number: nextEpisodeNumber,
    title: '',
    description: '',
    thumbnail_url: '',
    video_url: '',
    duration: 1440, // 24 minutes in seconds
    is_premium: false,
    air_date: new Date().toISOString().split('T')[0]
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError(null)
  }

  const handleDemoData = () => {
    setFormData(prev => ({
      ...prev,
      title: `Episode ${prev.episode_number}: The Journey Begins`,
      description: 'Tanjiro begins his journey to become a demon slayer and save his sister Nezuko. He meets Giyu Tomioka, a demon slayer who will change his life forever.',
      thumbnail_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=225&fit=crop',
      video_url: 'https://www.youtube.com/watch?v=VQGCKyvzIM4',
      duration: 1440, // 24 minutes
      is_premium: false,
      air_date: new Date().toISOString().split('T')[0]
    }))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.episode_number || formData.episode_number < 1) {
      setError('Episode number is required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('AddEpisodeModal: Starting episode creation...')
      console.log('AddEpisodeModal: Episode data:', {
        anime_id: animeId,
        ...formData
      })
      
      // Add timeout to prevent infinite loading
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 10000)
      )
      
      const episodePromise = AdminAnimeService.createEpisode({
        anime_id: animeId,
        ...formData
      })
      
      const episode = await Promise.race([episodePromise, timeoutPromise])
      
      console.log('AddEpisodeModal: Episode creation result:', episode)
      
      if (episode) {
        console.log('AddEpisodeModal: Episode created successfully, calling onSuccess')
        onSuccess(episode)
        onClose()
        // Reset form for next episode
        setFormData(prev => ({
          ...prev,
          episode_number: prev.episode_number + 1,
          title: '',
          description: '',
          thumbnail_url: '',
          video_url: '',
          air_date: new Date().toISOString().split('T')[0]
        }))
      } else {
        console.log('AddEpisodeModal: Episode creation returned null')
        setError('Failed to create episode. Please check your database connection and try again.')
      }
    } catch (err) {
      console.error('AddEpisodeModal: Error creating episode:', err)
      if (err instanceof Error) {
        console.log('AddEpisodeModal: Setting error message:', err.message)
        if (err.message === 'Request timeout') {
          setError('Request timed out. Please check your database connection.')
        } else {
          setError(err.message)
        }
      } else {
        console.log('AddEpisodeModal: Setting generic error message')
        setError('Failed to create episode. Please try again.')
      }
    } finally {
      console.log('AddEpisodeModal: Setting loading to false')
      setLoading(false)
    }
  }

  const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  const parseDuration = (timeString: string) => {
    const [minutes, seconds] = timeString.split(':').map(Number)
    return (minutes * 60) + (seconds || 0)
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-teal-800">Add Episode</h2>
                <p className="text-gray-600">for {animeTitle}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDemoData}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors duration-200 text-sm"
                  title="Fill with demo data for testing"
                >
                  <i className="ri-magic-line mr-2"></i>
                  Demo Data
                </button>
                <button
                  onClick={onClose}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <i className="ri-close-line text-2xl"></i>
                </button>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-100 border border-red-300 text-red-700 rounded-lg">
                <div className="flex items-start gap-3">
                  <i className="ri-error-warning-line text-xl mt-0.5"></i>
                  <div>
                    <p className="font-semibold mb-2">{error}</p>
                    {error.includes('Database not configured') && (
                      <div className="text-sm">
                        <p className="mb-2">To fix this:</p>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                          <li>Create a Supabase project at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">supabase.com</a></li>
                          <li>Create a <code className="bg-red-200 px-1 rounded">.env.local</code> file in your project root</li>
                          <li>Add your Supabase URL and API key</li>
                          <li>Restart the development server</li>
                        </ol>
                        <p className="mt-2 text-xs">
                          See <code className="bg-red-200 px-1 rounded">SUPABASE-SETUP-GUIDE.md</code> for detailed instructions.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Episode Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Episode Number *
                </label>
                <Input
                  type="number"
                  value={formData.episode_number || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? nextEpisodeNumber : parseInt(e.target.value)
                    handleInputChange('episode_number', isNaN(value) ? nextEpisodeNumber : value)
                  }}
                  min="1"
                  required
                />
              </div>

              {/* Episode Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Episode Title
                </label>
                <Input
                  type="text"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder={`Episode ${formData.episode_number}`}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  rows={3}
                  placeholder="Episode description..."
                />
              </div>

              {/* URLs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Thumbnail URL
                  </label>
                  <Input
                    type="url"
                    value={formData.thumbnail_url}
                    onChange={(e) => handleInputChange('thumbnail_url', e.target.value)}
                    placeholder="https://example.com/thumbnail.jpg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Video URL *
                  </label>
                  <Input
                    type="url"
                    value={formData.video_url}
                    onChange={(e) => handleInputChange('video_url', e.target.value)}
                    placeholder="https://example.com/video.mp4"
                    required
                  />
                </div>
              </div>

              {/* Duration and Air Date */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (MM:SS)
                  </label>
                  <Input
                    type="text"
                    value={formatDuration(formData.duration)}
                    onChange={(e) => {
                      const duration = parseDuration(e.target.value)
                      if (!isNaN(duration)) {
                        handleInputChange('duration', duration)
                      }
                    }}
                    placeholder="24:00"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Air Date
                  </label>
                  <Input
                    type="date"
                    value={formData.air_date}
                    onChange={(e) => handleInputChange('air_date', e.target.value)}
                  />
                </div>
              </div>

              {/* Premium Toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_premium"
                  checked={formData.is_premium}
                  onChange={(e) => handleInputChange('is_premium', e.target.checked)}
                  className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500"
                />
                <label htmlFor="is_premium" className="text-sm font-medium text-gray-700">
                  Premium Episode (requires subscription)
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={onClose}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <i className="ri-add-line"></i>
                      Create Episode
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
