import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { getProxiedImageUrl } from '../../utils/media/imageProxy';

// Interfaces for type safety
import { useCurrentUser } from '../../hooks/auth/selectors';
interface Anime {
  _id: string;
  title: string;
  cover: string;
  banner?: string;
  rating: number;
  year: number;
  totalEpisodes: number;
  currentEpisode: number;
  genres: string[];
  status: 'Ongoing' | 'Completed' | 'Upcoming';
  description: string;
  type: 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special';
  studios: string[];
  popularity: number;
  views: number;
}

interface AnimeCardProps extends Anime {
  showTrendingBadge?: boolean;
  showNewBadge?: boolean;
}

interface StoredAnime {
  id: string;
  title: string;
  image: string;
  rating: number;
  year: number;
  episodes: number;
  genres: string[];
  status: 'Ongoing' | 'Completed' | 'Upcoming';
  description: string;
  addedAt: string;
}

// Simple debounce utility (instead of lodash.debounce)
const debounce = <F extends (...args: any[]) => void>(func: F, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<F>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const AnimeCard = React.memo(function AnimeCard(props: AnimeCardProps) {
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [watchProgress, setWatchProgress] = useState(0);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [showMoreInfo, setShowMoreInfo] = useState(false);

  const fallbackImage = '/path/to/fallback-image.jpg'; // Replace with actual fallback image path
  const user = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();

  // Load saved states from localStorage with error handling
  useEffect(() => {
    try {
      const savedWatchlist: StoredAnime[] = JSON.parse(localStorage.getItem('watchlist') || '[]');
      const savedFavorites: StoredAnime[] = JSON.parse(localStorage.getItem('favorites') || '[]');
      const savedProgress: Record<string, number> = JSON.parse(localStorage.getItem('watchProgress') || '{}');

      setIsInWatchlist(savedWatchlist.some((item) => item.id === props._id));
      setIsFavorite(savedFavorites.some((item) => item.id === props._id));
      setWatchProgress(savedProgress[props._id] || 0);
    } catch (error) {
      console.error('Error reading from localStorage:', error);
    }
  }, [props._id]);

  // Add keyboard support for modal
  useEffect(() => {
    if (!showMoreInfo) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMoreInfo(false);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showMoreInfo]);

  // Show toast notification
  const showToastMessage = (message: string) => {
    setShowToast(message);
    setTimeout(() => setShowToast(null), 2000);
  };

  // Reusable toggle function for watchlist and favorites
  const toggleItem = debounce(
    (
      e: React.MouseEvent,
      type: 'watchlist' | 'favorites',
      setState: React.Dispatch<React.SetStateAction<boolean>>,
      state: boolean
    ) => {
      e.preventDefault();
      e.stopPropagation();

      if (!user) {
        navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }

      try {
        const key = type;
        const savedItems: StoredAnime[] = JSON.parse(localStorage.getItem(key) || '[]');
        let updatedItems;

        if (state) {
          updatedItems = savedItems.filter((item) => item.id !== props._id);
          showToastMessage(`Removed from ${type}`);
        } else {
          const animeData: StoredAnime = {
            id: props._id,
            title: props.title,
            image: props.cover,
            rating: props.rating,
            year: props.year,
            episodes: props.totalEpisodes,
            genres: props.genres,
            status: props.status,
            description: props.description,
            addedAt: new Date().toISOString(),
          };
          updatedItems = [...savedItems, animeData];
          showToastMessage(`Added to ${type}`);
        }

        localStorage.setItem(key, JSON.stringify(updatedItems));
        setState(!state);
      } catch (error) {
        console.error(`Error updating ${type}:`, error);
        showToastMessage(`Failed to update ${type}`);
      }
    },
    300
  );

  const handleWatchlistToggle = (e: React.MouseEvent) => toggleItem(e, 'watchlist', setIsInWatchlist, isInWatchlist);
  const handleFavoriteToggle = (e: React.MouseEvent) => toggleItem(e, 'favorites', setIsFavorite, isFavorite);
  const handleMoreInfoToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMoreInfo(!showMoreInfo);
  };
  const handleCloseModal = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) setShowMoreInfo(false);
  };

  // Memoize detailed description
  const getDetailedDescription = useMemo(() => {
    const baseDescription =
      props.description ||
      `Experience the captivating world of ${props.title}, a masterful ${props.genres
        .join(', ')
        .toLowerCase()} anime that showcases exceptional storytelling and stunning animation.`;

    const additionalInfo = [
      `This ${props.totalEpisodes}-episode series has garnered critical acclaim with a rating of ${props.rating}/10.`,
      `Set in a beautifully crafted world, the story explores themes of ${props.genres
        .slice(0, 2)
        .join(' and ')
        .toLowerCase()}.`,
      `Released in ${props.year || 'recent years'}, this anime has become a beloved addition to the genre.`,
      `With its unique blend of ${props.genres.slice(-2).join(' and ').toLowerCase()}, it offers viewers an unforgettable journey.`,
    ];

    return baseDescription + ' ' + additionalInfo.join(' ');
  }, [props.description, props.title, props.genres, props.totalEpisodes, props.rating, props.year]);

  // Optimize badge rendering
  const badges = [
    props.showTrendingBadge && { label: '🔥 Trending', className: 'bg-red-500/90' },
    props.showNewBadge && { label: '✨ New', className: 'bg-green-500/90' },
    props.status.toLowerCase() === 'ongoing' && { label: 'Ongoing', className: 'bg-blue-500/90' },
  ].filter(Boolean);

  // Optimize Framer Motion animations
  const cardVariants = {
    rest: { y: 0 },
    hover: { y: -5, transition: { duration: 0.3 } },
  };

  return (
    <>
      <motion.div
        className="group relative bg-white/90 backdrop-blur-sm rounded-xl shadow-md hover:shadow-xl transition-all duration-300 overflow-hidden border border-white/20"
        variants={cardVariants}
        initial="rest"
        whileHover="hover"
        style={{ willChange: 'transform' }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Link to={`/anime/${props._id}`} className="block">
          {/* Image Container */}
          <div className="relative aspect-[3/4] overflow-hidden">
            <img
              src={getProxiedImageUrl(props.cover) || fallbackImage}
              srcSet={props.cover ? `${getProxiedImageUrl(`${props.cover}?w=150`)} 150w, ${getProxiedImageUrl(`${props.cover}?w=300`)} 300w, ${getProxiedImageUrl(`${props.cover}?w=600`)} 600w, ${getProxiedImageUrl(`${props.cover}?w=900`)} 900w` : undefined}
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 20vw"
              alt={props.title}
              className="w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-110"
              loading="lazy"
              width={300}
              height={400}
              decoding="async"
              onError={(e) => (e.currentTarget.src = fallbackImage)}
            />

            {/* Badges */}
            <div className="absolute top-3 left-3 flex flex-col gap-2">
              {badges.map((badge, index) => (
                <span
                  key={index}
                  className={`px-2 py-1 ${badge.className} backdrop-blur-sm text-white text-xs font-semibold rounded-full shadow-lg`}
                >
                  {badge.label}
                </span>
              ))}
            </div>

            {/* Action Buttons */}
            <div
              className={`absolute top-3 right-3 flex flex-col gap-2 transition-all duration-300 ${
                isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'
              }`}
            >
              <button
                onClick={handleFavoriteToggle}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-lg ${
                  isFavorite ? 'bg-red-500/90 text-white' : 'bg-white/90 text-teal-600 hover:bg-red-500 hover:text-white'
                }`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <i className={`ri-heart-${isFavorite ? 'fill' : 'line'} text-sm`}></i>
              </button>
              <button
                onClick={handleWatchlistToggle}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 backdrop-blur-sm shadow-lg ${
                  isInWatchlist
                    ? 'bg-teal-500/90 text-white'
                    : 'bg-white/90 text-teal-600 hover:bg-teal-500 hover:text-white'
                }`}
                aria-label={isInWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                <i className={`ri-bookmark-${isInWatchlist ? 'fill' : 'line'} text-sm`}></i>
              </button>
              <button
                onClick={handleMoreInfoToggle}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/90 text-teal-600 hover:bg-blue-500 hover:text-white transition-all duration-200 backdrop-blur-sm shadow-lg"
                aria-label="More information"
              >
                <i className="ri-information-line text-sm"></i>
              </button>
            </div>

            {/* Rating */}
            <div className="absolute bottom-3 left-3">
              <div className="flex items-center gap-1 px-3 py-1.5 bg-black/70 backdrop-blur-sm text-white text-xs rounded-full shadow-lg">
                <i className="ri-star-fill text-yellow-400"></i>
                <span className="font-medium">{props.rating}</span>
              </div>
            </div>

            {/* Play Button Overlay */}
            <div
              className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-300 ${
                isHovered ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <div className="w-14 h-14 bg-white/95 backdrop-blur-sm rounded-full flex items-center justify-center shadow-xl">
                <i className="ri-play-fill text-teal-600 text-xl ml-1"></i>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            <h3 className="font-semibold text-teal-800 mb-2 line-clamp-2 group-hover:text-teal-600 transition-colors duration-200 leading-tight">
              {props.title}
            </h3>

            <div className="flex items-center justify-between text-sm text-teal-600 mb-3">
              <span className="font-medium">{props.year || 'N/A'}</span>
              <span className="font-medium">{props.totalEpisodes} episodes</span>
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {props.genres.slice(0, 2).map((g) => (
                <span
                  key={g}
                  className="px-2 py-1 bg-teal-100/80 text-teal-700 text-xs rounded-full font-medium"
                >
                  {g}
                </span>
              ))}
              {props.genres.length > 2 && (
                <span className="px-2 py-1 bg-teal-50/80 text-teal-600 text-xs rounded-full font-medium">
                  +{props.genres.length - 2}
                </span>
              )}
            </div>

            {/* Progress Bar (if in watchlist) */}
            {isInWatchlist && props.totalEpisodes > 0 && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-teal-600 mb-1.5">
                  <span className="font-medium">Progress</span>
                  <span className="font-medium">
                    {watchProgress}/{props.totalEpisodes}
                  </span>
                </div>
                <div className="w-full bg-teal-100/80 rounded-full h-2">
                  <div
                    className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(watchProgress / props.totalEpisodes) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

            {props.description && (
              <p className="text-xs text-teal-600 line-clamp-2 leading-relaxed">
                {props.description}
              </p>
            )}
          </div>
        </Link>
      </motion.div>

      {/* More Info Modal */}
      <AnimatePresence>
        {showMoreInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={handleCloseModal}
            role="dialog"
            aria-labelledby="modal-title"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative">
                <img
                  src={getProxiedImageUrl(props.cover) || fallbackImage}
                  alt={props.title}
                  className="w-full h-48 object-cover object-top rounded-t-2xl"
                  width={800}
                  height={192}
                  loading="lazy"
                  decoding="async"
                  onError={(e) => (e.currentTarget.src = fallbackImage)}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent rounded-t-2xl" />
                <button
                  onClick={() => setShowMoreInfo(false)}
                  className="absolute top-4 right-4 w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all duration-200"
                  aria-label="Close modal"
                >
                  <i className="ri-close-line text-lg"></i>
                </button>
                <div className="absolute bottom-4 left-6">
                  <h2 id="modal-title" className="text-2xl font-bold text-white mb-2">
                    {props.title}
                  </h2>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1 text-yellow-400">
                      <i className="ri-star-fill"></i>
                      <span className="text-white font-medium">{props.rating}</span>
                    </div>
                    <span className="text-white/90">{props.year || 'N/A'}</span>
                    <span className="text-white/90">{props.totalEpisodes} episodes</span>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {/* Genres */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {props.genres.map((genre) => (
                    <span
                      key={genre}
                      className="px-3 py-1.5 bg-teal-100 text-teal-700 text-sm rounded-full font-medium"
                    >
                      {genre}
                    </span>
                  ))}
                </div>

                {/* Status */}
                {props.status && (
                  <div className="mb-4">
                    <h3 className="font-semibold text-teal-800 mb-2">Status</h3>
                    <span
                      className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                        props.status.toLowerCase() === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : props.status.toLowerCase() === 'ongoing'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-teal-50 text-teal-700'
                      }`}
                    >
                      {props.status.charAt(0).toUpperCase() + props.status.slice(1)}
                    </span>
                  </div>
                )}

                {/* Description */}
                <div className="mb-6">
                  <h3 className="font-semibold text-teal-800 mb-3">Synopsis</h3>
                  <p className="text-teal-700 leading-relaxed">{getDetailedDescription}</p>
                </div>

                {/* Additional Info */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <h4 className="font-medium text-teal-800 mb-1">Episodes</h4>
                    <p className="text-teal-600">{props.totalEpisodes}</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-teal-800 mb-1">Year</h4>
                    <p className="text-teal-600">{props.year || 'N/A'}</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-teal-800 mb-1">Rating</h4>
                    <p className="text-teal-600">{props.rating}/10</p>
                  </div>
                  <div>
                    <h4 className="font-medium text-teal-800 mb-1">Genres</h4>
                    <p className="text-teal-600">{props.genres.length}</p>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3">
                  <Link to={`/player/${props._id}/1`} className="flex-1 min-w-0">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="w-full bg-teal-600 hover:bg-teal-700 text-white px-4 py-3 rounded-lg font-medium transition-colors duration-200 flex items-center justify-center gap-2 whitespace-nowrap"
                    >
                      <i className="ri-play-fill"></i>
                      Watch Now
                    </motion.button>
                  </Link>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleWatchlistToggle}
                    className={`px-4 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${
                      isInWatchlist
                        ? 'bg-teal-100 text-teal-700 hover:bg-teal-200'
                        : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                    }`}
                    aria-label={isInWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    <i className={`ri-bookmark-${isInWatchlist ? 'fill' : 'line'}`}></i>
                    {isInWatchlist ? 'In Watchlist' : 'Add to List'}
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleFavoriteToggle}
                    className={`px-4 py-3 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${
                      isFavorite
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-teal-50 text-teal-700 hover:bg-teal-100'
                    }`}
                    aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <i className={`ri-heart-${isFavorite ? 'fill' : 'line'}`}></i>
                    {isFavorite ? 'Favorited' : 'Favorite'}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      {showToast && (
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          className="fixed bottom-4 right-4 bg-teal-600 text-white px-4 py-2 rounded-lg shadow-lg z-50"
        >
          {showToast}
        </motion.div>
      )}
    </>
  );
});

export default AnimeCard;