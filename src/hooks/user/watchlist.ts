import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserService } from '../../services/user';
import { useAuthContext } from '../../contexts/auth/AuthContext';
import { queryKeys } from '../queryKeys';

export function useWatchlist() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: queryKeys.user.watchlist(user?.id ?? null),
    queryFn: () => UserService.getUserWatchlist(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const addToWatchlist = useCallback(async (animeId: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    try {
      await UserService.addToWatchlist(user.id, animeId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.watchlist(user.id) });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to add to watchlist');
    }
  }, [user?.id, queryClient]);

  const removeFromWatchlist = useCallback(async (animeId: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    try {
      await UserService.removeFromWatchlist(user.id, animeId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.watchlist(user.id) });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to remove from watchlist');
    }
  }, [user?.id, queryClient]);

  const isInWatchlist = useCallback(async (animeId: string) => {
    if (!user?.id) return false;
    
    try {
      return await UserService.isInWatchlist(user.id, animeId);
    } catch (err) {
      console.error('Check watchlist error:', err);
      return false;
    }
  }, [user?.id]);

  return {
    watchlist: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    refetch: q.refetch
  };
}
