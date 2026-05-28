import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminAnimeService } from '../../services/admin/anime';

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
    episode_number: '',
    is_premium: false,
    air_date: '',
    video_servers: [] as Array<{ name: string; url: string; lang?: string }>
  });
  
  const [newServer, setNewServer] = useState({
    name: '',
    url: '',
    lang: 'sub'
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
        episode_number: episode.episode_number?.toString() || '1',
        is_premium: episode.is_premium || false,
        air_date: (() => {
          if (!episode.air_date) return '';
          const d = new Date(episode.air_date);
          return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
        })(),
        video_servers: Array.isArray(episode.video_servers) ? episode.video_servers : []
      });
      setError(null);
      setNewServer({ name: '', url: '', lang: 'sub' });
    }
  }, [episode, isOpen]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleAddServer = () => {
    if (!newServer.name.trim() || !newServer.url.trim()) {
      return;
    }
    setFormData(prev => ({
      ...prev,
      video_servers: [
        ...prev.video_servers,
        {
          name: newServer.name.trim(),
          url: newServer.url.trim(),
          lang: newServer.lang
        }
      ]
    }));
    setNewServer({ name: '', url: '', lang: 'sub' });
  };

  const handleRemoveServer = (index: number) => {
    setFormData(prev => ({
      ...prev,
      video_servers: prev.video_servers.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!episode?.id) return;

    if (!formData.episode_number) {
      setError('Episode number is required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const parsedDuration = parseInt(formData.duration);
      const durationInSeconds = isNaN(parsedDuration) ? null : parsedDuration * 60;

      // Clean the updates object
      const updateData = {
        title: formData.title || null,
        description: formData.description || null,
        duration: durationInSeconds,
        video_url: formData.video_url || null,
        thumbnail_url: formData.thumbnail_url || null,
        episode_number: parseInt(formData.episode_number),
        is_premium: formData.is_premium,
        air_date: formData.air_date || null,
        video_servers: formData.video_servers.length > 0 ? formData.video_servers : null
      };

      console.log('Updating episode with data:', updateData);
      await AdminAnimeService.updateEpisode(episode.id, updateData);

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Failed to update episode:', err);
      setError(err instanceof Error ? err.message : 'Failed to update episode');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <i className="ri-play-circle-line text-xl text-white"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Edit Episode</h2>
                <p className="text-white/80 text-xs mt-0.5">Database schema synced episode editor</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white hover:bg-white/10 transition-all p-2 rounded-xl"
            >
              <i className="ri-close-line text-2xl"></i>
            </button>
          </div>

          {/* Modal Body */}
          <div className="overflow-y-auto p-6 space-y-6 flex-1 custom-scrollbar">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3.5 rounded-xl flex items-center gap-3 text-sm font-medium">
                <i className="ri-error-warning-line text-lg flex-shrink-0"></i>
                <p>{error}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Grid 1: Numbers & Meta */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="episode_number" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Episode Number *
                    </label>
                    <input
                      type="number"
                      id="episode_number"
                      name="episode_number"
                      value={formData.episode_number}
                      onChange={handleChange}
                      min="1"
                      required
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 1"
                    />
                  </div>

                  <div>
                    <label htmlFor="duration" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Duration (minutes)
                    </label>
                    <input
                      type="number"
                      id="duration"
                      name="duration"
                      value={formData.duration}
                      onChange={handleChange}
                      min="1"
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 24"
                    />
                  </div>
                </div>
              </div>

              {/* Grid 2: Core Details */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="title" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Episode Title *
                    </label>
                    <input
                      type="text"
                      id="title"
                      name="title"
                      value={formData.title}
                      onChange={handleChange}
                      required
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="Enter episode title"
                    />
                  </div>

                  <div>
                    <label htmlFor="description" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Description
                    </label>
                    <textarea
                      id="description"
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows={4}
                      className="w-full p-4 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="Enter episode description..."
                    />
                  </div>
                </div>
              </div>

              {/* Grid 3: Media Sources */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="video_url" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Video Stream URL *
                    </label>
                    <input
                      type="url"
                      id="video_url"
                      name="video_url"
                      value={formData.video_url}
                      onChange={handleChange}
                      required
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs"
                      placeholder="https://example.com/video.mp4 or iframe embed link"
                    />
                  </div>

                  <div>
                    <label htmlFor="thumbnail_url" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Thumbnail Image URL
                    </label>
                    <input
                      type="url"
                      id="thumbnail_url"
                      name="thumbnail_url"
                      value={formData.thumbnail_url}
                      onChange={handleChange}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs"
                      placeholder="https://example.com/thumbnail.jpg"
                    />
                  </div>
                </div>
              </div>

              {/* Section: Video Streaming Servers */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                  Video Servers & Streams (JSONB)
                </h3>

                {/* List current servers */}
                <div className="space-y-2">
                  {formData.video_servers.map((server, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-slate-300 transition-all">
                      <div className="flex items-center space-x-3 truncate">
                        <div className="flex-shrink-0 px-2 py-0.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold uppercase rounded-md">
                          {server.name}
                        </div>
                        {server.lang && (
                          <div className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded-md border ${
                            server.lang === 'dub' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-blue-50 border-blue-200 text-blue-700'
                          }`}>
                            {server.lang}
                          </div>
                        )}
                        <span className="text-xs text-slate-500 font-mono truncate">{server.url}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveServer(index)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded-lg transition-all flex items-center justify-center flex-shrink-0"
                        title="Remove Server"
                      >
                        <i className="ri-delete-bin-line text-sm"></i>
                      </button>
                    </div>
                  ))}
                  {formData.video_servers.length === 0 && (
                    <div className="text-center py-4 bg-white border border-dashed border-slate-200 rounded-xl">
                      <p className="text-xs text-slate-400 font-medium">No custom server streams configured. Falls back to default Video URL.</p>
                    </div>
                  )}
                </div>

                {/* Add new server form */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
                  <p className="text-xs font-bold text-slate-700">Add New Stream Source</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <input
                        type="text"
                        value={newServer.name}
                        onChange={(e) => setNewServer(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:bg-white outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Server Name (e.g. MegaCloud, Mixdrop)"
                      />
                    </div>
                    <div>
                      <select
                        value={newServer.lang}
                        onChange={(e) => setNewServer(prev => ({ ...prev, lang: e.target.value }))}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:bg-white outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                      >
                        <option value="sub">🇯🇵 Subbed</option>
                        <option value="dub">🇺🇸 Dubbed</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={newServer.url}
                      onChange={(e) => setNewServer(prev => ({ ...prev, url: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:bg-white outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Embed or stream video source URL..."
                    />
                    <button
                      type="button"
                      onClick={handleAddServer}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center flex-shrink-0"
                    >
                      + Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Grid 5: Release & Subscriptions */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="air_date" className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Air Date
                    </label>
                    <input
                      type="date"
                      id="air_date"
                      name="air_date"
                      value={formData.air_date}
                      onChange={handleChange}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center">
                    <label className="flex items-center space-x-3 cursor-pointer mt-4 md:mt-0 select-none">
                      <input
                        type="checkbox"
                        id="is_premium"
                        name="is_premium"
                        checked={formData.is_premium}
                        onChange={handleChange}
                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-bold text-slate-700">
                        ⭐ Premium Episode <span className="text-slate-400 font-medium text-xs">(requires subscription)</span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex justify-end items-center gap-3 pt-6 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="px-6 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold shadow-md hover:shadow-lg transition-all flex items-center gap-2 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Updating...
                    </>
                  ) : (
                    <>
                      <i className="ri-save-line text-base"></i>
                      Update Episode
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
