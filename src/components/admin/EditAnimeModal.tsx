import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AdminService } from '../../services/admin';

interface EditAnimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  anime: any;
}

export default function EditAnimeModal({ isOpen, onClose, onSuccess, anime }: EditAnimeModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    title_japanese: '',
    description: '',
    poster_url: '',
    banner_url: '',
    trailer_url: '',
    rating: '',
    year: '',
    status: 'draft',
    type: 'TV',
    genres: [] as string[],
    studios: [] as string[],
    total_episodes: '',
    duration: '',
    age_rating: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableGenres] = useState([
    'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery',
    'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
  ]);
  const [availableStudios] = useState([
    'Studio Ghibli', 'Toei Animation', 'Madhouse', 'Bones', 'MAPPA', 'Ufotable',
    'Wit Studio', 'A-1 Pictures', 'Production I.G', 'Kyoto Animation'
  ]);

  useEffect(() => {
    if (anime && isOpen) {
      setFormData({
        title: anime.title || '',
        title_japanese: anime.title_japanese || '',
        description: anime.description || '',
        poster_url: anime.poster_url || '',
        banner_url: anime.banner_url || '',
        trailer_url: anime.trailer_url || '',
        rating: anime.rating?.toString() || '',
        year: anime.year?.toString() || '',
        status: anime.status || 'draft',
        type: anime.type || 'TV',
        genres: anime.genres || [],
        studios: anime.studios || [],
        total_episodes: anime.total_episodes?.toString() || '',
        duration: anime.duration?.toString() || '',
        age_rating: anime.age_rating || ''
      });
    }
  }, [anime, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Validate required fields
    if (!formData.title.trim()) {
      setError('Title is required');
      setLoading(false);
      return;
    }

    try {
      // Convert form data to proper types
      const updateData = {
        title: formData.title || null,
        title_japanese: formData.title_japanese || null,
        description: formData.description || null,
        poster_url: formData.poster_url || null,
        banner_url: formData.banner_url || null,
        trailer_url: formData.trailer_url || null,
        rating: formData.rating ? parseFloat(formData.rating) : null,
        year: formData.year ? parseInt(formData.year) : null,
        status: formData.status,
        type: formData.type,
        genres: formData.genres.length > 0 ? formData.genres : null,
        studios: formData.studios.length > 0 ? formData.studios : null,
        total_episodes: formData.total_episodes ? parseInt(formData.total_episodes) : null,
        duration: formData.duration ? parseInt(formData.duration) : null,
        age_rating: formData.age_rating || null
      };

      console.log('Sending update data:', updateData);
      await AdminService.updateAnime(anime.id, updateData);
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to update anime:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to update anime';
      setError(`Update failed: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenreToggle = (genre: string) => {
    setFormData(prev => ({
      ...prev,
      genres: prev.genres.includes(genre)
        ? prev.genres.filter(g => g !== genre)
        : [...prev.genres, genre]
    }));
  };

  const handleStudioToggle = (studio: string) => {
    setFormData(prev => ({
      ...prev,
      studios: prev.studios.includes(studio)
        ? prev.studios.filter(s => s !== studio)
        : [...prev.studios, studio]
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Edit Anime</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="Anime title"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Japanese Title
              </label>
              <input
                type="text"
                value={formData.title_japanese}
                onChange={(e) => setFormData(prev => ({ ...prev, title_japanese: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="Japanese title"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Year
              </label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="2024"
                min="1900"
                max="2030"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rating
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                value={formData.rating}
                onChange={(e) => setFormData(prev => ({ ...prev, rating: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="8.5"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="published">Published</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type
              </label>
              <select
                value={formData.type}
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="TV">TV</option>
                <option value="Movie">Movie</option>
                <option value="OVA">OVA</option>
                <option value="ONA">ONA</option>
                <option value="Special">Special</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Total Episodes
              </label>
              <input
                type="number"
                value={formData.total_episodes}
                onChange={(e) => setFormData(prev => ({ ...prev, total_episodes: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="12"
                min="1"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Duration (minutes)
              </label>
              <input
                type="number"
                value={formData.duration}
                onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="24"
                min="1"
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
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Anime description..."
            />
          </div>

          {/* URLs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Poster URL
              </label>
              <input
                type="url"
                value={formData.poster_url}
                onChange={(e) => setFormData(prev => ({ ...prev, poster_url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/poster.jpg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Banner URL
              </label>
              <input
                type="url"
                value={formData.banner_url}
                onChange={(e) => setFormData(prev => ({ ...prev, banner_url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/banner.jpg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trailer URL
              </label>
              <input
                type="url"
                value={formData.trailer_url}
                onChange={(e) => setFormData(prev => ({ ...prev, trailer_url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://youtube.com/embed/..."
              />
            </div>
          </div>

          {/* Genres */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Genres
            </label>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {availableGenres.map(genre => (
                <label key={genre} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.genres.includes(genre)}
                    onChange={() => handleGenreToggle(genre)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{genre}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Studios */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Studios
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {availableStudios.map(studio => (
                <label key={studio} className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={formData.studios.includes(studio)}
                    onChange={() => handleStudioToggle(studio)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">{studio}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Updating...' : 'Update Anime'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
