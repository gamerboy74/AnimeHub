import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SparkleLoadingSpinner } from '../base/LoadingSpinner'
import { UserPreferencesService } from '../../services/user/preferences'

interface GenrePreferencesProps {
  userId: string
  onSave: (genres: string[]) => void
  onCancel: () => void
}

export default function GenrePreferences({ userId, onSave, onCancel }: GenrePreferencesProps) {
  const [availableGenres, setAvailableGenres] = useState<string[]>([])
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load available genres and user's current preferences
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        
        // Load available genres and user preferences in parallel
        const [genres, preferences] = await Promise.all([
          UserPreferencesService.getAvailableGenres(),
          UserPreferencesService.getUserPreferences(userId)
        ])
        
        setAvailableGenres(genres)
        setSelectedGenres(preferences?.favorite_genres || [])
      } catch (error) {
        console.error('Error loading genre preferences:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [userId])

  const handleGenreToggle = (genre: string) => {
    setSelectedGenres(prev => {
      if (prev.includes(genre)) {
        return prev.filter(g => g !== genre)
      } else {
        return [...prev, genre]
      }
    })
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const success = await UserPreferencesService.updateFavoriteGenres(userId, selectedGenres)
      
      if (success) {
        onSave(selectedGenres)
      } else {
        alert('Failed to save preferences. Please try again.')
      }
    } catch (error) {
      console.error('Error saving preferences:', error)
      alert('Failed to save preferences. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleSelectAll = () => {
    setSelectedGenres(availableGenres)
  }

  const handleClearAll = () => {
    setSelectedGenres([])
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <SparkleLoadingSpinner size="md" text="Loading genres..." />
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="bg-white rounded-xl p-6 shadow-lg"
    >
      <div className="mb-6">
        <h3 className="text-2xl font-bold text-teal-800 mb-2">Select Your Favorite Genres</h3>
        <p className="text-teal-600">
          Choose the genres you enjoy most. This helps us recommend anime you'll love!
        </p>
        <div className="mt-3 flex items-center space-x-4 text-sm text-teal-500">
          <span>{selectedGenres.length} selected</span>
          <button
            onClick={handleSelectAll}
            className="text-blue-600 hover:text-blue-700 underline"
          >
            Select All
          </button>
          <button
            onClick={handleClearAll}
            className="text-red-600 hover:text-red-700 underline"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Genre Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6 max-h-96 overflow-y-auto">
        <AnimatePresence>
          {availableGenres.map((genre, index) => {
            const isSelected = selectedGenres.includes(genre)
            return (
              <motion.button
                key={genre}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => handleGenreToggle(genre)}
                className={`p-3 rounded-lg border-2 transition-all duration-200 ${
                  isSelected
                    ? 'border-teal-500 bg-teal-50 text-teal-800 shadow-md'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-teal-300 hover:bg-teal-25'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{genre}</span>
                  {isSelected && (
                    <motion.i
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="ri-check-line text-teal-600 text-sm ml-2"
                    />
                  )}
                </div>
              </motion.button>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Selected Genres Preview */}
      {selectedGenres.length > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mb-6 p-4 bg-teal-50 rounded-lg border border-teal-200"
        >
          <h4 className="font-semibold text-teal-800 mb-2">Your Selected Genres:</h4>
          <div className="flex flex-wrap gap-2">
            {selectedGenres.map((genre) => (
              <motion.span
                key={genre}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="px-3 py-1 bg-teal-600 text-white text-sm rounded-full"
              >
                {genre}
              </motion.span>
            ))}
          </div>
        </motion.div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-end space-x-3">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
              Saving...
            </>
          ) : (
            <>
              <i className="ri-save-line mr-2"></i>
              Save Preferences
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}
