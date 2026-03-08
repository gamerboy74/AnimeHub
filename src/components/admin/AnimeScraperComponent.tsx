import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { HiAnimeScraperService } from '../../services/scrapers/hianime';
import { AdminAnimeService } from '../../services/admin/anime';
import { AnimeService } from '../../services/anime';
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

export const AnimeScraperComponent: React.FC = () => {
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

  // Load anime list on component mount
  useEffect(() => {
    console.log('🎯 AnimeScraperComponent mounted');
    loadAnimeList();
  }, []);

  // Log when selectedAnime changes
  useEffect(() => {
    console.log('🎬 Selected anime changed:', selectedAnime);
  }, [selectedAnime]);

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
      const result = await HiAnimeScraperService.scrapeAnimeEpisode(
        selectedAnime.title,
        selectedAnime.id,
        episodeNumber
      );

      setScrapeResult(result);
      
      if (result.success) {
        setSuccess(`Episode ${episodeNumber} scraped successfully!`);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Scraping failed');
        setTimeout(() => setError(null), 5000);
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
    setSuccess(null);
    setBatchResult(null);

    // Auto-create episode stubs if they don't exist yet
    try {
      await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
    } catch (stubErr) {
      console.warn('⚠️ Episode stub creation skipped:', stubErr);
    }

    try {
      const result = await HiAnimeScraperService.batchScrapeEpisodes(
        selectedAnime.title,
        selectedAnime.id,
        episodeNumbers,
        {
          headless: true,
          timeout: 30000,
          retries: 2,
          delayBetweenEpisodes: 3000
        }
      );

      if (result.success && result.results) {
        // Convert results to scraped episodes format for direct display
        const scrapedEpisodes = result.results
          .filter((r: any) => r.status === 'success')
          .map((r: any) => ({
            number: r.episode,
            title: r.title,
            streamUrl: r.url,
            embeddingProtected: r.embeddingProtected || false,
            embeddingReason: r.embeddingReason || null,
            scrapedAt: r.scrapedAt || new Date().toISOString(),
            isExisting: existingEpisodes.has(r.episode)
          }));

        // Show episodes directly in results (no modal)
        setCurrentScrapedEpisodes(scrapedEpisodes);
        
        setSuccess(`Batch scraping completed: ${scrapedEpisodes.length}/${episodeNumbers.length} episodes scraped successfully!`);
        setTimeout(() => setSuccess(null), 5000);
      } else {
        setError((result as any).error || 'Batch scraping failed');
        setTimeout(() => setError(null), 5000);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScrapeAllEpisodes = async () => {
    console.log('🔥 handleScrapeAllEpisodes called!', { selectedAnime });
    
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

    // Generate episode numbers array
    const totalEpisodes = selectedAnime.total_episodes || 13;
    const episodeNumbers = Array.from({ length: totalEpisodes }, (_, i) => i + 1);

    // Auto-create episode stubs if they don't exist yet
    try {
      setProgressMessages(prev => [...prev, '📺 Ensuring episode stubs exist in database...']);
      const stubResult = await AnimeImporterService.fetchEpisodesForExistingAnime(selectedAnime.id);
      setProgressMessages(prev => [...prev, `📺 Episode stubs: ${stubResult.created} created, ${stubResult.skipped} already existed`]);
    } catch (stubErr) {
      console.warn('⚠️ Episode stub creation skipped (no MAL ID or API error):', stubErr);
      setProgressMessages(prev => [...prev, '⚠️ Stub creation skipped — will scrape anyway']);
    }
    
    // Initialize all episodes as pending
    const initialStatuses: Record<number, { status: 'pending' }> = {};
    episodeNumbers.forEach(ep => {
      initialStatuses[ep] = { status: 'pending' };
    });
    setEpisodeStatuses(initialStatuses);

    // Collections for scraped and failed episodes
    const scrapedEpisodes: Array<{
      number: number;
      title: string;
      streamUrl: string;
      embeddingProtected: boolean;
      embeddingReason?: string;
      scrapedAt: string;
    }> = [];
    
    const failedEpisodes: Array<{
      number: number;
      title: string;
      error: string;
    }> = [];

    console.log('📋 Episode numbers generated:', episodeNumbers);
    console.log('🌐 API URL:', import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001');

    try {
      console.log('🚀 Starting batch scrape for:', selectedAnime.title, 'Episodes:', episodeNumbers);
      console.log('📞 Calling batchScrapeEpisodesWithProgress...');
      
      await HiAnimeScraperService.batchScrapeEpisodesWithProgress(
        selectedAnime.title,
        selectedAnime.id,
        episodeNumbers,
        (event) => {
          console.log('📊 Progress event received:', event);
          
          // Handle progress updates
          switch (event.type) {
            case 'start':
              console.log('🎬 START event - setting progress messages');
              setCurrentProgress({
                current: 0,
                total: event.total || 0,
                successCount: 0,
                errorCount: 0
              });
              break;
            
            case 'progress':
              console.log('📺 PROGRESS event - episode', event.episode, 'scraping');
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'scraping' }
              }));
              break;
            
            case 'success':
              console.log('✅ SUCCESS event - episode', event.episode);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'success', message: 'Scraped successfully' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                successCount: prev.successCount + 1
              } : null);
              
              // Collect successful episode
              if (event.episode && event.url) {
                scrapedEpisodes.push({
                  number: event.episode,
                  title: event.title || `Episode ${event.episode}`,
                  streamUrl: event.url,
                  embeddingProtected: (event as any).embeddingProtected || false,
                  embeddingReason: (event as any).embeddingReason || undefined,
                  scrapedAt: new Date().toISOString()
                });
              }
              break;
            
            case 'error':
              console.log('❌ ERROR event - episode', event.episode);
              setEpisodeStatuses(prev => ({
                ...prev,
                [event.episode!]: { status: 'error', message: event.error || 'Failed' }
              }));
              setCurrentProgress(prev => prev ? {
                ...prev,
                current: event.current || prev.current,
                errorCount: prev.errorCount + 1
              } : null);
              
              // Collect failed episode
              if (event.episode) {
                failedEpisodes.push({
                  number: event.episode,
                  title: `Episode ${event.episode}`,
                  error: event.error || 'Unknown error'
                });
              }
              break;
            
            case 'complete':
              console.log('🎉 COMPLETE event');
              
              // Prepare data for modal
              const summary = {
                total: event.total || episodeNumbers.length,
                successful: scrapedEpisodes.length,
                failed: failedEpisodes.length,
                embeddingProtected: scrapedEpisodes.filter(ep => ep.embeddingProtected).length
              };
              
              // Show modal with scraped episodes
              setScrapedEpisodesData({
                scrapedEpisodes,
                failedEpisodes,
                summary
              });
              setShowScrapedEpisodes(true);
              
              setSuccess(`Scraped ${scrapedEpisodes.length} out of ${event.total || episodeNumbers.length} episodes!`);
              setTimeout(() => setSuccess(null), 5000);
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
      
      console.log('✅ Batch scrape completed successfully!');
    } catch (error) {
      console.error('❌ Error during batch scrape:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setTimeout(() => setError(null), 5000);
    } finally {
      console.log('🏁 Finally block - setting isLoading to false');
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
            description: `Scraped from HiAnime`,
            isPremium: false
          }
        })
      });

      const result = await response.json();
      
      if (result.success) {
        // Update episode status
        setCurrentScrapedEpisodes(prev => 
          prev.map(ep => 
            ep.number === episode.number 
              ? { ...ep, isExisting: true, addedAt: new Date().toISOString() }
              : ep
          )
        );
        
        // Update existing episodes set
        setExistingEpisodes(prev => new Set([...prev, episode.number]));
        
        // Update counter
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
        <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2 flex items-center justify-center gap-3">
          <i className="ri-movie-2-line text-blue-600 text-3xl"></i>
          Anime Episode Scraper
        </h2>
        <p className="text-slate-500 text-sm">
          Scrape episodes from 9anime.org.lv for your anime collection
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
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <i className="ri-tv-2-line text-white text-sm"></i>
          </div>
          Select Anime
        </h3>
        
        <div className="space-y-4">
          {/* Search Input */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              <i className="ri-search-line mr-1 text-slate-400"></i> Search Anime
            </label>
            <Input
              type="text"
              placeholder="Type anime name to search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
          </div>

          {/* Selected Anime Display */}
          {selectedAnime && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/60 rounded-xl p-4"
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
                    <span className="inline-flex items-center text-xs font-medium bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full">
                      <i className="ri-play-circle-line mr-1"></i>{selectedAnime.total_episodes} episodes
                    </span>
                    <span className="inline-flex items-center text-xs font-medium bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                      {selectedAnime.status}
                    </span>
                  </div>
                </div>
                <div className="text-blue-500">
                  <i className="ri-checkbox-circle-fill text-2xl"></i>
                </div>
              </div>
            </motion.div>
          )}

          {/* Anime List */}
          <div className="max-h-60 overflow-y-auto border border-slate-200/60 rounded-xl bg-white/50">
            {isLoading ? (
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
                    whileHover={{ backgroundColor: 'rgba(59, 130, 246, 0.04)' }}
                    className={`p-3 cursor-pointer transition-all duration-150 ${
                      selectedAnime?.id === anime.id ? 'bg-blue-50/80 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'
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
                        <i className="ri-check-line text-blue-500 text-lg"></i>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Scraping Options */}
      {selectedAnime && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6"
        >
          <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <i className="ri-crosshair-2-line text-white text-sm"></i>
            </div>
            Scraping Options
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Single Episode */}
            <div className="bg-gradient-to-br from-slate-50 to-blue-50/50 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-blue-100 flex items-center justify-center">
                  <i className="ri-movie-2-line text-blue-600 text-sm"></i>
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
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-movie-2-line mr-1"></i> Scrape Episode</>}
              </Button>
            </div>

            {/* Batch Episodes */}
            <div className="bg-gradient-to-br from-slate-50 to-purple-50/50 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-purple-100 flex items-center justify-center">
                  <i className="ri-stack-line text-purple-600 text-sm"></i>
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
                className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-stack-line mr-1"></i> Batch Scrape</>}
              </Button>
            </div>

            {/* All Episodes */}
            <div className="bg-gradient-to-br from-slate-50 to-green-50/50 rounded-xl p-5 border border-slate-200/60 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-7 h-7 rounded-md bg-green-100 flex items-center justify-center">
                  <i className="ri-rocket-line text-green-600 text-sm"></i>
                </div>
                <h4 className="font-semibold text-slate-700 text-sm">All Episodes</h4>
              </div>
              <div className="text-sm text-slate-500 py-2.5 px-3 bg-white/60 rounded-xl border border-slate-100">
                <i className="ri-play-circle-line mr-1"></i> Scrape all {selectedAnime.total_episodes} episodes
              </div>
              <Button
                onClick={handleScrapeAllEpisodes}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-green-600 to-teal-600 hover:from-green-700 hover:to-teal-700 text-white rounded-xl font-medium shadow-md hover:shadow-lg transition-all"
              >
                {isLoading ? <SparkleLoadingSpinner size="sm" /> : <><i className="ri-rocket-line mr-1"></i> Scrape All</>}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Progress Messages Display - STANDALONE */}
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
                  className={`p-3 rounded-xl border transition-all ${bgColor} ${
                    status.status === 'scraping' ? 'animate-pulse shadow-md' : ''
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
              className="text-slate-500 hover:text-slate-700 rounded-xl border border-slate-200 hover:border-slate-300"
            >
              <i className="ri-close-line mr-1"></i>
              Clear
            </Button>
          </div>
          
          {success && (
            <div className="border-l-4 border-green-500 bg-green-50/80 rounded-r-xl p-4 mb-4">
              <div className="flex items-center">
                <i className="ri-checkbox-circle-line text-green-600 text-xl mr-3"></i>
                <span className="text-green-800 font-medium text-sm">{success}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="border-l-4 border-red-500 bg-red-50/80 rounded-r-xl p-4 mb-4">
              <div className="flex items-center">
                <i className="ri-error-warning-line text-red-600 text-xl mr-3"></i>
                <span className="text-red-800 font-medium text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* Single Episode Result */}
          {scrapeResult && (
            <div className="space-y-3 mb-4">
              <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                <i className="ri-movie-2-line text-blue-500"></i> Single Episode Result
              </h4>
              <div className={`p-4 rounded-xl ${
                scrapeResult.success ? 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200/60' : 'bg-gradient-to-r from-red-50 to-rose-50 border border-red-200/60'
              }`}>
                {scrapeResult.success ? (
                  <div>
                    <p className="text-green-800 font-semibold text-sm"><i className="ri-check-double-line mr-1"></i>Episode scraped successfully!</p>
                    <p className="text-xs text-green-600/80 mt-1 font-mono">
                      {scrapeResult.streamUrl?.substring(0, 60)}...
                    </p>
                    <div className="mt-2 text-xs text-slate-500 flex items-center gap-3">
                      <span>Episode {episodeNumber}</span>
                      <span>•</span>
                      <span>{selectedAnime?.title}</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-red-800 font-semibold text-sm"><i className="ri-close-circle-line mr-1"></i>{scrapeResult.error}</p>
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

          {/* Batch Result */}
          {batchResult && (
            <div className="space-y-3 mb-4">
              <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                <i className="ri-stack-line text-blue-500"></i> Batch Scraping Result
              </h4>
              <div className="bg-gradient-to-br from-blue-50/80 to-indigo-50/50 border border-blue-200/50 rounded-xl p-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <div className="text-center bg-white/70 rounded-xl p-3 border border-blue-100">
                    <div className="text-2xl font-bold text-blue-600">{batchResult.summary.totalEpisodes}</div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">Total</div>
                  </div>
                  <div className="text-center bg-white/70 rounded-xl p-3 border border-green-100">
                    <div className="text-2xl font-bold text-green-600">{batchResult.summary.successCount}</div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">Success</div>
                  </div>
                  <div className="text-center bg-white/70 rounded-xl p-3 border border-red-100">
                    <div className="text-2xl font-bold text-red-500">{batchResult.summary.errorCount}</div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">Failed</div>
                  </div>
                  <div className="text-center bg-white/70 rounded-xl p-3 border border-purple-100">
                    <div className="text-2xl font-bold text-purple-600">{batchResult.summary.successRate.toFixed(1)}%</div>
                    <div className="text-xs text-slate-500 font-medium mt-0.5">Rate</div>
                  </div>
                </div>
                
                <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                  <span><strong>Range:</strong> {episodeRange}</span>
                  <span>•</span>
                  <span><strong>Anime:</strong> {selectedAnime?.title}</span>
                  <span>•</span>
                  <span>{new Date().toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* Scraped Episodes List */}
          {currentScrapedEpisodes.length > 0 && (
            <div className="space-y-3 mb-4">
              <h4 className="font-semibold text-slate-700 text-sm flex items-center gap-1.5">
                <i className="ri-play-list-line text-blue-500"></i> Scraped Episodes
              </h4>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {currentScrapedEpisodes.map((episode) => (
                  <div key={episode.number} className={`p-3.5 rounded-xl border transition-all ${
                    episode.isExisting 
                      ? 'bg-slate-50/80 border-slate-200/60' 
                      : 'bg-blue-50/60 border-blue-200/50 hover:border-blue-300/60'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-sm text-slate-800 bg-white/60 px-2 py-0.5 rounded-md">
                            EP {episode.number}
                          </span>
                          <span className="text-sm text-slate-600 truncate">
                            {episode.title}
                          </span>
                          {episode.embeddingProtected && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                              <i className="ri-shield-line mr-0.5"></i>Protected
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1 font-mono truncate">
                          {episode.streamUrl?.substring(0, 60)}...
                        </div>
                      </div>
                      <div className="ml-3 flex-shrink-0">
                        {episode.isExisting ? (
                          <div className="flex items-center gap-1 text-green-600 bg-green-50 px-2.5 py-1 rounded-lg">
                            <i className="ri-check-double-line text-sm"></i>
                            <span className="text-xs font-semibold">Added</span>
                          </div>
                        ) : (
                          <Button
                            onClick={() => handleAddEpisode(episode)}
                            size="sm"
                            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg text-xs shadow-sm"
                          >
                            <i className="ri-add-line mr-1"></i>Add
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Episodes Added Summary */}
          {episodesAddedCount > 0 && (
            <div className="border-l-4 border-green-500 bg-gradient-to-r from-green-50 to-emerald-50 rounded-r-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                  <i className="ri-check-double-line text-green-600 text-lg"></i>
                </div>
                <div>
                  <p className="text-green-800 font-semibold text-sm">
                    {episodesAddedCount} episodes added to database
                  </p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {selectedAnime?.title}
                  </p>
                </div>
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
          How to Use
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { step: '1', icon: 'ri-search-line', text: 'Search & select your anime' },
            { step: '2', icon: 'ri-list-settings-line', text: 'Choose scraping method' },
            { step: '3', icon: 'ri-loader-4-line', text: 'Click scrape and wait for results' },
            { step: '4', icon: 'ri-database-2-line', text: 'Review and add episodes to database' },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3 text-sm text-slate-600">
              <div className="w-7 h-7 rounded-lg bg-white/80 border border-blue-200/50 flex items-center justify-center flex-shrink-0">
                <i className={`${item.icon} text-blue-500 text-xs`}></i>
              </div>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* Scraped Episodes Modal */}
      {showScrapedEpisodes && scrapedEpisodesData && selectedAnime && (
        <ScrapedEpisodesModal
          isOpen={showScrapedEpisodes}
          onClose={handleCloseScrapedEpisodes}
          animeId={selectedAnime.id}
          animeTitle={selectedAnime.title}
          scrapedEpisodes={scrapedEpisodesData.scrapedEpisodes || []}
          failedEpisodes={scrapedEpisodesData.failedEpisodes || []}
          summary={scrapedEpisodesData.summary || { 
            total: 0, 
            successful: scrapedEpisodesData.scrapedEpisodes?.length || 0, 
            failed: scrapedEpisodesData.failedEpisodes?.length || 0, 
            embeddingProtected: scrapedEpisodesData.scrapedEpisodes?.filter((ep: any) => ep.embeddingProtected).length || 0 
          }}
          onEpisodesAdded={() => {
            handleCloseScrapedEpisodes();
            setSuccess('Episodes added successfully!');
            setTimeout(() => setSuccess(null), 5000);
            // Invalidate caches so other pages reflect new episodes
            if (selectedAnime) {
              queryClient.invalidateQueries({ queryKey: ['anime', 'byId', selectedAnime.id] });
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
