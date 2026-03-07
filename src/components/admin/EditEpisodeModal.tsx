import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AdminService } from '../../services/admin';

interface EditEpisodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  episode: any;
}

export default function EditEpisodeModal({
  isOpen,
  onClose,
  onSuccess,
  episode
}: EditEpisodeModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    duration: '',
    video_url: '',
    thumbnail_url: '',
    episode_number: 1,
    is_premium: false,
    air_date: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (episode && isOpen) {
      setFormData({
        title: episode.title || '',
        description: episode.description || '',
        duration: episode.duration ? Math.floor(episode.duration / 60).toString() : '',
        video_url: episode.video_url || '',
        thumbnail_url: episode.thumbnail_url || '',
        episode_number: episode.episode_number || 1,
        is_premium: episode.is_premium || false,
        air_date: episode.air_date ? new Date(episode.air_date).toISOString().split('T')[0] : ''
      });
    }
  }, [episode, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!episode?.id) return;

    try {
      setLoading(true);
      setError(null);

      const durationInSeconds = parseInt(formData.duration) * 60;

      await AdminService.updateEpisode(episode.id, {
        title: formData.title,
        description: formData.description,
        duration: durationInSeconds,
        video_url: formData.video_url,
        thumbnail_url: formData.thumbnail_url,
        episode_number: formData.episode_number,
        is_premium: formData.is_premium,
        air_date: formData.air_date
      });

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to update episode:', err);
      setError(err instanceof Error ? err.message : 'Failed to update episode');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : 
              (name === 'episode_number' || name === 'duration') ? parseInt(value) || 0 : value
    }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Edit Episode</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Episode Number */}
            <div>
              <label htmlFor="episode_number" className="block text-sm font-medium text-gray-700 mb-2">
                Episode Number
              </label>
              <input
                type="number"
                id="episode_number"
                name="episode_number"
                value={formData.episode_number}
                onChange={handleChange}
                min="1"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Duration */}
            <div>
              <label htmlFor="duration" className="block text-sm font-medium text-gray-700 mb-2">
                Duration (minutes)
              </label>
              <input
                type="number"
                id="duration"
                name="duration"
                value={formData.duration}
                onChange={handleChange}
                min="1"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Title */}
            <div className="md:col-span-2">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Episode Title
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter episode title"
              />
            </div>

            {/* Description */}
            <div className="md:col-span-2">
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter episode description"
              />
            </div>

            {/* URLs */}
            <div className="md:col-span-2">
              <label htmlFor="video_url" className="block text-sm font-medium text-gray-700 mb-2">
                Video URL
              </label>
              <input
                type="url"
                id="video_url"
                name="video_url"
                value={formData.video_url}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/video.mp4"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="thumbnail_url" className="block text-sm font-medium text-gray-700 mb-2">
                Thumbnail URL
              </label>
              <input
                type="url"
                id="thumbnail_url"
                name="thumbnail_url"
                value={formData.thumbnail_url}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://example.com/thumbnail.jpg"
              />
            </div>

            {/* Air Date and Premium */}
            <div className="md:col-span-2">
              <label htmlFor="air_date" className="block text-sm font-medium text-gray-700 mb-2">
                Air Date
              </label>
              <input
                type="date"
                id="air_date"
                name="air_date"
                value={formData.air_date}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="is_premium"
                  name="is_premium"
                  checked={formData.is_premium}
                  onChange={handleChange}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="is_premium" className="text-sm font-medium text-gray-700">
                  Premium Episode (requires subscription)
                </label>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Updating...</span>
                </div>
              ) : (
                'Update Episode'
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
