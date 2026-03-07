
import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '../../components/feature/Navbar';
import AnimeCard from '../../components/feature/AnimeCard';
import Button from '../../components/base/Button';
import SmartVideoPlayer from '../../components/player/SmartVideoPlayer';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import useAnimePlayer from '../../hooks/anime/player';
import { useAnimeById, useSimilarAnime } from '../../hooks/useAnime';
import { useCurrentUser } from '../../hooks/auth/selectors';
import type { VideoSource } from '../../services/media/video';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import { VideoPlayerError } from '../../components/common/ErrorFallbacks';
import Footer from '../../components/feature/Footer';

export default function PlayerPage() {
  const { animeId, episode } = useParams<{ animeId: string; episode: string }>();
  const [searchParams] = useSearchParams();
  const user = useCurrentUser();
  
  const currentEpisode = parseInt(episode || '1');
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [initialTime, setInitialTime] = useState(0);
  const [initialTimeResolved, setInitialTimeResolved] = useState(false);

  const { getEpisodeSources, updateWatchProgress, updateWatchProgressManual, updateWatchProgressEstimated, getWatchProgress } = useAnimePlayer();
  const { anime, loading: animeLoading } = useAnimeById(animeId || '', user?.id);
  
  // Memoize genres to prevent infinite loops
  const memoizedGenres = useMemo(() => anime?.genres || [], [anime?.genres?.join(',')]);
  
  const { anime: similarAnime, loading: similarLoading } = useSimilarAnime(
    animeId || '', 
    memoizedGenres, 
    6
  );

  // Detect if player is using embedded iframe
  const isEmbeddedPlayer = useMemo(() => {
    if (sources.length === 0) return false;
    const sourceType = sources[0]?.type;
    return sourceType === 'iframe';
  }, [sources]);

  // Handle player events
  const handleTimeUpdate = (currentTime: number, _duration: number) => {
    setCurrentTime(currentTime);
  };

  // Handle progress updates from embedded players with accuracy information
  const handleProgressUpdate = async (progress: number, accuracy: 'accurate' | 'estimated' | 'manual') => {
    if (!animeId || !episode) return;

    try {
      switch (accuracy) {
        case 'accurate':
          await updateWatchProgress(animeId, parseInt(episode), Math.floor(progress), 'accurate');
          break;
        case 'estimated':
          await updateWatchProgressEstimated(animeId, parseInt(episode), Math.floor(progress));
          break;
        case 'manual':
          await updateWatchProgressManual(animeId, parseInt(episode), Math.floor(progress));
          break;
      }
    } catch (error) {
      console.warn('Failed to update progress:', error);
    }
  };

  const handlePlay = () => {
    console.log('Video started playing');
  };

  const handlePause = () => {
    console.log('Video paused');
  };

  const handleEnded = () => {
    console.log('Video ended');
  };

  const handleError = (error: string) => {
    console.error('Video player error:', error);
  };

  // Handle progress restoration from URL params or saved progress
  useEffect(() => {
    const restoreProgress = async () => {
      if (!animeId || !episode) return;

      // Check for progress in URL params (from continue watching)
      const progressParam = searchParams.get('progress');
      if (progressParam) {
        const progressSeconds = parseInt(progressParam);
        if (!isNaN(progressSeconds) && progressSeconds > 0) {
          setInitialTime(progressSeconds);
          setInitialTimeResolved(true);
          return;
        }
      }

      // Check if this is a "continue watching" request (has continue=true param)
      const isContinueWatching = searchParams.get('continue') === 'true';
      
      if (isContinueWatching) {
        // For continue watching, get saved progress from database/localStorage
        try {
          const savedProgress = await getWatchProgress(animeId, parseInt(episode));
          if (savedProgress > 0) {
            setInitialTime(savedProgress);
          }
        } catch (error) {
          console.warn('Failed to get saved progress:', error);
        }
      } else {
        // For direct episode clicks, start from beginning
        setInitialTime(0);
      }
      setInitialTimeResolved(true);
    };

    restoreProgress();
  }, [animeId, episode, searchParams, getWatchProgress]);

  useEffect(() => {
    let isMounted = true;
    const fetchVideoSources = async () => {
      if (!animeId || !episode) {
        if (isMounted) {
          setSourcesLoading(false);
        }
        return;
      }
      
      // Reset state when episode changes — but don't blank out sources if cached result will be instant
      if (isMounted) {
        setSourcesLoading(true);
        setSourcesError(null);
      }
      
      try {
        const episodeData = await getEpisodeSources(animeId, parseInt(episode));
        
        // Check if component is still mounted before updating state
        if (!isMounted) return;
        
        if (episodeData.sources && episodeData.sources.length > 0) {
          setSources(episodeData.sources);
          setSourcesError(null);
        } else {
          throw new Error('No video sources available for this episode');
        }
      } catch (err) {
        if (!isMounted) return;
        const errorMessage = err instanceof Error ? err.message : 'Failed to load video sources';
        console.error('Error fetching video sources:', err);
        setSourcesError(errorMessage);
        setSources([]);
      } finally {
        if (isMounted) {
          setSourcesLoading(false);
        }
      }

      // Prefetch next episode sources in background
      const nextEp = parseInt(episode) + 1;
      getEpisodeSources(animeId, nextEp).catch(() => {}); // silent prefetch
    };

    fetchVideoSources();

    return () => {
      isMounted = false;
    };
  }, [animeId, episode]); // Remove getEpisodeSources from deps - it's stable

  // Separate useEffect for progress saving (runs independently to avoid infinite loops)
  // Use a ref for currentTime so the interval doesn't get recreated every second
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;

  useEffect(() => {
    // Only save progress for native video players, not embedded
    if (isEmbeddedPlayer || !animeId || !episode) {
      return; // Don't set up interval for embedded players
    }

    const progressInterval = setInterval(() => {
      if (currentTimeRef.current > 0) {
        updateWatchProgress(animeId, parseInt(episode), Math.floor(currentTimeRef.current), 'accurate')
          .catch(console.error);
      }
    }, 30000); // Save every 30 seconds

    return () => {
      clearInterval(progressInterval);
    };
  }, [animeId, episode, isEmbeddedPlayer, updateWatchProgress]); // removed currentTime — use ref instead

  // Generate episodes for navigation with fallback
  const episodes = useMemo(() => {
    if (!anime) return [];
    
    if (anime.episodes && anime.episodes.length > 0) {
      return anime.episodes.map((ep: any, index: number) => {
        // Ensure we have a valid episode object
        if (!ep || typeof ep !== 'object') {
          return {
            number: index + 1,
            title: `Episode ${index + 1}`
          };
        }
        
        return {
          number: ep.episode_number || ep.number || (index + 1),
          title: ep.title || `Episode ${ep.episode_number || ep.number || (index + 1)}`
        };
      });
    }
    
    // Fallback: generate episodes based on total_episodes
    const totalEpisodes = anime.total_episodes || 1;
    return Array.from({ length: totalEpisodes }, (_, i) => ({
      number: i + 1,
      title: `Episode ${i + 1}`
    }));
  }, [anime]);





  if (animeLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <SparkleLoadingSpinner size="xl" text="Loading anime..." />
          </div>
        </div>
      </div>
    );
  }

  if (!anime) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
        <Navbar />
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-16 max-w-md mx-auto border border-white/50">
              <i className="ri-error-warning-line text-7xl text-teal-300 mb-6"></i>
              <h2 className="text-2xl font-bold text-teal-800 mb-4">Anime not found</h2>
              <Link to="/anime">
                <Button size="lg">Browse Anime</Button>
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
      
      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Breadcrumb Navigation */}
          <motion.nav
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-teal-600">
              <Link to="/" className="hover:text-teal-700 transition-colors duration-200 cursor-pointer flex-shrink-0">
                <i className="ri-home-line mr-1"></i>
                Home
              </Link>
              <i className="ri-arrow-right-s-line text-teal-500 flex-shrink-0"></i>
              <Link to="/anime" className="hover:text-teal-700 transition-colors duration-200 cursor-pointer flex-shrink-0">
                Anime
              </Link>
              <i className="ri-arrow-right-s-line text-teal-500 flex-shrink-0"></i>
              <Link to={`/anime/${animeId}`} className="hover:text-teal-700 transition-colors duration-200 cursor-pointer truncate max-w-[150px] sm:max-w-xs">
                {anime.title}
              </Link>
              <i className="ri-arrow-right-s-line text-teal-500 flex-shrink-0"></i>
              <span className="text-teal-700 font-medium flex-shrink-0">EP {currentEpisode}</span>
            </div>
          </motion.nav>

          {/* Video Player */}
          <ErrorBoundary fallback={<VideoPlayerError title="Video Player Error" message="The video player encountered an error. This might be due to network issues or an unsupported video format." />}>
            <div className="relative bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video mb-6 sm:mb-12">
              {sourcesLoading ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
                  <div className="text-center text-white">
                    <SparkleLoadingSpinner size="xl" text="Loading video sources..." />
                    <p className="text-white/60 mt-4">Preparing your video experience</p>
                  </div>
                </div>
              ) : sourcesError ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-red-900 to-black">
                  <div className="text-center text-white max-w-md mx-auto px-4">
                    <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <i className="ri-error-warning-line text-3xl text-red-400"></i>
                    </div>
                    <h3 className="text-xl font-bold mb-2">Video Loading Error</h3>
                    <p className="text-white/60 mb-4">{sourcesError}</p>
                    <button
                      onClick={() => {
                        setSourcesLoading(true);
                        setSourcesError(null);
                        // Retry fetch
                        const fetchVideoSources = async () => {
                          if (!animeId || !episode) return;
                          try {
                            const episodeData = await getEpisodeSources(animeId, parseInt(episode));
                            if (episodeData.sources && episodeData.sources.length > 0) {
                              setSources(episodeData.sources);
                              setSourcesError(null);
                            } else {
                              throw new Error('No video sources available');
                            }
                          } catch (err) {
                            setSourcesError(err instanceof Error ? err.message : 'Failed to load video sources');
                          } finally {
                            setSourcesLoading(false);
                          }
                        };
                        fetchVideoSources();
                      }}
                      className="px-6 py-3 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                    >
                      <i className="ri-refresh-line mr-2"></i>
                      Retry
                    </button>
                  </div>
                </div>
              ) : sources.length > 0 && initialTimeResolved ? (
                <SmartVideoPlayer
                  key={`${animeId}-${currentEpisode}-${initialTime}`}
                  sources={sources}
                  animeId={animeId!}
                  episodeNumber={currentEpisode}
                  title={`${anime.title} - Episode ${currentEpisode}`}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onEnded={handleEnded}
                  onError={handleError}
                  onProgressUpdate={isEmbeddedPlayer ? handleProgressUpdate : undefined}
                  autoPlay={true}
                  startTime={initialTime}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
                  <div className="text-center text-white">
                    <i className="ri-video-line text-6xl text-white/40 mb-4"></i>
                    <p className="text-white/60">No video sources available</p>
                  </div>
                </div>
              )}
            </div>
          </ErrorBoundary>

          {/* Episode List */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-teal-800 mb-8 flex items-center">
              <i className="ri-play-list-line mr-3 text-green-600"></i>
              Episodes
            </h2>
            
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-4 sm:p-8 border border-white/50">
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 sm:gap-3" style={{ contentVisibility: 'auto', containIntrinsicSize: '1000px' }}>
                {episodes.length === 0 ? (
                  <div className="col-span-full text-center py-8">
                    <p className="text-teal-600">No episodes available</p>
                  </div>
                ) : (
                  episodes.map((ep: any) => {
                    // Safety check to ensure ep is a valid object with required properties
                    if (!ep || typeof ep !== 'object' || !ep.number || !ep.title) {
                      console.warn('Invalid episode object:', ep);
                      return null;
                    }
                    
                    return (
                      <Link
                        key={ep.number}
                        to={`/player/${animeId}/${ep.number}`}
                        className={`block p-2 sm:p-3 rounded-lg transition-all duration-200 cursor-pointer text-center ${
                          ep.number === currentEpisode
                            ? 'bg-teal-600 text-white shadow-lg transform scale-105'
                            : 'bg-teal-50 text-teal-800 hover:bg-teal-100 hover:shadow-md border border-teal-200 hover:transform hover:scale-105'
                        }`}
                      >
                        <div className="flex flex-col items-center justify-center">
                          <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mb-1 sm:mb-2 ${
                            ep.number === currentEpisode
                              ? 'bg-white/20'
                              : 'bg-teal-100'
                          }`}>
                            <i className={`ri-play-fill text-xs sm:text-sm ${
                              ep.number === currentEpisode
                                ? 'text-white'
                                : 'text-teal-600'
                            }`}></i>
                          </div>
                          <p className="text-[10px] sm:text-xs font-semibold truncate w-full">{ep.number}</p>
                        </div>
                      </Link>
                    );
                  }).filter(Boolean)
                )}
              </div>
            </div>
          </motion.section>

          {/* Anime Info */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="mb-12"
          >
            <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl p-4 sm:p-8 border border-white/50">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8">
                <img
                  src={anime.poster_url || `https://readdy.ai/api/search-image?query=Anime%20poster%20${anime.title}%2C%20Studio%20Ghibli%20style%2C%20beautiful%20artwork%2C%20detailed%20illustration&width=300&height=450&seq=player-poster&orientation=portrait`}
                  srcSet={anime.poster_url ? `${anime.poster_url}?w=200 200w, ${anime.poster_url}?w=300 300w, ${anime.poster_url}?w=450 450w, ${anime.poster_url}?w=600 600w` : undefined}
                  sizes="(max-width: 640px) 200px, 300px"
                  alt={anime.title}
                  className="w-24 h-32 sm:w-32 sm:h-44 object-cover object-top rounded-xl flex-shrink-0 mx-auto sm:mx-0"
                  width={128}
                  height={176}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = `https://readdy.ai/api/search-image?query=Anime%20poster%20${anime.title}%2C%20Studio%20Ghibli%20style%2C%20beautiful%20artwork%2C%20detailed%20illustration&width=300&height=450&seq=player-poster-fallback&orientation=portrait`;
                  }}
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-teal-800 mb-3 sm:mb-4">{anime.title}</h3>
                  <div className="flex flex-wrap gap-3 mb-4">
                    {anime.genres?.map((genre: string) => (
                      <span
                        key={genre}
                        className="px-3 py-2 bg-teal-100 text-teal-700 text-sm rounded-full font-medium"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-6 text-sm text-teal-600 mb-4">
                    <span className="flex items-center gap-2">
                      <i className="ri-star-fill text-yellow-500"></i>
                      <span className="font-semibold">{anime.rating || 'N/A'}</span>
                    </span>
                    <span className="font-medium">{anime.release_year}</span>
                    <span className="font-medium">{anime.total_episodes || anime.episodes?.length || 0} episodes</span>
                  </div>
                  <p className="text-teal-700 leading-relaxed text-sm sm:text-lg">
                    {anime.description || `Experience the magical world of ${anime.title}, a captivating story that will transport you to enchanting realms filled with wonder and adventure.`}
                  </p>
                </div>
              </div>
            </div>
          </motion.section>

          {/* Similar Anime */}
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="mb-12"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-teal-800 mb-8 flex items-center">
              <i className="ri-heart-line mr-3 text-pink-500"></i>
              Similar Anime
            </h2>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
              {similarLoading ? (
                Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="bg-white/80 rounded-xl p-4 animate-pulse border border-white/20">
                    <div className="aspect-[3/4] bg-teal-100 rounded-lg mb-3"></div>
                    <div className="h-4 bg-teal-200 rounded mb-2"></div>
                    <div className="h-3 bg-teal-200 rounded w-2/3"></div>
                  </div>
                ))
              ) : similarAnime.length > 0 ? (
                similarAnime.map((similarAnimeItem: any, index: number) => {
                  // Map database anime structure to AnimeCard expected structure
                  const mappedAnime = {
                    _id: similarAnimeItem.id,
                    title: similarAnimeItem.title,
                    cover: similarAnimeItem.poster_url || "https://readdy.ai/api/search-image?query=Anime%20poster%2C%20default%20anime%20image&width=300&height=400&seq=anime-poster&orientation=portrait",
                    banner: similarAnimeItem.banner_url,
                    rating: similarAnimeItem.rating || 0,
                    year: similarAnimeItem.year || new Date().getFullYear(),
                    totalEpisodes: similarAnimeItem.total_episodes || 1,
                    currentEpisode: 0,
                    genres: similarAnimeItem.genres || [],
                    status: similarAnimeItem.status === 'ongoing' ? 'Ongoing' : 
                            similarAnimeItem.status === 'completed' ? 'Completed' : 
                            similarAnimeItem.status === 'upcoming' ? 'Upcoming' : 'Ongoing' as 'Ongoing' | 'Completed' | 'Upcoming',
                    description: similarAnimeItem.description || '',
                    type: similarAnimeItem.type === 'tv' ? 'TV' :
                          similarAnimeItem.type === 'movie' ? 'Movie' :
                          similarAnimeItem.type === 'ova' ? 'OVA' :
                          similarAnimeItem.type === 'special' ? 'Special' : 'TV' as 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special',
                    studios: similarAnimeItem.studios || [],
                    popularity: 0,
                    views: 0
                  };
                  
                  return (
                    <motion.div
                      key={similarAnimeItem.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.1 * index }}
                    >
                      <AnimeCard {...mappedAnime} />
                    </motion.div>
                  );
                })
              ) : (
                <div className="col-span-full text-center py-8">
                  <div className="bg-white/95 backdrop-blur-sm rounded-xl p-8 border border-white/50">
                    <i className="ri-movie-2-line text-4xl text-teal-400 mb-4"></i>
                    <h4 className="text-teal-800 font-semibold mb-2">No Similar Anime Found</h4>
                    <p className="text-teal-600 text-sm mb-4">
                      We couldn't find anime with similar genres
                    </p>
                    <Link
                      to="/anime"
                      className="inline-block px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors cursor-pointer"
                    >
                      Browse All Anime
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </motion.section>
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
