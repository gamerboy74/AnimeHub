import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Button from '../base/Button';

// Interface for HeroSlide
interface HeroSlide {
  id: string;
  title: string;
  description: string;
  image: string;
  genres: string[];
  rating: number;
}

interface HeroCarouselProps {
  slides: HeroSlide[];
  loading?: boolean;
}

// Simple debounce utility
const debounce = <F extends (...args: any[]) => void>(func: F, wait: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<F>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

// Reusable navigation button component
const NavButton: React.FC<{
  onClick: () => void;
  direction: 'left' | 'right';
  ariaLabel: string;
}> = ({ onClick, direction, ariaLabel }) => (
  <button
    onClick={onClick}
    className="absolute top-1/2 transform -translate-y-1/2 w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-all duration-200"
    style={{ [direction]: '1rem' }}
    aria-label={ariaLabel}
  >
    <i className={`ri-arrow-${direction}-line text-xl`}></i>
  </button>
);

const HeroCarousel = React.memo(function HeroCarousel({ slides, loading = false }: HeroCarouselProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const fallbackImage = '/assets/images/default-anime-banner.jpg'; // Replace with actual path

  // Filter valid slides
  const validSlides = useMemo(
    () =>
      slides.filter(
        (slide) => slide.id && slide.title && slide.image && slide.description && slide.rating >= 0
      ),
    [slides]
  );

  // Handle visibility for auto-play
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Auto-play effect
  useEffect(() => {
    if (!isAutoPlaying || !validSlides.length || !isVisible) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % validSlides.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [validSlides.length, isAutoPlaying, isVisible]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced navigation functions
  const goToSlide = useCallback(
    debounce((index: number) => {
      setCurrentSlide(index);
    }, 200),
    []
  );

  const goToPrevious = useCallback(
    debounce(() => {
      setCurrentSlide((prev) => (prev - 1 + validSlides.length) % validSlides.length);
    }, 200),
    [validSlides.length]
  );

  const goToNext = useCallback(
    debounce(() => {
      setCurrentSlide((prev) => (prev + 1) % validSlides.length);
    }, 200),
    [validSlides.length]
  );

  // Show loading state or empty state
  if (loading || !validSlides.length) {
    return (
      <div
        className="relative h-96 md:h-[500px] overflow-hidden rounded-2xl bg-gray-200 animate-pulse"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse"></div>
        <div className="absolute bottom-8 left-8 right-8">
          <div className="h-8 bg-gray-300 rounded mb-4 w-3/4"></div>
          <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          <div className="flex gap-4 mt-6">
            <div className="h-12 bg-gray-300 rounded w-32"></div>
            <div className="h-12 bg-gray-300 rounded w-28"></div>
          </div>
        </div>
      </div>
    );
  }

  const currentSlideData = validSlides[currentSlide];

  return (
    <div
      className="relative h-96 md:h-[500px] overflow-hidden rounded-2xl"
      onMouseEnter={() => setIsAutoPlaying(false)}
      onMouseLeave={() => setIsAutoPlaying(true)}
      role="region"
      aria-label="Featured anime carousel"
      aria-live="polite"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSlide}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0"
          style={{ willChange: 'opacity' }}
        >
          <img
            src={currentSlideData.image || fallbackImage}
            srcSet={currentSlideData.image ? `${currentSlideData.image}?w=640 640w, ${currentSlideData.image}?w=960 960w, ${currentSlideData.image}?w=1280 1280w, ${currentSlideData.image}?w=1920 1920w` : undefined}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1920px"
            alt={currentSlideData.title}
            className="w-full h-full object-cover object-top"
            loading={currentSlide === 0 ? 'eager' : 'lazy'}
            fetchPriority={currentSlide === 0 ? 'high' : 'auto'}
            width={1920}
            height={500}
            decoding={currentSlide === 0 ? 'sync' : 'async'}
            style={{ aspectRatio: '1920/500', objectFit: 'cover' }}
            onError={(e) => (e.currentTarget.src = fallbackImage)}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
        </motion.div>
      </AnimatePresence>

      {/* Content */}
      <div className="absolute inset-0 flex items-center">
        <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            key={`content-${currentSlide}`}
            initial={{ x: -50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-lg"
          >
            <div className="flex flex-wrap gap-2 mb-4">
              {currentSlideData.genres.slice(0, 3).map((genre) => (
                <span
                  key={genre}
                  className="px-3 py-1 bg-yellow-400/90 text-teal-800 text-sm rounded-full font-medium backdrop-blur-sm"
                >
                  {genre}
                </span>
              ))}
            </div>

            <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 drop-shadow-lg">
              {currentSlideData.title}
            </h1>

            <p className="text-gray-200 text-lg mb-6 line-clamp-3 drop-shadow-md">
              {currentSlideData.description}
            </p>

            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center gap-1 text-yellow-400">
                <i className="ri-star-fill"></i>
                <span className="text-white font-medium">{currentSlideData.rating}</span>
              </div>
            </div>

            <div className="flex gap-4">
              <Link to={`/player/${currentSlideData.id}/1`} aria-label={`Watch ${currentSlideData.title}`}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button size="lg" className="bg-teal-700 hover:bg-teal-600">
                    <i className="ri-play-fill mr-2"></i>
                    Watch Now
                  </Button>
                </motion.div>
              </Link>

              <Link to={`/anime/${currentSlideData.id}`} aria-label={`More info about ${currentSlideData.title}`}>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="bg-white/20 backdrop-blur-sm text-white hover:bg-white/30"
                  >
                    <i className="ri-information-line mr-2"></i>
                    More Info
                  </Button>
                </motion.div>
              </Link>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Navigation Arrows */}
      <NavButton onClick={goToPrevious} direction="left" ariaLabel="Previous slide" />
      <NavButton onClick={goToNext} direction="right" ariaLabel="Next slide" />

      {/* Dots Indicator */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex gap-2">
        {validSlides.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-3 h-3 rounded-full transition-all duration-200 ${
              index === currentSlide ? 'bg-white scale-125' : 'bg-white/50 hover:bg-white/75'
            }`}
            aria-label={`Go to slide ${index + 1}`}
            aria-current={index === currentSlide ? 'true' : 'false'}
          />
        ))}
      </div>

      {/* Optional: Structured data for SEO */}
      {/* <script type="application/ld+json">
        {JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: validSlides.map((slide, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            item: {
              '@type': 'CreativeWork',
              name: slide.title,
              description: slide.description,
              image: slide.image,
            },
          })),
        })}
      </script> */}
    </div>
  );
});

export default HeroCarousel;