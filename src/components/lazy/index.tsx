// Lazy Loading Components for AnimeHub
// Reduces initial bundle size by loading components on demand

import { lazy } from 'react';

// Admin Components - Load only when needed
export const LazyAddAnimeModal = lazy(() => import('../admin/AddAnimeModal'));
export const LazyAddEpisodeModal = lazy(() => import('../admin/AddEpisodeModal'));
export const LazyEditAnimeModal = lazy(() => import('../admin/EditAnimeModal'));
export const LazyEditEpisodeModal = lazy(() => import('../admin/EditEpisodeModal'));
export const LazyAnimeScraperComponent = lazy(() => import('../admin/AnimeScraperComponent'));
export const LazyHiAnimeScraperComponent = lazy(() => import('../admin/HiAnimeScraperComponent'));
export const LazyEnhancedAnimeImporter = lazy(() => import('../admin/EnhancedAnimeImporter'));
export const LazyLargeAnimeScraper = lazy(() => import('../admin/LargeAnimeScraper'));
export const LazyImportAnalyticsDashboard = lazy(() => import('../admin/ImportAnalyticsDashboard'));
export const LazyTrailerDebugger = lazy(() => import('../admin/TrailerDebugger'));
export const LazyEpisodeStatusManager = lazy(() => import('../admin/EpisodeStatusManager'));
export const LazyScrapedEpisodesModal = lazy(() => import('../admin/ScrapedEpisodesModal'));

// Feature Components - Load on demand
export const LazyTrailerSection = lazy(() => import('../feature/TrailerSection'));
export const LazyRelatedAnime = lazy(() => import('../feature/RelatedAnime'));
export const LazyAnimeCharacters = lazy(() => import('../feature/AnimeCharacters'));
export const LazyNotificationCenter = lazy(() => import('../feature/NotificationCenter'));

// Player Components - Load when video is needed
export const LazySmartVideoPlayer = lazy(() => import('../player/SmartVideoPlayer'));
export const LazyIframePlayer = lazy(() => import('../player/IframePlayer'));
export const LazyYouTubePlayer = lazy(() => import('../player/YouTubePlayer'));

// Auth Components - Load when authentication is needed
export const LazyLoginModal = lazy(() => import('../auth/LoginModal'));
export const LazySignUpModal = lazy(() => import('../auth/SignUpModal'));

// Profile Components - Load when user profile is accessed
export const LazyGenrePreferences = lazy(() => import('../profile/GenrePreferences'));

// Search Components - Load when search is used
export const LazyLiveSearchDropdown = lazy(() => import('../search/LiveSearchDropdown'));

// Admin Pages - Load only for admin users
export const LazyAdminAnalytics = lazy(() => import('../../pages/admin/analytics/page'));
export const LazyAdminReports = lazy(() => import('../../pages/admin/reports/page'));
export const LazyAdminUsers = lazy(() => import('../../pages/admin/users/page'));
export const LazyAdminSettings = lazy(() => import('../../pages/admin/settings/page'));

// Loading fallback component
export const LazyLoadingFallback = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
    <span className="ml-2 text-teal-600">Loading...</span>
  </div>
);

// Error boundary for lazy components
export const LazyErrorFallback = ({ error, retry }: { error: Error; retry: () => void }) => (
  <div className="flex flex-col items-center justify-center p-8 text-center">
    <div className="text-red-500 mb-4">
      <i className="ri-error-warning-line text-4xl"></i>
    </div>
    <h3 className="text-lg font-semibold text-gray-800 mb-2">Failed to load component</h3>
    <p className="text-gray-600 mb-4">{error.message}</p>
    <button
      onClick={retry}
      className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
    >
      Try Again
    </button>
  </div>
);
