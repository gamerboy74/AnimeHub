import { useState, useEffect, useMemo } from 'react';
import { AnimeService } from '../../services/anime';

interface LiveSearchResult {
  id: string;
  title: string;
  poster_url?: string;
  year?: number;
  rating?: number;
  genres?: string[];
  status?: string;
}

export function useLiveSearch(query: string, minLength: number = 2) {
  const [results, setResults] = useState<LiveSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search effect
  useEffect(() => {
    if (!query || query.length < minLength) {
      setResults([]);
      setLoading(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Search for anime with the query
        const searchResults = await AnimeService.searchAnime(query, { limit: 8 });
        
        // Transform results to match our interface
        const transformedResults = searchResults.map(anime => ({
          id: anime.id,
          title: anime.title,
          poster_url: anime.poster_url,
          year: anime.year,
          rating: anime.rating,
          genres: anime.genres,
          status: anime.status
        }));
        
        setResults(transformedResults);
      } catch (err) {
        console.error('Live search error:', err);
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [query, minLength]);

  return { results, loading, error };
}
