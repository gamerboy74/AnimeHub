import { useState, useEffect } from 'react'
import { AnimeRelationsService } from '../../services/anime/relations';
import type { AnimeRelation, AnimeCharacter } from '../../services/anime/relations';

export interface UseAnimeRelationsResult {
  relatedAnime: AnimeRelation[]
  similarAnime: any[]
  characters: AnimeCharacter[]
  studios: any[]
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAnimeRelations(animeId: string): UseAnimeRelationsResult {
  const [relatedAnime, setRelatedAnime] = useState<AnimeRelation[]>([])
  const [similarAnime, setSimilarAnime] = useState<any[]>([])
  const [characters, setCharacters] = useState<AnimeCharacter[]>([])
  const [studios, setStudios] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = async () => {
    if (!animeId) return

    try {
      setLoading(true)
      setError(null)

      const [related, similar, chars, studioData] = await Promise.all([
        AnimeRelationsService.getRelatedAnime(animeId),
        AnimeRelationsService.getSimilarAnime(animeId, 8),
        AnimeRelationsService.getAnimeCharacters(animeId),
        AnimeRelationsService.getAnimeStudios(animeId)
      ])

      setRelatedAnime(related)
      setSimilarAnime(similar)
      setCharacters(chars)
      setStudios(studioData)
    } catch (err) {
      console.error('Error fetching anime relations:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch anime relations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [animeId])

  return {
    relatedAnime,
    similarAnime,
    characters,
    studios,
    loading,
    error,
    refetch: fetchData
  }
}

export function useAnimeByTitleSimilarity(baseTitle: string, excludeId: string, limit: number = 10) {
  const [anime, setAnime] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    if (!baseTitle || !excludeId) return

    try {
      setLoading(true)
      setError(null)

      const results = await AnimeRelationsService.getAnimeByTitleSimilarity(baseTitle, excludeId, limit)
      setAnime(results)
    } catch (err) {
      console.error('Error searching anime by title similarity:', err)
      setError(err instanceof Error ? err.message : 'Failed to search anime')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    search()
  }, [baseTitle, excludeId, limit])

  return {
    anime,
    loading,
    error,
    refetch: search
  }
}

export function useAnimeCharacters(animeId: string) {
  const [characters, setCharacters] = useState<AnimeCharacter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCharacters = async () => {
    if (!animeId) return

    try {
      setLoading(true)
      setError(null)

      const results = await AnimeRelationsService.getAnimeCharacters(animeId)
      setCharacters(results)
    } catch (err) {
      console.error('Error fetching anime characters:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch characters')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCharacters()
  }, [animeId])

  return {
    characters,
    loading,
    error,
    refetch: fetchCharacters
  }
}

export function useAnimeSearch(criteria: {
  genres?: string[]
  studios?: string[]
  year?: number
  type?: string
  status?: string
  minRating?: number
  limit?: number
}) {
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = async () => {
    try {
      setLoading(true)
      setError(null)

      const searchResults = await AnimeRelationsService.searchAnimeByCriteria(criteria)
      setResults(searchResults)
    } catch (err) {
      console.error('Error searching anime:', err)
      setError(err instanceof Error ? err.message : 'Failed to search anime')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (criteria.genres?.length || criteria.studios?.length || criteria.year || criteria.type || criteria.status || criteria.minRating) {
      search()
    }
  }, [criteria])

  return {
    results,
    loading,
    error,
    refetch: search
  }
}
