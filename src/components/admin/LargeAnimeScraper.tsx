import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LargeAnimeScraperService } from '../../services/scrapers/largeBatch';
import type { LargeScrapeProgress, ChunkScrapeResult } from '../../services/scrapers/largeBatch';

interface LargeAnimeScraperProps {
  animeId: string;
  animeTitle: string;
  totalEpisodes: number;
  onScrapingComplete?: () => void;
}

export default function LargeAnimeScraper({
  animeId,
  animeTitle,
  totalEpisodes,
  onScrapingComplete
}: LargeAnimeScraperProps) {
  const [isScraping, setIsScraping] = useState(false);
  const [progress, setProgress] = useState<LargeScrapeProgress | null>(null);
  const [chunkSize, setChunkSize] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [recentChunkResults, setRecentChunkResults] = useState<ChunkScrapeResult[]>([]);

  // Calculate estimated time
  const estimatedTime = LargeAnimeScraperService.calculateEstimatedTime(totalEpisodes, chunkSize);

  // Check for existing progress on mount
  useEffect(() => {
    checkExistingProgress();
  }, [animeId]);

  const checkExistingProgress = async () => {
    try {
      const result = await LargeAnimeScraperService.getScrapingProgress(animeId);
      if (result.success && result.progress) {
        setProgress(result.progress);
        if (result.progress.status === 'in_progress') {
          setIsScraping(true);
        }
      }
    } catch (error) {
      console.error('Error checking existing progress:', error);
    }
  };

  const startScraping = async () => {
    try {
      setIsScraping(true);
      setError(null);
      setSuccess(null);
      setRecentChunkResults([]);

      const result = await LargeAnimeScraperService.scrapeAllChunks(
        animeId,
        animeTitle,
        totalEpisodes,
        chunkSize,
        (progress) => {
          setProgress(progress);
        },
        (_chunkNumber, chunkResult) => {
          setRecentChunkResults(prev => [chunkResult, ...prev.slice(0, 4)]); // Keep last 5 results
        }
      );

      if (result.success) {
        setSuccess(`Scraping completed! ${result.completedChunks}/${result.totalChunks} chunks processed`);
        if (onScrapingComplete) {
          onScrapingComplete();
        }
      } else {
        setError(result.error || 'Scraping failed');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsScraping(false);
    }
  };

  const pauseScraping = async () => {
    setIsScraping(false);
    setSuccess('Scraping paused. Click Resume to continue from current progress.');
  };

  const resumeScraping = async () => {
    if (progress) {
      // Resume from current chunk
      await startScraping();
    }
  };

  const resetScraping = async () => {
    // Reset all progress state
    setProgress(null);
    setRecentChunkResults([]);
    setError(null);
    setSuccess(null);
  };

  // Calculate success rate
  const overallSuccessRate = progress 
    ? progress.totalEpisodes > 0 
      ? Math.round((progress.completedEpisodes / progress.totalEpisodes) * 100)
      : 0
    : 0;

  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg overflow-hidden border border-white/20">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-2xl font-bold mb-1 flex items-center gap-2">
              <i className="ri-movie-2-line text-3xl"></i>
              Large Anime Scraper
            </h3>
            <p className="text-blue-100 text-sm">Batch scraping for large anime series</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{totalEpisodes}</div>
            <div className="text-blue-100 text-xs">episodes</div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Anime Info Card */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl p-5 border border-slate-200 shadow-sm"
        >
          <h4 className="font-bold text-slate-800 mb-4 text-lg flex items-center gap-2">
            <i className="ri-tv-2-line text-blue-500"></i>
            {animeTitle}
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/60 backdrop-blur-sm rounded-lg p-3 border border-blue-100">
              <div className="text-xs text-slate-600 mb-1">Total Episodes</div>
              <div className="text-xl font-bold text-blue-700">{totalEpisodes}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm rounded-lg p-3 border border-blue-100">
              <div className="text-xs text-slate-600 mb-1">Chunk Size</div>
              <div className="text-xl font-bold text-purple-700">{chunkSize}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm rounded-lg p-3 border border-blue-100">
              <div className="text-xs text-slate-600 mb-1">Total Chunks</div>
              <div className="text-xl font-bold text-indigo-700">{estimatedTime.totalChunks}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm rounded-lg p-3 border border-blue-100">
              <div className="text-xs text-slate-600 mb-1">Est. Time</div>
              <div className="text-lg font-bold text-green-700">
                {estimatedTime.estimatedDays > 1 
                  ? `${estimatedTime.estimatedDays} days`
                  : `${estimatedTime.estimatedHours} hours`
                }
              </div>
            </div>
          </div>
        </motion.div>

        {/* Chunk Size Configuration */}
        <AnimatePresence>
          {!isScraping && !progress && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-gradient-to-br from-slate-50 to-white rounded-xl p-5 border border-slate-200"
            >
              <label className="block text-sm font-semibold text-slate-700 mb-4">
                <i className="ri-settings-3-line mr-1"></i> Chunk Size Configuration
              </label>
              <div className="flex items-center space-x-4">
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gradient-to-r from-purple-200 to-blue-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                />
                <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg font-bold min-w-[4rem] text-center shadow-lg">
                  {chunkSize}
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-3 flex items-center gap-2">
                <i className="ri-lightbulb-line text-amber-500"></i>
                <span>Smaller chunks = more control, larger chunks = faster overall</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Progress Display */}
        <AnimatePresence>
          {progress && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-gradient-to-br from-green-50 via-blue-50 to-slate-50 rounded-xl p-6 border border-slate-200 shadow-lg"
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <i className="ri-bar-chart-box-line text-blue-500"></i>
                  Scraping Progress
                </h4>
                <div className="bg-white/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-green-200">
                  <div className="text-xs text-slate-600">Success Rate</div>
                  <div className="text-lg font-bold text-green-600">{overallSuccessRate}%</div>
                </div>
              </div>

              {/* Main Progress Bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-slate-700">Overall Progress</span>
                  <span className="text-sm font-bold text-slate-800">
                    {progress.completedEpisodes}/{progress.totalEpisodes} episodes
                  </span>
                </div>
                  <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden shadow-inner">
                  <motion.div
                    className="bg-gradient-to-r from-green-500 via-blue-500 to-purple-500 h-4 rounded-full shadow-lg"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress.progressPercentage}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <div className="flex justify-between text-xs text-slate-600 mt-2">
                  <span className="font-medium">{progress.progressPercentage}% complete</span>
                  <span className="font-semibold">ETA: {progress.estimatedTimeRemaining}</span>
                </div>
              </div>
              
              {/* Detailed Stats Grid */}
              <div className="grid grid-cols-3 gap-4 mt-6">
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="bg-white/80 backdrop-blur-sm rounded-xl p-4 text-center border border-green-200 shadow-md"
                >
                  <div className="text-3xl font-bold text-green-600 mb-1">
                    {progress.completedEpisodes}
                  </div>
                  <div className="text-xs text-slate-600 font-medium"><i className="ri-check-line mr-1"></i>Completed</div>
                </motion.div>
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white/80 backdrop-blur-sm rounded-xl p-4 text-center border border-red-200 shadow-md"
                >
                  <div className="text-3xl font-bold text-red-600 mb-1">
                    {progress.failedEpisodes}
                  </div>
                  <div className="text-xs text-slate-600 font-medium"><i className="ri-close-line mr-1"></i>Failed</div>
                </motion.div>
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-xl p-4 text-center border border-blue-200 shadow-md"
                >
                  <div className="text-3xl font-bold text-blue-600 mb-1">
                    {progress.currentChunk}/{progress.totalChunks}
                  </div>
                  <div className="text-xs text-slate-600 font-medium"><i className="ri-stack-line mr-1"></i>Chunks</div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent Chunk Results */}
        <AnimatePresence>
          {recentChunkResults.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-gradient-to-br from-slate-50 to-white rounded-xl p-5 border border-slate-200"
            >
              <h4 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <i className="ri-line-chart-line text-blue-500"></i>
                Recent Chunk Performance
              </h4>
              <div className="space-y-3">
                {recentChunkResults.map((result, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className={`bg-white rounded-lg p-4 border-2 shadow-sm ${
                      result.summary.successRate >= 80 
                        ? 'border-green-300 bg-green-50/50'
                        : result.summary.successRate >= 50
                        ? 'border-yellow-300 bg-yellow-50/50'
                        : 'border-red-300 bg-red-50/50'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          result.summary.successRate >= 80 
                            ? 'bg-green-500'
                            : result.summary.successRate >= 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`} />
                        <div>
                          <div className="font-semibold text-slate-800">
                            <i className="ri-check-line text-green-500 mr-1"></i>{result.summary.successCount} success • <i className="ri-close-line text-red-500 mr-1"></i>{result.summary.errorCount} failed
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Total: {result.summary.total} episodes
                          </div>
                        </div>
                      </div>
                      <div className={`px-4 py-2 rounded-lg font-bold text-sm shadow-md ${
                        result.summary.successRate >= 80 
                          ? 'bg-green-500 text-white'
                          : result.summary.successRate >= 50
                          ? 'bg-yellow-500 text-white'
                          : 'bg-red-500 text-white'
                      }`}>
                        {result.summary.successRate.toFixed(1)}%
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          {!isScraping && !progress && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={startScraping}
              className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <i className="ri-rocket-line text-xl"></i>
              Start Scraping
            </motion.button>
          )}

          {isScraping && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={pauseScraping}
              className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <i className="ri-pause-line text-xl"></i>
              Pause
            </motion.button>
          )}

          {progress && !isScraping && progress.status !== 'completed' && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={resumeScraping}
              className="bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <i className="ri-play-line text-xl"></i>
              Resume
            </motion.button>
          )}

          {(progress || recentChunkResults.length > 0) && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={resetScraping}
              className="bg-gradient-to-r from-slate-500 to-slate-600 hover:from-slate-600 hover:to-slate-700 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
            >
              <i className="ri-refresh-line text-xl"></i>
              Reset
            </motion.button>
          )}
        </div>

        {/* Status Messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-300 rounded-xl p-4 shadow-md"
            >
              <div className="flex items-center gap-3">
                <i className="ri-close-circle-line text-2xl text-red-500"></i>
                <div className="text-red-800 font-semibold">{error}</div>
              </div>
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-xl p-4 shadow-md"
            >
              <div className="flex items-center gap-3">
                <i className="ri-check-double-line text-2xl text-green-500"></i>
                <div className="text-green-800 font-semibold">{success}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warning Card */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-gradient-to-r from-yellow-50 via-amber-50 to-orange-50 border-2 border-yellow-300 rounded-xl p-5 shadow-md"
        >
          <div className="flex items-start gap-3">
            <i className="ri-alert-line text-3xl text-amber-500 mt-1"></i>
            <div>
              <div className="font-bold text-yellow-800 mb-2">Large Scraping Warning</div>
              <div className="text-yellow-800 text-sm leading-relaxed">
                This process will take a significant amount of time. For example, scraping One Piece 
                (1146 episodes) may take 6-12 hours depending on chunk size and network delays. 
                The process can be paused and resumed at any time. Make sure your server stays running 
                throughout the entire process.
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
