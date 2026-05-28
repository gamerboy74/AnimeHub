import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { SanjiAnimeScraperService } from '../../services/scrapers/sanjianime';
import { AdminAnimeService } from '../../services/admin/anime';
import { AnimeImporterService } from '../../services/anime/importer';
import Button from '../../components/base/Button';
import Input from '../../components/base/Input';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';

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
  streamUrl?: string | null;
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

interface SanjiAnimeScraperComponentProps {
  initialSelectedAnime?: Anime | null;
}

export const SanjiAnimeScraperComponent: React.FC<SanjiAnimeScraperComponentProps> = ({ initialSelectedAnime }) => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [animeList, setAnimeList] = useState<Anime[]>([]);
  const [filteredAnime, setFilteredAnime] = useState<Anime[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedAnime, setSelectedAnime] = useState<Anime | null>(null);
  const [inputUrl, setInputUrl] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [episodeRange, setEpisodeRange] = useState('');
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [lang, setLang] = useState<'sub' | 'dub'>('dub');
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [currentScrapedEpisodes, setCurrentScrapedEpisodes] = useState<any[]>([]);

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

  useEffect(() => {
    console.log('🎯 SanjiAnimeScraperComponent mounted');
    loadAnimeList();
  }, []);

  useEffect(() => {
    if (initialSelectedAnime) handleAnimeSelect(initialSelectedAnime);
  }, [initialSelectedAnime]);

  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredAnime(animeList);
    } else {
      setFilteredAnime(animeList.filter((anime) => anime.title.toLowerCase().includes(searchTerm.toLowerCase())));
    }
  }, [searchTerm, animeList]);

  const loadAnimeList = async () => {
    try {
      setIsLoading(true);
      const result = await AdminAnimeService.getAnimeList(1, 1000);
      setAnimeList(result.anime || []);
      setFilteredAnime(result.anime || []);
    } catch (err) {
      console.error('Error loading anime list:', err);
      setError('Failed to load anime list');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnimeSelect = async (anime: Anime) => {
    setSelectedAnime(anime);
    setSearchTerm(anime.title);
    setInputUrl('');
    setError(null);
    setSuccess(null);
    setScrapeResult(null);
    setBatchResult(null);
    setCurrentScrapedEpisodes([]);
    setProgressMessages([]);
    setCurrentProgress(null);
    setEpisodeStatuses({});
  };

  const resolveTarget = () => inputUrl.trim() || selectedAnime?.title || '';

  const handleSingleScrape = async () => {
    const target = resolveTarget();
    if (!target) {
      setError('Please select an anime or paste a Sanji Anime URL first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await SanjiAnimeScraperService.scrapeAnimeEpisode(target, episodeNumber, { lang, animeId: selectedAnime?.id });
      setScrapeResult(result);

      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
        setSuccess(`Episode ${episodeNumber} scraped and saved successfully!`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError(result.error || 'Scraping failed');
        setTimeout(() => setError(null), 5000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchScrape = async () => {
    const target = resolveTarget();
    if (!target) {
      setError('Please select an anime or paste a Sanji Anime URL first');
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

    setIsLoading(true);
    setError(null);
    setSuccess(null);
    setBatchResult(null);
    setProgressMessages([]);
    setCurrentProgress(null);
    setEpisodeStatuses({});

    const initialStatuses: Record<number, { status: 'pending' }> = {};
    episodeNumbers.forEach(ep => {
      initialStatuses[ep] = { status: 'pending' };
    });
    setEpisodeStatuses(initialStatuses);

    if (selectedAnime) {
      try {
        setProgressMessages(prev => [...prev, '📺 Ensuring episode stubs exist in database...']);
        await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
      } catch (stubErr) {
        console.warn('⚠️ Episode stub creation skipped:', stubErr);
      }
    }

    const scrapedEpisodes: any[] = [];
    const failedEpisodes: any[] = [];

    try {
      await SanjiAnimeScraperService.batchScrapeEpisodesWithProgress(
        selectedAnime?.title || target,
        selectedAnime?.id || '',
        episodeNumbers,
        (event) => {
          switch (event.type) {
            case 'start':
              setProgressMessages(prev => [...prev, `🎬 Starting batch scrape for ${event.total || 0} episodes...`]);
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
                  servers: event.sources || [{ name: "Sanji Anime active", url: event.url, lang }],
                  embeddingProtected: false,
                  scrapedAt: new Date().toISOString(),
                  isExisting: true
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
              setCurrentScrapedEpisodes(scrapedEpisodes);

              queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
              setSuccess(`Scraped & saved ${scrapedEpisodes.length} out of ${event.total || episodeNumbers.length} episodes successfully!`);
              setTimeout(() => setSuccess(null), 5000);
              break;
          }
        },
        { lang, overwrite: overwriteExisting, inputUrl: target }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
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

    const initialStatuses: Record<number, { status: 'pending' }> = {};
    episodeNumbers.forEach(ep => {
      initialStatuses[ep] = { status: 'pending' };
    });
    setEpisodeStatuses(initialStatuses);

    try {
      setProgressMessages(prev => [...prev, '📺 Ensuring episode stubs exist in database...']);
      await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
    } catch (stubErr) {
      console.warn('⚠️ Episode stub creation skipped:', stubErr);
    }

    const scrapedEpisodes: any[] = [];
    const failedEpisodes: any[] = [];

    try {
      await SanjiAnimeScraperService.batchScrapeEpisodesWithProgress(
        selectedAnime.title,
        selectedAnime.id,
        episodeNumbers,
        (event) => {
          switch (event.type) {
            case 'start':
              setProgressMessages(prev => [...prev, `🎬 Starting batch scrape for all ${event.total || 0} episodes...`]);
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
                  servers: event.sources || [{ name: "Sanji Anime active", url: event.url, lang }],
                  embeddingProtected: false,
                  scrapedAt: new Date().toISOString(),
                  isExisting: true
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
              setCurrentScrapedEpisodes(scrapedEpisodes);

              queryClient.invalidateQueries({ queryKey: ['admin-anime'] });
              setSuccess(`Scraped & saved ${scrapedEpisodes.length} out of ${event.total || episodeNumbers.length} episodes successfully!`);
              setTimeout(() => setSuccess(null), 5000);
              break;
          }
        },
        { lang, overwrite: overwriteExisting, inputUrl: resolveTarget() }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-2">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-cyan-500 to-blue-600 bg-clip-text text-transparent mb-2 flex items-center justify-center gap-3">
          <i className="ri-play-circle-line text-cyan-500 text-3xl"></i>
          Sanji Anime Episode Scraper
        </h2>
        <p className="text-slate-500 text-sm">Scrape Sanji Anime servers, sub and dub, into your library</p>
      </motion.div>

      {/* Anime Selection */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
            <i className="ri-tv-2-line text-white text-sm"></i>
          </div>
          Select Anime
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-link mr-1 text-slate-400"></i> Sanji Anime URL or anime title
            </label>
            <Input
              type="text"
              placeholder="Paste a watch URL or type an anime title"
              value={inputUrl || searchTerm}
              onChange={(e) => {
                setInputUrl(e.target.value);
                setSearchTerm(e.target.value);
              }}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200 transition-all"
            />
          </div>

          {selectedAnime && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-200/60 rounded-xl p-4"
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
                    <span className="inline-flex items-center text-xs font-medium bg-cyan-100 text-cyan-700 px-2.5 py-1 rounded-full">
                      <i className="ri-play-circle-line mr-1"></i>{selectedAnime.total_episodes} episodes
                    </span>
                    <span className="inline-flex items-center text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                      {selectedAnime.status}
                    </span>
                  </div>
                </div>
                <div className="text-cyan-500">
                  <i className="ri-checkbox-circle-fill text-2xl"></i>
                </div>
              </div>
            </motion.div>
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
                    whileHover={{ backgroundColor: 'rgba(6, 182, 212, 0.04)' }}
                    className={`p-3 cursor-pointer transition-all duration-150 ${selectedAnime?.id === anime.id ? 'bg-cyan-50/80 border-l-4 border-l-cyan-500' : 'border-l-4 border-l-transparent'}`}
                    onClick={() => handleAnimeSelect(anime)}
                  >
                    <div className="flex items-center space-x-3">
                      {anime.poster_url && (
                        <img src={anime.poster_url} alt={anime.title} className="w-10 h-14 object-cover rounded-lg shadow-sm" width={40} height={56} loading="lazy" decoding="async" />
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-800 text-sm truncate">{anime.title}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">{anime.total_episodes} eps • {anime.status}</p>
                      </div>
                      {selectedAnime?.id === anime.id && <i className="ri-check-line text-cyan-500 text-lg"></i>}
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
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Language Preference Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <i className="ri-global-line text-white text-sm"></i>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Language Preference</h3>
                <p className="text-xs text-slate-500">Sanji Anime can expose sub, dub, or mixed server tabs</p>
              </div>
            </div>
            <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setLang('sub')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${lang === 'sub' ? 'bg-cyan-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                Subbed
              </button>
              <button onClick={() => setLang('dub')} className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${lang === 'dub' ? 'bg-cyan-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                Dubbed
              </button>
            </div>
          </div>

          {/* Overwrite/Rescrape Preference Card */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <i className="ri-refresh-line text-white text-sm"></i>
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Rescrape & Overwrite</h3>
                <p className="text-xs text-slate-500">Force fresh Sanji Anime server collection</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer select-none">
              <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>
        </motion.div>
      )}

      {/* Scraping Options */}
      {selectedAnime && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
              <i className="ri-crosshair-2-line text-white text-sm"></i>
            </div>
            Scraping Options
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Single Episode */}
            <div className="bg-gradient-to-br from-slate-50 to-cyan-50/30 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-cyan-100 flex items-center justify-center">
                  <i className="ri-movie-2-line text-cyan-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">Single Episode</h4>
              </div>
              <Input type="number" min="1" value={episodeNumber} onChange={(e) => setEpisodeNumber(parseInt(e.target.value || '1', 10))} className="rounded-xl border-slate-200" />
              <Button onClick={handleSingleScrape} disabled={isLoading} className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all">
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-movie-2-line mr-1"></i> Scrape Episode</>}
              </Button>
            </div>

            {/* Batch Episodes */}
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-blue-100 flex items-center justify-center">
                  <i className="ri-stack-line text-blue-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">Batch Episodes</h4>
              </div>
              <Input type="text" placeholder="1-12 or 1,3,5" value={episodeRange} onChange={(e) => setEpisodeRange(e.target.value)} className="rounded-xl border-slate-200" />
              <Button onClick={handleBatchScrape} disabled={isLoading} className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all">
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
              <Button onClick={handleScrapeAllEpisodes} disabled={isLoading} className="w-full bg-gradient-to-r from-indigo-500 to-cyan-600 hover:from-indigo-600 hover:to-cyan-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all">
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-rocket-line mr-1"></i> Scrape All</>}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Progress Messages Display */}
      {(Object.keys(episodeStatuses).length > 0 && isLoading) && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
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
                <div key={episodeNum} className={`p-3 rounded-xl border transition-all ${bgColor} ${status.status === 'scraping' ? 'animate-pulse shadow-md' : ''}`}>
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

      {/* Results & Saved List */}
      {(scrapeResult || batchResult || error || success || currentScrapedEpisodes.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
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
                setCurrentScrapedEpisodes([]);
              }}
              variant="secondary"
              className="text-xs py-1 px-3 rounded-lg"
            >
              Clear Results
            </Button>
          </div>

          {(success || error) && (
            <div className="space-y-2 mb-4">
              {success && <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-3 text-sm flex items-center gap-2"><i className="ri-checkbox-circle-line text-lg text-green-600"></i>{success}</div>}
              {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm flex items-center gap-2"><i className="ri-error-warning-line text-lg text-red-600"></i>{error}</div>}
            </div>
          )}

          {scrapeResult && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm mb-4 space-y-3">
              <div className="font-semibold text-slate-700 flex items-center gap-2"><i className="ri-movie-2-line text-cyan-600"></i>Latest Single Result</div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 border-b border-slate-200/60 pb-3">
                <div>Status: <span className={scrapeResult.success ? "text-green-600 font-bold" : "text-red-500 font-bold"}>{scrapeResult.success ? "Success" : "Failed"}</span></div>
                {scrapeResult.watchUrl && <div className="col-span-2 truncate">Watch URL: <a href={scrapeResult.watchUrl} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline">{scrapeResult.watchUrl}</a></div>}
                {scrapeResult.streamUrl && <div className="col-span-2 truncate">Primary Stream: <a href={scrapeResult.streamUrl} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline font-semibold">{scrapeResult.streamUrl}</a></div>}
              </div>

              {/* Scraped Servers detail list */}
              {scrapeResult.episodeData?.sources && scrapeResult.episodeData.sources.length > 0 && (
                <div className="space-y-2 mt-2">
                  <div className="text-xs uppercase font-bold text-slate-500 tracking-wider">Scraped Server Slots ({scrapeResult.episodeData.sources.length})</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {scrapeResult.episodeData.sources.map((srv: any, idx: number) => (
                      <div key={idx} className="bg-white p-2.5 rounded-xl border border-slate-200/60 shadow-sm flex flex-col justify-between gap-1">
                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                          <span>Slot: {srv.label}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${srv.lang === 'sub' ? 'bg-cyan-50 text-cyan-600 border border-cyan-100' :
                              srv.lang === 'dub' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                                'bg-slate-50 text-slate-500 border border-slate-100'
                            }`}>{srv.lang}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate" title={srv.playableUrl || srv.iframeUrl || ''}>
                          {srv.playableUrl ? (
                            <span className="text-emerald-600 font-medium flex items-center gap-1"><i className="ri-play-circle-fill"></i> Playable URL: {srv.playableUrl}</span>
                          ) : srv.iframeUrl ? (
                            <span className="text-slate-500 flex items-center gap-1"><i className="ri-external-link-line"></i> Iframe URL: {srv.iframeUrl}</span>
                          ) : (
                            <span className="text-red-500">Failed / No URL found</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {batchResult && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm mb-4">
              <div className="font-semibold text-slate-700 flex items-center gap-2 mb-3"><i className="ri-bar-chart-box-line text-blue-600"></i>Batch Scrape Summary</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="bg-white p-3 rounded-xl border border-slate-100"><div className="text-xs text-slate-400">Total</div><div className="text-xl font-bold text-slate-700">{batchResult.summary.totalEpisodes}</div></div>
                <div className="bg-white p-3 rounded-xl border border-slate-100"><div className="text-xs text-slate-400">Success</div><div className="text-xl font-bold text-green-600">{batchResult.summary.successCount}</div></div>
                <div className="bg-white p-3 rounded-xl border border-slate-100"><div className="text-xs text-slate-400">Failed</div><div className="text-xl font-bold text-red-500">{batchResult.summary.errorCount}</div></div>
                <div className="bg-white p-3 rounded-xl border border-slate-100"><div className="text-xs text-slate-400">Success Rate</div><div className="text-xl font-bold text-indigo-600">{batchResult.summary.successRate}%</div></div>
              </div>
            </div>
          )}

          {currentScrapedEpisodes.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><i className="ri-play-list-add-line text-cyan-600"></i>Scraped Episodes Saved to Database</div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {currentScrapedEpisodes.map((episode) => (
                  <div key={episode.number} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm flex flex-col gap-2 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-cyan-100 text-cyan-700 flex items-center justify-center font-bold text-sm shrink-0">EP {episode.number}</div>
                        <div className="min-w-0">
                          <div className="font-medium text-slate-800 truncate">{episode.title}</div>
                          <div className="text-slate-400 text-xs truncate max-w-md">{episode.streamUrl}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 font-semibold">{episode.lang || lang}</span>
                        <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-700 font-medium flex items-center gap-1 border border-green-100"><i className="ri-checkbox-circle-fill"></i>Saved</span>
                      </div>
                    </div>

                    {/* Mapped servers detail display */}
                    {episode.servers && episode.servers.length > 0 && (
                      <div className="pl-12 border-t border-slate-200/60 pt-2 space-y-1">
                        <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Saved Server Variants:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {episode.servers.map((srv: any, idx: number) => (
                            <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200 flex items-center gap-1 shadow-sm" title={srv.playableUrl || srv.iframeUrl || ''}>
                              <i className={srv.playableUrl ? "ri-play-circle-fill text-emerald-500" : "ri-external-link-line text-slate-400"}></i>
                              <strong>{srv.label}</strong>
                              <span className="text-[9px] text-slate-400 font-normal">({srv.lang})</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export default SanjiAnimeScraperComponent;