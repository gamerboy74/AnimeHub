import { useState, useEffect, useMemo, useCallback, useTransition, Suspense } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '../../components/feature/Navbar';
import AnimeCard from '../../components/feature/AnimeCard';
import { LazyTrailerSection, LazyRelatedAnime, LazyAnimeCharacters } from '../../components/lazy';
import ReviewSection from '../../components/feature/ReviewSection';
import Button from '../../components/base/Button';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { useCurrentUser } from '../../hooks/auth/selectors';
import { useAnimeById, useAnime, useRelatedSeasons } from '../../hooks/useAnime';
import SeasonTabs from '../../components/feature/SeasonTabs';
import { useWatchlist } from '../../hooks/user/watchlist';
import { useFavorites } from '../../hooks/user/favorites';
import { generatePlayerUrl } from '../../utils/media/player';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import { SectionError, ContentError } from '../../components/common/ErrorFallbacks';
import Footer from '../../components/feature/Footer';

// Interface for type safety
interface Anime {
  id: string;
  title: string;
  poster_url?: string | null;
  banner_url?: string | null;
  rating?: number | null;
  year?: number | null;
  total_episodes?: number | null;
  episodes?: any[] | null;
  genres?: string[] | null;
  status?: 'ongoing' | 'completed' | 'upcoming' | null;
  description?: string | null;
  type?: 'tv' | 'movie' | 'ova' | 'ona' | 'special' | null;
  studios?: string[] | null;
  trailer_url?: string | null;
  user_progress?: any[] | null;
  duration?: number | null;
}

export default function AnimeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedEpisode, setSelectedEpisode] = useState(1);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [watchlistStatus, setWatchlistStatus] = useState(false); // Replaced useOptimistic
  const [favoriteStatus, setFavoriteStatus] = useState(false); // Replaced useOptimistic
  const [watchProgress, setWatchProgress] = useState(0);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const [isPending, startTransition] = useTransition();

  const { anime, loading: animeLoading, error: animeError, refetch } = useAnimeById(id!, user?.id);
  const { anime: similarAnime } = useAnime({ limit: 6 });

  // Fetch related seasons for the season tabs
  const { seasons } = useRelatedSeasons(
    id!,
    anime?.title ?? '',
    (anime as any)?.title_english ?? null,
  );

  // Check watchlist and favorites status
  const { addToWatchlist, removeFromWatchlist, isInWatchlist: checkWatchlist } = useWatchlist();
  const { addToFavorites, removeFromFavorites, isInFavorites: checkFavorites } = useFavorites();

  // Update metadata with poster image (not banner) to prevent banner preload warnings
  useEffect(() => {
    if (!anime || animeLoading) return;
    
    // Remove any existing banner preload links that might cause warnings
    const existingPreloads = document.querySelectorAll('link[rel="preload"][as="image"]');
    existingPreloads.forEach((link) => {
      const href = link.getAttribute('href') || '';
      // Remove preloads for banner images from anilist
      if (href.includes('anilistcdn/media/anime/banner')) {
        link.remove();
      }
    });
    
    // Set og:image to poster_url instead of banner_url to prevent banner preloading
    // Posters are more appropriate for social sharing and smaller/faster to load
    if (anime.poster_url) {
      let ogImage = document.querySelector('meta[property="og:image"]');
      if (!ogImage) {
        ogImage = document.createElement('meta');
        ogImage.setAttribute('property', 'og:image');
        document.head.appendChild(ogImage);
      }
      ogImage.setAttribute('content', anime.poster_url);
    }
  }, [anime, animeLoading]);

  useEffect(() => {
    const checkUserData = async () => {
      if (!anime || animeLoading) return;

      try {
        if (user) {
          const [watchlistResult, favoritesResult] = await Promise.all([
            checkWatchlist(anime.id),
            checkFavorites(anime.id),
          ]);
          setWatchlistStatus(watchlistResult); // Regular state update
          setFavoriteStatus(favoritesResult); // Regular state update

          // Extract continue watching data
          if (anime.user_progress?.length) {
            const recentProgress = anime.user_progress
              .filter((progress: any) => !progress.is_completed)
              .sort((a: any, b: any) => new Date(b.last_watched).getTime() - new Date(a.last_watched).getTime())[0];
            if (recentProgress) {
              const episode = anime.episodes?.find((ep: any) => ep.id === recentProgress.episode_id);
              if (episode) {
                setWatchProgress(episode.episode_number);
                setProgressSeconds(recentProgress.progress_seconds);
              }
            }
          }
        } else {
          // LocalStorage fallback for non-logged-in users
          const savedFavorites = JSON.parse(localStorage.getItem('favorites') || '[]');
          const savedWatchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
          setFavoriteStatus(savedFavorites.some((item: any) => item.id === anime.id));
          setWatchlistStatus(savedWatchlist.some((item: any) => item.id === anime.id));
        }
      } catch (error) {
        console.error('Error checking user data:', error);
        // Optionally log to Sentry: Sentry.captureException(error);
      }
    };

    checkUserData();
  }, [anime, user, checkWatchlist, checkFavorites, animeLoading]);

  // Toast notification handler
  const showToastMessage = useCallback((message: string) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 3000);
  }, []);

  // Watchlist toggle with optimistic update
  const handleWatchlistToggle = useCallback(async () => {
    if (!anime) return;

    startTransition(() => {
      const wasInWatchlist = watchlistStatus;
      setWatchlistStatus(!wasInWatchlist); // Optimistic update

      // Perform async operation
      (async () => {
        try {
          if (!user) {
            navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
            return;
          }
          if (wasInWatchlist) {
            await removeFromWatchlist(anime.id);
            showToastMessage('Removed from watchlist');
          } else {
            await addToWatchlist(anime.id);
            showToastMessage('Added to watchlist');
          }
        } catch (error) {
          console.error('Error updating watchlist:', error);
          setWatchlistStatus(wasInWatchlist); // Revert on error
          showToastMessage('Failed to update watchlist. Please try again.');
        }
      })();
    });
  }, [anime, user, watchlistStatus, addToWatchlist, removeFromWatchlist, showToastMessage]);

  // Favorites toggle with optimistic update
  const handleFavoriteToggle = useCallback(async () => {
    if (!anime) return;

    startTransition(() => {
      const wasFavorite = favoriteStatus;
      setFavoriteStatus(!wasFavorite); // Optimistic update

      // Perform async operation
      (async () => {
        try {
          if (!user) {
            navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
            return;
          }
          if (wasFavorite) {
            await removeFromFavorites(anime.id);
            showToastMessage('Removed from favorites');
          } else {
            await addToFavorites(anime.id);
            showToastMessage('Added to favorites');
          }
        } catch (error) {
          console.error('Error updating favorites:', error);
          setFavoriteStatus(wasFavorite); // Revert on error
          showToastMessage('Failed to update favorites. Please try again.');
        }
      })();
    });
  }, [anime, user, favoriteStatus, addToFavorites, removeFromFavorites, showToastMessage]);

  // Episode click handler
  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      startTransition(() => {
        setSelectedEpisode(episodeNumber);
        if (anime) {
          const savedProgress = JSON.parse(localStorage.getItem('watchProgress') || '{}');
          const newProgress = Math.max(savedProgress[anime.id] || 0, episodeNumber);
          localStorage.setItem('watchProgress', JSON.stringify({ ...savedProgress, [anime.id]: newProgress }));
          setWatchProgress(newProgress);
        }
      });
    },
    [anime]
  );

  // Memoized episodes
  const episodes = useMemo(() => {
    if (!anime) return [];
    return (
      anime.episodes ||
      Array.from({ length: anime.total_episodes || 1 }, (_, i) => ({
        id: `${anime.id}-ep-${i + 1}`,
        episode_number: i + 1,
        title: `Episode ${i + 1}`,
        thumbnail_url: `https://readdy.ai/api/search-image?query=Anime%20episode%20scene%20from%20${encodeURIComponent(
          anime.title
        )}%2C%20Studio%20Ghibli%20style%2C%20magical%20atmosphere%2C%20detailed%20animation%20frame%2C%20simple%20background&width=200&height=120&seq=ep${i + 1}&orientation=landscape`,
        duration: anime.duration || 1470, // 24:30 in seconds
      }))
    );
  }, [anime]);

  // Loading state
  if (animeLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <SparkleLoadingSpinner size="xl" text="Loading anime details..." />
        </div>
      </div>
    );
  }

  // Error state
  if (animeError || !anime) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-16 max-w-md mx-auto border border-white/50">
              <i className="ri-error-warning-line text-7xl text-teal-300 mb-6" aria-hidden="true" />
              <h2 className="text-2xl font-bold text-teal-800 mb-4">Anime not found</h2>
              <p className="text-teal-600 mb-6 text-lg">The anime you're looking for doesn't exist.</p>
              <Link to="/anime">
                <Button size="lg" aria-label="Browse anime">
                  Browse Anime
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
      <Navbar />

      {/* Hero Section */}
      <div className="relative">
        {/* Background Image */}
        <div className="absolute inset-0 h-96 md:h-[500px] lg:h-[600px]">
          <img
            src={
              (anime.banner_url && typeof anime.banner_url === 'string' && anime.banner_url.trim())
                ? anime.banner_url
                : (anime.poster_url && typeof anime.poster_url === 'string' && anime.poster_url.trim())
                  ? anime.poster_url
                  : '/assets/images/default-anime-banner.jpg'
            }
            alt={`${anime.title} banner`}
            className="w-full h-full object-cover"
            width={1920}
            height={600}
            decoding="async"
            fetchPriority="auto"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement;
              // If already tried default banner, hide the image
              if (target.src.includes('default-anime-banner.jpg')) {
                target.style.display = 'none';
              } else {
                // Fallback to default banner
                target.src = '/assets/images/default-anime-banner.jpg';
              }
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/30" />
          <div className="absolute inset-0 backdrop-blur-sm" />
        </div>

        {/* Content */}
        <ErrorBoundary
          fallback={
            <ContentError
              title="Anime Details Error"
              message="Couldn't load anime details. Please try again."
              retry={refetch}
            />
          }
        >
          <div className="relative z-10 min-h-[400px] md:min-h-[500px] lg:min-h-[600px] flex items-end">
            <div className="w-full px-4 sm:px-6 lg:px-8 py-12">
              <div className="max-w-7xl mx-auto">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-center">
                  {/* Poster */}
                  <motion.div
                    initial={{ opacity: 0, x: -50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.8 }}
                    className="lg:col-span-1"
                  >
                    <div className="w-64 h-96 mx-auto lg:mx-0 rounded-2xl overflow-hidden shadow-2xl">
                      <img
                        src={anime.poster_url && typeof anime.poster_url === 'string' && anime.poster_url.trim() ? anime.poster_url : '/assets/images/default-anime-poster.jpg'}
                        srcSet={anime.poster_url && typeof anime.poster_url === 'string' && anime.poster_url.trim() ? `${anime.poster_url}?w=200 200w, ${anime.poster_url}?w=300 300w, ${anime.poster_url}?w=450 450w, ${anime.poster_url}?w=600 600w` : undefined}
                        sizes="(max-width: 640px) 200px, 300px"
                        alt={`${anime.title} poster`}
                        className="w-full h-full object-cover"
                        width={300}
                        height={450}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const target = e.currentTarget as HTMLImageElement;
                          // If already tried local fallback, use readdy.ai as last resort
                          if (target.src.includes('default-anime-poster.jpg')) {
                            target.src = 'https://readdy.ai/api/search-image?query=Anime%20poster&width=300&height=450&seq=anime-poster-fallback&orientation=portrait';
                          } else {
                            target.src = '/assets/images/default-anime-poster.jpg';
                          }
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* Info */}
                  <motion.div
                    initial={{ opacity: 0, x: 50 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                    className="lg:col-span-2 text-white"
                  >
                    <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold mb-4 leading-tight break-words hyphens-auto">
                      {anime.title}
                    </h1>

                    {/* Stats */}
                    <div className="flex flex-wrap items-center gap-4 mb-4" role="list" aria-label="Anime statistics">
                      {anime.rating && (
                        <div
                          role="listitem"
                          className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/40 shadow-lg"
                        >
                          <i className="ri-star-fill text-yellow-400 text-lg" aria-hidden="true" />
                          <span className="font-bold text-lg">{anime.rating}</span>
                        </div>
                      )}
                      {anime.year && (
                        <div
                          role="listitem"
                          className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/40 shadow-lg"
                        >
                          <i className="ri-calendar-line text-blue-300 text-lg" aria-hidden="true" />
                          <span className="font-semibold">{anime.year}</span>
                        </div>
                      )}
                      {anime.total_episodes && anime.total_episodes > 0 && (
                        <div
                          role="listitem"
                          className="flex items-center gap-2 bg-white/20 backdrop-blur-md px-6 py-3 rounded-full border border-white/40 shadow-lg"
                        >
                          <i className="ri-calendar-check-line text-purple-300 text-lg" aria-hidden="true" />
                          <span className="font-semibold">{anime.total_episodes} episodes planned</span>
                        </div>
                      )}
                      {anime.status && (
                        <span
                          role="listitem"
                          className={`px-6 py-3 rounded-full text-sm font-bold backdrop-blur-md border border-white/40 shadow-lg ${
                            anime.status === 'completed'
                              ? 'bg-green-500/60 text-white'
                              : anime.status === 'ongoing'
                              ? 'bg-blue-500/60 text-white'
                              : 'bg-teal-500/60 text-white'
                          }`}
                        >
                          {anime.status.charAt(0).toUpperCase() + anime.status.slice(1)}
                        </span>
                      )}
                    </div>

                    {/* Genres */}
                    {anime.genres?.length && (
                      <div className="flex flex-wrap gap-2 mb-4" role="list" aria-label="Anime genres">
                        {anime.genres.map((genre: string, index: number) => {
                          const colors = [
                            'bg-gradient-to-r from-pink-500/80 to-rose-500/80',
                            'bg-gradient-to-r from-blue-500/80 to-cyan-500/80',
                            'bg-gradient-to-r from-green-500/80 to-emerald-500/80',
                            'bg-gradient-to-r from-purple-500/80 to-violet-500/80',
                            'bg-gradient-to-r from-orange-500/80 to-yellow-500/80',
                            'bg-gradient-to-r from-red-500/80 to-pink-500/80',
                            'bg-gradient-to-r from-indigo-500/80 to-blue-500/80',
                            'bg-gradient-to-r from-teal-500/80 to-green-500/80',
                          ];
                          const colorClass = colors[index % colors.length];

                          return (
                            <span
                              key={genre}
                              role="listitem"
                              className={`px-4 py-2 ${colorClass} backdrop-blur-md text-white text-sm rounded-full font-semibold border border-white/50 shadow-lg hover:scale-105 transition-transform duration-200`}
                            >
                              {genre}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Description */}
                    {anime.description && (
                      <div className="bg-white/15 backdrop-blur-md rounded-2xl p-6 mb-6 border border-white/40 shadow-lg max-w-3xl">
                        <h3 className="text-white/90 text-sm font-semibold uppercase tracking-wider mb-4 opacity-80">
                          Synopsis
                        </h3>
                        <p className="text-white text-base leading-relaxed font-normal tracking-wide">
                          {anime.description.length > 300 ? `${anime.description.substring(0, 300)}...` : anime.description}
                        </p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-wrap gap-4">
                      {anime.episodes?.length ? (
                        <Link to={generatePlayerUrl(anime.id, watchProgress > 0 ? watchProgress : 1, watchProgress > 0 ? progressSeconds : undefined)}>
                          <motion.div
                            whileHover={{ scale: 1.08, boxShadow: '0 20px 40px rgba(59, 130, 246, 0.4)', y: -3 }}
                            whileTap={{ scale: 0.95 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                          >
                            <Button
                              size="lg"
                              className="bg-gradient-to-r from-blue-600/80 to-purple-600/80 hover:from-blue-700/90 hover:to-purple-700/90 backdrop-blur-lg text-white px-8 py-4 text-lg font-bold border border-white/60 shadow-xl hover:shadow-2xl transition-all duration-300"
                              aria-label={watchProgress > 0 ? 'Continue watching' : 'Watch now'}
                              disabled={isPending}
                            >
                              <motion.i
                                className="ri-play-fill mr-2"
                                animate={{ scale: [1, 1.1, 1] }}
                                transition={{ duration: 2, repeat: Infinity }}
                                aria-hidden="true"
                              />
                              {watchProgress > 0 ? 'Continue Watching' : 'Watch Now'}
                            </Button>
                          </motion.div>
                        </Link>
                      ) : (
                        <motion.div
                          whileHover={{ scale: 1.02, boxShadow: '0 10px 20px rgba(107, 114, 128, 0.2)', y: -1 }}
                          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                        >
                          <Button
                            size="lg"
                            disabled
                            className="bg-gradient-to-r from-gray-600/60 to-gray-700/60 backdrop-blur-lg text-white/70 px-8 py-4 text-lg font-bold border border-white/40 shadow-lg cursor-not-allowed opacity-75"
                            aria-label="Upcoming anime"
                          >
                            <i className="ri-calendar-line mr-2" aria-hidden="true" />
                            Upcoming
                          </Button>
                        </motion.div>
                      )}

                      <motion.div
                        whileHover={{ scale: 1.05, boxShadow: '0 15px 30px rgba(255, 255, 255, 0.2)', y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={handleWatchlistToggle}
                          className="bg-white/25 backdrop-blur-lg text-white border-white/60 hover:bg-white/35 px-8 py-4 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
                          aria-label={watchlistStatus ? 'Remove from watchlist' : 'Add to watchlist'}
                          disabled={isPending}
                        >
                          <motion.i
                            className={`mr-2 ${watchlistStatus ? 'ri-check-line' : 'ri-add-line'}`}
                            animate={watchlistStatus ? { rotate: [0, 10, -10, 0] } : {}}
                            transition={{ duration: 0.5 }}
                            aria-hidden="true"
                          />
                          {watchlistStatus ? 'In Watchlist' : 'Add to Watchlist'}
                        </Button>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05, boxShadow: '0 15px 30px rgba(255, 255, 255, 0.2)', y: -2 }}
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        <Button
                          variant="secondary"
                          size="lg"
                          onClick={handleFavoriteToggle}
                          className="bg-white/25 backdrop-blur-lg text-white border-white/60 hover:bg-white/35 px-8 py-4 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
                          aria-label={favoriteStatus ? 'Remove from favorites' : 'Add to favorites'}
                          disabled={isPending}
                        >
                          <motion.i
                            className={`mr-2 ${favoriteStatus ? 'ri-heart-fill text-red-400' : 'ri-heart-line'}`}
                            animate={favoriteStatus ? { scale: [1, 1.2, 1] } : {}}
                            transition={{ duration: 0.6 }}
                            aria-hidden="true"
                          />
                          {favoriteStatus ? 'Favorited' : 'Add to Favorites'}
                        </Button>
                      </motion.div>
                    </div>
                  </motion.div>
                </div>
              </div>
            </div>
          </div>
        </ErrorBoundary>
      </div>

      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Pending Indicator */}
          {isPending && (
            <div className="fixed top-4 right-4 z-50">
              <SparkleLoadingSpinner size="sm" text="Updating..." />
            </div>
          )}

          {/* Progress Bar */}
          {watchlistStatus && watchProgress > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="mb-16"
              aria-labelledby="progress-heading"
            >
              <h2 id="progress-heading" className="sr-only">
                Your Watching Progress
              </h2>
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/50">
                <div className="flex justify-between text-sm text-teal-600 mb-3 font-medium">
                  <span>Your Progress</span>
                  <span>
                    {watchProgress}/{anime.total_episodes || anime.episodes?.length || 0} episodes
                  </span>
                </div>
                <div className="w-full bg-teal-100 rounded-full h-3">
                  <div
                    className="bg-teal-500 h-3 rounded-full transition-all duration-300"
                    style={{
                      width: `${(watchProgress / (anime.total_episodes || anime.episodes?.length || 1)) * 100}%`,
                    }}
                    role="progressbar"
                    aria-valuenow={watchProgress}
                    aria-valuemin={0}
                    aria-valuemax={anime.total_episodes || anime.episodes?.length || 1}
                    aria-label="Watch progress"
                  />
                </div>
              </div>
            </motion.section>
          )}

          {/* Episodes Section */}
          <ErrorBoundary
            fallback={<SectionError title="Episodes Error" message="Couldn't load episodes list. Please try again." retry={refetch} />}
          >
            <motion.section
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.6 }}
              className="mb-16"
              aria-labelledby="episodes-heading"
            >
              <h2 id="episodes-heading" className="text-2xl md:text-3xl font-bold text-teal-800 mb-8 flex items-center">
                <i className="ri-play-list-line mr-3 text-green-600" aria-hidden="true" />
                Episodes
              </h2>
              <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-8 border border-white/50">
                {/* Season Tabs */}
                <SeasonTabs seasons={seasons} currentAnimeId={anime.id} />
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '1000px' }}
                  role="list"
                  aria-label="Episode list"
                >
                  {episodes.map((episode: any) => {
                    const episodeNumber = episode.episode_number || episode.number;
                    const episodeTitle = episode.title || `Episode ${episodeNumber}`;
                    const episodeDuration = episode.duration;

                    return (
                      <motion.div
                        key={episode.id || episodeNumber}
                        whileHover={{ scale: 1.02, y: -2 }}
                        className={`p-6 rounded-xl border-2 transition-all duration-300 cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                          selectedEpisode === episodeNumber
                            ? 'border-teal-500 bg-gradient-to-br from-teal-50 to-teal-100 shadow-lg'
                            : episodeNumber <= watchProgress
                            ? 'border-green-300 bg-gradient-to-br from-green-50 to-green-100 shadow-md'
                            : 'border-gray-200 hover:border-teal-300 hover:bg-gradient-to-br hover:from-teal-50 hover:to-teal-100 hover:shadow-md'
                        }`}
                        role="listitem"
                        onClick={() => handleEpisodeClick(episodeNumber)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            handleEpisodeClick(episodeNumber);
                          }
                        }}
                      >
                        <Link
                          to={`/player/${anime.id}/${episodeNumber}`}
                          className="block"
                          aria-label={`Watch episode ${episodeNumber} of ${anime.title}`}
                        >
                          <div className="flex items-center space-x-4">
                            <div
                              className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${
                                selectedEpisode === episodeNumber
                                  ? 'bg-teal-500 text-white shadow-lg'
                                  : episodeNumber <= watchProgress
                                  ? 'bg-green-500 text-white shadow-md'
                                  : 'bg-teal-50 text-teal-600'
                              }`}
                            >
                              <i className="ri-play-fill text-xl" aria-hidden="true" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="font-bold text-lg text-teal-800 truncate">Episode {episodeNumber}</h4>
                                {episodeNumber <= watchProgress && (
                                  <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                                    <i className="ri-check-line text-white text-sm" aria-hidden="true" />
                                  </div>
                                )}
                              </div>
                              <p className="text-sm text-teal-600 truncate">{episodeTitle}</p>
                              {episodeDuration && (
                                <p className="text-xs text-teal-500 mt-1">
                                  {Math.floor(episodeDuration / 60)}:{(episodeDuration % 60).toString().padStart(2, '0')}
                                </p>
                              )}
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          </ErrorBoundary>

          {/* Trailer Section */}
          <ErrorBoundary
            fallback={<SectionError title="Trailer Error" message="Couldn't load trailer. Please try again." retry={refetch} />}
          >
            <Suspense fallback={<div className="h-64 bg-teal-100 rounded-2xl animate-pulse" aria-hidden="true" />}>
              <LazyTrailerSection trailerUrl={anime.trailer_url} title={anime.title} />
            </Suspense>
          </ErrorBoundary>

          {/* Related Anime */}
          <ErrorBoundary
            fallback={<SectionError title="Related Anime Error" message="Couldn't load related anime. Please try again." retry={refetch} />}
          >
            <Suspense fallback={<div className="h-96 bg-teal-100 rounded-2xl animate-pulse" aria-hidden="true" />}>
              <LazyRelatedAnime animeId={anime.id} currentTitle={anime.title} currentGenres={anime.genres || []} />
            </Suspense>
          </ErrorBoundary>

          {/* Characters Section */}
          <ErrorBoundary
            fallback={<SectionError title="Characters Error" message="Couldn't load character information. Please try again." retry={refetch} />}
          >
            <Suspense fallback={<div className="h-64 bg-teal-100 rounded-2xl animate-pulse" aria-hidden="true" />}>
              <LazyAnimeCharacters animeId={anime.id} />
            </Suspense>
          </ErrorBoundary>

          {/* Reviews Section */}
          <ReviewSection animeId={anime.id} />

          {/* You Might Also Like */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.8 }}
            className="mb-16"
            aria-labelledby="related-anime-heading"
          >
            <h2 id="related-anime-heading" className="text-2xl md:text-3xl font-bold text-teal-800 mb-8 flex items-center">
              <i className="ri-heart-line mr-3 text-pink-500" aria-hidden="true" />
              You Might Also Like
            </h2>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
              style={{ contentVisibility: 'auto', containIntrinsicSize: '1000px' }}
              role="list"
              aria-label="Related anime recommendations"
            >
              {similarAnime.map((similarAnimeItem: any, index: number) => {
                const mappedAnime = {
                  _id: similarAnimeItem.id,
                  title: similarAnimeItem.title,
                  cover:
                    (similarAnimeItem.poster_url && typeof similarAnimeItem.poster_url === 'string' && similarAnimeItem.poster_url.trim())
                      ? similarAnimeItem.poster_url
                      : '/assets/images/default-anime-poster.jpg',
                  banner: similarAnimeItem.banner_url,
                  rating: similarAnimeItem.rating || 0,
                  year: similarAnimeItem.year || new Date().getFullYear(),
                  totalEpisodes: similarAnimeItem.total_episodes || 1,
                  currentEpisode: 0,
                  genres: similarAnimeItem.genres || [],
                  status: (similarAnimeItem.status === 'ongoing'
                    ? 'Ongoing'
                    : similarAnimeItem.status === 'completed'
                    ? 'Completed'
                    : similarAnimeItem.status === 'upcoming'
                    ? 'Upcoming'
                    : 'Ongoing') as 'Ongoing' | 'Completed' | 'Upcoming',
                  description: similarAnimeItem.description || '',
                  type: (similarAnimeItem.type === 'tv'
                    ? 'TV'
                    : similarAnimeItem.type === 'movie'
                    ? 'Movie'
                    : similarAnimeItem.type === 'ova'
                    ? 'OVA'
                    : similarAnimeItem.type === 'special'
                    ? 'Special'
                    : 'TV') as 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special',
                  studios: similarAnimeItem.studios || [],
                  popularity: 0,
                  views: 0,
                };

                return (
                  <motion.div
                    key={similarAnimeItem.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.1 * index }}
                    role="listitem"
                  >
                    <AnimeCard {...mappedAnime} />
                  </motion.div>
                );
              })}
            </div>
          </motion.section>
        </div>
      </main>
    
      <Footer />

      
      {/* Toast Notification */}
      {showToast && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-6 right-6 bg-teal-600 text-white px-8 py-4 rounded-xl shadow-2xl z-50 flex items-center gap-3 backdrop-blur-sm"
          role="alert"
          aria-live="polite"
        >
          <i className="ri-check-line text-lg" aria-hidden="true" />
          <span className="font-medium">{showToast}</span>
        </motion.div>
      )}
    </div>
  );
}