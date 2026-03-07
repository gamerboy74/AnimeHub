import { useState, useEffect, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimeService } from '../services/anime'
import type { Tables } from '../../lib/database/supabase'
import { queryKeys } from './queryKeys'

type Anime = Tables<'anime'>

interface UseAnimeOptions {
  page?: number
  limit?: number
  genre?: string
  year?: number
  status?: string
  search?: string
}

export function useAnime(options: UseAnimeOptions = {}) {
  const params = useMemo(() => ({
    page: options.page || 1,
    limit: options.limit || 20,
    genre: options.genre,
    year: options.year,
    status: options.status,
    search: options.search,
  }), [options.page, options.limit, options.genre, options.year, options.status, options.search])

  const query = useQuery({
    queryKey: queryKeys.anime.list(params),
    queryFn: () => AnimeService.getAnimeList(params.page, params.limit, {
      genre: params.genre,
      year: params.year,
      status: params.status,
      search: params.search,
    }),
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: true, // Always refetch on mount to ensure fresh data
    refetchOnWindowFocus: false,
    keepPreviousData: false, // Don't keep previous data to avoid showing stale empty data
  })

  return {
    anime: query.data?.data ?? [],
    totalPages: query.data?.totalPages ?? 0,
    total: query.data?.total ?? 0,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
  }
}

export function useFeaturedAnime(limit: number = 5) {
  const query = useQuery({
    queryKey: queryKeys.anime.featured(limit),
    queryFn: () => AnimeService.getFeaturedAnime(limit),
    staleTime: 10 * 60 * 1000, // 10 minutes (increased)
    gcTime: 30 * 60 * 1000, // 30 minutes (increased)
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { anime: query.data ?? [], loading: query.isLoading, error: query.error ? (query.error as Error).message : null }
}

export function useTrendingAnime(limit: number = 10) {
  const query = useQuery({
    queryKey: queryKeys.anime.trending(limit),
    queryFn: () => AnimeService.getTrendingAnime(limit),
    staleTime: 5 * 60 * 1000, // 5 minutes (increased from 2)
    gcTime: 20 * 60 * 1000, // 20 minutes
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { anime: query.data ?? [], loading: query.isLoading, error: query.error ? (query.error as Error).message : null }
}

export function usePopularAnime(limit: number = 12) {
  const query = useQuery({
    queryKey: queryKeys.anime.popular(limit),
    queryFn: () => AnimeService.getPopularAnime(limit),
    staleTime: 5 * 60 * 1000, // 5 minutes (increased from 2)
    gcTime: 20 * 60 * 1000, // 20 minutes
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { anime: query.data ?? [], loading: query.isLoading, error: query.error ? (query.error as Error).message : null }
}

export function useRecentAnime(limit: number = 6) {
  const query = useQuery({
    queryKey: queryKeys.anime.recent(limit),
    queryFn: () => AnimeService.getRecentAnime(limit),
    staleTime: 2 * 60 * 1000, // 2 minutes (recently added changes often)
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
    refetchOnWindowFocus: false,
  })
  return { anime: query.data ?? [], loading: query.isLoading, error: query.error ? (query.error as Error).message : null }
}

export function useAnimeById(id: string, userId?: string) {
  const query = useQuery({
    queryKey: queryKeys.anime.byId(id, userId),
    queryFn: () => AnimeService.getAnimeById(id, userId),
    enabled: !!id,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
  return { anime: query.data ?? null, loading: query.isLoading, error: query.error ? (query.error as Error).message : null, refetch: query.refetch }
}

export function useSearchAnime(query: string, filters?: {
  genres?: string[]
  year?: string
  status?: string
  sortBy?: string
}) {
  const enabled = !!query && query.length >= 2
  const q = useQuery({
    queryKey: queryKeys.anime.search(query, filters),
    queryFn: () => AnimeService.searchAnime(query, 50, filters),
    enabled,
    staleTime: 3 * 60 * 1000,
    retry: 0,
  })
  return { anime: q.data ?? [], loading: q.isLoading, error: q.error ? (q.error as Error).message : null }
}

export function useGenres() {
  const q = useQuery({
    queryKey: queryKeys.anime.genres(),
    queryFn: () => AnimeService.getGenres(),
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: 1,
  })
  return { genres: q.data ?? [], loading: q.isLoading, error: q.error ? (q.error as Error).message : null }
}

export function useSimilarAnime(animeId: string, genres: string[], limit: number = 6) {
  const memoGenres = useMemo(() => genres, [genres.join(',')])
  const q = useQuery({
    queryKey: queryKeys.anime.similar(animeId, memoGenres, limit),
    queryFn: () => AnimeService.getSimilarAnime(animeId, memoGenres, limit),
    enabled: !!animeId && memoGenres.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  return { anime: q.data ?? [], loading: q.isLoading, error: q.error ? (q.error as Error).message : null }
}

export function useContinueWatching(userId: string | null) {
  const q = useQuery({
    queryKey: queryKeys.user.continueWatching(userId),
    queryFn: () => AnimeService.getContinueWatching(userId!, 10),
    enabled: !!userId,
    staleTime: 1 * 60 * 1000, // 1 minute – should feel fresh
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: true, // refresh when user returns to tab
  })
  return { anime: q.data ?? [], loading: q.isLoading, error: q.error ? (q.error as Error).message : null }
}

/**
 * Fetch all related seasons for an anime and return them sorted by season number.
 */
export function useRelatedSeasons(animeId: string, title: string, titleEnglish?: string | null) {
  const q = useQuery({
    queryKey: queryKeys.anime.seasons(animeId),
    queryFn: async () => {
      const { extractSeasonInfo, buildSeasonList } = await import('../utils/anime/seasons')

      // Get candidates from the service (handles progressive prefix search)
      const candidates = await AnimeService.getRelatedSeasons(animeId, title, titleEnglish)

      // Find the best base title by checking which candidate base titles
      // produce the most groupable results
      const infoEng = titleEnglish ? extractSeasonInfo(titleEnglish) : null
      const infoRaw = extractSeasonInfo(title)
      let baseTitle = infoEng?.baseTitle || infoRaw.baseTitle

      // Try building with the extracted base first
      let result = buildSeasonList(candidates, baseTitle)

      // If we only got 1 result and there are more candidates, try to find
      // a shorter franchise root that groups more entries
      if (result.length <= 1 && candidates.length >= 2) {
        // Try each candidate's extracted base title
        for (const c of candidates) {
          const cInfoEng = c.title_english ? extractSeasonInfo(c.title_english) : null
          const cInfoRaw = extractSeasonInfo(c.title)
          const candidateBase = cInfoEng?.baseTitle || cInfoRaw.baseTitle
          if (candidateBase && candidateBase !== baseTitle) {
            const alt = buildSeasonList(candidates, candidateBase)
            if (alt.length > result.length) {
              result = alt
              baseTitle = candidateBase
            }
          }
        }
      }

      return result
    },
    enabled: !!animeId && !!title,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  })
  return {
    seasons: q.data ?? [],
    loading: q.isLoading,
    error: q.error ? (q.error as Error).message : null,
  }
}