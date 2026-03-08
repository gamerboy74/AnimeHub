import { QueryClient } from '@tanstack/react-query';
import { AnimeService } from '../../services/anime';

/**
 * Invalidate all anime-related React Query caches and clear the local service cache.
 * Use this after creating, updating, or deleting anime/episodes.
 */
export async function invalidateAllAnimeCaches(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['anime', 'featured'] }),
    queryClient.invalidateQueries({ queryKey: ['anime', 'trending'] }),
    queryClient.invalidateQueries({ queryKey: ['anime', 'popular'] }),
    queryClient.invalidateQueries({ queryKey: ['anime', 'recent'] }),
    queryClient.invalidateQueries({ queryKey: ['anime', 'list'] }),
  ]);
  AnimeService.clearCache();
}

/**
 * Invalidate caches for a specific anime (e.g. after editing episodes).
 */
export async function invalidateAnimeCaches(
  queryClient: QueryClient,
  animeId?: string
): Promise<void> {
  const promises = [invalidateAllAnimeCaches(queryClient)];
  if (animeId) {
    promises.push(
      queryClient.invalidateQueries({ queryKey: ['anime', 'byId', animeId] }) as Promise<void>
    );
  }
  await Promise.all(promises);
}
