import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserService } from '../../services/user';
import { useAuthContext } from '../../contexts/auth/AuthContext';
import { queryKeys } from '../queryKeys';

export function useFavorites() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: queryKeys.user.favorites(user?.id ?? null),
    queryFn: () => UserService.getUserFavorites(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const addToFavorites = useCallback(async (animeId: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    try {
      await UserService.addToFavorites(user.id, animeId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.favorites(user.id) });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to add to favorites');
    }
  }, [user?.id, queryClient]);

  const removeFromFavorites = useCallback(async (animeId: string) => {
    if (!user?.id) {
      throw new Error('User not authenticated');
    }

    try {
      await UserService.removeFromFavorites(user.id, animeId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.user.favorites(user.id) });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to remove from favorites');
    }
  }, [user?.id, queryClient]);

  const isInFavorites = useCallback(async (animeId: string) => {
    if (!user?.id) return false;
    
    try {
      return await UserService.isInFavorites(user.id, animeId);
    } catch (err) {
      console.error('Check favorites error:', err);
      return false;
    }
  }, [user?.id]);

  return {
    favorites: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
    addToFavorites,
    removeFromFavorites,
    isInFavorites,
    refetch: q.refetch
  };
}
