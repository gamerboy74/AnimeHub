
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../components/feature/Navbar';
import AnimeCard from '../../components/feature/AnimeCard';
import Button from '../../components/base/Button';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { useFavorites } from '../../hooks/user/favorites';
import { useCurrentUser } from '../../hooks/auth/selectors';
import Footer from '../../components/feature/Footer';

export default function FavoritesPage() {
  const [sortBy, setSortBy] = useState('addedAt');
  const [showToast, setShowToast] = useState<string | null>(null);
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { favorites, loading, error } = useFavorites();

  // Redirect if not authenticated
  if (!user) {
    navigate('/');
    return null;
  }

  const showToastMessage = (message: string) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 3000);
  };


  const sortedFavorites = useMemo(() => {
    const sorted = [...favorites];
    switch (sortBy) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'rating':
        return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      case 'year':
        return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'addedAt':
      default:
        return sorted; // Database already sorts by created_at
    }
  }, [favorites, sortBy]);

  // Helper function to map database anime to AnimeCard format
  const mapAnimeToCard = (anime: any) => ({
    _id: anime.id,
    title: anime.title,
    cover: anime.poster_url || "https://readdy.ai/api/search-image?query=Anime%20poster%20default&width=300&height=400&seq=favorites-poster&orientation=portrait",
    banner: anime.banner_url,
    rating: anime.rating || 0,
    year: anime.year || new Date().getFullYear(),
    totalEpisodes: anime.total_episodes || 1,
    currentEpisode: 0,
    genres: anime.genres || [],
    status: anime.status === 'ongoing' ? 'Ongoing' : 
            anime.status === 'completed' ? 'Completed' : 
            anime.status === 'upcoming' ? 'Upcoming' : 'Ongoing' as 'Ongoing' | 'Completed' | 'Upcoming',
    description: anime.description || '',
    type: anime.type === 'tv' ? 'TV' :
          anime.type === 'movie' ? 'Movie' :
          anime.type === 'ova' ? 'OVA' :
          anime.type === 'special' ? 'Special' : 'TV' as 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special',
    studios: anime.studios || [],
    popularity: 0,
    views: 0
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
      <Navbar />
      
      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="mb-12"
          >
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-8">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold text-teal-800 mb-4 flex items-center">
                    <i className="ri-heart-fill mr-3 text-red-500"></i>
                    My Favorites
                  </h1>
                  <p className="text-teal-600 text-lg">
                    {favorites.length} anime{favorites.length !== 1 ? 's' : ''} in your favorites collection
                  </p>
                </div>
                
                {favorites.length > 0 && (
                  <div className="flex flex-wrap gap-4">
                    <div className="relative">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-4 py-3 pr-12 text-sm bg-white/95 backdrop-blur-sm border border-green-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all duration-200 cursor-pointer appearance-none font-medium"
                      >
                        <option value="addedAt">Recently Added</option>
                        <option value="title">Title A-Z</option>
                        <option value="rating">Highest Rated</option>
                        <option value="year">Newest First</option>
                      </select>
                      <i className="ri-arrow-down-s-line absolute right-4 top-1/2 transform -translate-y-1/2 text-teal-600 pointer-events-none text-lg"></i>
                    </div>
                    
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Content */}
          {loading ? (
            <div className="text-center py-16">
              <SparkleLoadingSpinner size="lg" text="Loading your favorites..." />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <i className="ri-error-warning-line text-6xl text-red-400 mb-4"></i>
              <h3 className="text-xl font-semibold text-red-600 mb-2">Error Loading Favorites</h3>
              <p className="text-red-500 mb-6">{error}</p>
              <Button onClick={() => window.location.reload()}>
                <i className="ri-refresh-line mr-2"></i>
                Try Again
              </Button>
            </div>
          ) : sortedFavorites.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-center py-20"
            >
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-16 max-w-lg mx-auto border border-white/50">
                <i className="ri-heart-line text-7xl text-teal-300 mb-6"></i>
                <h2 className="text-2xl font-bold text-teal-800 mb-4">No favorites yet</h2>
                <p className="text-teal-600 mb-8 leading-relaxed text-lg">
                  Start adding anime to your favorites by clicking the heart icon on any anime card. 
                  Your favorite shows will appear here for easy access.
                </p>
                <Button onClick={() => window.history.back()} size="lg">
                  <i className="ri-arrow-left-line mr-2"></i>
                  Go Back
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 mb-16"
            >
              {sortedFavorites.map((anime, index) => (
                <motion.div
                  key={anime.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.05 * index }}
                >
                  <AnimeCard {...mapAnimeToCard(anime)} />
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Stats Section */}
          {sortedFavorites.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
              className="mb-12"
            >
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-8">
                <h2 className="text-2xl md:text-3xl font-bold text-teal-800 mb-8 flex items-center">
                  <i className="ri-bar-chart-line mr-3 text-green-600"></i>
                  Your Favorites Stats
                </h2>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center p-6 bg-gradient-to-br from-teal-50 to-green-50 rounded-xl border border-green-100">
                    <div className="text-3xl md:text-4xl font-bold text-teal-600 mb-3">
                      {sortedFavorites.length}
                    </div>
                    <div className="text-teal-800 font-semibold">Total Favorites</div>
                  </div>
                  
                  <div className="text-center p-6 bg-gradient-to-br from-green-50 to-yellow-50 rounded-xl border border-yellow-100">
                    <div className="text-3xl md:text-4xl font-bold text-green-600 mb-3">
                      {sortedFavorites.length > 0 ? Math.round(sortedFavorites.reduce((sum, anime) => sum + (anime.rating || 0), 0) / sortedFavorites.length * 10) / 10 : 0}
                    </div>
                    <div className="text-teal-800 font-semibold">Avg Rating</div>
                  </div>
                  
                  <div className="text-center p-6 bg-gradient-to-br from-pink-50 to-red-50 rounded-xl border border-pink-100">
                    <div className="text-3xl md:text-4xl font-bold text-pink-600 mb-3">
                      {sortedFavorites.reduce((sum, anime) => sum + (anime.total_episodes || 0), 0)}
                    </div>
                    <div className="text-teal-800 font-semibold">Total Episodes</div>
                  </div>
                  
                  <div className="text-center p-6 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
                    <div className="text-3xl md:text-4xl font-bold text-purple-600 mb-3">
                      {[...new Set(sortedFavorites.flatMap(anime => anime.genres || []))].length}
                    </div>
                    <div className="text-teal-800 font-semibold">Unique Genres</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Top Genres */}
          {favorites.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="mb-16"
            >
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-8">
                <h3 className="text-xl md:text-2xl font-bold text-teal-800 mb-6 flex items-center">
                  <i className="ri-price-tag-3-line mr-3 text-yellow-600"></i>
                  Your Favorite Genres
                </h3>
                
                <div className="flex flex-wrap gap-3">
                  {Object.entries(
                    favorites.reduce((acc: any, anime) => {
                      anime.genres.forEach((genre: string) => {
                        acc[genre] = (acc[genre] || 0) + 1;
                      });
                      return acc;
                    }, {})
                  )
                    .sort(([,a], [,b]) => (b as number) - (a as number))
                    .slice(0, 10)
                    .map(([genre, count]) => (
                      <span
                        key={genre}
                        className="px-4 py-3 bg-gradient-to-r from-teal-100 to-green-100 text-teal-800 rounded-full font-semibold flex items-center gap-3 border border-green-200 hover:shadow-md transition-all duration-200"
                      >
                        {genre}
                        <span className="bg-teal-200 text-teal-700 px-3 py-1 rounded-full text-sm font-bold">
                          {count}
                        </span>
                      </span>
                    ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
      <Footer />

      {/* Toast Notification */}
      {showToast && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-6 right-6 bg-teal-600 text-white px-8 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-3 backdrop-blur-sm"
        >
          <i className="ri-check-line text-lg"></i>
          <span className="font-medium">{showToast}</span>
        </motion.div>
      )}
    </div>
  );
}
