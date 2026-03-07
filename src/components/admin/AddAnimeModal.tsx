import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AdminAnimeService } from '../../services/admin/anime'
import { isSupabaseConfigured } from '../../lib/database/supabase'
import Button from '../../components/base/Button'
import Input from '../../components/base/Input'
import { SparkleLoadingSpinner } from '../base/LoadingSpinner'

interface AddAnimeModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: (anime: any) => void
}

export default function AddAnimeModal({ isOpen, onClose, onSuccess }: AddAnimeModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    title_japanese: '',
    description: '',
    poster_url: '',
    banner_url: '',
    trailer_url: '',
    rating: 0,
    year: new Date().getFullYear(),
    status: 'ongoing' as 'ongoing' | 'completed' | 'upcoming',
    type: 'tv' as 'tv' | 'movie' | 'ova' | 'special',
    genres: [] as string[],
    studios: [] as string[],
    total_episodes: 1,
    duration: 24,
    age_rating: 'PG-13' as 'G' | 'PG' | 'PG-13' | 'R' | '18+'
  })

  const [availableGenres, setAvailableGenres] = useState<string[]>([])
  const [availableStudios, setAvailableStudios] = useState<string[]>([])
  const [newGenre, setNewGenre] = useState('')
  const [newStudio, setNewStudio] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        title: '',
        title_japanese: '',
        description: '',
        poster_url: '',
        banner_url: '',
        trailer_url: '',
        rating: 0,
        year: new Date().getFullYear(),
        status: 'ongoing',
        type: 'tv',
        genres: [],
        studios: [],
        total_episodes: 1,
        duration: 24,
        age_rating: 'PG-13'
      })
      setError(null)
      setNewGenre('')
      setNewStudio('')
    }
  }, [isOpen])

  // Load available genres and studios
  useEffect(() => {
    if (isOpen) {
      const loadData = async () => {
        try {
          const [genres, studios] = await Promise.all([
            AdminAnimeService.getAvailableGenres(),
            AdminAnimeService.getAvailableStudios()
          ])
          setAvailableGenres(genres)
          setAvailableStudios(studios)
        } catch (err) {
          console.error('Error loading data:', err)
        }
      }
      loadData()
    }
  }, [isOpen])

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
    setError(null)
  }

  const handleAddGenre = () => {
    if (newGenre.trim() && !formData.genres.includes(newGenre.trim())) {
      setFormData(prev => ({
        ...prev,
        genres: [...prev.genres, newGenre.trim()]
      }))
      setNewGenre('')
    }
  }

  const handleRemoveGenre = (genre: string) => {
    setFormData(prev => ({
      ...prev,
      genres: prev.genres.filter(g => g !== genre)
    }))
  }

  const handleAddStudio = () => {
    if (newStudio.trim() && !formData.studios.includes(newStudio.trim())) {
      setFormData(prev => ({
        ...prev,
        studios: [...prev.studios, newStudio.trim()]
      }))
      setNewStudio('')
    }
  }

  const handleDemoData = () => {
    setFormData({
      title: 'Demon Slayer: Kimetsu no Yaiba',
      title_japanese: '鬼滅の刃',
      description: 'A family is attacked by demons and only two members survive - Tanjiro and his sister Nezuko, who is turning into a demon slowly. Tanjiro sets out to become a demon slayer to avenge his family and cure his sister.',
      poster_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400&h=600&fit=crop',
      banner_url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=1200&h=400&fit=crop',
      trailer_url: 'https://www.youtube.com/watch?v=VQGCKyvzIM4',
      rating: 8.7,
      year: 2019,
      status: 'completed' as 'ongoing' | 'completed' | 'upcoming',
      type: 'tv' as 'tv' | 'movie' | 'ova' | 'special',
      genres: ['Action', 'Supernatural', 'Historical', 'Shounen'],
      studios: ['Ufotable'],
      total_episodes: 26,
      duration: 24,
      age_rating: 'R' as 'G' | 'PG' | 'PG-13' | 'R' | '18+'
    })
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    console.log('Form submission started with data:', formData)
    
    if (!isSupabaseConfigured) {
      setError('Database is not configured. Please check your Supabase settings.')
      return
    }
    
    if (!formData.title.trim()) {
      setError('Title is required')
      return
    }

    setLoading(true)
    setError(null)

        try {
          console.log('Calling AdminAnimeService.createAnime with:', formData)
          
          const anime = await AdminAnimeService.createAnime(formData)
          
          console.log('Create anime result:', anime)
          
          if (anime) {
            onSuccess(anime)
            onClose()
          } else {
            setError('Failed to create anime. Please check your database connection and try again.')
          }
        } catch (err) {
          console.error('Error creating anime:', err)
          if (err instanceof Error) {
            setError(err.message)
          } else {
            setError('Failed to create anime. Please try again.')
          }
        } finally {
          setLoading(false)
        }
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
          className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-teal-800">Add New Anime</h2>
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
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Title *
                  </label>
                  <Input
                    type="text"
                    value={formData.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="Anime title"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Japanese Title
                  </label>
                  <Input
                    type="text"
                    value={formData.title_japanese}
                    onChange={(e) => handleInputChange('title_japanese', e.target.value)}
                    placeholder="Japanese title"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Year
                  </label>
                  <Input
                    type="number"
                    value={formData.year || ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? new Date().getFullYear() : parseInt(e.target.value)
                      handleInputChange('year', isNaN(value) ? new Date().getFullYear() : value)
                    }}
                    min="1900"
                    max={new Date().getFullYear() + 1}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rating
                  </label>
                  <Input
                    type="number"
                    value={formData.rating || ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 0 : parseFloat(e.target.value)
                      handleInputChange('rating', isNaN(value) ? 0 : value)
                    }}
                    min="0"
                    max="10"
                    step="0.1"
                    placeholder="0-10"
                  />
                </div>
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
                  rows={4}
                  placeholder="Anime description..."
                />
              </div>

              {/* URLs */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Poster URL
                  </label>
                  <Input
                    type="url"
                    value={formData.poster_url}
                    onChange={(e) => handleInputChange('poster_url', e.target.value)}
                    placeholder="https://example.com/poster.jpg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Banner URL
                  </label>
                  <Input
                    type="url"
                    value={formData.banner_url}
                    onChange={(e) => handleInputChange('banner_url', e.target.value)}
                    placeholder="https://example.com/banner.jpg"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Trailer URL
                  </label>
                  <Input
                    type="url"
                    value={formData.trailer_url}
                    onChange={(e) => handleInputChange('trailer_url', e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                  />
                </div>
              </div>

              {/* Status, Type, Age Rating */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="ongoing">Ongoing</option>
                    <option value="completed">Completed</option>
                    <option value="upcoming">Upcoming</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Type
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => handleInputChange('type', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="tv">TV Series</option>
                    <option value="movie">Movie</option>
                    <option value="ova">OVA</option>
                    <option value="special">Special</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Age Rating
                  </label>
                  <select
                    value={formData.age_rating}
                    onChange={(e) => handleInputChange('age_rating', e.target.value)}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  >
                    <option value="G">G</option>
                    <option value="PG">PG</option>
                    <option value="PG-13">PG-13</option>
                    <option value="R">R</option>
                    <option value="18+">18+</option>
                  </select>
                </div>
              </div>

              {/* Episodes and Duration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Total Episodes
                  </label>
                  <Input
                    type="number"
                    value={formData.total_episodes || ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 1 : parseInt(e.target.value)
                      handleInputChange('total_episodes', isNaN(value) ? 1 : value)
                    }}
                    min="1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Duration (minutes)
                  </label>
                  <Input
                    type="number"
                    value={formData.duration || ''}
                    onChange={(e) => {
                      const value = e.target.value === '' ? 24 : parseInt(e.target.value)
                      handleInputChange('duration', isNaN(value) ? 24 : value)
                    }}
                    min="1"
                    placeholder="24"
                  />
                </div>
              </div>

              {/* Genres */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Genres
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {formData.genres.map((genre) => (
                    <span
                      key={genre}
                      className="px-3 py-1 bg-teal-100 text-teal-800 rounded-full text-sm flex items-center gap-2"
                    >
                      {genre}
                      <button
                        type="button"
                        onClick={() => handleRemoveGenre(genre)}
                        className="text-teal-600 hover:text-teal-800"
                      >
                        <i className="ri-close-line text-sm"></i>
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newGenre}
                    onChange={(e) => setNewGenre(e.target.value)}
                    placeholder="Add genre"
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddGenre())}
                  />
                  <Button type="button" onClick={handleAddGenre} size="sm">
                    Add
                  </Button>
                </div>
              </div>

              {/* Studios */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Studios
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {formData.studios.map((studio) => (
                    <span
                      key={studio}
                      className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm flex items-center gap-2"
                    >
                      {studio}
                      <button
                        type="button"
                        onClick={() => handleRemoveStudio(studio)}
                        className="text-purple-600 hover:text-purple-800"
                      >
                        <i className="ri-close-line text-sm"></i>
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newStudio}
                    onChange={(e) => setNewStudio(e.target.value)}
                    placeholder="Add studio"
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddStudio())}
                  />
                  <Button type="button" onClick={handleAddStudio} size="sm">
                    Add
                  </Button>
                </div>
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
                      <SparkleLoadingSpinner size="sm" text="Creating..." />
                    </>
                  ) : (
                    <>
                      <i className="ri-add-line"></i>
                      Create Anime
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
