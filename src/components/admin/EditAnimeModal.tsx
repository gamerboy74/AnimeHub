import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminAnimeService } from '../../services/admin/anime';

interface EditAnimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  anime: any;
}

export default function EditAnimeModal({ isOpen, onClose, onSuccess, anime }: EditAnimeModalProps) {
  const [formData, setFormData] = useState({
    title: '',
    title_english: '',
    title_romaji: '',
    title_japanese: '',
    description: '',
    poster_url: '',
    banner_url: '',
    trailer_url: '',
    rating: '',
    year: '',
    status: 'draft',
    type: 'tv',
    genres: [] as string[],
    studios: [] as string[],
    total_episodes: '',
    duration: '',
    age_rating: 'PG-13',
    mal_id: '',
    nine_anime_slug: ''
  });

  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [availableStudios, setAvailableStudios] = useState<string[]>([]);
  const [newGenre, setNewGenre] = useState('');
  const [newStudio, setNewStudio] = useState('');
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);
  const [showStudioDropdown, setShowStudioDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available genres and studios
  useEffect(() => {
    if (isOpen) {
      const loadData = async () => {
        try {
          const [genres, studios] = await Promise.all([
            AdminAnimeService.getAvailableGenres(),
            AdminAnimeService.getAvailableStudios()
          ]);
          setAvailableGenres(genres);
          setAvailableStudios(studios);
        } catch (err) {
          console.error('Error loading genres/studios:', err);
        }
      };
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (anime && isOpen) {
      setFormData({
        title: anime.title || '',
        title_english: anime.title_english || '',
        title_romaji: anime.title_romaji || '',
        title_japanese: anime.title_japanese || '',
        description: anime.description || '',
        poster_url: anime.poster_url || '',
        banner_url: anime.banner_url || '',
        trailer_url: anime.trailer_url || '',
        rating: anime.rating?.toString() || '',
        year: anime.year?.toString() || '',
        status: anime.status || 'draft',
        type: anime.type || 'tv',
        genres: Array.isArray(anime.genres) ? anime.genres : [],
        studios: Array.isArray(anime.studios) ? anime.studios : [],
        total_episodes: anime.total_episodes?.toString() || '',
        duration: anime.duration?.toString() || '',
        age_rating: anime.age_rating || 'PG-13',
        mal_id: anime.mal_id?.toString() || '',
        nine_anime_slug: anime.nine_anime_slug || ''
      });
      setError(null);
    }
  }, [anime, isOpen]);

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setError(null);
  };

  const handleAddGenre = () => {
    const val = newGenre.trim();
    if (val && !formData.genres.includes(val)) {
      setFormData(prev => ({
        ...prev,
        genres: [...prev.genres, val]
      }));
      setNewGenre('');
    }
  };

  const handleRemoveGenre = (genre: string) => {
    setFormData(prev => ({
      ...prev,
      genres: prev.genres.filter(g => g !== genre)
    }));
  };

  const handleAddStudio = () => {
    const val = newStudio.trim();
    if (val && !formData.studios.includes(val)) {
      setFormData(prev => ({
        ...prev,
        studios: [...prev.studios, val]
      }));
      setNewStudio('');
    }
  };

  const handleRemoveStudio = (studio: string) => {
    setFormData(prev => ({
      ...prev,
      studios: prev.studios.filter(s => s !== studio)
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!formData.title.trim()) {
      setError('Title is required');
      setLoading(false);
      return;
    }

    try {
      const updateData = {
        title: formData.title || null,
        title_english: formData.title_english || null,
        title_romaji: formData.title_romaji || null,
        title_japanese: formData.title_japanese || null,
        description: formData.description || null,
        poster_url: formData.poster_url || null,
        banner_url: formData.banner_url || null,
        trailer_url: formData.trailer_url || null,
        rating: formData.rating ? parseFloat(formData.rating) : null,
        year: formData.year ? parseInt(formData.year) : null,
        status: formData.status as any,
        type: formData.type.toLowerCase() as any,
        genres: formData.genres.length > 0 ? formData.genres : null,
        studios: formData.studios.length > 0 ? formData.studios : null,
        total_episodes: formData.total_episodes ? parseInt(formData.total_episodes) : null,
        duration: formData.duration ? parseInt(formData.duration) : null,
        age_rating: (formData.age_rating || null) as any,
        mal_id: formData.mal_id ? parseInt(formData.mal_id) : null,
        nine_anime_slug: formData.nine_anime_slug || null
      };

      console.log('Updating anime with data:', updateData);
      await AdminAnimeService.updateAnime(anime.id, updateData);
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

  const filteredGenres = availableGenres.filter(
    genre => genre && typeof genre === 'string' && genre.toLowerCase().includes(newGenre.toLowerCase()) && !formData.genres.includes(genre)
  );

  const filteredStudios = availableStudios.filter(
    studio => studio && typeof studio === 'string' && studio.toLowerCase().includes(newStudio.toLowerCase()) && !formData.studios.includes(studio)
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center z-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-100 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <i className="ri-edit-box-line text-xl text-white"></i>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Edit Anime Info</h2>
                <p className="text-white/80 text-xs mt-0.5">Database schema synced administrative editor</p>
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
              {/* Section: Title & Identity */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-blue-500 rounded-full"></span>
                  Title & Identification
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) => handleInputChange('title', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="Anime title"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Japanese Title (Kana/Kanji)
                    </label>
                    <input
                      type="text"
                      value={formData.title_japanese}
                      onChange={(e) => handleInputChange('title_japanese', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="日本語タイトル"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      English Title
                    </label>
                    <input
                      type="text"
                      value={formData.title_english}
                      onChange={(e) => handleInputChange('title_english', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="English release title"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Romaji Title
                    </label>
                    <input
                      type="text"
                      value={formData.title_romaji}
                      onChange={(e) => handleInputChange('title_romaji', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="Romaji transliteration"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      MyAnimeList ID (mal_id)
                    </label>
                    <input
                      type="number"
                      value={formData.mal_id}
                      onChange={(e) => handleInputChange('mal_id', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      placeholder="e.g. 38000"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      9Anime Slug
                    </label>
                    <input
                      type="text"
                      value={formData.nine_anime_slug}
                      onChange={(e) => handleInputChange('nine_anime_slug', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. demon-slayer-kimetsu-no-yaiba.2vv"
                    />
                  </div>
                </div>
              </div>

              {/* Section: Details & Metadata */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                  Metadata & Status
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Type
                    </label>
                    <select
                      value={formData.type}
                      onChange={(e) => handleInputChange('type', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                    >
                      <option value="tv">📺 TV Series</option>
                      <option value="movie">🎬 Movie</option>
                      <option value="ova">💿 OVA</option>
                      <option value="ona">🌐 ONA</option>
                      <option value="special">⭐ Special</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Status
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => handleInputChange('status', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                    >
                      {/* Publication states */}
                      <option value="published">✅ Published</option>
                      <option value="pending">⏳ Pending</option>
                      <option value="draft">📝 Draft</option>
                      {/* Broadcast states */}
                      <option value="ongoing">📡 Ongoing</option>
                      <option value="completed">🏁 Completed</option>
                      <option value="upcoming">🗓️ Upcoming</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Year
                    </label>
                    <input
                      type="number"
                      value={formData.year}
                      onChange={(e) => handleInputChange('year', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 2024"
                      min="1900"
                      max="2035"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Rating (0-10)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="10"
                      value={formData.rating}
                      onChange={(e) => handleInputChange('rating', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 8.5"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Total Episodes
                    </label>
                    <input
                      type="number"
                      value={formData.total_episodes}
                      onChange={(e) => handleInputChange('total_episodes', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 12"
                      min="1"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Duration (min)
                    </label>
                    <input
                      type="number"
                      value={formData.duration}
                      onChange={(e) => handleInputChange('duration', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      placeholder="e.g. 24"
                      min="1"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Age Rating
                    </label>
                    <select
                      value={formData.age_rating}
                      onChange={(e) => handleInputChange('age_rating', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                    >
                      <option value="G">G - General Audiences</option>
                      <option value="PG">PG - Parental Guidance Suggested</option>
                      <option value="PG-13">PG-13 - Teens 13 or older</option>
                      <option value="R">R - 17+ (violence & profanity)</option>
                      <option value="18+">18+ - Mild Nudity / Explicit contents</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section: Description */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-purple-500 rounded-full"></span>
                  Story & Description
                </h3>
                <div>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    rows={4}
                    className="w-full p-4 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    placeholder="Enter full storyline description..."
                  />
                </div>
              </div>

              {/* Section: Visuals & Streams */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-amber-500 rounded-full"></span>
                  Visual Assets & Trailer
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Poster Image URL
                    </label>
                    <input
                      type="url"
                      value={formData.poster_url}
                      onChange={(e) => handleInputChange('poster_url', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs"
                      placeholder="https://example.com/poster.jpg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Banner Image URL
                    </label>
                    <input
                      type="url"
                      value={formData.banner_url}
                      onChange={(e) => handleInputChange('banner_url', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs"
                      placeholder="https://example.com/banner.jpg"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                      Trailer URL (YouTube Link)
                    </label>
                    <input
                      type="url"
                      value={formData.trailer_url}
                      onChange={(e) => handleInputChange('trailer_url', e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-xs"
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </div>
                </div>
              </div>

              {/* Section: Genres & Studios */}
              <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-100 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2 mb-1">
                  <span className="w-1.5 h-3 bg-emerald-500 rounded-full"></span>
                  Dynamic Categorization
                </h3>

                {/* Genres Tags Manager */}
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Genres
                  </label>
                  <div className="flex flex-wrap gap-2 mb-3 bg-white p-3.5 rounded-xl border border-slate-200 min-h-[50px]">
                    {formData.genres.map((genre) => (
                      <span
                        key={genre}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-200"
                      >
                        {genre}
                        <button
                          type="button"
                          onClick={() => handleRemoveGenre(genre)}
                          className="text-blue-500 hover:text-blue-700 transition-colors"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {formData.genres.length === 0 && (
                      <span className="text-xs text-slate-400 self-center">No genres selected</span>
                    )}
                  </div>
                  
                  <div className="relative flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={newGenre}
                        onChange={(e) => {
                          setNewGenre(e.target.value);
                          setShowGenreDropdown(true);
                        }}
                        onFocus={() => setShowGenreDropdown(true)}
                        onBlur={() => setTimeout(() => setShowGenreDropdown(false), 200)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddGenre())}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        placeholder="Search or add custom genre..."
                      />
                      
                      {showGenreDropdown && filteredGenres.length > 0 && (
                        <div className="absolute z-20 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar py-1">
                          {filteredGenres.slice(0, 10).map((genre) => (
                            <button
                              key={genre}
                              type="button"
                              onMouseDown={() => {
                                if (!formData.genres.includes(genre)) {
                                  setFormData(prev => ({
                                    ...prev,
                                    genres: [...prev.genres, genre]
                                  }));
                                }
                                setNewGenre('');
                                setShowGenreDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-sm font-semibold transition-colors flex items-center gap-2"
                            >
                              <i className="ri-add-line text-blue-500"></i> {genre}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddGenre}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm flex-shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Studios Tags Manager */}
                <div className="space-y-3 pt-2">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Studios
                  </label>
                  <div className="flex flex-wrap gap-2 mb-3 bg-white p-3.5 rounded-xl border border-slate-200 min-h-[50px]">
                    {formData.studios.map((studio) => (
                      <span
                        key={studio}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-semibold border border-purple-200"
                      >
                        {studio}
                        <button
                          type="button"
                          onClick={() => handleRemoveStudio(studio)}
                          className="text-purple-500 hover:text-purple-700 transition-colors"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    {formData.studios.length === 0 && (
                      <span className="text-xs text-slate-400 self-center">No studios selected</span>
                    )}
                  </div>
                  
                  <div className="relative flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={newStudio}
                        onChange={(e) => {
                          setNewStudio(e.target.value);
                          setShowStudioDropdown(true);
                        }}
                        onFocus={() => setShowStudioDropdown(true)}
                        onBlur={() => setTimeout(() => setShowStudioDropdown(false), 200)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddStudio())}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        placeholder="Search or add custom studio..."
                      />
                      
                      {showStudioDropdown && filteredStudios.length > 0 && (
                        <div className="absolute z-20 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar py-1">
                          {filteredStudios.slice(0, 10).map((studio) => (
                            <button
                              key={studio}
                              type="button"
                              onMouseDown={() => {
                                if (!formData.studios.includes(studio)) {
                                  setFormData(prev => ({
                                    ...prev,
                                    studios: [...prev.studios, studio]
                                  }));
                                }
                                setNewStudio('');
                                setShowStudioDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2 hover:bg-purple-50 text-slate-700 hover:text-purple-700 text-sm font-semibold transition-colors flex items-center gap-2"
                            >
                              <i className="ri-add-line text-purple-500"></i> {studio}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleAddStudio}
                      className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition-all shadow-sm flex-shrink-0"
                    >
                      Add
                    </button>
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
                      Update Anime
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
