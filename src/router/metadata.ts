/**
 * Route Metadata Configuration
 * Defines titles, descriptions, permissions, and SEO metadata for each route
 */

export interface RouteMetadata {
  title: string | ((params: Record<string, string>, data?: Record<string, unknown>) => string);
  description?: string | ((params: Record<string, string>, data?: Record<string, unknown>) => string);
  keywords?: string[];
  requiresAuth?: boolean;
  requiresAdmin?: boolean;
  noIndex?: boolean;
  breadcrumbs?: Array<{ label: string; path: string }> | ((params: Record<string, string>, data?: Record<string, unknown>) => Array<{ label: string; path: string }>);
  ogImage?: string;
}

export const routeMetadata: Record<string, RouteMetadata> = {
  '/': {
    title: 'AnimeHub - Discover Your Next Favorite Anime',
    description: 'Stream thousands of anime series and movies. Discover trending anime, popular shows, and hidden gems.',
    keywords: ['anime', 'streaming', 'anime series', 'watch anime'],
    breadcrumbs: [{ label: 'Home', path: '/' }],
  },
  '/anime': {
    title: 'Browse Anime - AnimeHub',
    description: 'Browse our complete collection of anime series and movies. Filter by genre, year, status, and more.',
    keywords: ['anime list', 'browse anime', 'anime catalog'],
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Browse Anime', path: '/anime' }],
  },
  '/anime/:id': {
    title: (params: Record<string, string>, data?: { title?: string }) => 
      data?.title ? `${data.title} - AnimeHub` : 'Anime Details - AnimeHub',
    description: (params: Record<string, string>, data?: { description?: string }) =>
      data?.description || 'View detailed information about this anime series.',
    breadcrumbs: (params: Record<string, string>, data?: { title?: string }) => [
      { label: 'Home', path: '/' },
      { label: 'Browse Anime', path: '/anime' },
      { label: data?.title || 'Anime Details', path: `/anime/${params.id}` },
    ],
  },
  '/player/:animeId/:episode': {
    title: (params: Record<string, string>, data?: { title?: string; episode?: number }) =>
      data?.title && data?.episode 
        ? `Watch ${data.title} - Episode ${data.episode} | AnimeHub`
        : 'Watch Anime - AnimeHub',
    description: 'Watch anime episodes in high quality. Adjust playback speed, quality, and more.',
    noIndex: true, // Don't index player pages
    breadcrumbs: (params: Record<string, string>, data?: { title?: string; episode?: number }) => [
      { label: 'Home', path: '/' },
      { label: data?.title || 'Anime', path: `/anime/${params.animeId}` },
      { label: `Episode ${data?.episode || params.episode}`, path: `/player/${params.animeId}/${params.episode}` },
    ],
  },
  '/search': {
    title: 'Search Anime - AnimeHub',
    description: 'Search for anime by title, genre, or keywords. Find exactly what you\'re looking for.',
    keywords: ['search anime', 'find anime', 'anime search'],
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Search', path: '/search' }],
  },
  '/watchlist': {
    title: 'My Watchlist - AnimeHub',
    description: 'Manage your anime watchlist. Keep track of shows you want to watch.',
    requiresAuth: true,
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Watchlist', path: '/watchlist' }],
  },
  '/favorites': {
    title: 'My Favorites - AnimeHub',
    description: 'View your favorite anime series and movies.',
    requiresAuth: true,
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Favorites', path: '/favorites' }],
  },
  '/profile': {
    title: 'My Profile - AnimeHub',
    description: 'Manage your profile, preferences, and viewing history.',
    requiresAuth: true,
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Profile', path: '/profile' }],
  },
  '/settings': {
    title: 'Settings - AnimeHub',
    description: 'Customize your AnimeHub experience with personalized settings.',
    requiresAuth: true,
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Settings', path: '/settings' }],
  },
  '/admin': {
    title: 'Admin Dashboard - AnimeHub',
    description: 'Admin control panel for managing the AnimeHub platform.',
    requiresAuth: true,
    requiresAdmin: true,
    noIndex: true,
    breadcrumbs: [{ label: 'Home', path: '/' }, { label: 'Admin', path: '/admin' }],
  },
  '/admin/anime': {
    title: 'Manage Anime - Admin - AnimeHub',
    requiresAuth: true,
    requiresAdmin: true,
    noIndex: true,
    breadcrumbs: [
      { label: 'Home', path: '/' },
      { label: 'Admin', path: '/admin' },
      { label: 'Anime Management', path: '/admin/anime' },
    ],
  },
  '/admin/users': {
    title: 'Manage Users - Admin - AnimeHub',
    requiresAuth: true,
    requiresAdmin: true,
    noIndex: true,
    breadcrumbs: [
      { label: 'Home', path: '/' },
      { label: 'Admin', path: '/admin' },
      { label: 'User Management', path: '/admin/users' },
    ],
  },
};

/**
 * Get metadata for a route
 */
export function getRouteMetadata(
  path: string,
  params?: Record<string, string>,
  data?: Record<string, unknown>
): RouteMetadata | null {
  // Try exact match first
  let metadata = routeMetadata[path];
  
  // Try pattern matching for dynamic routes
  if (!metadata) {
    const patterns = Object.keys(routeMetadata).filter(key => key.includes(':'));
    for (const pattern of patterns) {
      const patternRegex = new RegExp('^' + pattern.replace(/:[^/]+/g, '([^/]+)') + '$');
      if (patternRegex.test(path)) {
        metadata = routeMetadata[pattern];
        break;
      }
    }
  }
  
  if (!metadata) return null;
  
  // Handle function-based metadata
  const processed: RouteMetadata = {
    title: typeof metadata.title === 'function' 
      ? metadata.title(params || {}, data)
      : metadata.title,
    description: typeof metadata.description === 'function'
      ? metadata.description(params || {}, data)
      : metadata.description,
    keywords: metadata.keywords,
    requiresAuth: metadata.requiresAuth,
    requiresAdmin: metadata.requiresAdmin,
    noIndex: metadata.noIndex,
    breadcrumbs: typeof metadata.breadcrumbs === 'function'
      ? metadata.breadcrumbs(params || {}, data)
      : metadata.breadcrumbs,
    ogImage: metadata.ogImage,
  };
  
  return processed;
}

