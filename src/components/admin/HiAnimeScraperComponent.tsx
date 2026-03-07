import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { HiAnimeScraperService } from '../../services/scrapers/hianime';
import { AdminAnimeService } from '../../services/admin/anime';
import { AnimeService } from '../../services/anime';
import Button from '../../components/base/Button';
import Input from '../../components/base/Input';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { ScrapedEpisodesModal } from './ScrapedEpisodesModal';

interface ScrapeResult {
  success: boolean;
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

export const HiAnimeScraperComponent: React.FC = () => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);
  const [animeTitle, setAnimeTitle] = useState('');
  const [animeId, setAnimeId] = useState('');
  const [episodeNumber, setEpisodeNumber] = useState(1);
  const [episodeRange, setEpisodeRange] = useState('');
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [animeList, setAnimeList] = useState<any[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<any>(null);
  
  // New state for all episodes scraping
  const [showScrapedEpisodes, setShowScrapedEpisodes] = useState(false);
  const [scrapedEpisodesData, setScrapedEpisodesData] = useState<any>(null);

  // Progress tracking state
  const [progressMessages, setProgressMessages] = useState<string[]>([]);
  const [currentProgress, setCurrentProgress] = useState<{
    current: number;
    total: number;
    successCount: number;
    errorCount: number;
  } | null>(null);

  // Load anime list for selection
  React.useEffect(() => {
    loadAnimeList();
  }, []);

  const loadAnimeList = async () => {
    try {
      const result = await AdminAnimeService.getAnimeList(1, 50);
      setAnimeList(result.anime || []);
    } catch (error) {
      console.error('Error loading anime list:', error);
    }
  };

  const handleSingleScrape = async () => {
    if (!animeTitle.trim() || !animeId.trim()) {
      setError('Please provide both anime title and anime ID');
      return;
    }

    setIsLoading(true);
    setError(null);
    setScrapeResult(null);

    try {
      const result = await HiAnimeScraperService.scrapeAnimeEpisode(
        animeTitle,
        animeId,
        episodeNumber,
        {
          headless: true,
          timeout: 30000,
          retries: 3
        }
      );

      setScrapeResult(result);
      
      if (!result.success) {
        setError(result.error || 'Scraping failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchScrape = async () => {
    if (!animeTitle.trim() || !animeId.trim() || !episodeRange.trim()) {
      setError('Please provide anime title, anime ID, and episode range');
      return;
    }

    // Parse episode range (e.g., "1-5" or "1,3,5" or "1")
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
    setBatchResult(null);
    setProgressMessages([]);
    setCurrentProgress(null);

    try {
      // Use streaming version for real-time updates
      await HiAnimeScraperService.batchScrapeEpisodesWithProgress(
        animeTitle,
        animeId,
        episodeNumbers,
        (event) => {
          // Handle progress updates
          switch (event.type) {
            case 'start':
              setProgressMessages([`🎬 Starting to scrape ${event.total} episodes...`]);
              setCurrentProgress({
                current: 0,
                total: event.total || 0,
                successCount: 0,
                errorCount: 0
              });
              break;
            
            case 'progress':
              setProgressMessages(prev => [
                ...prev,
                `📺 Scraping episode ${event.episode} (${event.current}/${event.total})...`
              ]);
              break;
            
            case 'success':
              setProgressMessages(prev => [
                ...prev,
                `✅ Episode ${event.episode} scraped successfully!`
              ]);
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                successCount: prev.successCount + 1
              } : null);
              break;
            
            case 'error':
              setProgressMessages(prev => [
                ...prev,
                `❌ Episode ${event.episode} failed: ${event.error}`
              ]);
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                errorCount: prev.errorCount + 1
              } : null);
              break;
            
            case 'complete':
              setProgressMessages(prev => [
                ...prev,
                `\n🎉 Batch scraping completed!`,
                `✅ Success: ${event.successCount}/${event.total}`,
                `❌ Errors: ${event.errorCount}/${event.total}`,
                `📊 Success rate: ${event.successRate}%`
              ]);
              // Build final result for display
              setBatchResult({
                success: true,
                results: [],
                summary: {
                  totalEpisodes: event.total || 0,
                  successCount: event.successCount || 0,
                  errorCount: event.errorCount || 0,
                  successRate: event.successRate || 0
                }
              });
              break;
          }
        },
        {
          headless: true,
          timeout: 30000,
          retries: 2,
          delayBetweenEpisodes: 3000
        }
      );

    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setProgressMessages(prev => [
        ...prev,
        `❌ Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // New function to scrape all episodes
  const handleScrapeAllEpisodes = async () => {
    if (!animeTitle || !animeId) {
      setError('Please select an anime first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setScrapedEpisodesData(null);

    try {
      const result = await HiAnimeScraperService.scrapeAllEpisodes(animeTitle, {
        maxEpisodes: 50,
        timeout: 120000, // 2 minutes
        retries: 2
      });

      if (result.success && result.data) {
        setScrapedEpisodesData(result.data);
        setShowScrapedEpisodes(true);
      } else {
        setError(result.error || 'Failed to scrape episodes');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnimeSelect = (anime: any) => {
    setSelectedAnime(anime);
    setAnimeTitle(anime.title);
    setAnimeId(anime.id);
  };

  const handleTestScraper = async () => {
    setIsLoading(true);
    setError(null);
    setScrapeResult(null);

    try {
      await HiAnimeScraperService.testScraper();
      setScrapeResult({
        success: true,
        streamUrl: 'Test completed - check console for details',
        episodeData: { test: true }
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Test failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -15 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent flex items-center gap-3">
            <i className="ri-flask-line text-blue-600 text-3xl"></i>
            HiAnime.do Scraper
          </h2>
          <p className="text-slate-500 text-sm mt-1">Direct episode scraping with real-time progress</p>
        </div>
        <Button
          onClick={handleTestScraper}
          variant="secondary"
          disabled={isLoading}
          className="text-sm rounded-xl border border-slate-200 hover:border-blue-300 px-4 py-2"
        >
          <i className="ri-flask-line mr-1"></i> Test Scraper
        </Button>
      </motion.div>

      {/* Anime Selection */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <i className="ri-tv-2-line text-white text-sm"></i>
          </div>
          Select Anime
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-search-line mr-1 text-slate-400"></i> Search Anime
            </label>
            <Input
              type="text"
              placeholder="Search anime..."
              value={animeTitle}
              onChange={(e) => setAnimeTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-fingerprint-line mr-1 text-slate-400"></i> Anime ID (UUID)
            </label>
            <Input
              type="text"
              placeholder="Anime UUID from database"
              value={animeId}
              onChange={(e) => setAnimeId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
          </div>
        </div>

        {/* Anime List */}
        {animeList.length > 0 && (
          <div className="mt-5">
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-list-check mr-1 text-slate-400"></i> Or select from existing anime:
            </label>
            <div className="max-h-40 overflow-y-auto border border-slate-200/60 rounded-xl bg-white/50">
              {animeList.slice(0, 10).map((anime) => (
                <button
                  key={anime.id}
                  onClick={() => handleAnimeSelect(anime)}
                  className={`w-full text-left px-4 py-2.5 hover:bg-blue-50/50 border-b border-slate-100 last:border-b-0 transition-all ${
                    selectedAnime?.id === anime.id ? 'bg-blue-50/80 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="font-semibold text-sm text-slate-800">{anime.title}</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">ID: {anime.id}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>

      {/* Single Episode Scraping */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <i className="ri-play-circle-line text-white text-sm"></i>
          </div>
          Single Episode Scraping
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Episode Number
            </label>
            <Input
              type="number"
              min="1"
              value={episodeNumber}
              onChange={(e) => setEpisodeNumber(parseInt(e.target.value) || 1)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleSingleScrape}
              disabled={isLoading || !animeTitle.trim() || !animeId.trim()}
              className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
            >
              {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-movie-2-line mr-1"></i> Scrape Episode</>}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Batch Episode Scraping */}
      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
      >
        <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
            <i className="ri-stack-line text-white text-sm"></i>
          </div>
          Batch Episode Scraping
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Episode Range
            </label>
            <Input
              type="text"
              placeholder="e.g., 1-5, 1,3,5, or 1"
              value={episodeRange}
              onChange={(e) => setEpisodeRange(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
              <i className="ri-lightbulb-line text-amber-400"></i>
              Formats: 1-5 (range), 1,3,5 (specific), 1 (single)
            </p>
          </div>
          <div className="flex items-start gap-3 pt-7">
            <Button
              onClick={handleBatchScrape}
              disabled={isLoading || !animeTitle.trim() || !animeId.trim() || !episodeRange.trim()}
              variant="secondary"
              className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all border-0"
            >
              {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-stack-line mr-1"></i> Batch Scrape</>}
            </Button>
            <Button
              onClick={handleScrapeAllEpisodes}
              disabled={isLoading || !animeTitle.trim() || !animeId.trim()}
              variant="primary"
              className="flex-1 bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
            >
              {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-movie-2-line mr-1"></i> Scrape All</>}
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Error Display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-l-4 border-red-500 bg-red-50/80 rounded-r-xl p-4"
        >
          <div className="flex items-center gap-3">
            <i className="ri-error-warning-line text-red-500 text-xl"></i>
            <span className="text-red-800 font-medium text-sm">{error}</span>
          </div>
        </motion.div>
      )}

      {/* Single Scrape Result */}
      {scrapeResult && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className={`rounded-2xl border p-5 ${
            scrapeResult.success
              ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200/60'  
              : 'bg-gradient-to-r from-red-50 to-rose-50 border-red-200/60'
          }`}
        >
          <h3 className="text-sm font-bold mb-3 flex items-center gap-2 ${scrapeResult.success ? 'text-green-800' : 'text-red-800'}">
            {scrapeResult.success ? <><i className="ri-check-double-line text-green-600"></i> Scraping Successful</> : <><i className="ri-close-circle-line text-red-600"></i> Scraping Failed</>}
          </h3>
          
          {scrapeResult.success ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-green-700 mb-1">Stream URL:</label>
                <div className="bg-white/70 p-3 rounded-xl border border-green-100 text-xs font-mono break-all text-slate-600">
                  {scrapeResult.streamUrl}
                </div>
              </div>
              {scrapeResult.episodeData && (
                <div>
                  <label className="block text-xs font-semibold text-green-700 mb-1">Episode Data:</label>
                  <pre className="bg-white/70 p-3 rounded-xl border border-green-100 text-xs overflow-auto text-slate-600">
                    {JSON.stringify(scrapeResult.episodeData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-700 text-sm">
              <strong>Error:</strong> {scrapeResult.error}
            </div>
          )}
        </motion.div>
      )}

      {/* Progress Messages Display */}
      {progressMessages.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <div className="flex items-center justify-between mb-4">
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
          
          <div className="bg-slate-50/80 rounded-xl border border-slate-200/60 p-4 max-h-72 overflow-y-auto">
            <div className="space-y-1 font-mono text-xs">
              {progressMessages.map((msg, idx) => (
                <div key={idx} className="text-slate-600 whitespace-pre-wrap leading-relaxed">
                  {msg}
                </div>
              ))}
            </div>
          </div>
          
          {isLoading && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <SparkleLoadingSpinner size="sm" />
              <span className="text-slate-500 text-sm font-medium">Scraping in progress...</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Batch Scrape Result */}
      {batchResult && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <i className="ri-bar-chart-box-line text-white text-sm"></i>
            </div>
            Batch Scraping Results
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="text-center bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl p-4 border border-blue-100">
              <div className="text-2xl font-bold text-blue-600">{batchResult.summary.totalEpisodes}</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Total</div>
            </div>
            <div className="text-center bg-gradient-to-br from-green-50 to-green-100/50 rounded-xl p-4 border border-green-100">
              <div className="text-2xl font-bold text-green-600">{batchResult.summary.successCount}</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Successful</div>
            </div>
            <div className="text-center bg-gradient-to-br from-red-50 to-red-100/50 rounded-xl p-4 border border-red-100">
              <div className="text-2xl font-bold text-red-500">{batchResult.summary.errorCount}</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Failed</div>
            </div>
            <div className="text-center bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl p-4 border border-purple-100">
              <div className="text-2xl font-bold text-purple-600">{batchResult.summary.successRate.toFixed(1)}%</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Rate</div>
            </div>
          </div>

          {/* Detailed Results */}
          {batchResult.results.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                <i className="ri-list-check text-blue-500"></i> Episode Results
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                {batchResult.results.map((result, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-2.5 rounded-xl text-sm ${
                      result.success ? 'bg-green-50/80 text-green-800 border border-green-200/50' : 'bg-red-50/80 text-red-800 border border-red-200/50'
                    }`}
                  >
                    <span className="font-medium text-xs">Episode {index + 1}</span>
                    <span className="text-xs flex items-center gap-1">
                      {result.success ? <><i className="ri-check-line"></i> Success</> : <><i className="ri-close-line"></i> {result.error}</>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* Instructions */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="bg-gradient-to-br from-blue-50/80 to-indigo-50/60 backdrop-blur-sm rounded-2xl border border-blue-200/40 p-6"
      >
        <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
          <i className="ri-lightbulb-line text-amber-500"></i>
          Instructions
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { icon: 'ri-terminal-line', text: 'Install Playwright first' },
            { icon: 'ri-movie-2-line', text: 'Enter title + ID for single episode' },
            { icon: 'ri-stack-line', text: 'Use range format for batch scraping' },
            { icon: 'ri-fingerprint-line', text: 'Use UUID from your database' },
            { icon: 'ri-timer-line', text: 'Rate limiting prevents blocks' },
          ].map((item, idx) => (
            <div key={idx} className="flex items-center gap-3 text-sm text-slate-600">
              <div className="w-7 h-7 rounded-lg bg-white/80 border border-blue-200/50 flex items-center justify-center flex-shrink-0">
                <i className={`${item.icon} text-blue-500 text-xs`}></i>
              </div>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Scraped Episodes Modal */}
      {showScrapedEpisodes && scrapedEpisodesData && (
        <ScrapedEpisodesModal
          isOpen={showScrapedEpisodes}
          onClose={() => setShowScrapedEpisodes(false)}
          animeId={animeId}
          animeTitle={animeTitle}
          scrapedEpisodes={scrapedEpisodesData.scrapedEpisodes}
          failedEpisodes={scrapedEpisodesData.failedEpisodes}
          summary={scrapedEpisodesData.summary}
          onEpisodesAdded={() => {
            // Invalidate caches so other pages reflect new episodes
            if (animeId) {
              queryClient.invalidateQueries({ queryKey: ['anime', 'byId', animeId] });
            }
            queryClient.invalidateQueries({ queryKey: ['anime', 'recent'] });
            queryClient.invalidateQueries({ queryKey: ['anime', 'list'] });
            AnimeService.clearCache();
          }}
        />
      )}
    </div>
  );
};
