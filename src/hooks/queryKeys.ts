// Centralized React Query keys

export const queryKeys = {
  anime: {
    list: (params: { page: number; limit: number; genre?: string; year?: number; status?: string; search?: string }) =>
      ['anime', 'list', params] as const,
    featured: (limit: number) => ['anime', 'featured', limit] as const,
    trending: (limit: number) => ['anime', 'trending', limit] as const,
    popular: (limit: number) => ['anime', 'popular', limit] as const,
    recent: (limit: number) => ['anime', 'recent', limit] as const,
    byId: (id: string, userId?: string) => ['anime', 'byId', id, userId ?? null] as const,
    search: (query: string, filters?: any) => ['anime', 'search', query, filters ?? {}] as const,
    similar: (id: string, genres: string[], limit: number) => ['anime', 'similar', id, genres.slice().sort(), limit] as const,
    genres: () => ['anime', 'genres'] as const,
    seasons: (id: string) => ['anime', 'seasons', id] as const,
  },
  user: {
    profile: (userId: string | null) => ['user', 'profile', userId] as const,
    favorites: (userId: string | null) => ['user', 'favorites', userId] as const,
    watchlist: (userId: string | null) => ['user', 'watchlist', userId] as const,
    continueWatching: (userId: string | null) => ['user', 'continueWatching', userId] as const,
    stats: (userId: string | null) => ['user', 'stats', userId] as const,
    recentActivity: (userId: string | null) => ['user', 'recentActivity', userId] as const,
  },
};


