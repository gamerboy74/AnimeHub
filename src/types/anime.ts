export interface Anime {
  _id: string;
  title: string;
  description: string;
  cover: string;
  banner?: string;
  rating: number;
  year: number;
  type: 'TV' | 'Movie' | 'OVA' | 'ONA' | 'Special';
  status: 'Ongoing' | 'Completed' | 'Upcoming';
  season?: string;
  studios: string[];
  totalEpisodes: number;
  currentEpisode: number;
  popularity: number;
  views: number;
  genres: string[];
  altTitles?: string[];
  synonyms?: string[];
}

export interface AnimeResponse {
  anime: Anime[];
  currentPage: number;
  totalPages: number;
  totalAnime: number;
}

export interface UseAnimeOptions {
  page?: number;
  limit?: number;
  sortBy?: 'rating' | 'views';
  genre?: string;
}