
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../../components/feature/Navbar';
import AnimeCard from '../../components/feature/AnimeCard';
import Button from '../../components/base/Button';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { useWatchlist } from '../../hooks/user/watchlist';
import { useCurrentUser } from '../../hooks/auth/selectors';
import Footer from '../../components/feature/Footer';

export default function WatchlistPage() {
  const [sortBy, setSortBy] = useState('added');
  const [viewMode, setViewMode] = useState('grid');
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { watchlist, loading, error } = useWatchlist();

  // Redirect if not authenticated
  if (!user) {
    navigate('/');
    return null;
  }

  const sortedWatchlist = useMemo(() => {
    const sorted = [...watchlist];
    switch (sortBy) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title));
      case 'rating':
        return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      case 'year':
        return sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'added':
      default:
        return sorted;
    }
  }, [watchlist, sortBy]);

  // Helper function to map database anime to AnimeCard format
  const mapAnimeToCard = (anime: any) => ({
    _id: anime.id,
    title: anime.title,
    cover: anime.poster_url || "https://readdy.ai/api/search-image?query=Anime%20poster%20default&width=300&height=400&seq=watchlist-poster&orientation=portrait",
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



  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.5
      }
    }
  };

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
            <h1 className="text-3xl md:text-4xl font-bold text-teal-800 mb-4 flex items-center">
              <i className="ri-bookmark-line mr-3 text-pink-500"></i>
              My Watchlist
            </h1>
            <p className="text-teal-600 text-lg">Keep track of anime you want to watch</p>
          </motion.div>

          {/* Controls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-8 mb-12"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex items-center gap-4">
                <span className="text-teal-800 font-semibold text-lg">
                  {watchlist.length} anime in your watchlist
                </span>
              </div>

              <div className="flex items-center gap-4">
                {/* View Mode Toggle */}
                <div className="flex bg-green-100 rounded-xl p-1">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                      viewMode === 'grid'
                        ? 'bg-teal-700 text-white shadow-md'
                        : 'text-teal-700 hover:bg-green-200'
                    }`}
                  >
                    <i className="ri-grid-line mr-2"></i>
                    Grid
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
                      viewMode === 'list'
                        ? 'bg-teal-700 text-white shadow-md'
                        : 'text-teal-700 hover:bg-green-200'
                    }`}
                  >
                    <i className="ri-list-unordered mr-2"></i>
                    List
                  </button>
                </div>

                {/* Sort Dropdown */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-4 py-3 pr-12 text-sm bg-white/95 backdrop-blur-sm border border-green-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all duration-200 cursor-pointer appearance-none font-medium"
                  >
                    <option value="added">Recently Added</option>
                    <option value="title">Title A-Z</option>
                    <option value="rating">Highest Rated</option>
                    <option value="year">Newest First</option>
                  </select>
                  <i className="ri-arrow-down-s-line absolute right-4 top-1/2 transform -translate-y-1/2 text-teal-600 pointer-events-none text-lg"></i>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Watchlist Content */}
          {loading ? (
            <div className="text-center py-16">
              <SparkleLoadingSpinner size="lg" text="Loading your watchlist..." />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <i className="ri-error-warning-line text-6xl text-red-400 mb-4"></i>
              <h3 className="text-xl font-semibold text-red-600 mb-2">Error Loading Watchlist</h3>
              <p className="text-red-500 mb-6">{error}</p>
              <Button onClick={() => window.location.reload()}>
                <i className="ri-refresh-line mr-2"></i>
                Try Again
              </Button>
            </div>
          ) : sortedWatchlist.length > 0 ? (
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="mb-16"
            >
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6" style={{ contentVisibility: 'auto', containIntrinsicSize: '1000px' }}>
                  {sortedWatchlist.map((anime, index) => (
                    <motion.div
                      key={anime.id}
                      variants={itemVariants}
                      custom={index}
                      className="relative group"
                    >
                      <AnimeCard {...mapAnimeToCard(anime)} />
                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 mt-4">
                        <button
                          onClick={() => navigate(`/player/${anime.id}/1`)}
                          className="flex-1 bg-teal-600 text-white px-4 py-3 rounded-xl hover:bg-teal-700 transition-colors duration-200 whitespace-nowrap font-semibold text-sm"
                        >
                          <i className="ri-play-fill mr-2"></i>
                          Watch Now
                        </button>
                        <button
                          onClick={() => navigate(`/anime/${anime.id}`)}
                          className="px-3 py-3 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors duration-200 cursor-pointer"
                          title="View details"
                        >
                          <i className="ri-information-line text-lg"></i>
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="space-y-6">
                  {sortedWatchlist.map((anime, index) => (
                    <motion.div
                      key={anime.id}
                      variants={itemVariants}
                      custom={index}
                      className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-white/50 p-8 hover:shadow-2xl transition-all duration-300"
                    >
                      <div className="flex items-center space-x-8">
                        <Link to={`/anime/${anime.id}`} className="flex-shrink-0">
                          <img
                            src={anime.image}
                            srcSet={`${anime.image}?w=96 96w, ${anime.image}?w=128 128w, ${anime.image}?w=160 160w, ${anime.image}?w=192 192w`}
                            sizes="(max-width: 640px) 96px, 128px"
                            alt={anime.title}
                            className="w-24 h-32 object-cover object-top rounded-xl hover:scale-105 transition-transform duration-300 cursor-pointer"
                            width={96}
                            height={128}
                            loading="lazy"
                            decoding="async"
                          />
                        </Link>
                        
                        <div className="flex-1 min-w-0">
                          <Link to={`/anime/${anime.id}`}>
                            <h3 className="text-2xl font-bold text-teal-800 mb-3 hover:text-teal-600 transition-colors duration-200 cursor-pointer">
                              {anime.title}
                            </h3>
                          </Link>
                          
                          <div className="flex flex-wrap gap-3 mb-4">
                            {anime.genres.slice(0, 3).map((genre: string) => (
                              <span
                                key={genre}
                                className="px-3 py-2 bg-teal-100 text-teal-700 text-sm rounded-full font-semibold"
                              >
                                {genre}
                              </span>
                            ))}
                          </div>
                          
                          <div className="flex items-center gap-6 text-sm text-teal-600 mb-4">
                            <span className="flex items-center gap-2 font-semibold">
                              <i className="ri-star-fill text-yellow-500 text-lg"></i>
                              {anime.rating}
                            </span>
                            <span className="font-medium">{anime.year}</span>
                            <span className="font-medium">{anime.episodes} episodes</span>
                          </div>
                          
                          <p className="text-teal-700 leading-relaxed mb-6 text-lg">
                            Experience the magical world of {anime.title}, a captivating story filled with wonder and adventure.
                          </p>
                          
                          {/* Action Buttons */}
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => navigate(`/anime/${anime.id}`)}
                              className="bg-teal-600 text-white px-8 py-3 rounded-xl hover:bg-teal-700 transition-colors duration-200 whitespace-nowrap font-semibold"
                            >
                              <i className="ri-play-fill mr-2"></i>
                              Watch Now
                            </button>
                            <button
                              onClick={() => markAsCompleted(anime.id)}
                              className="px-4 py-3 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors duration-200 cursor-pointer"
                              title="Mark as completed"
                            >
                              <i className="ri-check-line mr-2"></i>
                              Complete
                            </button>
                            <button
                              onClick={() => removeFromWatchlist(anime.id)}
                              className="px-4 py-3 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 transition-colors duration-200 cursor-pointer"
                              title="Remove from watchlist"
                            >
                              <i className="ri-delete-bin-line mr-2"></i>
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </motion.section>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-20"
            >
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-16 max-w-lg mx-auto border border-white/50">
                <i className="ri-bookmark-line text-7xl text-teal-300 mb-6"></i>
                <h3 className="text-2xl font-bold text-teal-800 mb-4">Your watchlist is empty</h3>
                <p className="text-teal-600 mb-8 text-lg leading-relaxed">
                  Start adding anime to keep track of what you want to watch
                </p>
                <Link to="/anime">
                  <Button size="lg">
                    <i className="ri-search-line mr-2"></i>
                    Browse Anime
                  </Button>
                </Link>
              </div>
            </motion.div>
          )}
        </div>
      </main>

      {/* Footer */}
<Footer />
    </div>
  );
}
