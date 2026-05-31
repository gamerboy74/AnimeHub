import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AnimeImporterService } from '../../services/anime/importer';
import { HiAnimeScraperService } from '../../services/scrapers/hianime';
import { AdminAnimeService } from '../../services/admin/anime';
import { supabase } from '../../lib/database/supabase';

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: string[];
  duplicates: string[];
}

interface SearchResult {
  title: string;
  title_english?: string;
  title_romaji?: string;
  title_japanese?: string;
  year?: number;
  status?: string;
  type?: string;
  genres?: string[];
  rating?: number;
  poster_url?: string;
  description?: string;
  source: 'jikan' | 'anilist';
  originalData: any;
}

interface ImportProgress {
  total: number;
  completed: number;
  current: string;
  percentage: number;
}

interface EnhancedAnimeImporterProps {
  onImportComplete?: () => void;
}

export const EnhancedAnimeImporter: React.FC<EnhancedAnimeImporterProps> = ({ onImportComplete }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [source, setSource] = useState<'jikan' | 'anilist'>('jikan');
  const [showPreview, setShowPreview] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [searchFilters, setSearchFilters] = useState({
    year: '',
    genre: '',
    status: '',
    rating: '',
    sortBy: 'relevance'
  });
  const [batchSize, setBatchSize] = useState(5);
  const [autoImport, setAutoImport] = useState(false);
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'trending' | 'seasonal' | 'debug'>('search');
  const [message, setMessage] = useState<string | null>(null);
  const [scrapingAnimeId, setScrapingAnimeId] = useState<string | null>(null);
  const [resultMode, setResultMode] = useState<'search' | 'trending' | 'seasonal' | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [trendingPage, setTrendingPage] = useState(1);
  const [seasonalPage, setSeasonalPage] = useState(1);
  const [canLoadMoreResults, setCanLoadMoreResults] = useState(false);
  const [dbAnimeList, setDbAnimeList] = useState<any[]>([]);
  const [selectedDbAnimeId, setSelectedDbAnimeId] = useState<string>('');

  // Autocomplete Genre states
  const [availableGenres, setAvailableGenres] = useState<string[]>([]);
  const [showGenreDropdown, setShowGenreDropdown] = useState(false);

  // Debounce search query
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

  // Debounce search query with 300ms delay
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Load database anime list for maintenance tools
  useEffect(() => {
    if (activeTab === 'debug') {
      const fetchDbAnimeList = async () => {
        try {
          const { data, error } = await supabase
            .from('anime')
            .select('id, title')
            .order('title');
          if (!error && data) {
            setDbAnimeList(data);
          }
        } catch (err) {
          console.error('Failed to fetch anime list:', err);
        }
      };
      fetchDbAnimeList();
    }
  }, [activeTab]);

  // Load import history and database genres on mount
  useEffect(() => {
    loadImportHistory();
    loadGenresList();
  }, []);

  const loadGenresList = async () => {
    try {
      const genres = await AdminAnimeService.getAvailableGenres();
      setAvailableGenres(genres || []);
    } catch (err) {
      console.error('Failed to load genres:', err);
    }
  };

  const loadImportHistory = async () => {
    try {
      const history = JSON.parse(localStorage.getItem('animeImportHistory') || '[]');
      setImportHistory(history);
    } catch (error) {
      console.error('Failed to load import history:', error);
    }
  };

  const saveImportHistory = (result: ImportResult, query: string) => {
    const historyItem = {
      id: Date.now(),
      query,
      result,
      timestamp: new Date().toISOString(),
      source
    };

    const newHistory = [historyItem, ...importHistory.slice(0, 9)];
    setImportHistory(newHistory);
    localStorage.setItem('animeImportHistory', JSON.stringify(newHistory));
  };

  const mapApiResults = (results: any[], currentSource: 'jikan' | 'anilist'): SearchResult[] => {
    return results.map(anime => {
      const mapped = currentSource === 'jikan'
        ? AnimeImporterService.mapJikanToDatabase(anime)
        : AnimeImporterService.mapAniListToDatabase(anime);

      return {
        ...mapped,
        source: currentSource,
        originalData: anime
      } as SearchResult;
    });
  };

  const getResultTitles = (anime: SearchResult): string[] => {
    return [anime.title, anime.title_english, anime.title_romaji, anime.title_japanese]
      .filter((value): value is string => Boolean(value && value.trim()));
  };

  const normalizeTitle = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

  const filterExistingAnimeResults = async (results: SearchResult[]): Promise<SearchResult[]> => {
    const candidateTitles = Array.from(
      new Set(results.flatMap(anime => getResultTitles(anime)))
    );

    if (candidateTitles.length === 0) {
      return results;
    }

    try {
      const { data, error } = await supabase
        .from('anime')
        .select('title')
        .in('title', candidateTitles);

      if (error) {
        console.warn('Could not check existing anime titles:', error.message);
        return results;
      }

      const existingTitles = new Set(
        (data || [])
          .map(row => row.title)
          .filter((value): value is string => Boolean(value))
          .map(normalizeTitle)
      );

      return results.filter(anime => {
        return !getResultTitles(anime).some(title => existingTitles.has(normalizeTitle(title)));
      });
    } catch (error) {
      console.warn('Failed to filter existing anime results:', error);
      return results;
    }
  };

  const handleSearch = useCallback(async (query: string, page: number = 1, append: boolean = false) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setResultMode('search');
    if (!append) {
      setSearchResults([]);
      setSelectedAnime([]);
      setImportResult(null);
      setSearchPage(1);
      setCanLoadMoreResults(false);
      setMessage(null);
      setScrapingAnimeId(null);
    }

    try {
      const pageSize = source === 'jikan' ? 25 : 50;
      let results: any[] = [];

      if (source === 'jikan') {
        results = await AnimeImporterService.searchJikanAnime(query, pageSize, page);
      } else {
        results = await AnimeImporterService.searchAniListAnime(query, pageSize, page);
      }

      const filteredResults = await filterExistingAnimeResults(applyFiltersToResults(mapApiResults(results, source)));
      setSearchResults(prev => append ? [...prev, ...filteredResults] : filteredResults);
      setSearchPage(page);
      setCanLoadMoreResults(results.length === pageSize);
    } catch (error) {
      console.error('Search error:', error);
      alert(`Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  }, [source, searchFilters]);

  // Auto-search when debounced query changes
  useEffect(() => {
    if (debouncedSearchQuery.trim() && activeTab === 'search') {
      handleSearch(debouncedSearchQuery);
    }
  }, [debouncedSearchQuery, activeTab, handleSearch]);

  const applyFiltersToResults = (results: SearchResult[]): SearchResult[] => {
    let filteredResults = results;

    if (searchFilters.year) {
      filteredResults = filteredResults.filter(anime =>
        anime.year === parseInt(searchFilters.year) ||
        anime.originalData.startDate?.year === parseInt(searchFilters.year)
      );
    }

    if (searchFilters.genre) {
      filteredResults = filteredResults.filter(anime =>
        anime.genres?.some((g: string) =>
          g.toLowerCase().includes(searchFilters.genre.toLowerCase())
        )
      );
    }

    if (searchFilters.status) {
      filteredResults = filteredResults.filter(anime =>
        anime.status?.toLowerCase().includes(searchFilters.status.toLowerCase())
      );
    }

    if (searchFilters.rating) {
      const minRating = parseFloat(searchFilters.rating);
      filteredResults = filteredResults.filter(anime =>
        (anime.rating || anime.originalData.score || anime.originalData.averageScore) >= minRating
      );
    }

    filteredResults.sort((a, b) => {
      switch (searchFilters.sortBy) {
        case 'rating':
          return (b.rating || b.originalData.score || b.originalData.averageScore || 0) -
            (a.rating || a.originalData.score || a.originalData.averageScore || 0);
        case 'year':
          return (b.year || b.originalData.startDate?.year || 0) -
            (a.year || a.originalData.startDate?.year || 0);
        case 'title':
          return (a.title || '').localeCompare(b.title || '');
        case 'popularity':
          return (b.originalData.popularity || b.originalData.members || 0) -
            (a.originalData.popularity || a.originalData.members || 0);
        default:
          return 0;
      }
    });

    return filteredResults;
  };

  const handleSelectAnime = (anime: SearchResult) => {
    setSelectedAnime(prev => {
      const isSelected = prev.some(selected =>
        selected.title === anime.title && selected.source === anime.source
      );

      if (isSelected) {
        return prev.filter(selected =>
          !(selected.title === anime.title && selected.source === anime.source)
        );
      } else {
        return [...prev, anime];
      }
    });
  };

  const handleBulkImport = async () => {
    if (selectedAnime.length === 0) {
      alert('Please select at least one anime to import');
      return;
    }

    setIsImporting(true);
    setImportResult(null);
    setMessage(null);
    setScrapingAnimeId(null);
    setImportProgress({
      total: selectedAnime.length,
      completed: 0,
      current: '',
      percentage: 0
    });

    try {
      const results: ImportResult = {
        success: true,
        imported: 0,
        skipped: 0,
        errors: [],
        duplicates: []
      };

      const currentBatchSize = batchSize || 3;
      for (let i = 0; i < selectedAnime.length; i += currentBatchSize) {
        const batch = selectedAnime.slice(i, i + currentBatchSize);

        const batchPromises = batch.map(async (anime) => {
          try {
            const mappedData = anime.source === 'jikan'
              ? AnimeImporterService.mapJikanToDatabase(anime.originalData)
              : AnimeImporterService.mapAniListToDatabase(anime.originalData);

            const imported = anime.source === 'anilist'
              ? await (AnimeImporterService as any).importAnimeFromAniList(anime.originalData)
              : await AnimeImporterService.importAnime(mappedData);
            return {
              success: !!imported,
              title: anime.title,
              isDuplicate: !imported
            };
          } catch (error) {
            return {
              success: false,
              title: anime.title,
              error: error instanceof Error ? error.message : 'Unknown error',
              isDuplicate: false
            };
          }
        });

        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((settledResult, batchIndex) => {
          const result = settledResult.status === 'fulfilled'
            ? settledResult.value
            : {
              success: false,
              title: batch[batchIndex]?.title || 'Unknown',
              error: settledResult.reason?.message || 'Unknown error',
              isDuplicate: false
            };

          setImportProgress(prev => prev ? {
            ...prev,
            current: result.title,
            completed: prev.completed + 1,
            percentage: Math.round(((prev.completed + 1) / prev.total) * 100)
          } : null);

          if (result.success) {
            results.imported++;
          } else if (result.isDuplicate) {
            results.skipped++;
            results.duplicates.push(result.title);
          } else {
            results.errors.push(`${result.title}: ${result.error}`);
          }
        });

        if (i + currentBatchSize < selectedAnime.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      setImportResult(results);
      saveImportHistory(results, searchQuery);
      setSelectedAnime([]);
      setSearchResults([]);

      if (results.imported > 0 && onImportComplete) {
        onImportComplete();
      }
    } catch (error) {
      console.error('Import error:', error);
      alert(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const handleQuickImport = async (anime: SearchResult) => {
    setIsImporting(true);
    setImportResult(null);
    setMessage(null);
    setScrapingAnimeId(null);

    try {
      const mappedData = anime.source === 'jikan'
        ? AnimeImporterService.mapJikanToDatabase(anime.originalData)
        : AnimeImporterService.mapAniListToDatabase(anime.originalData);

      const imported = anime.source === 'anilist'
        ? await (AnimeImporterService as any).importAnimeFromAniList(anime.originalData)
        : await AnimeImporterService.importAnime(mappedData);

      if (imported) {
        const result = {
          success: true,
          imported: 1,
          skipped: 0,
          errors: [],
          duplicates: []
        };

        setImportResult(result);
        saveImportHistory(result, anime.title);

        setSearchResults(prev => prev.filter(res =>
          !(res.title === anime.title && res.source === anime.source)
        ));

        if (onImportComplete) {
          onImportComplete();
        }
      } else {
        setImportResult({
          success: false,
          imported: 0,
          skipped: 1,
          errors: [],
          duplicates: [anime.title]
        });
      }
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: [`${anime.title}: ${error instanceof Error ? error.message : 'Unknown error'}`],
        duplicates: []
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportAndScrape = async (anime: SearchResult) => {
    setIsImporting(true);
    setImportResult(null);
    setScrapingAnimeId(null);
    setMessage(null);

    try {
      const mappedData = anime.source === 'jikan'
        ? AnimeImporterService.mapJikanToDatabase(anime.originalData)
        : AnimeImporterService.mapAniListToDatabase(anime.originalData);

      let importedAnime: any = null;
      if (anime.source === 'anilist') {
        const ok = await (AnimeImporterService as any).importAnimeFromAniList(anime.originalData, { skipAutoScrape: true });
        if (ok) {
          const { data } = await supabase
            .from('anime')
            .select('id, title, total_episodes')
            .ilike('title', mappedData.title || '')
            .maybeSingle();
          importedAnime = data;
        }
      } else {
        importedAnime = await AnimeImporterService.importAnime(mappedData, { skipAutoScrape: true });
      }

      if (!importedAnime) {
        setImportResult({ success: false, imported: 0, skipped: 1, errors: [], duplicates: [anime.title] });
        return;
      }

      setImportResult({ success: true, imported: 1, skipped: 0, errors: [], duplicates: [] });
      saveImportHistory({ success: true, imported: 1, skipped: 0, errors: [], duplicates: [] }, anime.title);

      const totalEps = importedAnime.total_episodes || (anime.originalData as any)?.episodes || 0;
      if (totalEps > 0 && importedAnime.id) {
        setScrapingAnimeId(importedAnime.id);
        setMessage(`📺 Imported! Now scraping ${totalEps} episodes for "${anime.title}"...`);

        const episodeNumbers = Array.from({ length: totalEps }, (_, i) => i + 1);

        try {
          await HiAnimeScraperService.batchScrapeEpisodesWithProgress(
            importedAnime.title || anime.title,
            importedAnime.id,
            episodeNumbers,
            (event) => {
              if (event.type === 'progress' || event.type === 'success') {
                setMessage(`📺 Scraping episodes: ${event.current || '?'}/${totalEps} — ${event.title || ''}`);
              } else if (event.type === 'error') {
                console.warn('Episode scrape error:', event.error);
              } else if (event.type === 'complete') {
                setMessage(`✅ Done! ${event.successCount || 0}/${event.total || totalEps} episodes scraped successfully.`);
              }
            },
          );
        } catch (scrapeErr) {
          console.error('Batch scrape error:', scrapeErr);
          setMessage(`⚠️ Import succeeded but scraping failed: ${scrapeErr instanceof Error ? scrapeErr.message : 'Unknown error'}`);
        }
      } else {
        setScrapingAnimeId(importedAnime?.id || 'unknown');
        setMessage(`✅ Imported "${anime.title}"! (Episode count unknown — scrape manually from the Scraper tab.)`);
      }

      setSearchResults(prev => prev.filter(r => !(r.title === anime.title && r.source === anime.source)));

      if (onImportComplete) onImportComplete();
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: [`${anime.title}: ${error instanceof Error ? error.message : 'Unknown error'}`],
        duplicates: []
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleTrendingImport = async (page: number = 1, append: boolean = false) => {
    setIsSearching(true);
    setResultMode('trending');
    if (!append) {
      setSearchResults([]);
      setSelectedAnime([]);
      setImportResult(null);
      setTrendingPage(1);
      setCanLoadMoreResults(false);
      setMessage(null);
      setScrapingAnimeId(null);
    }

    try {
      const pageSize = source === 'jikan' ? 25 : 50;
      let results: any[] = [];

      if (source === 'anilist') {
        results = await AnimeImporterService.getTrendingAniListAnime(pageSize, page);
      } else {
        results = await AnimeImporterService.getTrendingJikanAnime(pageSize, page);
      }

      const mappedResults = mapApiResults(results, source);
      const filteredResults = await filterExistingAnimeResults(applyFiltersToResults(mappedResults));
      setSearchResults(prev => append ? [...prev, ...filteredResults] : filteredResults);
      setTrendingPage(page);
      setCanLoadMoreResults(results.length === pageSize);
    } catch (error) {
      console.error('Trending import error:', error);
      alert(`Failed to fetch trending anime: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSeasonalImport = async (page: number = 1, append: boolean = false) => {
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    let season = 'winter';
    if (month >= 3 && month <= 5) season = 'spring';
    else if (month >= 6 && month <= 8) season = 'summer';
    else if (month >= 9 && month <= 11) season = 'fall';

    setIsSearching(true);
    setResultMode('seasonal');
    if (!append) {
      setSearchResults([]);
      setSelectedAnime([]);
      setImportResult(null);
      setSeasonalPage(1);
      setCanLoadMoreResults(false);
      setMessage(null);
      setScrapingAnimeId(null);
    }

    try {
      const pageSize = source === 'jikan' ? 25 : 50;
      let results: any[] = [];

      if (source === 'anilist') {
        results = await (AnimeImporterService as any).getSeasonalAniListAnime(year, season, pageSize, page);
      } else {
        results = await AnimeImporterService.getSeasonalJikanAnime(year, season, pageSize, page);
      }

      const mappedResults = mapApiResults(results, source);
      const filteredResults = await filterExistingAnimeResults(applyFiltersToResults(mappedResults));
      setSearchResults(prev => append ? [...prev, ...filteredResults] : filteredResults);
      setSeasonalPage(page);
      setCanLoadMoreResults(results.length === pageSize);
    } catch (error) {
      console.error('Seasonal import error:', error);
      alert(`Failed to fetch seasonal anime: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMoreResults = async () => {
    if (isSearching || !canLoadMoreResults || !resultMode) return;

    if (resultMode === 'search') {
      await handleSearch(searchQuery, searchPage + 1, true);
    } else if (resultMode === 'trending') {
      await handleTrendingImport(trendingPage + 1, true);
    } else if (resultMode === 'seasonal') {
      await handleSeasonalImport(seasonalPage + 1, true);
    }
  };

  const handleSelectAll = () => {
    if (selectedAnime.length === searchResults.length) {
      setSelectedAnime([]);
    } else {
      setSelectedAnime([...searchResults]);
    }
  };

  const handleClearFilters = () => {
    setSearchFilters({
      year: '',
      genre: '',
      status: '',
      rating: '',
      sortBy: 'relevance'
    });
  };

  const handleApplyFilters = async () => {
    if (!searchQuery.trim()) {
      await handleTrendingImport(1, false);
      return;
    }
    await handleSearch(searchQuery, 1, false);
  };

  const filteredGenres = availableGenres.filter(
    genre => genre && typeof genre === 'string' && genre.toLowerCase().includes(searchFilters.genre.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Premium Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-4 bg-white/80 backdrop-blur-md p-6 rounded-2xl border border-slate-100 shadow-sm"
      >
        <h1 className="text-3xl font-extrabold bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent mb-2 flex items-center justify-center gap-3">
          <i className="ri-download-cloud-2-line text-blue-600"></i>
          Anime Import Hub
        </h1>
        <p className="text-slate-500 text-sm font-medium max-w-xl mx-auto">
          Discover new series, fetch high-quality metadata, auto-build stubs, and scrape live video servers in the background instantly.
        </p>
      </motion.div>

      {/* Main Import Panel */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
      >
        {/* Tab Navigation Menu */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 border-b border-indigo-900/30">
          <div className="flex flex-wrap md:flex-nowrap gap-2 bg-white/5 backdrop-blur-md rounded-xl p-1.5 border border-white/5">
            {[
              { id: 'search', label: 'Search Anime', icon: 'ri-search-line' },
              { id: 'trending', label: 'Trending Feed', icon: 'ri-fire-line' },
              { id: 'seasonal', label: 'Seasonal Feed', icon: 'ri-leaf-line' },
              { id: 'debug', label: 'Maintenance Tools', icon: 'ri-tools-line' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setMessage(null);
                  setScrapingAnimeId(null);
                }}
                className={`relative flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-bold transition-all duration-300 select-none ${activeTab === tab.id
                    ? 'bg-white text-indigo-950 shadow-md transform scale-[1.02]'
                    : 'text-white/70 hover:text-white hover:bg-white/5'
                  }`}
              >
                <i className={`${tab.icon} text-base`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 md:p-8">
          <AnimatePresence mode="wait">
            {activeTab === 'search' && (
              <motion.div
                key="search"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                {/* Search Workspace Box */}
                <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                    <div className="md:col-span-7">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                        <i className="ri-search-eye-line mr-1 text-slate-400"></i> Search Query
                      </label>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by title (e.g., Demon Slayer, Jujutsu Kaisen...)"
                        onKeyPress={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>

                    <div className="md:col-span-3">
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">
                        <i className="ri-database-2-line mr-1 text-slate-400"></i> Metadata Source
                      </label>
                      <select
                        value={source}
                        onChange={(e) => setSource(e.target.value as 'jikan' | 'anilist')}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                      >
                        <option value="jikan">Jikan API (MyAnimeList)</option>
                        <option value="anilist">AniList GraphQL API</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <button
                        onClick={() => handleSearch(searchQuery)}
                        disabled={isSearching || !searchQuery.trim()}
                        className="w-full px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isSearching ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Searching</span>
                          </>
                        ) : (
                          <>
                            <i className="ri-search-line text-sm"></i>
                            <span>Search</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'trending' && (
              <motion.div
                key="trending"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="text-center py-6"
              >
                <div className="w-16 h-16 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-orange-100">
                  <i className="ri-fire-line text-orange-500 text-3xl"></i>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Trending Anime</h3>
                <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
                  Fetch and load the highest-trending anime releases currently popular across the community.
                </p>
                <button
                  onClick={() => handleTrendingImport(1, false)}
                  disabled={isSearching}
                  className="px-8 py-3 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                >
                  {isSearching ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-flashlight-line"></i>
                      <span>Load Trending Feed</span>
                    </>
                  )}
                </button>
              </motion.div>
            )}

            {activeTab === 'seasonal' && (
              <motion.div
                key="seasonal"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="text-center py-6"
              >
                <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-green-100">
                  <i className="ri-leaf-line text-green-500 text-3xl"></i>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Seasonal Broadcast Feed</h3>
                <p className="text-slate-500 text-sm mb-6 max-w-sm mx-auto">
                  Load anime from the current broadcast season (Winter, Spring, Summer, Fall) matching active media releases.
                </p>
                <button
                  onClick={() => handleSeasonalImport(1, false)}
                  disabled={isSearching}
                  className="px-8 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 mx-auto disabled:opacity-50"
                >
                  {isSearching ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-leaf-line"></i>
                      <span>Load Seasonal Feed</span>
                    </>
                  )}
                </button>
              </motion.div>
            )}

            {activeTab === 'debug' && (
              <motion.div
                key="debug"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Active Maintenance Log banner */}
                {message && (
                  <div className={`flex items-start gap-3 p-4 rounded-xl text-sm font-medium border shadow-sm ${message.includes('❌') || message.includes('Error') || message.includes('error')
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : message.includes('⏳') || message.includes('🔍') || message.includes('📺')
                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    }`}>
                    <p className="whitespace-pre-wrap leading-relaxed flex-1">{message}</p>
                    <button onClick={() => setMessage(null)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded-lg hover:bg-slate-200/50">
                      <i className="ri-close-line text-lg"></i>
                    </button>
                  </div>
                )}

                {/* Maintenance Tools Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Tool 1: Backfill Characters */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-amber-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-100 text-amber-600">
                          <i className="ri-magic-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Backfill Characters</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Query AniList to download missing character bios and voice actor details for all database items. Skips populated profiles.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setMessage('🔍 Fetching anime list from database...');
                          const { data: animeList, error: listError } = await supabase
                            .from('anime')
                            .select('id, title, mal_id')
                            .order('title');

                          if (listError || !animeList?.length) {
                            setMessage(listError ? `Error: ${listError.message}` : 'No anime found in database');
                            return;
                          }

                          let totalSuccess = 0;
                          let totalErrors = 0;
                          let totalSkipped = 0;
                          const failedTitles: string[] = [];
                          const total = animeList.length;

                          for (let i = 0; i < total; i++) {
                            const anime = animeList[i];
                            const { data: existingChars } = await supabase
                              .from('anime_characters')
                              .select('id, voice_actor, description')
                              .eq('anime_id', anime.id)
                              .limit(10);

                            if (existingChars && existingChars.length > 0) {
                              const hasVoiceActors = existingChars.some(c => c.voice_actor);
                              const hasDescriptions = existingChars.some(c => c.description);
                              if (hasVoiceActors && hasDescriptions) {
                                totalSkipped++;
                                continue;
                              }
                            }

                            setMessage(`🎭 [${i + 1}/${total}] Fetching characters for "${anime.title}"... (${totalSkipped} complete)`);

                            try {
                              const searchQuery = `
                                query ($search: String) {
                                  Media(search: $search, type: ANIME) {
                                    id
                                    characters(sort: [ROLE, RELEVANCE], perPage: 25) {
                                      edges {
                                        id
                                        role
                                        voiceActors(language: JAPANESE) {
                                          id
                                          name { full native }
                                        }
                                        voiceActorRoles {
                                          voiceActor {
                                            id
                                            name { full native }
                                            language
                                          }
                                        }
                                        node {
                                          id
                                          name { full native alternative }
                                          image { large medium }
                                          description
                                        }
                                      }
                                    }
                                  }
                                }
                              `;

                              const fetchAniList = async (body: string, attempt = 1): Promise<any> => {
                                try {
                                  const r = await fetch('https://graphql.anilist.co', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body
                                  });
                                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                                  return await r.json();
                                } catch (err) {
                                  if (attempt >= 3) throw err;
                                  const wait = attempt === 1 ? 30000 : 60000;
                                  setMessage(`⏳ [${i + 1}/${total}] Rate limited on "${anime.title}", waiting ${wait / 1000}s (attempt ${attempt}/3)...`);
                                  await new Promise(r => setTimeout(r, wait));
                                  return fetchAniList(body, attempt + 1);
                                }
                              };

                              const reqBody = JSON.stringify({ query: searchQuery, variables: { search: anime.title } });
                              const data = await fetchAniList(reqBody);

                              const media = data.data?.Media;
                              if (!media?.characters?.edges?.length) {
                                totalSkipped++;
                                await new Promise(r => setTimeout(r, 3000));
                                continue;
                              }

                              const result = await (AnimeImporterService as any).importAnimeCharacters(anime.id, media);
                              totalSuccess += result.success;
                              totalErrors += result.errors;
                            } catch (err) {
                              console.error(`Failed to backfill characters for "${anime.title}":`, err);
                              totalErrors++;
                              failedTitles.push(anime.title);
                            }

                            await new Promise(r => setTimeout(r, 3000));
                          }

                          setMessage(`✅ Character backfill complete! ${totalSuccess} characters updated across ${total} anime. ${totalSkipped > 0 ? `${totalSkipped} skipped. ` : ''}${totalErrors > 0 ? `${totalErrors} errors. ` : ''}`);
                        } catch (err) {
                          setMessage(`❌ Backfill failed: ${err instanceof Error ? err.message : err}`);
                        }
                      }}
                      disabled={isImporting}
                      className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Processing...' : 'Run Character Backfill'}
                    </button>
                  </div>

                  {/* Tool 2: Remove Duplicates */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-rose-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-100 text-rose-600">
                          <i className="ri-delete-bin-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Clean Duplicates</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Scans the entire database for redundant anime character name mappings within individual series, keeping entries with the most complete bio profiles.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setMessage('🔍 Scanning for duplicate characters...');
                          const { data: allChars, error: fetchErr } = await supabase
                            .from('anime_characters')
                            .select('id, anime_id, name, role, description, voice_actor')
                            .order('anime_id');

                          if (fetchErr || !allChars) {
                            setMessage(`Error: ${fetchErr?.message || 'No characters found'}`);
                            return;
                          }

                          const normalizeName = (name: string) =>
                            name.toLowerCase().replace(/[.,\-'"""'']/g, '').split(/[\s,]+/).filter((w: string) => w.length > 1).sort().join(' ');

                          const byAnime = new Map<string, typeof allChars>();
                          for (const c of allChars) {
                            const list = byAnime.get(c.anime_id) || [];
                            list.push(c);
                            byAnime.set(c.anime_id, list);
                          }

                          let totalRemoved = 0;
                          const idsToDelete: string[] = [];

                          for (const [, chars] of byAnime) {
                            const seen = new Map<string, typeof allChars[0]>();
                            for (const c of chars) {
                              const norm = normalizeName(c.name);
                              const existing = seen.get(norm);
                              if (existing) {
                                const existingScore = (existing.description ? 1 : 0) + (existing.voice_actor ? 1 : 0);
                                const currentScore = (c.description ? 1 : 0) + (c.voice_actor ? 1 : 0);
                                if (currentScore > existingScore) {
                                  idsToDelete.push(existing.id);
                                  seen.set(norm, c);
                                } else {
                                  idsToDelete.push(c.id);
                                }
                                totalRemoved++;
                              } else {
                                seen.set(norm, c);
                              }
                            }
                          }

                          if (idsToDelete.length === 0) {
                            setMessage('✅ No duplicate characters found!');
                            return;
                          }

                          setMessage(`🗑️ Removing ${idsToDelete.length} duplicate characters...`);
                          for (let i = 0; i < idsToDelete.length; i += 50) {
                            const batch = idsToDelete.slice(i, i + 50);
                            await supabase.from('anime_characters').delete().in('id', batch);
                          }

                          setMessage(`✅ Removed ${totalRemoved} duplicate characters successfully!`);
                        } catch (err) {
                          setMessage(`❌ Error: ${err instanceof Error ? err.message : err}`);
                        }
                      }}
                      disabled={isImporting}
                      className="w-full bg-rose-500 hover:bg-rose-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Scanning...' : 'Scan & Clean Duplicates'}
                    </button>
                  </div>

                  {/* Tool 3: Backfill Episodes */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-blue-100 text-blue-600">
                          <i className="ri-play-list-add-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Backfill Episodes</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Fetch and generate missing episode stubs automatically from Jikan API for all existing database anime records.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setMessage('🔍 Fetching anime list...');
                          const { data: animeList, error: listError } = await supabase
                            .from('anime')
                            .select('id, title, mal_id, total_episodes')
                            .not('mal_id', 'is', null)
                            .order('title');

                          if (listError || !animeList?.length) {
                            setMessage(listError ? `Error: ${listError.message}` : 'No anime with MAL IDs found');
                            return;
                          }

                          let totalCreated = 0;
                          let totalFixed = 0;
                          let totalSkipped = 0;
                          const total = animeList.length;

                          for (let i = 0; i < total; i++) {
                            const anime = animeList[i];
                            setMessage(`📺 [${i + 1}/${total}] Checking episodes for "${anime.title}"...`);

                            try {
                              const { count } = await supabase
                                .from('episodes')
                                .select('id', { count: 'exact', head: true })
                                .eq('anime_id', anime.id);

                              const expectedEps = anime.total_episodes || 0;
                              const existingEps = count || 0;

                              if (expectedEps > 0 && existingEps >= expectedEps) {
                                totalSkipped++;
                                continue;
                              }

                              const result = await AnimeImporterService.fetchEpisodesForExistingAnime(anime.id);
                              totalCreated += result.created;
                              if (result.created > 0) {
                                totalFixed++;
                                const { data: unscroped } = await supabase
                                  .from('episodes')
                                  .select('episode_number')
                                  .eq('anime_id', anime.id)
                                  .is('video_url', null);
                                if (unscroped?.length) {
                                  const nums = unscroped.map(e => e.episode_number);
                                  HiAnimeScraperService.batchScrapeEpisodes(anime.title, anime.id, nums).catch(() => { });
                                }
                              }
                            } catch (err) {
                              console.warn(`⚠️ Failed for "${anime.title}":`, err);
                            }

                            await new Promise(r => setTimeout(r, 500));
                          }

                          setMessage(`✅ Episode backfill complete! Created ${totalCreated} episode stubs across ${totalFixed} series.`);
                        } catch (err) {
                          setMessage(`❌ Error: ${err instanceof Error ? err.message : err}`);
                        }
                      }}
                      disabled={isImporting}
                      className="w-full bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Processing...' : 'Run Episode Backfill'}
                    </button>
                  </div>

                  {/* Tool 4: Scrape Missing Streams */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-purple-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-purple-100 text-purple-600">
                          <i className="ri-movie-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Scrape Missing Streams</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Identify all episodes in the database that are missing stream video URLs, and trigger Playwright batch scrapers to populate them.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setMessage('🔍 Finding episodes without video URLs...');
                          const { data: episodes, error } = await supabase
                            .from('episodes')
                            .select('anime_id, episode_number')
                            .is('video_url', null)
                            .order('anime_id')
                            .order('episode_number');

                          if (error) {
                            setMessage(`❌ Error: ${error.message}`);
                            return;
                          }

                          if (!episodes?.length) {
                            setMessage('✅ All episodes already have video URLs!');
                            return;
                          }

                          const byAnime = new Map<string, number[]>();
                          for (const ep of episodes) {
                            const list = byAnime.get(ep.anime_id) || [];
                            list.push(ep.episode_number);
                            byAnime.set(ep.anime_id, list);
                          }

                          const animeIds = [...byAnime.keys()];
                          const { data: animeList } = await supabase
                            .from('anime')
                            .select('id, title')
                            .in('id', animeIds);

                          const titleMap = new Map(animeList?.map(a => [a.id, a.title]) || []);

                          let totalQueued = 0;
                          let idx = 0;
                          const total = byAnime.size;

                          for (const [animeId, epNums] of byAnime) {
                            idx++;
                            const title = titleMap.get(animeId) || 'Unknown';
                            setMessage(`🎬 [${idx}/${total}] Scraping "${title}" (${epNums.length} episodes)...`);

                            try {
                              await HiAnimeScraperService.batchScrapeEpisodes(title, animeId, epNums);
                              totalQueued += epNums.length;
                            } catch (err) {
                              console.warn(`⚠️ Scrape failed for "${title}":`, err);
                            }

                            await new Promise(r => setTimeout(r, 1000));
                          }

                          setMessage(`✅ Completed! Triggered scraping for ${totalQueued} episodes across ${total} series.`);
                        } catch (err) {
                          setMessage(`❌ Error: ${err instanceof Error ? err.message : err}`);
                        }
                      }}
                      disabled={isImporting}
                      className="w-full bg-purple-500 hover:bg-purple-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Processing...' : 'Run Scraper Backfill'}
                    </button>
                  </div>

                  {/* Tool 5: Rename Generic Episode Titles */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-100 text-emerald-600">
                          <i className="ri-edit-box-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Rename Generic Episode Titles</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed">
                        Scan the database for generic titles (like "Episode X", "Ep X" or blank) and fetch/update their actual names from Jikan (MAL) API.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setIsImporting(true);
                          setMessage('🔍 Loading anime list from database...');

                          // Fetch all anime upfront
                          const { data: animeList, error: animeErr } = await supabase
                            .from('anime')
                            .select('id, title, mal_id');

                          if (animeErr) {
                            setMessage(`❌ Failed to load anime metadata: ${animeErr.message}`);
                            return;
                          }

                          const animeMap = new Map(animeList?.map(a => [a.id, a]) || []);

                          setMessage('🔍 Scanning all episodes in database (paginated)...');

                          // Fetch all episodes from database with pagination to avoid 1000-row limit
                          let episodes: any[] = [];
                          let fromRange = 0;
                          const batchSize = 2000;
                          let hasMore = true;

                          while (hasMore) {
                            const { data: batch, error: fetchErr } = await supabase
                              .from('episodes')
                              .select('id, anime_id, episode_number, title')
                              .range(fromRange, fromRange + batchSize - 1);

                            if (fetchErr) {
                              setMessage(`❌ Scan failed: ${fetchErr.message}`);
                              return;
                            }

                            if (!batch || batch.length === 0) {
                              hasMore = false;
                            } else {
                              episodes = [...episodes, ...batch];
                              if (batch.length < batchSize) {
                                hasMore = false;
                              } else {
                                fromRange += batchSize;
                              }
                            }
                          }

                          // Identify generic episode titles
                          const genericRegex = /^(episode|ep|ep\.|ep\.\s)\s*\d+$/i;
                          const genericEpisodes = episodes.filter(ep => {
                            if (!ep.title) return true;
                            const t = ep.title.trim().toLowerCase();
                            if (t === '' || !isNaN(Number(t))) return true;
                            if (genericRegex.test(t)) return true;

                            // Check prefix relative to its anime title (common scraper pattern: "Baki - Episode 1")
                            const animeObj = animeMap.get(ep.anime_id);
                            if (animeObj && animeObj.title) {
                              const cleanAnimeTitle = animeObj.title.trim().toLowerCase();
                              const epNum = ep.episode_number;
                              const patterns = [
                                `${cleanAnimeTitle} - episode ${epNum}`,
                                `${cleanAnimeTitle} - ep ${epNum}`,
                                `${cleanAnimeTitle} - ep. ${epNum}`,
                                `${cleanAnimeTitle} - ep.${epNum}`,
                                `${cleanAnimeTitle} - ${epNum}`,
                                `${cleanAnimeTitle} episode ${epNum}`,
                                `${cleanAnimeTitle} ep ${epNum}`,
                                `${cleanAnimeTitle} ${epNum}`,
                              ];
                              if (patterns.includes(t)) return true;
                            }
                            return false;
                          });

                          if (genericEpisodes.length === 0) {
                            setMessage('✅ No episodes with generic titles found!');
                            return;
                          }

                          setMessage(`🔍 Found ${genericEpisodes.length} generic/unnamed episodes. Grouping by anime...`);

                          const byAnime = new Map<string, typeof genericEpisodes>();
                          for (const ep of genericEpisodes) {
                            const list = byAnime.get(ep.anime_id) || [];
                            list.push(ep);
                            byAnime.set(ep.anime_id, list);
                          }

                          let totalUpdated = 0;
                          let animeIndex = 0;
                          const totalAnime = byAnime.size;
                          const skippedAnimeList: string[] = [];

                          for (const [animeId, eps] of byAnime) {
                            animeIndex++;
                            const animeObj = animeMap.get(animeId);
                            if (!animeObj) continue;

                            let malId = animeObj.mal_id;
                            if (!malId) {
                              setMessage(`🔍 [${animeIndex}/${totalAnime}] Missing MAL ID for "${animeObj.title}". Querying Jikan...`);
                              try {
                                await new Promise(r => setTimeout(r, 1200)); // Rate limit buffer
                                const searchResp = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeObj.title)}&limit=1`);
                                if (searchResp.status === 429) {
                                  setMessage(`⏳ Rate limited. Waiting 5s before retrying search for "${animeObj.title}"...`);
                                  await new Promise(r => setTimeout(r, 5000));
                                  const retryResp = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeObj.title)}&limit=1`);
                                  if (retryResp.ok) {
                                    const json = await retryResp.json();
                                    const match = json.data?.[0];
                                    if (match) {
                                      malId = match.mal_id;
                                    }
                                  }
                                } else if (searchResp.ok) {
                                  const json = await searchResp.json();
                                  const match = json.data?.[0];
                                  if (match) {
                                    malId = match.mal_id;
                                  }
                                }

                                if (malId) {
                                  const { error: updateErr } = await supabase
                                    .from('anime')
                                    .update({ mal_id: malId })
                                    .eq('id', animeObj.id);
                                  if (!updateErr) {
                                    animeObj.mal_id = malId;
                                    setMessage(`✅ Resolved MAL ID ${malId} for "${animeObj.title}"`);
                                  } else {
                                    console.error(`Failed to save resolved MAL ID ${malId} for "${animeObj.title}":`, updateErr);
                                  }
                                }
                              } catch (resolveErr) {
                                console.error(`Failed to resolve MAL ID for "${animeObj.title}":`, resolveErr);
                              }
                            }

                            if (!animeObj.mal_id) {
                              console.warn(`Skipping anime "${animeObj.title}" (could not resolve MAL ID)`);
                              skippedAnimeList.push(animeObj.title);
                              continue;
                            }

                            const maxEpNum = Math.max(...eps.map(e => e.episode_number));
                            const maxPage = Math.ceil(maxEpNum / 100);

                            setMessage(`⏳ [${animeIndex}/${totalAnime}] Fetching titles for "${animeObj.title}" (up to page ${maxPage})...`);

                            const jikanEpisodesMap = new Map<number, { title: string; aired: string | null }>();
                            let apiSuccess = true;
                            let p = 1;

                            while (p <= maxPage) {
                              if (p > 1 || animeIndex > 1) {
                                // Respect Jikan rate limits
                                await new Promise(r => setTimeout(r, 1200));
                              }

                              try {
                                const response = await fetch(`https://api.jikan.moe/v4/anime/${animeObj.mal_id}/episodes?page=${p}`);
                                if (response.status === 429) {
                                  setMessage(`⏳ Rate limited. Waiting 5s before retrying page ${p} for "${animeObj.title}"...`);
                                  await new Promise(r => setTimeout(r, 5000));
                                  continue; // Retry current page without incrementing
                                }

                                if (!response.ok) {
                                  throw new Error(`HTTP ${response.status}`);
                                }

                                const json = await response.json();
                                const jikanEps = json.data || [];
                                for (const ep of jikanEps) {
                                  jikanEpisodesMap.set(ep.mal_id, {
                                    title: ep.title,
                                    aired: ep.aired || null
                                  });
                                }

                                if (!json.pagination?.has_next_page) {
                                  break;
                                }

                                p++;
                              } catch (err) {
                                console.error(`Error fetching page ${p} for anime ${animeObj.title}:`, err);
                                apiSuccess = false;
                                break;
                              }
                            }

                            if (!apiSuccess || jikanEpisodesMap.size === 0) {
                              continue;
                            }

                            // Perform batch updates for current anime
                            const updatePromises = eps.map(async (ep): Promise<number> => {
                              const jikanEp = jikanEpisodesMap.get(ep.episode_number);
                              if (jikanEp && jikanEp.title) {
                                const newTitle = jikanEp.title.trim();
                                if (newTitle && !genericRegex.test(newTitle) && newTitle !== ep.title) {
                                  // Also make sure it doesn't match a scraper-format string containing the anime name
                                  const cleanNewTitle = newTitle.toLowerCase();
                                  if (cleanNewTitle.includes(`${animeObj.title.toLowerCase()} - episode`) ||
                                      cleanNewTitle.includes(`${animeObj.title.toLowerCase()} - ep`)) {
                                    return 0;
                                  }

                                  const updates: any = { title: newTitle };
                                  if (jikanEp.aired) {
                                    updates.air_date = jikanEp.aired.split('T')[0];
                                  }
                                  const { error: updateErr } = await supabase
                                    .from('episodes')
                                    .update(updates)
                                    .eq('id', ep.id);
                                  if (!updateErr) {
                                    return 1;
                                  }
                                }
                              }
                              return 0;
                            });

                            const results = await Promise.all(updatePromises);
                            const updatedForThisAnime = results.reduce((sum, val) => sum + val, 0);
                            totalUpdated += updatedForThisAnime;

                            setMessage(`✨ [${animeIndex}/${totalAnime}] Updated ${updatedForThisAnime} episodes for "${animeObj.title}"`);
                          }

                          let completionMsg = `✅ Completed! Renamed ${totalUpdated} generic episode titles to their proper names.`;
                          if (skippedAnimeList.length > 0) {
                            completionMsg += `\n⚠️ Skipped ${skippedAnimeList.length} series due to missing MAL IDs (e.g. ${skippedAnimeList.slice(0, 3).join(', ')}${skippedAnimeList.length > 3 ? '...' : ''})`;
                          }
                          setMessage(completionMsg);
                        } catch (err) {
                          setMessage(`❌ Error: ${err instanceof Error ? err.message : err}`);
                        } finally {
                          setIsImporting(false);
                        }
                      }}
                      disabled={isImporting}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Processing...' : 'Rename Generic Titles'}
                    </button>
                  </div>

                  {/* Tool 6: Clear Stream & Scraper Metadata */}
                  <div className="bg-white rounded-2xl border border-slate-200 hover:border-red-300 hover:shadow-md transition-all duration-200 p-5 flex flex-col justify-between min-h-48">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-red-100 text-red-600">
                          <i className="ri-refresh-line text-lg"></i>
                        </span>
                        <h4 className="font-bold text-slate-800 text-sm">Reset Stream & Scraper Data</h4>
                      </div>
                      <p className="text-slate-500 text-xs leading-relaxed mb-3">
                        Completely clear the scraped stream URLs, 9anime slug, and all associated episode server links for a selected anime. Useful for forcing a clean re-scrape.
                      </p>
                      
                      {/* Anime Dropdown Selector */}
                      <div className="relative mb-3">
                        <select
                          value={selectedDbAnimeId}
                          onChange={(e) => setSelectedDbAnimeId(e.target.value)}
                          className="w-full px-3 py-2 pr-8 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-red-500 transition-all cursor-pointer appearance-none font-semibold text-slate-700"
                        >
                          <option value="">-- Select an Anime from Catalog --</option>
                          {dbAnimeList.map(anime => (
                            <option key={anime.id} value={anime.id}>
                              {anime.title}
                            </option>
                          ))}
                        </select>
                        <i className="ri-arrow-down-s-line absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-500 pointer-events-none text-sm"></i>
                      </div>
                    </div>
                    
                    <button
                      onClick={async () => {
                        if (!selectedDbAnimeId) {
                          alert('Please select an anime to reset');
                          return;
                        }
                        
                        const anime = dbAnimeList.find(a => a.id === selectedDbAnimeId);
                        const confirmReset = window.confirm(
                          `Are you absolutely sure you want to delete all scraped streams, server links, and scraper slug metadata for "${anime?.title || 'this anime'}"?\n\nThis action cannot be undone.`
                        );
                        
                        if (!confirmReset) return;
                        
                        try {
                          setIsImporting(true);
                          setMessage(`⏳ Resetting streaming metadata for "${anime?.title || 'Anime'}"...`);
                          
                          // 1. Reset nine_anime_slug and scraper_urls in anime table
                          const { error: animeErr } = await supabase
                            .from('anime')
                            .update({
                              nine_anime_slug: null,
                              scraper_urls: null,
                              updated_at: new Date().toISOString()
                            })
                            .eq('id', selectedDbAnimeId);
                            
                          if (animeErr) throw new Error(`Anime reset failed: ${animeErr.message}`);
                          
                          // 2. Reset video_url and video_servers in episodes table
                          const { error: epErr } = await supabase
                            .from('episodes')
                            .update({
                              video_url: null,
                              video_servers: null
                            })
                            .eq('anime_id', selectedDbAnimeId);
                            
                          if (epErr) throw new Error(`Episodes reset failed: ${epErr.message}`);
                          
                          setMessage(`✅ Success! Stream metadata and scraper caches have been fully cleared for "${anime?.title}". You can now perform a clean re-scrape.`);
                          setSelectedDbAnimeId('');
                        } catch (err) {
                          setMessage(`❌ Reset failed: ${err instanceof Error ? err.message : err}`);
                        } finally {
                          setIsImporting(false);
                        }
                      }}
                      disabled={isImporting || !selectedDbAnimeId}
                      className="w-full bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow-md transition-all cursor-pointer"
                    >
                      {isImporting ? 'Resetting...' : 'Reset Stream Data'}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Advanced Search Filters Card (Collapsible) */}
          {activeTab === 'search' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-6 border-t border-slate-100 pt-6"
            >
              <div className="flex justify-between items-center mb-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-sm select-none"
                >
                  <i className={`ri-arrow-${showAdvanced ? 'down' : 'up'}-s-line text-sm`}></i>
                  {showAdvanced ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
                </button>
              </div>

              <AnimatePresence>
                {showAdvanced && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-slate-50/50 rounded-2xl p-5 border border-slate-150 overflow-visible space-y-4"
                  >
                    <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-1">
                      <span className="w-1.5 h-3 bg-blue-500 rounded-full"></span>
                      Advanced Query Filters
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Release Year</label>
                        <input
                          type="number"
                          value={searchFilters.year}
                          onChange={(e) => setSearchFilters({ ...searchFilters, year: e.target.value })}
                          placeholder="e.g. 2024"
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                      </div>

                      {/* Genre Autocomplete Selector */}
                      <div className="relative">
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Genre Category</label>
                        <input
                          type="text"
                          value={searchFilters.genre}
                          onChange={(e) => {
                            setSearchFilters({ ...searchFilters, genre: e.target.value });
                            setShowGenreDropdown(true);
                          }}
                          onFocus={() => setShowGenreDropdown(true)}
                          onBlur={() => setTimeout(() => setShowGenreDropdown(false), 200)}
                          placeholder="e.g. Action"
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                        {showGenreDropdown && filteredGenres.length > 0 && (
                          <div className="absolute z-30 w-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar py-1">
                            {filteredGenres.slice(0, 10).map((genre) => (
                              <button
                                key={genre}
                                type="button"
                                onMouseDown={() => {
                                  setSearchFilters({ ...searchFilters, genre });
                                  setShowGenreDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-sm font-semibold transition-colors flex items-center gap-2"
                              >
                                {genre}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Airing Status</label>
                        <select
                          value={searchFilters.status}
                          onChange={(e) => setSearchFilters({ ...searchFilters, status: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                        >
                          <option value="">All Statuses</option>
                          <option value="ongoing">📡 Ongoing</option>
                          <option value="completed">🏁 Completed</option>
                          <option value="upcoming">🗓️ Upcoming</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Min Rating (0-10)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="10"
                          value={searchFilters.rating}
                          onChange={(e) => setSearchFilters({ ...searchFilters, rating: e.target.value })}
                          placeholder="e.g. 8.0"
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Sort Results By</label>
                        <select
                          value={searchFilters.sortBy}
                          onChange={(e) => setSearchFilters({ ...searchFilters, sortBy: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all cursor-pointer"
                        >
                          <option value="relevance">🔍 Relevance</option>
                          <option value="rating">⭐ Star Rating</option>
                          <option value="year">🗓️ Release Year</option>
                          <option value="title">🔤 Alphabetical</option>
                          <option value="popularity">🔥 Popularity</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleClearFilters}
                        className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                      >
                        <i className="ri-delete-bin-line mr-1"></i> Clear Filters
                      </button>
                      <button
                        onClick={handleApplyFilters}
                        disabled={isSearching}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer"
                      >
                        <i className="ri-filter-2-line mr-1"></i> Apply Filter Criteria
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* Import Settings Panel */}
          {activeTab !== 'debug' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-6 border-t border-slate-100 pt-6"
            >
              <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-100">
                <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2 mb-4">
                  <span className="w-1.5 h-3 bg-indigo-500 rounded-full"></span>
                  Import Configuration Settings
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Batch Processing Size</label>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={batchSize}
                      onChange={(e) => setBatchSize(parseInt(e.target.value) || 5)}
                      className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                    />
                  </div>

                  {/* Toggle switches for settings */}
                  <div className="flex items-center">
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={autoImport}
                        onChange={(e) => setAutoImport(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      <span className="ml-3 text-sm font-bold text-slate-600">Background Auto-Import</span>
                    </label>
                  </div>

                  <div className="flex items-center">
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={showPreview}
                        onChange={(e) => setShowPreview(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      <span className="ml-3 text-sm font-bold text-slate-600">Show Storyline Description</span>
                    </label>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Import Progress Bar */}
          <AnimatePresence>
            {importProgress && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="mt-6"
              >
                <div className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 rounded-2xl p-5 border border-blue-100 shadow-sm space-y-3">
                  <div className="flex justify-between items-center text-xs font-bold text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                      <span>Import Progress: {importProgress.completed} of {importProgress.total} Complete</span>
                    </span>
                    <span className="text-blue-600 text-sm">{importProgress.percentage}%</span>
                  </div>
                  <div className="w-full bg-slate-200/80 rounded-full h-3 overflow-hidden border border-slate-100">
                    <motion.div
                      className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${importProgress.percentage}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 flex gap-1">
                    <span>Currently Processing:</span>
                    <span className="font-bold text-indigo-600 truncate">{importProgress.current}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scraping Progress Status Banner */}
          <AnimatePresence>
            {scrapingAnimeId && message && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="mt-6"
              >
                <div className={`rounded-2xl p-5 border shadow-sm ${message.startsWith('✅')
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 text-emerald-800'
                    : message.startsWith('⚠️')
                      ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200 text-amber-800'
                      : 'bg-gradient-to-r from-teal-50 to-cyan-50 border-teal-200 text-teal-800'
                  }`}>
                  <p className="font-semibold text-sm flex items-center gap-2">
                    {message.startsWith('✅') ? (
                      <i className="ri-checkbox-circle-fill text-lg shrink-0 text-emerald-600"></i>
                    ) : message.startsWith('⚠️') ? (
                      <i className="ri-error-warning-fill text-lg shrink-0 text-amber-600"></i>
                    ) : (
                      <i className="ri-loader-3-line text-lg animate-spin shrink-0"></i>
                    )}
                    {message}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Import Final Results banner */}
          <AnimatePresence>
            {importResult && (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="mt-6"
              >
                <div className="bg-slate-50/50 rounded-2xl p-5 border border-slate-200 space-y-4">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-1.5 h-3 bg-emerald-500 rounded-full"></span>
                    Import Results Summary
                  </h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3.5 bg-emerald-50 border border-emerald-100 rounded-xl">
                      <div className="text-2xl font-extrabold text-emerald-600">{importResult.imported}</div>
                      <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider mt-0.5">Success</div>
                    </div>
                    <div className="text-center p-3.5 bg-amber-50 border border-amber-100 rounded-xl">
                      <div className="text-2xl font-extrabold text-amber-600">{importResult.skipped}</div>
                      <div className="text-[11px] font-bold text-amber-700 uppercase tracking-wider mt-0.5">Skipped</div>
                    </div>
                    <div className="text-center p-3.5 bg-rose-50 border border-rose-100 rounded-xl">
                      <div className="text-2xl font-extrabold text-rose-600">{importResult.errors.length}</div>
                      <div className="text-[11px] font-bold text-rose-700 uppercase tracking-wider mt-0.5">Errors</div>
                    </div>
                  </div>

                  {importResult.duplicates.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Duplicates detected (skipped):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {importResult.duplicates.map((title, index) => (
                          <span key={index} className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold border border-amber-200">
                            {title}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {importResult.errors.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Encountered errors:</p>
                      <div className="space-y-1.5">
                        {importResult.errors.map((error, index) => (
                          <div key={index} className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-100 font-semibold flex gap-2">
                            <span>•</span>
                            <span>{error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Grid: Search results */}
      <AnimatePresence>
        {searchResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-slate-100 overflow-hidden"
          >
            {/* Header control toolbar */}
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 border-b border-indigo-700/20 flex flex-col sm:flex-row justify-between items-center gap-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 select-none">
                <i className="ri-list-check-2"></i>
                Discovered Catalog Results ({searchResults.length})
              </h3>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleSelectAll}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white border border-white/10 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                >
                  <i className="ri-check-double-line text-sm"></i>
                  {selectedAnime.length === searchResults.length ? 'Deselect All' : 'Select All'}
                </button>

                {selectedAnime.length > 0 && (
                  <button
                    onClick={handleBulkImport}
                    disabled={isImporting}
                    className="px-5 py-2 bg-white text-blue-600 hover:bg-blue-50 border border-white rounded-xl text-xs font-extrabold shadow-md hover:shadow-lg transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    {isImporting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <span>Importing</span>
                      </>
                    ) : (
                      <>
                        <i className="ri-download-line text-sm"></i>
                        <span>Import Selection ({selectedAnime.length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Results Grid Cards */}
            <div className="p-6 md:p-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {searchResults.map((anime, index) => {
                  const isSelected = selectedAnime.some(selected =>
                    selected.title === anime.title && selected.source === anime.source
                  );

                  return (
                    <motion.div
                      key={`${anime.title}-${anime.source}-${index}`}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="group"
                    >
                      <div className={`relative bg-white rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 transform hover:scale-[1.03] border-2 overflow-hidden flex flex-col h-full ${isSelected ? 'border-blue-500 shadow-blue-100 ring-2 ring-blue-500/10' : 'border-slate-200/60 hover:border-blue-400'
                        }`}>
                        {/* Poster visual */}
                        {anime.poster_url && (
                          <div className="relative h-48 bg-slate-900 overflow-hidden">
                            <img
                              src={anime.poster_url}
                              alt={anime.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-90 group-hover:opacity-100"
                              width={300}
                              height={192}
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            {/* Accent source badge */}
                            <div className="absolute top-2.5 right-2.5 bg-black/60 backdrop-blur-md text-white px-2 py-0.5 rounded-lg text-[10px] font-bold tracking-widest uppercase border border-white/5">
                              {anime.source}
                            </div>

                            {/* Selection check box toggle */}
                            <button
                              onClick={() => handleSelectAnime(anime)}
                              className={`absolute top-2.5 left-2.5 w-7 h-7 rounded-full flex items-center justify-center border transition-all cursor-pointer ${isSelected
                                  ? 'bg-blue-500 border-blue-400 text-white shadow-md'
                                  : 'bg-black/40 hover:bg-black/60 border-white/30 text-transparent hover:text-white'
                                }`}
                            >
                              <i className="ri-check-line text-sm font-bold"></i>
                            </button>
                          </div>
                        )}

                        {/* Card metadata details */}
                        <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                          <div className="space-y-1">
                            <h4 className="font-extrabold text-sm text-slate-800 line-clamp-2 leading-snug group-hover:text-blue-600 transition-colors cursor-pointer" title={anime.title}>
                              {anime.title}
                            </h4>
                            {anime.title_japanese && (
                              <p className="text-[11px] font-semibold text-slate-400 line-clamp-1 italic">{anime.title_japanese}</p>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-bold border-b border-slate-100 pb-2">
                              <div className="flex items-center gap-1">
                                {anime.year && <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md border border-blue-100">{anime.year}</span>}
                                {anime.type && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-100 uppercase">{anime.type}</span>}
                              </div>
                              {anime.rating && (
                                <div className="flex items-center text-yellow-600 gap-0.5">
                                  <i className="ri-star-fill text-xs"></i>
                                  <span>{anime.rating.toFixed(1)}/10</span>
                                </div>
                              )}
                            </div>

                            {anime.genres && anime.genres.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {anime.genres.slice(0, 3).map((genre, idx) => (
                                  <span key={idx} className="text-[9px] font-extrabold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md border border-slate-150">
                                    {genre}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Quick import control action bar */}
                          <div className="flex gap-1.5 pt-2">
                            <button
                              onClick={() => handleSelectAnime(anime)}
                              className={`flex-1 px-2 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1 ${isSelected
                                  ? 'bg-blue-50 border-blue-200 text-blue-600'
                                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-800'
                                }`}
                            >
                              <i className={`ri-${isSelected ? 'checkbox-circle' : 'add-circle'}-line text-sm`}></i>
                              <span>{isSelected ? 'Selected' : 'Select'}</span>
                            </button>
                            <button
                              onClick={() => handleQuickImport(anime)}
                              disabled={isImporting}
                              className="w-10 h-8 bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-sm hover:shadow-md"
                              title="Quick Import: Metadata & Stub episodes only"
                            >
                              <i className="ri-download-line text-sm font-bold"></i>
                            </button>
                            <button
                              onClick={() => handleImportAndScrape(anime)}
                              disabled={isImporting}
                              className="w-10 h-8 bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50 text-white rounded-xl flex items-center justify-center transition-all cursor-pointer shadow-sm hover:shadow-md"
                              title="Hyper Scrape: Import metadata + instantly scrape live video streams"
                            >
                              <i className="ri-rocket-line text-sm font-bold animate-pulse"></i>
                            </button>
                          </div>

                          {/* Preview Storyline block */}
                          {showPreview && anime.description && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              className="mt-2 pt-3 border-t border-slate-100"
                            >
                              <p className="text-[10px] text-slate-500 leading-normal line-clamp-3 italic">
                                {anime.description}
                              </p>
                            </motion.div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Load More results toolbar */}
              {canLoadMoreResults && resultMode && (
                <div className="mt-8 flex justify-center">
                  <button
                    onClick={handleLoadMoreResults}
                    disabled={isSearching}
                    className="px-8 py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all cursor-pointer flex items-center gap-1.5 select-none"
                  >
                    {isSearching ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        <span>Loading Data Feed</span>
                      </>
                    ) : (
                      <>
                        <i className="ri-more-line"></i>
                        <span>Load Additional Catalog Items</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Log cards (Collapsible) */}
      <AnimatePresence>
        {importHistory.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-6"
          >
            <div className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
              <div className="bg-gradient-to-r from-slate-700 to-slate-800 p-5 border-b border-slate-600/10">
                <h3 className="text-base font-bold text-white flex items-center gap-2 select-none">
                  <i className="ri-history-line"></i>
                  Recent Import Logs
                </h3>
              </div>
              <div className="p-6">
                <div className="space-y-3">
                  {importHistory.slice(0, 5).map((item, index) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 p-4 bg-slate-50/50 hover:bg-slate-50 border border-slate-250 hover:border-slate-300 rounded-xl hover:shadow-sm transition-all"
                    >
                      <div className="space-y-0.5">
                        <p className="font-extrabold text-sm text-slate-700 line-clamp-1">{item.query}</p>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                          {new Date(item.timestamp).toLocaleString()} • Source: {item.source}
                        </p>
                      </div>

                      {/* Metric logs */}
                      <div className="flex gap-4 items-center shrink-0 border-t sm:border-t-0 pt-2.5 sm:pt-0">
                        <span className="flex items-center text-xs font-bold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-md">
                          <i className="ri-check-line mr-0.5"></i> {item.result.imported} Success
                        </span>
                        <span className="flex items-center text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                          <i className="ri-alert-line mr-0.5"></i> {item.result.skipped} Skip
                        </span>
                        <span className="flex items-center text-xs font-bold text-rose-600 bg-rose-50 border border-rose-250 px-2 py-0.5 rounded-md">
                          <i className="ri-close-line mr-0.5"></i> {item.result.errors.length} Fail
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};