import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { AnimeSugeScraperService } from '../../services/scrapers/animesuge';
import { AdminAnimeService } from '../../services/admin/anime';
import { AnimeImporterService } from '../../services/anime/importer';
import Button from '../../components/base/Button';
import Input from '../../components/base/Input';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { ScrapedEpisodesModal } from './ScrapedEpisodesModal';

interface Anime {
  id: string;
  title: string;
  total_episodes: number;
  status: string;
  poster_url?: string;
}

interface ScrapeResult {
  success: boolean;
  watchUrl?: string;
  streamUrl?: string;
  episodeData?: any;
  error?: string;
}

interface BatchScrapeResult {
  success: boolean;
  results: ScrapeResult[];
  summary: {
    totalEpisodes: number;
    successCount: number;
    errorCount: number;
    successRate: number;
  };
}

interface AnimeSugeScraperComponentProps {
  initialSelectedAnime?: Anime | null;
}

export const AnimeSugeScraperComponent: React.FC<AnimeSugeScraperComponentProps> = ({ initialSelectedAnime }) => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [animeList, setAnimeList] = useState<Anime[]>([]);
  const [filteredAnime, setFilteredAnime] = useState<Anime[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [episodeRange, setEpisodeRange] = useState('');
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lang, setLang] = useState<'sub' | 'dub'>('sub');
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  // Scraped episodes modal state
  const [showScrapedEpisodes, setShowScrapedEpisodes] = useState(false);
  const [scrapedEpisodesData, setScrapedEpisodesData] = useState<any>(null);
  const [episodesAddedCount, setEpisodesAddedCount] = useState(0);
  const [currentScrapedEpisodes, setCurrentScrapedEpisodes] = useState<any[]>([]);
  const [existingEpisodes, setExistingEpisodes] = useState<Set<number>>(new Set());

  // Progress tracking state
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [currentProgress, setCurrentProgress] = useState<{
    current: number;
    total: number;
    successCount: number;
    errorCount: number;
  } | null>(null);
  const [episodeStatuses, setEpisodeStatuses] = useState<Record<number, {
    status: 'pending' | 'scraping' | 'success' | 'error';
    message?: string;
  }>>({});

  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll console logs area to bottom on new messages
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [progressMessages]);

  // Load anime list on component mount
  useEffect(() => {
    console.log('🎯 AnimeSugeScraperComponent mounted');
    loadAnimeList();
  }, []);

  // Pre-select anime if passed as prop
  useEffect(() => {
    if (initialSelectedAnime) {
      handleAnimeSelect(initialSelectedAnime);
    }
  }, [initialSelectedAnime]);

  // Filter anime based on search term
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredAnime(animeList);
    } else {
      const filtered = animeList.filter(anime =>
        anime.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredAnime(filtered);
    }
  }, [searchTerm, animeList]);

  const loadAnimeList = async () => {
    try {
      setIsLoading(true);
      const result = await AdminAnimeService.getAnimeList(1, 1000); // Get all anime
      setAnimeList(result.anime || []);
      setFilteredAnime(result.anime || []);
    } catch (error) {
      console.error('Error loading anime list:', error);
      setError('Failed to load anime list');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnimeSelect = async (anime: Anime) => {
    setSelectedAnime(anime);
    setSearchTerm(anime.title);
    setError(null);
    setSuccess(null);
    setScrapeResult(null);
    setBatchResult(null);
    setCurrentScrapedEpisodes([]);
    setEpisodesAddedCount(0);

    // Check existing episodes for this anime
    await checkExistingEpisodes(anime.id);
  };

  const checkExistingEpisodes = async (animeId: string) => {
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(animeId)) {
      console.warn('Invalid anime ID format, skipping existing episodes check');
      return;
    }

    try {
      const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${API_BASE}/api/anime/${animeId}/episodes`);
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json();
          const existingNumbers = new Set<number>(data.episodes?.map((ep: any) => ep.episode_number as number) || []);
          setExistingEpisodes(existingNumbers);
        } else {
          console.warn('Response is not JSON, skipping existing episodes check');
        }
      } else {
        console.warn(`Failed to fetch episodes: ${response.status}`);
      }
    } catch (error) {
      console.error('Error checking existing episodes:', error);
    }
  };

  const handleSingleScrape = async () => {
    if (!selectedAnime) {
      setError('Please select an anime first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const targetQuery = selectedAnime.title;
      const result = await AnimeSugeScraperService.scrapeAnimeEpisode(
        targetQuery,
        episodeNumber,
        { lang, animeId: selectedAnime.id, overwrite: overwriteExisting }
      );

      setScrapeResult(result);

      if (result.success) {
        // Refresh local database knowledge of existing episodes
        queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
        checkExistingEpisodes(selectedAnime.id);

        // Expose sources directly in result list
        const sources = result.episodeData?.sources;
        if (sources) {
          const scrapedEpisodes = sources.map((s: any) => ({
            number: episodeNumber,
            title: `Episode ${episodeNumber} (${s.label})`,
            streamUrl: s.iframeUrl,
            lang: s.lang || lang,
            servers: sources.map((src: any) => ({
              name: src.label,
              url: src.iframeUrl,
              lang: src.lang || lang
            })),
            embeddingProtected: false,
            scrapedAt: new Date().toISOString(),
            isExisting: existingEpisodes.has(episodeNumber)
          }));
          setCurrentScrapedEpisodes(scrapedEpisodes);
        } else if (result.streamUrl) {
          setCurrentScrapedEpisodes([{
            number: episodeNumber,
            title: `Episode ${episodeNumber}`,
            streamUrl: result.streamUrl,
            lang,
            servers: [{ name: "AnimeSuge active", url: result.streamUrl, lang }],
            embeddingProtected: false,
            scrapedAt: new Date().toISOString(),
            isExisting: existingEpisodes.has(episodeNumber)
          }]);
        }

        setSuccess(`Episode ${episodeNumber} scraped and saved successfully!`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        const errMsg = result.error || 'Scraping failed';
        setError(errMsg);
        // Keep error visible for 15s so user can read it
        setTimeout(() => setError(null), 15000);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchScrape = async () => {
    if (!selectedAnime) {
      setError('Please select an anime first');
      return;
    }

    let episodeNumbers: number[];
    if (episodeRange.includes('-')) {
      const [start, end] = episodeRange.split('-').map(Number);
      episodeNumbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    } else if (episodeRange.includes(',')) {
      episodeNumbers = episodeRange.split(',').map(Number);
    } else {
      episodeNumbers = [parseInt(episodeRange)];
    }

    if (episodeNumbers.some(isNaN) || episodeNumbers.length === 0) {
      setError('Please enter a valid episode range (e.g. 1-5 or 1,2,3)');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setBatchResult(null);
    setProgressMessages([]);
    setCurrentProgress(null);
    setEpisodeStatuses({});

    try {
      setProgressMessages(prev => [...prev, '📺 Ensuring episode stubs exist in database...']);
      await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
    } catch (stubErr) {
      console.warn('⚠️ Episode stub creation skipped:', stubErr);
    }

    const initialStatuses: Record<number, { status: 'pending' }> = {};
    episodeNumbers.forEach(ep => {
      initialStatuses[ep] = { status: 'pending' };
    });
    setEpisodeStatuses(initialStatuses);

    const scrapedEpisodes: any[] = [];
    const failedEpisodes: any[] = [];

    try {
      const targetQuery = selectedAnime.title;
      await AnimeSugeScraperService.batchScrapeEpisodesWithProgress(
        targetQuery,
        selectedAnime.id,
        episodeNumbers,
        (event) => {
          switch (event.type) {
            case 'start':
              setProgressMessages(prev => [...prev, `🎬 Starting AnimeSuge batch scrape for ${event.total || 0} episodes...`]);
              setCurrentProgress({
                current: 0,
                total: event.total || 0,
                successCount: 0,
                errorCount: 0
              });
              break;

            case 'progress':
              setProgressMessages(prev => [...prev, `⏳ Scraping Episode ${event.episode}...`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'scraping' }
              }));
              break;

            case 'success':
              setProgressMessages(prev => [...prev, `✅ Episode ${event.episode} scraped successfully!`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'success', message: 'Scraped' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                successCount: prev.successCount + 1
              } : null);

              if (event.episode && event.url) {
                scrapedEpisodes.push({
                  number: event.episode,
                  title: event.title || `Episode ${event.episode}`,
                  streamUrl: event.url,
                  lang,
                  servers: event.sources || [{ name: "AnimeSuge active", url: event.url, lang }],
                  embeddingProtected: false,
                  scrapedAt: new Date().toISOString(),
                  isExisting: existingEpisodes.has(event.episode)
                });
              }
              break;

            case 'error':
              setProgressMessages(prev => [...prev, `❌ Episode ${event.episode} failed: ${event.error || 'Unknown error'}`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'error', message: event.error || 'Failed' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                errorCount: prev.errorCount + 1
              } : null);

              if (event.episode) {
                failedEpisodes.push({
                  number: event.episode,
                  title: `Episode ${event.episode}`,
                  error: event.error || 'Unknown error'
                });
              }
              break;

            case 'complete':
              setProgressMessages(prev => [...prev, `🎉 Scraping complete! ${scrapedEpisodes.length} successful, ${failedEpisodes.length} failed.`]);

              // Set the results directly on the page
              setCurrentScrapedEpisodes(scrapedEpisodes);

              // Invalidate queries so that DB lists refresh
              queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
              checkExistingEpisodes(selectedAnime.id);

              setSuccess(`Scraped & saved ${scrapedEpisodes.length} out of ${event.total || episodeNumbers.length} episodes successfully!`);
              setTimeout(() => setSuccess(null), 5000);
              break;
          }
        },
        { lang, overwrite: overwriteExisting }
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScrapeAllEpisodes = async () => {
    if (!selectedAnime) {
      setError('Please select an anime first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setProgressMessages([]);
    setCurrentProgress(null);
    setEpisodeStatuses({});

    const totalEpisodes = selectedAnime.total_episodes || 13;
    const episodeNumbers = Array.from({ length: totalEpisodes }, (_, i) => i + 1);

    try {
      setProgressMessages(prev => [...prev, '📺 Ensuring episode stubs exist in database...']);
      await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
    } catch (stubErr) {
      console.warn('⚠️ Episode stub creation skipped:', stubErr);
    }

    const initialStatuses: Record<number, { status: 'pending' }> = {};
    episodeNumbers.forEach(ep => {
      initialStatuses[ep] = { status: 'pending' };
    });
    setEpisodeStatuses(initialStatuses);

    const scrapedEpisodes: any[] = [];
    const failedEpisodes: any[] = [];

    try {
      const targetQuery = selectedAnime.title;
      await AnimeSugeScraperService.batchScrapeEpisodesWithProgress(
        targetQuery,
        selectedAnime.id,
        episodeNumbers,
        (event) => {
          switch (event.type) {
            case 'start':
              setProgressMessages(prev => [...prev, `🎬 Starting AnimeSuge batch scrape for ${event.total || 0} episodes...`]);
              setCurrentProgress({
                current: 0,
                total: event.total || 0,
                successCount: 0,
                errorCount: 0
              });
              break;

            case 'progress':
              setProgressMessages(prev => [...prev, `⏳ Scraping Episode ${event.episode}...`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'scraping' }
              }));
              break;

            case 'success':
              setProgressMessages(prev => [...prev, `✅ Episode ${event.episode} scraped successfully!`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'success', message: 'Scraped' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                successCount: prev.successCount + 1
              } : null);

              if (event.episode && event.url) {
                scrapedEpisodes.push({
                  number: event.episode,
                  title: event.title || `Episode ${event.episode}`,
                  streamUrl: event.url,
                  lang,
                  servers: event.sources || [{ name: "AnimeSuge active", url: event.url, lang }],
                  embeddingProtected: false,
                  scrapedAt: new Date().toISOString(),
                  isExisting: existingEpisodes.has(event.episode)
                });
              }
              break;

            case 'error':
              setProgressMessages(prev => [...prev, `❌ Episode ${event.episode} failed: ${event.error || 'Unknown error'}`]);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'error', message: event.error || 'Failed' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                errorCount: prev.errorCount + 1
              } : null);

              if (event.episode) {
                failedEpisodes.push({
                  number: event.episode,
                  title: `Episode ${event.episode}`,
                  error: event.error || 'Unknown error'
                });
              }
              break;

            case 'complete':
              setProgressMessages(prev => [...prev, `🎉 Scraping complete! ${scrapedEpisodes.length} successful, ${failedEpisodes.length} failed.`]);

              // Set the results directly on the page
              setCurrentScrapedEpisodes(scrapedEpisodes);

              // Invalidate queries so that DB lists refresh
              queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
              checkExistingEpisodes(selectedAnime.id);

              setSuccess(`Scraped & saved ${scrapedEpisodes.length} out of ${event.total || episodeNumbers.length} episodes successfully!`);
              setTimeout(() => setSuccess(null), 5000);
              break;
          }
        },
        { lang, overwrite: overwriteExisting }
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloseScrapedEpisodes = () => {
    setShowScrapedEpisodes(false);
    setScrapedEpisodesData(null);
  };

  const handleAddEpisode = async (episode: any) => {
    if (!selectedAnime) return;

    try {
      const API_BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${API_BASE}/api/add-scraped-episode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          animeId: selectedAnime.id,
          episodeData: {
            number: episode.number,
            title: episode.title,
            streamUrl: episode.streamUrl,
            lang: episode.lang || lang,
            servers: (episode.servers || [{ name: "AnimeSuge active", url: episode.streamUrl }])
              .map((s: any) => ({ ...s, lang: s.lang || episode.lang || lang })),
            description: `Scraped from AnimeSuge`,
            isPremium: false
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        setCurrentScrapedEpisodes(prev =>
          prev.map(ep =>
            ep.number === episode.number
              ? { ...ep, isExisting: true, addedAt: new Date().toISOString() }
              : ep
          )
        );

        // Update existing episodes set
        setExistingEpisodes(prev => new Set([...prev, episode.number]));

        setEpisodesAddedCount(prev => prev + 1);
        setSuccess(`Episode ${episode.number} added successfully!`);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to add episode');
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      setError('Error adding episode');
      setTimeout(() => setError(null), 5000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-2"
      >
        <h2 className="text-3xl font-bold bg-gradient-to-r from-violet-500 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center justify-center gap-3">
          <i className="ri-vidicon-line text-violet-500 text-3xl"></i>
          AnimeSuge Episode Scraper
        </h2>
        <p className="text-slate-500 text-sm">
          Scrape episodes from animesuge.cz for your anime collection
        </p>
      </motion.div>

      {/* Anime Selection */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
            <i className="ri-tv-2-line text-white text-sm"></i>
          </div>
          Select Anime
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-search-line mr-1 text-slate-400"></i> Search Anime
            </label>
            <Input
              type="text"
              placeholder="Type anime name to search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-violet-500 focus:ring-2 focus:ring-violet-200 transition-all"
            />
          </div>

          {selectedAnime && (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200/60 rounded-xl p-4"
              >
                <div className="flex items-center space-x-4">
                  {selectedAnime.poster_url && (
                    <img
                      src={selectedAnime.poster_url}
                      alt={selectedAnime.title}
                      className="w-16 h-20 object-cover rounded-xl shadow-md"
                      width={64}
                      height={80}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className="flex-1">
                    <h4 className="font-bold text-slate-800">{selectedAnime.title}</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center text-xs font-medium bg-violet-100 text-violet-700 px-2.5 py-1 rounded-full">
                        <i className="ri-play-circle-line mr-1"></i>{selectedAnime.total_episodes} episodes
                      </span>
                      <span className="inline-flex items-center text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                        {selectedAnime.status}
                      </span>
                    </div>
                  </div>
                  <div className="text-violet-500">
                    <i className="ri-checkbox-circle-fill text-2xl"></i>
                  </div>
                </div>
              </motion.div>

            </>
          )}

          <div className="max-h-60 overflow-y-auto border border-slate-200/60 rounded-xl bg-white/50">
            {isLoading && animeList.length === 0 ? (
              <div className="p-6 text-center">
                <SparkleLoadingSpinner size="sm" />
                <p className="text-slate-500 mt-2 text-sm">Loading anime...</p>
              </div>
            ) : filteredAnime.length === 0 ? (
              <div className="p-6 text-center text-slate-400">
                <i className="ri-inbox-line text-3xl block mb-2"></i>
                No anime found
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredAnime.map((anime) => (
                  <motion.div
                    key={anime.id}
                    whileHover={{ backgroundColor: 'rgba(124, 58, 237, 0.04)' }}
                    className={`p-3 cursor-pointer transition-all duration-150 ${selectedAnime?.id === anime.id ? 'bg-violet-50/80 border-l-4 border-l-violet-500' : 'border-l-4 border-l-transparent'
                      }`}
                    onClick={() => handleAnimeSelect(anime)}
                  >
                    <div className="flex items-center space-x-3">
                      {anime.poster_url && (
                        <img
                          src={anime.poster_url}
                          alt={anime.title}
                          className="w-10 h-14 object-cover rounded-lg shadow-sm"
                          width={40}
                          height={56}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-sm truncate">{anime.title}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {anime.total_episodes} eps • {anime.status}
                        </p>
                      </div>
                      {selectedAnime?.id === anime.id && (
                        <i className="ri-check-line text-violet-500 text-lg"></i>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Language & Scraping Preferences */}
      {selectedAnime && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {/* Language Preference Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <i className="ri-global-line text-white text-sm"></i>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Language Preference</h3>
                <p className="text-xs text-slate-500">AnimeSuge has separate Sub and Dub links</p>
              </div>
            </div>
            <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setLang('sub')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${lang === 'sub' ? 'bg-violet-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
              >
                Subbed
              </button>
              <button
                onClick={() => setLang('dub')}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${lang === 'dub' ? 'bg-violet-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
                  }`}
              >
                Dubbed
              </button>
            </div>
          </div>

          {/* Overwrite/Rescrape Preference Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                <i className="ri-refresh-line text-white text-sm"></i>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Rescrape & Overwrite</h3>
                <p className="text-xs text-slate-500">Force re-scraping and update existing URLs</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overwriteExisting}
                onChange={(e) => setOverwriteExisting(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500"></div>
            </label>
          </div>
        </motion.div>
      )}

      {/* Scraping Options */}
      {selectedAnime && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <i className="ri-crosshair-2-line text-white text-sm"></i>
            </div>
            Scraping Options
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Single Episode */}
            <div className="bg-gradient-to-br from-slate-50 to-violet-50/30 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-violet-100 flex items-center justify-center">
                  <i className="ri-movie-2-line text-violet-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">Single Episode</h4>
              </div>
              <Input
                type="number"
                placeholder="Episode number"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(parseInt(e.target.value) || 1)}
                min="1"
                className="rounded-xl border-slate-200"
              />
              <Button
                onClick={handleSingleScrape}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-movie-2-line mr-1"></i> Scrape Episode</>}
              </Button>
            </div>

            {/* Batch Episodes */}
            <div className="bg-gradient-to-br from-slate-50 to-fuchsia-50/30 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-fuchsia-100 flex items-center justify-center">
                  <i className="ri-stack-line text-fuchsia-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">Batch Episodes</h4>
              </div>
              <Input
                type="text"
                placeholder="1-5, 1,3,5, or 1"
                value={episodeRange}
                onChange={(e) => setEpisodeRange(e.target.value)}
                className="rounded-xl border-slate-200"
              />
              <Button
                onClick={handleBatchScrape}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-fuchsia-500 to-violet-600 hover:from-fuchsia-600 hover:to-violet-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-stack-line mr-1"></i> Batch Scrape</>}
              </Button>
            </div>

            {/* All Episodes */}
            <div className="bg-gradient-to-br from-slate-50 to-indigo-50/30 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-indigo-100 flex items-center justify-center">
                  <i className="ri-rocket-line text-indigo-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">All Episodes</h4>
              </div>
              <div className="text-sm text-slate-500 py-2.5 px-3 bg-white/60 rounded-xl border border-slate-100">
                <i className="ri-play-circle-line mr-1"></i> Scrape all {selectedAnime.total_episodes} episodes
              </div>
              <Button
                onClick={handleScrapeAllEpisodes}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-rocket-line mr-1"></i> Scrape All</>}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Progress Messages Display */}
      {(Object.keys(episodeStatuses).length > 0 && isLoading) && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
                <i className="ri-loader-4-line text-white text-sm animate-spin"></i>
              </div>
              Scraping Progress
            </h3>
            {currentProgress && (
              <div className="flex items-center gap-3 text-sm font-medium bg-slate-50 px-4 py-2 rounded-xl border border-slate-200">
                <span className="text-slate-600">{currentProgress.current}/{currentProgress.total}</span>
                <span className="text-green-600 flex items-center gap-1"><i className="ri-check-line"></i>{currentProgress.successCount}</span>
                <span className="text-red-500 flex items-center gap-1"><i className="ri-close-line"></i>{currentProgress.errorCount}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Object.entries(episodeStatuses).map(([episodeNum, status]) => {
              const bgColor = {
                pending: 'bg-slate-50 text-slate-400 border-slate-200',
                scraping: 'bg-amber-50 text-amber-700 border-amber-300',
                success: 'bg-green-50 text-green-700 border-green-300',
                error: 'bg-red-50 text-red-700 border-red-300'
              }[status.status];

              const icon = {
                pending: 'ri-time-line',
                scraping: 'ri-loader-4-line',
                success: 'ri-check-line',
                error: 'ri-close-line'
              }[status.status];

              return (
                <div
                  key={episodeNum}
                  className={`p-3 rounded-xl border transition-all ${bgColor} ${status.status === 'scraping' ? 'animate-pulse shadow-md' : ''
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs">EP {episodeNum}</span>
                    <i className={`${icon} text-base ${status.status === 'scraping' ? 'animate-spin' : ''}`}></i>
                  </div>
                  {status.status === 'scraping' && (
                    <div className="text-[10px] mt-1 font-medium">Scraping...</div>
                  )}
                  {status.message && status.status !== 'scraping' && (
                    <div className="text-[10px] mt-1 truncate">{status.message}</div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Real-time Logs Console */}
          {progressMessages.length > 0 && (
            <div
              ref={logContainerRef}
              className="mt-6 p-4 bg-slate-900 text-slate-300 rounded-xl border border-slate-800 font-mono text-xs max-h-40 overflow-y-auto space-y-1 scroll-smooth"
            >
              {progressMessages.map((msg, idx) => (
                <div key={idx} className="flex gap-2">
                  <span className="text-slate-500">[{idx + 1}]</span>
                  <span>{msg}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Results */}
      {(scrapeResult || batchResult || error || success || currentScrapedEpisodes.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                <i className="ri-bar-chart-box-line text-white text-sm"></i>
              </div>
              Scraping Results
            </h3>
            <Button
              onClick={() => {
                setScrapeResult(null);
                setBatchResult(null);
                setError(null);
                setSuccess(null);
                setEpisodesAddedCount(0);
                setCurrentScrapedEpisodes([]);
              }}
              variant="secondary"
              size="sm"
              className="rounded-xl border-slate-200"
            >
              Clear Results
            </Button>
          </div>

          <div className="space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 text-lg mt-0.5 shrink-0"></i>
                  <div className="min-w-0">
                    <p className="text-red-700 text-sm font-semibold">Scraping Failed</p>
                    <p className="text-red-600 text-xs mt-1 break-words">{error}</p>
                  </div>
                </div>
                {(error.toLowerCase().includes('not found') || error.toLowerCase().includes('no results') || error.toLowerCase().includes('could not find')) && (
                  <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex items-start gap-2">
                    <i className="ri-lightbulb-line text-amber-500 text-base shrink-0 mt-0.5"></i>
                    <div>
                      <strong>Tip:</strong> The title search couldn't find this anime on AnimeSuge.
                      Go to <a href="https://animesuge.cz" target="_blank" rel="noreferrer" className="underline font-semibold">animesuge.cz</a>,
                      search for the anime there, then paste the full URL (e.g. <code className="bg-amber-100 px-1 rounded">https://animesuge.cz/anime/naruto-...</code>)
                      into the <strong>"Custom Search Query or Watch URL"</strong> field above.
                    </div>
                  </div>
                )}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <i className="ri-checkbox-circle-line text-lg"></i>
                <div>{success}</div>
              </div>
            )}

            {/* Single Episode Result */}
            {scrapeResult && (
              <div className="space-y-3 mb-4">
                <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                  <i className="ri-movie-2-line text-violet-500"></i> Single Episode Result
                </h4>
                <div className={`p-4 rounded-xl ${scrapeResult.success ? 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/60' : 'bg-gradient-to-r from-red-50 to-rose-50 border border-red-200/60'
                  }`}>
                  {scrapeResult.success ? (
                    <div>
                      <p className="text-green-800 font-semibold text-sm flex items-center gap-1"><i className="ri-check-double-line mr-1 text-lg"></i>Episode scraped and saved successfully!</p>
                      <p className="text-xs text-green-600/80 mt-1.5 font-mono truncate">
                        <strong>Source:</strong> {scrapeResult.streamUrl}
                      </p>
                      <div className="mt-2.5 text-xs text-slate-500 flex items-center gap-3">
                        <span>Episode {episodeNumber}</span>
                        <span>•</span>
                        <span>{selectedAnime?.title}</span>
                        <span>•</span>
                        <span className="font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded text-[10px] uppercase">{lang}</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-red-800 font-semibold text-sm flex items-center gap-1"><i className="ri-close-circle-line mr-1 text-lg"></i>{scrapeResult.error}</p>
                      <div className="mt-2 text-xs text-slate-500 flex items-center gap-3">
                        <span>Episode {episodeNumber}</span>
                        <span>•</span>
                        <span>{selectedAnime?.title}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {episodesAddedCount > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5 text-sm font-semibold">
                  <i className="ri-database-2-line text-lg text-emerald-600 animate-bounce"></i>
                  <span>{episodesAddedCount} episodes added to database</span>
                </div>
              </motion.div>
            )}

            {/* List of scraped episodes from batch */}
            {currentScrapedEpisodes.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-bold text-slate-800 text-sm">Scraped Episodes ({currentScrapedEpisodes.length})</h4>
                <div className="max-h-96 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white">
                  {currentScrapedEpisodes.map((episode, idx) => (
                    <div key={`${episode.number}-${idx}`} className="p-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-800">EP {episode.number}</span>
                          <span className="text-xs text-slate-500 truncate">{episode.title}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5 max-w-lg">{episode.streamUrl}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        {episode.isExisting ? (
                          <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                            <i className="ri-checkbox-circle-line"></i> In Database
                          </span>
                        ) : (
                          <Button
                            onClick={() => handleAddEpisode(episode)}
                            size="sm"
                            className="bg-violet-500 hover:bg-violet-600 text-white rounded-lg flex items-center gap-1 shadow-sm"
                          >
                            <i className="ri-add-line"></i> Add Episode
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Scraped Episodes Summary Modal */}
      {showScrapedEpisodes && scrapedEpisodesData && (
        <ScrapedEpisodesModal
          isOpen={showScrapedEpisodes}
          onClose={handleCloseScrapedEpisodes}
          animeId={selectedAnime!.id}
          animeTitle={selectedAnime!.title}
          scrapedEpisodes={scrapedEpisodesData.scrapedEpisodes}
          failedEpisodes={scrapedEpisodesData.failedEpisodes}
          summary={scrapedEpisodesData.summary}
          onEpisodesAdded={() => {
            queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
            checkExistingEpisodes(selectedAnime!.id);
          }}
        />
      )}
    </div>
  );
};

export default AnimeSugeScraperComponent;
