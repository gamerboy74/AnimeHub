import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import HeroCarousel from '../../components/feature/HeroCarousel';
import AnimeCard from '../../components/feature/AnimeCard';
import VirtualizedGrid from '../../components/feature/VirtualizedGrid';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { useTrendingAnime, usePopularAnime, useRecentAnime, useContinueWatching } from '../../hooks/useAnime';
import { useCurrentUser } from '../../hooks/auth/selectors';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import { SectionError, ContentError } from '../../components/common/ErrorFallbacks';
import { getProxiedImageUrl, getDirectImageUrl } from '../../utils/media/imageProxy';

// Interfaces for type safety
interface Anime {
  id: string;
  title: string;
  poster_url?: string | null;
  banner_url?: string | null;
  rating?: number | null;
  year?: number | null;
  total_episodes?: number | null;
  genres?: string[] | null;
  status?: 'ongoing' | 'completed' | 'upcoming' | null;
  description?: string | null;
  type?: 'tv' | 'movie' | 'ova' | 'ona' | 'special' | null;
  studios?: string[] | null;
}

interface HeroSlide {
  id: string;
  title: string;
  description: string;
  banner_url?: string | null;
  poster_url?: string | null;
  genres: string[];
  rating: number;
}

// Custom hook for delayed loading spinner
const useDelayedLoading = (isLoading: boolean, delay: number = 800) => {
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (isLoading) {
      const timer = setTimeout(() => setShowSpinner(true), delay);
      return () => clearTimeout(timer);
    } else {
      setShowSpinner(false);
    }
  }, [isLoading, delay]);

  return showSpinner;
};
// Premium custom card for Continue Watching with glassmorphic styling, no nested links, and fluid physics
interface ContinueWatchingCardProps {
  item: any;
}

const ContinueWatchingCard = memo(function ContinueWatchingCard({ item }: ContinueWatchingCardProps) {
  const fallbackPoster = '/assets/images/default-anime-poster.jpg';
  const progressPct = item.episodeDuration && item.episodeDuration > 0
    ? Math.min(100, Math.round((item.progressSeconds / item.episodeDuration) * 100))
    : 0;

  const playerUrl = `/player/${item.id}/${item.continueEpisode}?continue=true&progress=${item.progressSeconds || 0}`;

  return (
    <motion.div
      whileHover={{ y: -6, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="group bg-white/95 backdrop-blur-md rounded-2xl border border-teal-100/80 shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden flex flex-col relative h-full hover:border-teal-200/90"
    >
      {/* Poster / Play Overlay Container */}
      <div className="relative aspect-[3/4] overflow-hidden bg-slate-900">
        <img
          src={getProxiedImageUrl(item.poster_url) || fallbackPoster}
          alt={item.title}
          className="w-full h-full object-cover object-top transition-transform duration-500 group-hover:scale-110 animate-fade-in"
          loading="lazy"
          onError={(e) => {
            const target = e.currentTarget;
            if (target.dataset.failed) return;
            target.dataset.failed = 'true';
            const directUrl = getDirectImageUrl(target.src);
            if (directUrl && target.src !== directUrl) {
              target.srcset = '';
              target.src = directUrl;
            } else if (item.poster_url) {
              target.srcset = '';
              target.src = item.poster_url;
            } else {
              target.src = fallbackPoster;
            }
          }}
        />
        
        {/* Subtle Dark Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent opacity-80" />

        {/* Hover Premium Play Button Glass Overlay */}
        <Link
          to={playerUrl}
          className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 cursor-pointer"
          aria-label={`Resume watching ${item.title} Episode ${item.continueEpisode}`}
        >
          <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-teal-600 rounded-full flex items-center justify-center shadow-lg transform scale-75 group-hover:scale-100 transition-transform duration-300">
            <i className="ri-play-fill text-white text-2xl ml-1"></i>
          </div>
        </Link>

        {/* Episode Badge (Always Visible) */}
        <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-md border border-white/10 px-2.5 py-1 rounded-full text-white text-[11px] font-black tracking-wide shadow-md">
          EP {item.continueEpisode}
        </div>

        {/* Inline Info Button (Goes to Detail page, avoiding nested links!) */}
        <Link
          to={`/anime/${item.id}`}
          className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/90 hover:bg-teal-600 text-teal-700 hover:text-white flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-md hover:scale-110 z-20 cursor-pointer"
          title="Anime Details"
        >
          <i className="ri-information-line text-sm"></i>
        </Link>
        
        {/* Progress Bar overlay at the bottom of the poster */}
        {progressPct > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1.5 bg-slate-950/50">
            <div
              className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 rounded-r-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Info Content Area */}
      <div className="p-4 flex flex-col flex-grow justify-between bg-white/50">
        <div>
          {/* Title */}
          <Link
            to={playerUrl}
            className="block cursor-pointer group-hover:text-teal-600 transition-colors"
          >
            <h3 className="font-extrabold text-slate-800 text-sm leading-snug line-clamp-2 mb-1">
              {item.title}
            </h3>
          </Link>
          
          {/* Episode Title / Status */}
          {item.continueEpisodeTitle ? (
            <p className="text-slate-400 text-xs font-semibold truncate leading-normal">
              {item.continueEpisodeTitle}
            </p>
          ) : (
            <p className="text-slate-400 text-xs font-semibold leading-normal">
              Episode {item.continueEpisode}
            </p>
          )}
        </div>

        {/* Bottom Metadata & Interactive Resume Link */}
        <div className="mt-3 pt-3 border-t border-teal-50 flex items-center justify-between text-xs">
          <span className="text-teal-600 font-bold">
            {progressPct}% watched
          </span>
          <Link
            to={playerUrl}
            className="flex items-center gap-1 text-emerald-600 hover:text-teal-700 font-black cursor-pointer group-hover:underline"
          >
            Resume <i className="ri-arrow-right-s-line font-bold"></i>
          </Link>
        </div>
      </div>
    </motion.div>
  );
});

/* -------------------------------------------------------------------------- */
/*                             Primary Home Page                              */
/* -------------------------------------------------------------------------- */
export default function Home() {
  // Auth
  const user = useCurrentUser();

  // Data fetching hooks
  // Data fetching hooks
  const { anime: trendingAnime, loading: trendingLoading } = useTrendingAnime();
  const { anime: popularAnime, loading: popularLoading } = usePopularAnime();
  const { anime: recentAnime, loading: recentLoading } = useRecentAnime(6);
  const { anime: continueWatchingAnime } = useContinueWatching(user?.id ?? null);

  // Delayed loading spinners
  const showTrendingSpinner = useDelayedLoading(trendingLoading);
  const showPopularSpinner = useDelayedLoading(popularLoading);
  const showRecentSpinner = useDelayedLoading(recentLoading);

  // Consolidated anime mapping function
  const mapAnime = useMemo(
    () => (anime: Anime, format: 'hero' | 'card') => {
      const fallbackPoster =
        '/assets/images/default-anime-poster.jpg'; // Local fallback

      if (format === 'hero') {
        return {
          id: anime.id,
          title: anime.title,
          description: anime.description || 'An amazing anime adventure awaits!',
          banner_url: anime.banner_url,
          poster_url: anime.poster_url,
          genres: anime.genres || [],
          rating: anime.rating || 0,
        } as HeroSlide;
      }

      return {
        _id: anime.id,
        title: anime.title,
        cover: anime.poster_url || fallbackPoster,
        banner: anime.banner_url,
        rating: anime.rating || 0,
        year: anime.year || new Date().getFullYear(),
        totalEpisodes: anime.total_episodes || 1,
        currentEpisode: 0,
        genres: anime.genres || [],
        status: (anime.status === 'ongoing'
          ? 'Ongoing'
          : anime.status === 'completed'
          ? 'Completed'
          : anime.status === 'upcoming'
          ? 'Upcoming'
          : 'Ongoing') as 'Ongoing' | 'Completed' | 'Upcoming',
        description: anime.description || '',
        type: (anime.type === 'tv'
          ? 'TV'
          : anime.type === 'movie'
          ? 'Movie'
          : anime.type === 'ova'
          ? 'OVA'
          : anime.type === 'ona'
          ? 'ONA'
          : anime.type === 'special'
          ? 'Special'
          : 'TV') as 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special',
        studios: anime.studios || [],
        popularity: 0,
        views: 0,
      };
    },
    []
  );

  // Memoized mapped data
  const heroSlides = useMemo(
    () => trendingAnime.map((anime: Anime) => mapAnime(anime, 'hero') as HeroSlide),
    [trendingAnime, mapAnime]
  );
  
  const trendingCards = useMemo(
    () => trendingAnime.map((anime: Anime) => mapAnime(anime, 'card')),
    [trendingAnime, mapAnime]
  );
  const popularCards = useMemo(
    () => popularAnime.map((anime: Anime) => mapAnime(anime, 'card')),
    [popularAnime, mapAnime]
  );
  const recentCards = useMemo(
    () => recentAnime.map((anime: Anime) => mapAnime(anime, 'card')),
    [recentAnime, mapAnime]
  );

  // Calculate average rating
  const averageRating = useMemo(() => {
    const allAnime = [...trendingAnime, ...popularAnime];
    if (!allAnime.length) return 0;
    const validRatings = allAnime.filter((anime) => anime.rating && anime.rating > 0);
    if (!validRatings.length) return 0;
    const sum = validRatings.reduce((acc, anime) => acc + (anime.rating || 0), 0);
    return Math.round((sum / validRatings.length) * 10) / 10;
  }, [trendingAnime, popularAnime]);

  // Calculate total anime count
  const totalAnimeCount = useMemo(() => {
    const allAnime = [...trendingAnime, ...popularAnime, ...recentAnime];
    const uniqueAnimeIds = new Set(allAnime.map((anime) => anime.id));
    return uniqueAnimeIds.size;
  }, [trendingAnime, popularAnime, recentAnime]);

  // Reduced animation variants for better performance
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05, duration: 0.3 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { duration: 0.2 } },
  };

  // Preload first hero image for LCP optimization
  useEffect(() => {
    if (heroSlides.length > 0) {
      const imageUrl = heroSlides[0].banner_url || heroSlides[0].poster_url;
      if (imageUrl) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = getProxiedImageUrl(imageUrl) || imageUrl;
        link.fetchPriority = 'high';
        document.head.appendChild(link);
        return () => { document.head.removeChild(link); };
      }
    }
    return undefined;
  }, [heroSlides]);

  // Optimized anime section component (memoized)
  const AnimeSection = memo(function AnimeSection({ 
    items, 
    showSpinner, 
    title, 
    showBadge 
  }: { 
    items: any[];
    showSpinner: boolean;
    title: string;
    showBadge?: 'trending' | 'new';
  }) {
    const renderItem = useCallback((anime: any, _index: number) => {
      if (showSpinner) {
        return (
          <div className="bg-white/80 rounded-xl shadow-md overflow-hidden border border-white/20 flex items-center justify-center h-full" style={{ aspectRatio: '3/4' }}>
            <div className="w-full h-full flex flex-col items-center justify-center p-4">
              <SparkleLoadingSpinner size="lg" text={`Loading ${title.toLowerCase()}...`} />
            </div>
          </div>
        );
      }
      if (!anime) return null;
      return (
        <AnimeCard
          {...anime}
          showTrendingBadge={showBadge === 'trending'}
          showNewBadge={showBadge === 'new'}
        />
      );
    }, [showSpinner, title, showBadge]);

    // Use all items (already limited by API calls)
    const limitedItems = useMemo(() => items, [items]);
    
    // Memoize responsive width/height functions to prevent recreation
    const columnWidth = useCallback((w: number) => {
      if (w < 640) return 140;
      if (w < 1024) return 160;
      if (w < 1280) return 180;
      return 200;
    }, []);
    
    const rowHeight = useCallback((w: number) => {
      if (w < 640) return 240;
      if (w < 1024) return 280;
      return 320;
    }, []);

    if (showSpinner && limitedItems.length === 0) {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white/80 rounded-xl shadow-md overflow-hidden border border-white/20 aspect-[3/4] flex items-center justify-center">
              <SparkleLoadingSpinner size="md" />
            </div>
          ))}
        </div>
      );
    }

    // Calculate container height based on items
    const containerHeight = useMemo(() => {
      if (showSpinner || limitedItems.length === 0) return 400;
      // Estimate: assume ~6 columns on desktop, calculate rows needed
      const estimatedColumns = 6;
      const estimatedRows = Math.ceil(limitedItems.length / estimatedColumns);
      const estimatedRowHeight = 320; // desktop row height
      return Math.max(400, Math.min(800, estimatedRows * estimatedRowHeight + 100)); // Add padding
    }, [showSpinner, limitedItems.length]);

    if (limitedItems.length === 0 && !showSpinner) {
      return (
        <div className="text-center py-12 text-teal-500">
          <p>No {title.toLowerCase()} available</p>
        </div>
      );
    }

    // For small lists (< 20 items), use simple grid instead of virtualization
    // Virtualization is overkill and can cause rendering issues with small datasets
    if (limitedItems.length < 20) {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {limitedItems.map((anime, index) => (
            <div key={anime?._id || anime?.id || index}>
              {renderItem(anime, index)}
            </div>
          ))}
        </div>
      );
    }

    // Use virtualization only for larger lists
    return (
      <div style={{ height: containerHeight, width: '100%' }}>
        <VirtualizedGrid
          items={limitedItems}
          columnWidth={columnWidth}
          rowHeight={rowHeight}
          gap={16}
          overscan={3}
          renderItem={renderItem}
        />
      </div>
    );
  });

  return (
    <>
 
      <main className="w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Hero Section */}
          <ErrorBoundary
            fallback={
              <SectionError
                title="Hero Section Error"
                message="The featured anime carousel couldn't load."
                // retry={() => refetchFeatured()} // Add retry logic if hooks support refetch
              />
            }
          >
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="mb-16"
              aria-labelledby="featured-anime"
            >
              <h2 id="featured-anime" className="sr-only">
                Featured Anime
              </h2>
              <HeroCarousel slides={heroSlides} loading={trendingLoading} />
            </motion.section>
          </ErrorBoundary>

          {/* Quick Stats Section */}
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="mb-16"
            aria-labelledby="quick-stats"
          >
            <h2 id="quick-stats" className="sr-only">
              Quick Stats
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <motion.div
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 text-center"
              >
                <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <i className="ri-tv-line text-2xl text-teal-600"></i>
                </div>
                <div className="text-2xl font-bold text-teal-800">{totalAnimeCount || 0}</div>
                <div className="text-teal-600 text-sm">Total Anime</div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 text-center"
              >
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <i className="ri-fire-line text-2xl text-orange-500"></i>
                </div>
                <div className="text-2xl font-bold text-orange-600">{trendingAnime.length}</div>
                <div className="text-teal-600 text-sm">Trending Now</div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 text-center"
              >
                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <i className="ri-star-line text-2xl text-yellow-500"></i>
                </div>
                <div className="text-2xl font-bold text-yellow-600">{averageRating || 'N/A'}</div>
                <div className="text-teal-600 text-sm">Avg Rating</div>
              </motion.div>
              <motion.div
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.15 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20 text-center"
              >
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                  <i className="ri-clapperboard-line text-2xl text-purple-500"></i>
                </div>
                <div className="text-2xl font-bold text-purple-600">24/7</div>
                <div className="text-teal-600 text-sm">Streaming</div>
              </motion.div>
            </div>
          </motion.section>

          {/* Continue Watching */}
          {continueWatchingAnime.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
              className="mb-16"
              aria-labelledby="continue-watching"
            >
              <div className="mb-8">
                <h2 id="continue-watching" className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
                  <i className="ri-history-line mr-3 text-teal-500"></i>
                  Continue Watching
                </h2>
                <div className="h-1 w-20 bg-gradient-to-r from-teal-500 to-green-500 rounded-full mt-2"></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {continueWatchingAnime.map((item: any) => (
                  <ContinueWatchingCard key={item.id} item={item} />
                ))}
              </div>
            </motion.section>
          )}

          {/* Trending Now */}
          <ErrorBoundary
            fallback={
              <ContentError
                title="Trending Anime Error"
                message="Couldn't load trending anime. Please try again."
                // retry={() => refetchTrending()} // Add retry logic if hooks support refetch
              />
            }
          >
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="mb-16"
              aria-labelledby="trending-anime"
            >
              <motion.div variants={itemVariants} className="mb-8">
                <div className="flex items-center justify-between">
                  <h2 id="trending-anime" className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
                    <i className="ri-fire-line mr-3 text-pink-500"></i>
                    Trending Now
                  </h2>
                  <Link
                    to="/anime?filter=trending"
                    className="text-teal-600 hover:text-teal-800 font-medium flex items-center text-sm transition-colors"
                    aria-label="View all trending anime"
                  >
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="h-1 w-20 bg-gradient-to-r from-pink-500 to-orange-500 rounded-full mt-2"></div>
              </motion.div>
              <AnimeSection items={trendingCards} showSpinner={showTrendingSpinner} title="Trending Anime" showBadge="trending" />
            </motion.section>
          </ErrorBoundary>

          {/* Popular Anime */}
          <ErrorBoundary
            fallback={
              <ContentError
                title="Popular Anime Error"
                message="Couldn't load popular anime. Please try again."
                // retry={() => refetchPopular()} // Add retry logic if hooks support refetch
              />
            }
          >
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="mb-16"
              aria-labelledby="popular-anime"
            >
              <motion.div variants={itemVariants} className="mb-8">
                <div className="flex items-center justify-between">
                  <h2 id="popular-anime" className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
                    <i className="ri-star-line mr-3 text-yellow-500"></i>
                    Popular Anime
                  </h2>
                  <Link
                    to="/anime?filter=popular"
                    className="text-teal-600 hover:text-teal-800 font-medium flex items-center text-sm transition-colors"
                    aria-label="View all popular anime"
                  >
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="h-1 w-20 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full mt-2"></div>
              </motion.div>
              <AnimeSection items={popularCards} showSpinner={showPopularSpinner} title="Popular Anime" />
            </motion.section>
          </ErrorBoundary>

          {/* Recently Added */}
          <ErrorBoundary
            fallback={
              <ContentError
                title="Recent Anime Error"
                message="Couldn't load recent anime. Please try again."
                // retry={() => refetchRecent()} // Add retry logic if hooks support refetch
              />
            }
          >
            <motion.section
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="mb-16"
              aria-labelledby="recent-anime"
            >
              <motion.div variants={itemVariants} className="mb-8">
                <div className="flex items-center justify-between">
                  <h2 id="recent-anime" className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
                    <i className="ri-add-circle-line mr-3 text-green-600"></i>
                    Recently Added
                  </h2>
                  <Link
                    to="/anime?filter=recent"
                    className="text-teal-600 hover:text-teal-800 font-medium flex items-center text-sm transition-colors"
                    aria-label="View all recently added anime"
                  >
                    View All <i className="ri-arrow-right-line ml-1"></i>
                  </Link>
                </div>
                <div className="h-1 w-20 bg-gradient-to-r from-green-500 to-teal-500 rounded-full mt-2"></div>
              </motion.div>
              <AnimeSection items={recentCards} showSpinner={showRecentSpinner} title="Recent Anime" showBadge="new" />
            </motion.section>
          </ErrorBoundary>
        </div>
      </main>
    </>
  );
}