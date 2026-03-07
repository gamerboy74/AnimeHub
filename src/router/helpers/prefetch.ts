// Lightweight route prefetch helpers
// Warm the chunk cache and prefetch critical queries before navigation
import { queryClient } from '../../utils/query';
import { queryKeys } from '../../hooks/queryKeys';
import { AnimeService } from '../../services/anime';
import { UserService } from '../../services/user';

export function prefetchRoute(path: string) {
  switch (true) {
    case path === '/':
      // Prefetch route chunk and critical home queries
      void queryClient.prefetchQuery({ queryKey: queryKeys.anime.featured(5), queryFn: () => AnimeService.getFeaturedAnime(5) });
      void queryClient.prefetchQuery({ queryKey: queryKeys.anime.trending(10), queryFn: () => AnimeService.getTrendingAnime(10) });
      void queryClient.prefetchQuery({ queryKey: queryKeys.anime.popular(12), queryFn: () => AnimeService.getPopularAnime(12) });
      return import('../../pages/home');
    case path.startsWith('/anime/'):
      return import('../../pages/anime-detail/page');
    case path === '/anime':
      // Default list prefetch for first page
      void queryClient.prefetchQuery({
        queryKey: queryKeys.anime.list({ page: 1, limit: 20, genre: undefined, year: undefined, status: undefined, search: undefined }),
        queryFn: () => AnimeService.getAnimeList(1, 20, {}),
      });
      return import('../../pages/anime/page');
    case path.startsWith('/player/'):
      return import('../../pages/player/page');
    case path === '/watchlist':
      // Auth-aware prefetch of watchlist
      void (async () => {
        const profile = await UserService.getCurrentUser();
        if (profile?.id) {
          await queryClient.prefetchQuery({
            queryKey: queryKeys.user.watchlist(profile.id),
            queryFn: () => UserService.getUserWatchlist(profile.id),
            staleTime: 5 * 60 * 1000,
          });
        }
      })();
      return import('../../pages/watchlist/page');
    case path === '/favorites':
      void (async () => {
        const profile = await UserService.getCurrentUser();
        if (profile?.id) {
          await queryClient.prefetchQuery({
            queryKey: queryKeys.user.favorites(profile.id),
            queryFn: () => UserService.getUserFavorites(profile.id),
            staleTime: 5 * 60 * 1000,
          });
        }
      })();
      return import('../../pages/favorites/page');
    case path === '/profile':
      void (async () => {
        const profile = await UserService.getCurrentUser();
        if (profile?.id) {
          await Promise.all([
            queryClient.prefetchQuery({ queryKey: queryKeys.user.profile(profile.id), queryFn: () => UserService.getCurrentUser(), staleTime: 5 * 60 * 1000 }),
            queryClient.prefetchQuery({ queryKey: queryKeys.user.stats(profile.id), queryFn: () => UserService.getUserStats(profile.id), staleTime: 5 * 60 * 1000 }),
            queryClient.prefetchQuery({ queryKey: queryKeys.user.recentActivity(profile.id), queryFn: () => UserService.getRecentActivity(profile.id), staleTime: 5 * 60 * 1000 }),
          ]);
        }
      })();
      return import('../../pages/profile/page');
    case path === '/settings':
      return import('../../pages/settings/page');
    case path === '/search':
      return import('../../pages/search/page');
    case path === '/admin':
      return import('../../pages/admin/page');
    default:
      return Promise.resolve();
  }
}

export function prefetchOnHover(href: string) {
  // Fire and forget; errors are non-fatal
  try {
    void prefetchRoute(href);
  } catch {
    // ignore
  }
}


