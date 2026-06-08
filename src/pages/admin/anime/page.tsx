import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { AdminService } from '../../../services/admin';
import { AdminAnimeService } from '../../../services/admin/anime';
import { invalidateAnimeCaches } from '../../../utils/cache/invalidateAnimeCaches';
import AddAnimeModal from '../../../components/admin/AddAnimeModal';
import AddEpisodeModal from '../../../components/admin/AddEpisodeModal';
import ConfirmationDialog from '../../../components/admin/ConfirmationDialog';
import EditAnimeModal from '../../../components/admin/EditAnimeModal';
import EditEpisodeModal from '../../../components/admin/EditEpisodeModal';
import { EnhancedAnimeImporter } from '../../../components/admin/EnhancedAnimeImporter';
import { NineAnimeScraperComponent } from '../../../components/admin/NineAnimeScraperComponent';
import { ReAnimeScraperComponent } from '../../../components/admin/ReAnimeScraperComponent';
import { SanjiAnimeScraperComponent } from '../../../components/admin/SanjiAnimeScraperComponent';
import { AnimeSugeScraperComponent } from '../../../components/admin/AnimeSugeScraperComponent';
import { ScrapedEpisodesModal } from '../../../components/admin/ScrapedEpisodesModal';
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner';
import { supabase } from '../../../lib/database/supabase';
import LargeAnimeScraper from '../../../components/admin/LargeAnimeScraper';

export default function AnimeManagement() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (
        e.key === '/' &&
        document.activeElement !== searchInputRef.current &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const [anime, setAnime] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalAnime, setTotalAnime] = useState(0);
  const [globalPublishedCount, setGlobalPublishedCount] = useState(0);
  const [globalOngoingCount, setGlobalOngoingCount] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterGenre, setFilterGenre] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [searchInputValue, setSearchInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [availableGenres, setAvailableGenres] = useState<string[]>([
    'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mystery',
    'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
  ]);
  const [selectedAnime, setSelectedAnime] = useState<Set<string>>(new Set());
  const [updatingAnime, setUpdatingAnime] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAnimeModal, setShowAnimeModal] = useState(false);
  const [selectedAnimeForModal, setSelectedAnimeForModal] = useState<any>(null);
  const [animeAnalytics, setAnimeAnalytics] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showAddAnimeModal, setShowAddAnimeModal] = useState(false);
  const [showAddEpisodeModal, setShowAddEpisodeModal] = useState(false);
  const [selectedAnimeForEpisode, setSelectedAnimeForEpisode] = useState<any>(null);
  const [animeEpisodes, setAnimeEpisodes] = useState<any[]>([]);
  const [episodesCache, setEpisodesCache] = useState<Record<string, any[]>>({});
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodePage, setEpisodePage] = useState(1);
  const [preloadedAnime, setPreloadedAnime] = useState<Set<string>>(new Set());
  const [preloadQueue, setPreloadQueue] = useState<string[]>([]);
  const [editingEpisode, setEditingEpisode] = useState<string | null>(null);
  const [showConfirmationDialog, setShowConfirmationDialog] = useState(false);
  const [confirmationConfig, setConfirmationConfig] = useState<any>(null);
  const [showEditEpisodeModal, setShowEditEpisodeModal] = useState(false);
  const [selectedEpisodeForEdit, setSelectedEpisodeForEdit] = useState<any>(null);
  const [showEditAnimeModal, setShowEditAnimeModal] = useState(false);
  const [selectedAnimeForEdit, setSelectedAnimeForEdit] = useState<any>(null);
  const [showImporter, setShowImporter] = useState(false);
  const [showScraper, setShowScraper] = useState(false);
  const [activeScraperTab, setActiveScraperTab] = useState<'9anime' | 'reanime' | 'sanjianime' | 'animesuge'>('9anime');
  const [showScrapedEpisodesModal, setShowScrapedEpisodesModal] = useState(false);
  const [scrapedEpisodes, setScrapedEpisodes] = useState<any[]>([]);
  const [failedEpisodes, setFailedEpisodes] = useState<any[]>([]);
  const [scrapingSummary, setScrapingSummary] = useState<any>(null);
  const [selectedAnimeForScraping, setSelectedAnimeForScraping] = useState<any>(null);
  const [showLargeScraper, setShowLargeScraper] = useState(false);
  const [selectedAnimeForLargeScraping, setSelectedAnimeForLargeScraping] = useState<any>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Load genres dynamically from database
  useEffect(() => {
    const loadGenres = async () => {
      try {
        const dbGenres = await AdminAnimeService.getAvailableGenres();
        if (dbGenres && dbGenres.length > 0) {
          setAvailableGenres(dbGenres);
        }
      } catch (err) {
        console.error('Failed to load genres:', err);
      }
    };
    loadGenres();
  }, []);

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch (err) {
      console.error('Failed to copy ID:', err);
    }
  };

  const fetchAnime = async (
    page: number = 1,
    currentSearch: string = searchTerm,
    currentStatus: string = filterStatus,
    currentGenre: string = filterGenre,
    currentType: string = filterType,
    currentSortBy: string = sortBy,
    currentSortOrder: 'asc' | 'desc' = sortOrder
  ) => {
    try {
      setLoading(true);
      setError(null);
      setSuccessMessage(null);

      const [result, publishedRes, ongoingRes] = await Promise.all([
        AdminService.getAllAnime(page, 20, {
          search: currentSearch,
          status: currentStatus,
          genre: currentGenre,
          type: currentType,
          sortBy: currentSortBy,
          sortOrder: currentSortOrder
        }),
        supabase.from('anime').select('id', { count: 'exact', head: true }).in('status', ['published', 'ongoing', 'completed', 'upcoming']),
        supabase.from('anime').select('id', { count: 'exact', head: true }).eq('status', 'ongoing')
      ]);
      setAnime(result.anime);
      setTotalAnime(result.total);
      setGlobalPublishedCount(publishedRes.count || 0);
      setGlobalOngoingCount(ongoingRes.count || 0);
      setCurrentPage(page);

      // Start preloading episodes for visible anime using queue system
      setTimeout(() => {
        if (result.anime.length > 0) {
          const visibleAnime = result.anime.slice(0, 3);
          const animeToPreload = visibleAnime
            .map(animeItem => animeItem.id)
            .filter(id => !episodesCache[id] && !preloadedAnime.has(id));

          // Add to preload queue
          setPreloadQueue(prev => [...prev, ...animeToPreload]);
        }
      }, 300); // Reduced initial delay

    } catch (err) {
      console.error('Failed to fetch anime:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch anime');
    } finally {
      setLoading(false);
    }
  };

  // Process preload queue with rate limiting
  useEffect(() => {
    if (preloadQueue.length > 0) {
      const processQueue = async () => {
        const animeId = preloadQueue[0];
        if (animeId && !episodesCache[animeId] && !preloadedAnime.has(animeId)) {
          await preloadEpisodes(animeId);
        }

        // Remove processed item and continue
        setPreloadQueue(prev => prev.slice(1));
      };

      // Process one item every 300ms
      const timer = setTimeout(processQueue, 300);
      return () => clearTimeout(timer);
    }
  }, [preloadQueue, episodesCache, preloadedAnime]);

  // Debounce search input only
  useEffect(() => {
    if (searchInputValue !== searchTerm) {
      setIsTyping(true);
    }
    const handler = setTimeout(() => {
      setSearchTerm(searchInputValue);
      setIsTyping(false);
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInputValue]);

  // Fetch anime whenever any filter or search term changes
  useEffect(() => {
    fetchAnime(1, searchTerm, filterStatus, filterGenre, filterType, sortBy, sortOrder);
  }, [searchTerm, filterStatus, filterGenre, filterType, sortBy, sortOrder]);

  const handleStatusChange = async (animeId: string, newStatus: 'published' | 'pending' | 'draft') => {
    const previousAnimeList = [...anime];

    try {
      setUpdatingAnime(animeId);
      setError(null);
      setSuccessMessage(null);

      // Optimistic UI Update: Toggle status instantly in local state
      setAnime(prev => prev.map(item => {
        if (item.id === animeId) {
          return { ...item, status: newStatus };
        }
        return item;
      }));

      await AdminService.updateAnimeStatus(animeId, newStatus);

      // Silent cache invalidation in the background
      invalidateAnimeCaches(queryClient, animeId);

      setSuccessMessage(`Anime status updated to ${newStatus} successfully!`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to update anime status:', err);
      // Revert status to previous value on server failure
      setAnime(previousAnimeList);
      setError(err instanceof Error ? err.message : 'Failed to update anime status');
    } finally {
      setUpdatingAnime(null);
    }
  };

  const handleDeleteAnime = (animeId: string, animeTitle: string) => {
    setConfirmationConfig({
      title: 'Delete Anime',
      message: `Are you sure you want to delete "${animeTitle}"? This will permanently delete:
      
• All episodes and their data
• All user reviews and ratings
• All user watch progress and favorites
• All content reports
• The anime itself

This action cannot be undone.`,
      confirmText: 'Delete Anime',
      type: 'danger',
      onConfirm: async () => {
        try {
          setUpdatingAnime(animeId);
          setError(null);
          setSuccessMessage(null);

          await AdminService.deleteAnime(animeId);

          // Invalidate React Query cache for all anime-related queries
          await invalidateAnimeCaches(queryClient, animeId);

          await fetchAnime(currentPage);

          setSuccessMessage(`Anime "${animeTitle}" deleted successfully!`);
          setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
          console.error('Failed to delete anime:', err);
          setError(err instanceof Error ? err.message : 'Failed to delete anime');
        } finally {
          setUpdatingAnime(null);
          setShowConfirmationDialog(false);
        }
      }
    });
    setShowConfirmationDialog(true);
  };

  const handleBulkAction = async (action: 'published' | 'pending' | 'draft' | 'delete') => {
    const selectedIds = Array.from(selectedAnime);

    if (selectedIds.length === 0) return;

    const previousAnimeList = [...anime];

    try {
      setUpdatingAnime('bulk');
      setError(null);
      setSuccessMessage(null);

      if (action === 'delete') {
        setConfirmationConfig({
          title: 'Delete Multiple Anime',
          message: `Are you sure you want to delete ${selectedIds.length} anime? This will permanently delete:

• All episodes and their data for each anime
• All user reviews and ratings
• All user watch progress and favorites
• All content reports
• The anime themselves

This action cannot be undone.`,
          confirmText: `Delete ${selectedIds.length} Anime`,
          type: 'danger',
          onConfirm: async () => {
            await AdminService.bulkDeleteAnime(selectedIds);

            // Invalidate React Query cache for all anime-related queries
            await invalidateAnimeCaches(queryClient);

            setSuccessMessage(`${selectedIds.length} anime deleted successfully!`);
            await fetchAnime(currentPage);
            setSelectedAnime(new Set());
            setShowConfirmationDialog(false);
          }
        });
        setShowConfirmationDialog(true);
        return;
      } else {
        // Optimistic UI Update: Toggle status instantly in local state
        setAnime(prev => prev.map(item => {
          if (selectedIds.includes(item.id)) {
            return { ...item, status: action };
          }
          return item;
        }));
        setSelectedAnime(new Set()); // Clear selection list immediately

        await AdminService.bulkUpdateAnimeStatus(selectedIds, action);

        // Invalidate caches silently in the background
        invalidateAnimeCaches(queryClient);
        setSuccessMessage(`${selectedIds.length} anime status updated to ${action}!`);
      }

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Failed to perform bulk action:', err);
      // Revert status to previous values on server failure
      setAnime(previousAnimeList);
      setError(err instanceof Error ? err.message : 'Failed to perform bulk action');
    } finally {
      setUpdatingAnime(null);
    }
  };

  const closeAnimeModal = () => {
    setShowAnimeModal(false);
    setSelectedAnimeForModal(null);
    setAnimeAnalytics(null);
    setAnimeEpisodes([]); // Clear episodes when modal closes
    setEpisodePage(1); // Reset episode page
    setCopiedId(false);
  };

  const handleAnimeCreated = async (_newAnime?: any) => {
    setShowAddAnimeModal(false);
    // Invalidate all anime query caches so home/browse pages update
    await invalidateAnimeCaches(queryClient);
    // Force refresh - go to page 1 since new anime will be there (sorted by created_at desc)
    await fetchAnime(1);
    setCurrentPage(1);
    setSuccessMessage('Anime created successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleAnimeImported = async () => {
    // Invalidate React Query cache for all anime-related queries
    await invalidateAnimeCaches(queryClient);
    // Refresh the current page
    await fetchAnime(currentPage);
    setSuccessMessage('Anime imported successfully! List refreshed.');
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  const handleEpisodeCreated = async (_newEpisode?: any) => {
    setShowAddEpisodeModal(false);
    setSelectedAnimeForEpisode(null);

    // Invalidate TQ caches for episode-related data
    await invalidateAnimeCaches(queryClient, selectedAnimeForModal?.id);

    // Refresh anime list to update episode counts
    await fetchAnime(currentPage);

    // If anime modal is open, refresh its episodes
    if (selectedAnimeForModal) {
      // Clear cache first
      setEpisodesCache(prev => {
        const updated = { ...prev };
        delete updated[selectedAnimeForModal.id];
        return updated;
      });
      // Force reload episodes (bypass cache)
      await fetchAnimeEpisodes(selectedAnimeForModal.id, true);
    }

    setSuccessMessage('Episode created successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleAddEpisode = (anime: any) => {
    setSelectedAnimeForEpisode(anime);
    setShowAddEpisodeModal(true);
  };

  const fetchAnimeEpisodes = async (animeId: string, forceRefresh: boolean = false) => {
    try {
      // Check cache first for instant loading (unless force refresh)
      if (!forceRefresh && episodesCache[animeId]) {
        setAnimeEpisodes(episodesCache[animeId]);
        return;
      }

      // Show loading only when fetching from database
      setEpisodesLoading(true);

      // Load episodes from database
      const episodes = await AdminService.getAnimeEpisodes(animeId);
      setAnimeEpisodes(episodes);

      // Cache the episodes for future use
      setEpisodesCache(prev => ({ ...prev, [animeId]: episodes }));
    } catch (err) {
      console.error('Failed to fetch episodes:', err);
      setError('Failed to fetch episodes');
    } finally {
      setEpisodesLoading(false);
    }
  };

  // Background preloading function (no UI loading state)
  const preloadEpisodes = async (animeId: string) => {
    try {
      // Skip if already cached or currently loading
      if (episodesCache[animeId] || preloadedAnime.has(animeId)) {
        return;
      }

      setPreloadedAnime(prev => new Set(prev).add(animeId));

      // Load episodes silently in background with timeout
      const episodesPromise = AdminService.getAnimeEpisodes(animeId);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );

      const episodes = await Promise.race([episodesPromise, timeoutPromise]) as any[];

      // Cache the episodes for instant future access
      setEpisodesCache(prev => ({ ...prev, [animeId]: episodes }));

      console.log(`✅ Preloaded ${episodes.length} episodes for anime ${animeId}`);
    } catch (err) {
      console.error(`Failed to preload episodes for ${animeId}:`, err);
      // Remove from preloaded set on error so it can be retried
      setPreloadedAnime(prev => {
        const newSet = new Set(prev);
        newSet.delete(animeId);
        return newSet;
      });
    }
  };

  const handleDeleteEpisode = (episodeId: string, episodeTitle: string) => {
    setConfirmationConfig({
      title: 'Delete Episode',
      message: `Are you sure you want to delete "${episodeTitle}"? This action cannot be undone and will also delete all associated user progress and reviews.`,
      confirmText: 'Delete Episode',
      type: 'danger',
      onConfirm: async () => {
        try {
          setEditingEpisode(episodeId);
          await AdminService.deleteEpisode(episodeId);
          await fetchAnimeEpisodes(selectedAnimeForModal.id);
          // Clear cache to force refresh
          setEpisodesCache(prev => ({ ...prev, [selectedAnimeForModal.id]: undefined }));
          setSuccessMessage(`Episode "${episodeTitle}" deleted successfully!`);
          setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
          console.error('Failed to delete episode:', err);
          setError('Failed to delete episode');
        } finally {
          setEditingEpisode(null);
          setShowConfirmationDialog(false);
        }
      }
    });
    setShowConfirmationDialog(true);
  };

  const handleEditEpisode = (episode: any) => {
    setSelectedEpisodeForEdit(episode);
    setShowEditEpisodeModal(true);
  };

  const handleEpisodeUpdated = async () => {
    setShowEditEpisodeModal(false);
    setSelectedEpisodeForEdit(null);
    if (selectedAnimeForModal) {
      // Clear cache and force refresh
      setEpisodesCache(prev => {
        const updated = { ...prev };
        delete updated[selectedAnimeForModal.id];
        return updated;
      });
      await fetchAnimeEpisodes(selectedAnimeForModal.id, true); // Force refresh
    }
    // Also refresh anime list to update episode counts
    await fetchAnime(currentPage);
    setSuccessMessage('Episode updated successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleEditAnime = (anime: any) => {
    setSelectedAnimeForEdit(anime);
    setShowEditAnimeModal(true);
  };

  const handleAnimeUpdated = async () => {
    setShowEditAnimeModal(false);
    setSelectedAnimeForEdit(null);
    // Force refresh anime list
    await fetchAnime(currentPage);
    // If anime modal is open, refresh it too
    if (selectedAnimeForModal) {
      // Clear episodes cache for this anime
      setEpisodesCache(prev => {
        const updated = { ...prev };
        delete updated[selectedAnimeForModal.id];
        return updated;
      });
      // Refresh episodes if modal is open
      await fetchAnimeEpisodes(selectedAnimeForModal.id, true);
    }
    setSuccessMessage('Anime updated successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleCloseLargeScraper = async () => {
    setShowLargeScraper(false);
    setSelectedAnimeForLargeScraping(null);
    // Refresh the anime list to show updated episode count
    await fetchAnime(currentPage);
    // If anime modal is open, refresh its episodes too
    if (selectedAnimeForModal) {
      setEpisodesCache(prev => {
        const updated = { ...prev };
        delete updated[selectedAnimeForModal.id];
        return updated;
      });
      await fetchAnimeEpisodes(selectedAnimeForModal.id, true);
    }
  };

  const handleCloseScrapedEpisodesModal = async () => {
    setShowScrapedEpisodesModal(false);
    setScrapedEpisodes([]);
    setFailedEpisodes([]);
    setScrapingSummary(null);
    setSelectedAnimeForScraping(null);
    // Refresh the anime list to show updated episode count
    await fetchAnime(currentPage);
    // If anime modal is open, refresh its episodes too
    if (selectedAnimeForModal) {
      setEpisodesCache(prev => {
        const updated = { ...prev };
        delete updated[selectedAnimeForModal.id];
        return updated;
      });
      await fetchAnimeEpisodes(selectedAnimeForModal.id, true);
    }
  };

  const handleViewAnimeDetails = async (anime: any) => {
    setSelectedAnimeForModal(anime);
    setShowAnimeModal(true);
    setEpisodePage(1); // Reset episode page

    // Use preloaded episodes if available, otherwise clear episodes
    if (episodesCache[anime.id]) {
      setAnimeEpisodes(episodesCache[anime.id]);
    } else {
      setAnimeEpisodes([]);
    }

    setAnalyticsLoading(true);

    try {
      // Fetch detailed analytics
      const analytics = await AdminService.getAnimeAnalytics(anime.id);
      setAnimeAnalytics(analytics);

      // Only fetch episodes if not already cached
      if (!episodesCache[anime.id]) {
        fetchAnimeEpisodes(anime.id);
      }
    } catch (err) {
      console.error('Failed to fetch anime analytics:', err);
      setError('Failed to fetch anime details');
    } finally {
      setAnalyticsLoading(false);
    }
  };



  const EPISODES_PER_PAGE = 24;
  const totalEpisodePages = Math.ceil(animeEpisodes.length / EPISODES_PER_PAGE);
  const safeEpisodePage = Math.min(episodePage, totalEpisodePages || 1);
  const episodeStartIndex = (safeEpisodePage - 1) * EPISODES_PER_PAGE;
  const paginatedEpisodes = animeEpisodes.slice(episodeStartIndex, episodeStartIndex + EPISODES_PER_PAGE);

  const totalPages = Math.ceil(totalAnime / 20);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-green-100 text-green-800 border-green-200';
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'draft': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'published': return <i className="ri-check-line text-emerald-600"></i>;
      case 'pending': return <i className="ri-time-line text-amber-600"></i>;
      case 'draft': return <i className="ri-edit-line text-slate-500"></i>;
      default: return <i className="ri-file-line text-slate-400"></i>;
    }
  };

  const getGenreIcon = (genre: string) => {
    switch (genre.toLowerCase()) {
      case 'action': return <i className="ri-sword-line text-red-500"></i>;
      case 'romance': return <i className="ri-heart-line text-pink-500"></i>;
      case 'comedy': return <i className="ri-emotion-laugh-line text-amber-500"></i>;
      case 'drama': return <i className="ri-theatre-line text-purple-500"></i>;
      case 'fantasy': return <i className="ri-magic-line text-indigo-500"></i>;
      case 'sci-fi': return <i className="ri-rocket-line text-cyan-500"></i>;
      case 'horror': return <i className="ri-ghost-line text-slate-600"></i>;
      case 'slice of life': return <i className="ri-plant-line text-pink-400"></i>;
      default: return <i className="ri-film-line text-blue-500"></i>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section - Anime Themed */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                    <i className="ri-movie-2-line text-white text-xl"></i>
                  </div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Anime Management
                  </h1>
                </div>
                <p className="text-slate-500 ml-13">Manage your anime content library with power and precision</p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => setShowAddAnimeModal(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
                >
                  <i className="ri-add-line text-lg"></i>
                  <span className="font-medium">Add Anime</span>
                </button>
                <button
                  onClick={() => setShowImporter(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
                >
                  <i className="ri-download-2-line text-lg"></i>
                  <span className="font-medium">Import</span>
                </button>
                <button
                  onClick={() => {
                    setSelectedAnimeForScraping(null);
                    setShowScraper(true);
                  }}
                  className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl"
                >
                  <i className="ri-search-line text-lg"></i>
                  <span className="font-medium">Scraper</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stats Cards - Anime Themed */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 border-l-4 border-blue-500 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">Total Anime</p>
                <p className="text-3xl font-bold text-blue-600">{totalAnime}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <i className="ri-movie-2-line text-blue-600 text-2xl"></i>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 border-l-4 border-emerald-500 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">Published</p>
                <p className="text-3xl font-bold text-emerald-600">
                  {globalPublishedCount}
                </p>
              </div>
              <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                <i className="ri-check-double-line text-emerald-600 text-2xl"></i>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 border-l-4 border-amber-500 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">Ongoing</p>
                <p className="text-3xl font-bold text-amber-600">
                  {globalOngoingCount}
                </p>
              </div>
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <i className="ri-time-line text-amber-600 text-2xl"></i>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 border-l-4 border-purple-500 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">Selected</p>
                <p className="text-3xl font-bold text-purple-600">{selectedAnime.size}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <i className="ri-checkbox-multiple-line text-purple-600 text-2xl"></i>
              </div>
            </div>
          </motion.div>
        </div>


        {error && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-4 bg-red-50 border-l-4 border-red-500 p-4 rounded-r-xl shadow-md"
          >
            <div className="flex items-center gap-3">
              <i className="ri-error-warning-line text-red-500 text-xl"></i>
              <span className="text-red-700 font-medium">{error}</span>
            </div>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-4 bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-xl shadow-md"
          >
            <div className="flex items-center gap-3">
              <i className="ri-check-line text-emerald-500 text-xl"></i>
              <span className="text-emerald-700 font-medium">{successMessage}</span>
            </div>
          </motion.div>
        )}

        {/* Preloading Status */}
        {Object.keys(episodesCache).length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-4 bg-blue-50/80 border-l-4 border-blue-500 p-4 rounded-r-xl shadow-md"
          >
            <div className="flex items-center gap-3">
              <i className="ri-flashlight-line text-blue-500 text-lg"></i>
              <span className="text-blue-700 font-medium">
                Preloaded episodes for {Object.keys(episodesCache).length} anime — Click "View Details" for instant loading!
              </span>
            </div>
          </motion.div>
        )}

        {/* Filters and Search - State-of-the-Art Custom Control Center */}
        <div className="bg-white/85 backdrop-blur-md rounded-2xl shadow-xl border border-white/40 p-6 mb-6">
          {/* Header & Live Summary */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 shadow-sm">
                <i className="ri-filter-3-line text-blue-600 text-lg"></i>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Search & Filters</h2>
                <p className="text-[11px] text-slate-400 font-medium">Refine, sort and select from the anime library</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-full text-xs font-semibold text-slate-600 shadow-sm">
                <span className={`w-2 h-2 rounded-full ${loading || isTyping ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'}`}></span>
                {loading || isTyping ? (
                  <span className="text-slate-500">Updating library...</span>
                ) : (
                  <span>Showing {anime.length} of {totalAnime} Anime</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {/* Search Input with Keyboard Shortcut & Micro-Spinner */}
            <div className="md:col-span-2">
              <label htmlFor="search" className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <i className="ri-search-line text-blue-500"></i> Search Anime
              </label>
              <div className="relative group">
                <input
                  ref={searchInputRef}
                  type="text"
                  id="search"
                  className="w-full pl-11 pr-24 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 group-hover:border-slate-300 transition-all font-medium text-slate-700"
                  placeholder="Search by title, Japanese title, or desc..."
                  value={searchInputValue}
                  onChange={(e) => setSearchInputValue(e.target.value)}
                />

                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 transition-colors">
                  {loading && isTyping ? (
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <i className="ri-search-line text-lg text-slate-400 group-focus-within:text-blue-500 transition-colors"></i>
                  )}
                </div>

                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {searchInputValue && (
                    <button
                      onClick={() => {
                        setSearchInputValue('');
                        setSearchTerm('');
                      }}
                      className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                      title="Clear search"
                    >
                      <i className="ri-close-circle-fill text-base"></i>
                    </button>
                  )}

                  <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[9px] font-extrabold text-slate-400 select-none shadow-sm font-mono">
                    ⌘K
                  </span>
                </div>
              </div>
            </div>

            {/* Publication Status - Premium Segmented Tabs */}
            <div className="md:col-span-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <i className="ri-shield-check-line text-emerald-500"></i> Publication Status
              </label>
              <div className="flex bg-slate-100 p-1.5 rounded-xl border border-slate-200/50 shadow-inner h-[46px]">
                {[
                  { value: 'all', label: 'All', icon: 'ri-apps-2-line', activeBg: 'bg-gradient-to-r from-blue-600 to-blue-700' },
                  { value: 'published', label: 'Published', icon: 'ri-checkbox-circle-line', activeBg: 'bg-gradient-to-r from-emerald-600 to-emerald-700' },
                  { value: 'pending', label: 'Pending', icon: 'ri-time-line', activeBg: 'bg-gradient-to-r from-amber-600 to-amber-700' },
                  { value: 'draft', label: 'Draft', icon: 'ri-edit-2-line', activeBg: 'bg-gradient-to-r from-slate-600 to-slate-700' }
                ].map((tab) => {
                  const isActive = filterStatus === tab.value;
                  return (
                    <button
                      key={tab.value}
                      onClick={() => setFilterStatus(tab.value)}
                      className={`relative flex-1 py-1.5 rounded-lg text-xs font-bold transition-all duration-300 flex items-center justify-center gap-1.5 z-10 ${isActive ? 'text-white' : 'text-slate-600 hover:text-slate-800 hover:bg-slate-200/40'
                        }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeStatusIndicator"
                          className={`absolute inset-0 rounded-lg shadow-md ${tab.activeBg}`}
                          transition={{ type: "spring", stiffness: 350, damping: 28 }}
                        />
                      )}
                      <span className="relative flex items-center gap-1">
                        <i className={`${tab.icon} text-[13px]`}></i>
                        <span className="hidden lg:inline">{tab.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Genre Select Dropdown with custom styling */}
            <div>
              <label htmlFor="genreFilter" className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <i className="ri-price-tag-3-line text-blue-500"></i> Genre
              </label>
              <div className="relative">
                <select
                  id="genreFilter"
                  className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-semibold text-slate-700 appearance-none cursor-pointer text-sm"
                  value={filterGenre}
                  onChange={(e) => setFilterGenre(e.target.value)}
                >
                  <option value="all">All Genres</option>
                  {availableGenres.map((genre) => (
                    <option key={genre} value={genre.toLowerCase()}>
                      {genre}
                    </option>
                  ))}
                </select>
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <i className="ri-price-tag-line text-slate-400 text-sm"></i>
                </div>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <i className="ri-arrow-down-s-line text-lg"></i>
                </div>
              </div>
            </div>

            {/* Type Select Dropdown */}
            <div>
              <label htmlFor="typeFilter" className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <i className="ri-movie-line text-purple-500"></i> Type
              </label>
              <div className="relative">
                <select
                  id="typeFilter"
                  className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-semibold text-slate-700 appearance-none cursor-pointer text-sm"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">All Types</option>
                  <option value="tv">📺 TV Series</option>
                  <option value="movie">🎬 Movie</option>
                  <option value="ova">💿 OVA</option>
                  <option value="ona">🌐 ONA</option>
                  <option value="special">✨ Special</option>
                </select>
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <i className="ri-movie-2-line text-slate-400 text-sm"></i>
                </div>
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <i className="ri-arrow-down-s-line text-lg"></i>
                </div>
              </div>
            </div>

            {/* Sort & Order Controls */}
            <div className="md:col-span-2">
              <label htmlFor="sortFilter" className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
                <i className="ri-equalizer-line text-emerald-500"></i> Sort & Order
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <select
                    id="sortFilter"
                    className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-semibold text-slate-700 appearance-none cursor-pointer text-sm"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="created_at">📅 Date Added</option>
                    <option value="title">🔤 Title</option>
                    <option value="rating">⭐️ Rating</option>
                    <option value="year">🗓️ Release Year</option>
                    <option value="total_episodes">🔢 Episodes</option>
                  </select>
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <i className="ri-sort-asc text-slate-400 text-sm"></i>
                  </div>
                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <i className="ri-arrow-down-s-line text-lg"></i>
                  </div>
                </div>

                <button
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="px-3.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl shadow-sm transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-blue-600 focus:ring-2 focus:ring-blue-500 h-[46px]"
                  title={sortOrder === 'asc' ? 'Sort Ascending' : 'Sort Descending'}
                >
                  <i className={sortOrder === 'asc' ? 'ri-sort-asc-line text-lg' : 'ri-sort-desc-line text-lg'}></i>
                </button>
              </div>
            </div>
          </div>

          {/* Active Filter Chips with satisfying layout transitions */}
          {(searchTerm || filterStatus !== 'all' || filterGenre !== 'all' || filterType !== 'all' || sortBy !== 'created_at' || sortOrder !== 'desc') && (
            <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Active filters:</span>
              <div className="flex flex-wrap gap-1.5 flex-1 items-center">
                {searchTerm && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/50 shadow-sm">
                    <i className="ri-search-line text-[11px]"></i> Search: "{searchTerm}"
                    <button onClick={() => { setSearchInputValue(''); setSearchTerm(''); }} className="hover:bg-blue-200/50 p-0.5 rounded-full transition-colors">
                      <i className="ri-close-line"></i>
                    </button>
                  </span>
                )}
                {filterStatus !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/50 shadow-sm capitalize">
                    <i className="ri-checkbox-circle-line text-[11px]"></i> Status: {filterStatus}
                    <button onClick={() => setFilterStatus('all')} className="hover:bg-emerald-200/50 p-0.5 rounded-full transition-colors">
                      <i className="ri-close-line"></i>
                    </button>
                  </span>
                )}
                {filterGenre !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/50 shadow-sm capitalize">
                    <i className="ri-price-tag-3-line text-[11px]"></i> Genre: {filterGenre}
                    <button onClick={() => setFilterGenre('all')} className="hover:bg-amber-200/50 p-0.5 rounded-full transition-colors">
                      <i className="ri-close-line"></i>
                    </button>
                  </span>
                )}
                {filterType !== 'all' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200/50 shadow-sm uppercase">
                    <i className="ri-movie-2-line text-[11px]"></i> Type: {filterType}
                    <button onClick={() => setFilterType('all')} className="hover:bg-purple-200/50 p-0.5 rounded-full transition-colors">
                      <i className="ri-close-line"></i>
                    </button>
                  </span>
                )}
                {(sortBy !== 'created_at' || sortOrder !== 'desc') && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200/50 shadow-sm">
                    <i className="ri-sort-asc text-[11px]"></i> Sort: {sortBy === 'created_at' ? 'Date' : sortBy === 'title' ? 'Title' : sortBy === 'rating' ? 'Rating' : sortBy === 'year' ? 'Year' : 'Episodes'} ({sortOrder === 'asc' ? 'Asc' : 'Desc'})
                    <button onClick={() => { setSortBy('created_at'); setSortOrder('desc'); }} className="hover:bg-slate-200 p-0.5 rounded-full transition-colors">
                      <i className="ri-close-line"></i>
                    </button>
                  </span>
                )}

                <button
                  onClick={() => {
                    setSearchInputValue('');
                    setSearchTerm('');
                    setFilterStatus('all');
                    setFilterGenre('all');
                    setFilterType('all');
                    setSortBy('created_at');
                    setSortOrder('desc');
                  }}
                  className="text-xs text-red-500 hover:text-red-700 font-bold hover:underline ml-auto flex items-center gap-1 transition-all duration-200 hover:scale-105"
                >
                  <i className="ri-refresh-line"></i> Reset All
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Bulk Actions - Redesigned */}
        {selectedAnime.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-blue-50/80 backdrop-blur-sm border border-blue-200 rounded-2xl p-5 mb-6 shadow-lg"
          >
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                  <span className="text-white font-bold">{selectedAnime.size}</span>
                </div>
                <span className="text-blue-900 font-semibold">anime selected</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleBulkAction('published')}
                  disabled={updatingAnime === 'bulk'}
                  className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-50 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                >
                  {updatingAnime === 'bulk' ? 'Updating...' : <><i className="ri-check-line mr-1"></i>Publish</>}
                </button>
                <button
                  onClick={() => handleBulkAction('pending')}
                  disabled={updatingAnime === 'bulk'}
                  className="px-4 py-2 bg-gradient-to-r from-amber-600 to-amber-700 text-white rounded-xl hover:from-amber-700 hover:to-amber-800 disabled:opacity-50 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                >
                  {updatingAnime === 'bulk' ? 'Updating...' : <><i className="ri-time-line mr-1"></i>Pending</>}
                </button>
                <button
                  onClick={() => handleBulkAction('draft')}
                  disabled={updatingAnime === 'bulk'}
                  className="px-4 py-2 bg-gradient-to-r from-slate-600 to-slate-700 text-white rounded-xl hover:from-slate-700 hover:to-slate-800 disabled:opacity-50 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                >
                  {updatingAnime === 'bulk' ? 'Updating...' : <><i className="ri-edit-line mr-1"></i>Draft</>}
                </button>
                <button
                  onClick={() => handleBulkAction('delete')}
                  disabled={updatingAnime === 'bulk'}
                  className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl hover:from-red-700 hover:to-red-800 disabled:opacity-50 transition-all shadow-md hover:shadow-lg text-sm font-medium"
                >
                  {updatingAnime === 'bulk' ? 'Deleting...' : <><i className="ri-delete-bin-line mr-1"></i>Delete</>}
                </button>
                <button
                  onClick={() => setSelectedAnime(new Set())}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 transition-all shadow-md text-sm font-medium"
                >
                  ✕ Clear
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Select All Header - Redesigned */}
        {!loading && anime.length > 0 && (
          <div className="bg-white/70 backdrop-blur-sm border border-white/20 rounded-xl p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedAnime.size === anime.length && anime.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      // Select all visible anime
                      const allIds = new Set(anime.map(item => item.id));
                      setSelectedAnime(allIds);
                    } else {
                      // Deselect all
                      setSelectedAnime(new Set());
                    }
                  }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-slate-700">
                  Select All ({anime.length} anime)
                </span>
              </div>
              <div className="text-sm text-slate-500">
                {selectedAnime.size > 0 && `${selectedAnime.size} selected`}
              </div>
            </div>
          </div>
        )}

        {/* Anime List - Completely Redesigned */}
        {loading ? (
          <div className="flex flex-col justify-center items-center h-64">
            <SparkleLoadingSpinner size="lg" text="Loading anime..." />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5">
            {anime.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="group relative bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 overflow-hidden hover:border-blue-200 hover:shadow-xl transition-all duration-300"
              >
                {/* Selection Checkbox - Top Right Corner */}
                <div className="absolute top-4 left-4 z-10">
                  <input
                    type="checkbox"
                    checked={selectedAnime.has(item.id)}
                    onChange={(e) => {
                      const newSelected = new Set(selectedAnime);
                      if (e.target.checked) {
                        newSelected.add(item.id);
                      } else {
                        newSelected.delete(item.id);
                      }
                      setSelectedAnime(newSelected);
                    }}
                    className="w-5 h-5 rounded-md border-2 border-white text-blue-600 focus:ring-2 focus:ring-blue-500 shadow-lg cursor-pointer"
                  />
                </div>

                <div className="flex flex-col lg:flex-row gap-6 p-6">
                  {/* Poster - Enhanced */}
                  <div className="flex-shrink-0">
                    <div className="relative group/poster">
                      <img
                        className="h-56 w-40 rounded-xl object-cover shadow-xl border border-slate-200/50 group-hover:scale-105 transition-transform duration-300"
                        src={item.poster_url || item.thumbnail || '/placeholder-anime.jpg'}
                        alt={item.title}
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'https://via.placeholder.com/160x224/6366f1/ffffff?text=Anime';
                        }}
                      />
                      {episodesCache[item.id] && (
                        <div className="absolute -top-2 -right-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                          <i className="ri-flashlight-line"></i> {episodesCache[item.id].length}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 flex flex-col justify-between">
                    {/* Title & Status */}
                    <div>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <h3 className="text-2xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                          {item.title}
                        </h3>
                        <span className={`flex-shrink-0 px-4 py-1.5 rounded-full text-xs font-bold border-2 ${getStatusColor(item.status || 'draft')} shadow-sm`}>
                          {getStatusIcon(item.status || 'draft')} {(item.status || 'draft').toUpperCase()}
                        </span>
                      </div>

                      <p className="text-slate-500 text-sm mb-4 line-clamp-2 leading-relaxed">
                        {item.description || 'No description available'}
                      </p>

                      {/* Stats Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 rounded-lg">
                          <i className="ri-film-line text-blue-500 text-lg"></i>
                          <div>
                            <p className="text-xs text-slate-500">Episodes</p>
                            <p className="font-bold text-blue-600">{item.episode_count || 0}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-amber-50 px-3 py-2 rounded-lg">
                          <i className="ri-star-line text-amber-500 text-lg"></i>
                          <div>
                            <p className="text-xs text-slate-500">Rating</p>
                            <p className="font-bold text-amber-600">{item.average_rating || 'N/A'}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-purple-50 px-3 py-2 rounded-lg">
                          <i className="ri-eye-line text-purple-500 text-lg"></i>
                          <div>
                            <p className="text-xs text-slate-500">Views</p>
                            <p className="font-bold text-purple-600">{item.views?.toLocaleString() || '0'}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg">
                          <i className="ri-calendar-line text-slate-500 text-lg"></i>
                          <div>
                            <p className="text-xs text-slate-500">Added</p>
                            <p className="font-bold text-slate-600 text-xs">{new Date(item.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                      </div>

                      {/* Genres */}
                      {item.genres && item.genres.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                          {item.genres.slice(0, 5).map((genre: string, index: number) => (
                            <span key={index} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-200">
                              {getGenreIcon(genre)} {genre}
                            </span>
                          ))}
                          {item.genres.length > 5 && (
                            <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold">
                              +{item.genres.length - 5} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3 pt-4 border-t border-slate-100">
                      {/* Status Selector */}
                      <div className="flex items-center gap-3">
                        <label className="text-sm font-semibold text-slate-700">Status:</label>
                        <select
                          value={item.status || 'draft'}
                          onChange={(e) => handleStatusChange(item.id, e.target.value as any)}
                          disabled={updatingAnime === item.id}
                          className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 transition-all"
                        >
                          <option value="published">✅ Published</option>
                          <option value="pending">⏳ Pending</option>
                          <option value="draft">📝 Draft</option>
                        </select>
                        {updatingAnime === item.id && (
                          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        )}
                      </div>

                      {/* Action Buttons Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <button
                          onClick={() => handleViewAnimeDetails(item)}
                          className="px-3 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all text-xs font-semibold shadow-sm hover:shadow-md flex items-center justify-center gap-1"
                        >
                          <i className="ri-eye-line"></i> Details
                        </button>
                        <button
                          onClick={() => handleEditAnime(item)}
                          className="px-3 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-all text-xs font-semibold shadow-sm hover:shadow-md flex items-center justify-center gap-1"
                        >
                          <i className="ri-edit-line"></i> Edit
                        </button>
                        <button
                          onClick={() => handleAddEpisode(item)}
                          className="px-3 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all text-xs font-semibold shadow-sm hover:shadow-md flex items-center justify-center gap-1"
                        >
                          <i className="ri-add-circle-line"></i> Episode
                        </button>
                        <button
                          onClick={() => handleDeleteAnime(item.id, item.title)}
                          disabled={updatingAnime === item.id}
                          className="px-3 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all text-xs font-semibold shadow-sm hover:shadow-md flex items-center justify-center gap-1"
                        >
                          {updatingAnime === item.id ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <i className="ri-delete-bin-line"></i>} Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            {anime.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="col-span-full"
              >
                <div className="bg-white/60 backdrop-blur-sm border border-dashed border-slate-300 rounded-2xl p-16 text-center">
                  <motion.div
                    animate={{
                      scale: [1, 1.1, 1],
                      rotate: [0, 5, -5, 0]
                    }}
                    transition={{
                      duration: 4,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                    className="mb-6 inline-block"
                  >
                    <i className="ri-movie-2-line text-8xl text-blue-300"></i>
                  </motion.div>

                  <h3 className="text-3xl font-bold mb-3">
                    <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                      No Anime Found
                    </span>
                  </h3>

                  <p className="text-slate-500 text-lg mb-8 max-w-md mx-auto">
                    {searchTerm || filterStatus !== 'all' || filterGenre !== 'all'
                      ? 'No anime match your current filters. Try adjusting your search criteria.'
                      : 'Your anime library is empty. Start by adding or importing anime.'
                    }
                  </p>

                  {!searchTerm && filterStatus === 'all' && filterGenre === 'all' && (
                    <div className="flex gap-4 justify-center">
                      <button
                        onClick={() => setShowAddAnimeModal(true)}
                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200"
                      >
                        <i className="ri-add-line mr-1"></i> Add Anime
                      </button>
                      <button
                        onClick={() => setShowImporter(true)}
                        className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-xl font-medium shadow-lg hover:shadow-xl hover:from-purple-700 hover:to-purple-800 transition-all duration-200"
                      >
                        <i className="ri-download-2-line mr-1"></i> Import Anime
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-center mt-8"
          >
            <div className="inline-flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-2xl p-2 shadow-lg border border-white/20">
              <button
                onClick={() => fetchAnime(currentPage - 1)}
                disabled={currentPage === 1 || loading}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
              >
                <span>←</span>
                <span className="hidden sm:inline">Previous</span>
              </button>

              <div className="flex items-center gap-1.5 px-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNumber => {
                  // Show first, last, current, and adjacent pages
                  const showPage =
                    pageNumber === 1 ||
                    pageNumber === totalPages ||
                    Math.abs(pageNumber - currentPage) <= 1;

                  const showEllipsis =
                    (pageNumber === currentPage - 2 && currentPage > 3) ||
                    (pageNumber === currentPage + 2 && currentPage < totalPages - 2);

                  if (showEllipsis) {
                    return (
                      <span key={pageNumber} className="px-2 text-gray-400">
                        ···
                      </span>
                    );
                  }

                  if (!showPage) return null;

                  return (
                    <button
                      key={pageNumber}
                      onClick={() => fetchAnime(pageNumber)}
                      disabled={currentPage === pageNumber || loading}
                      className={`min-w-[44px] h-11 rounded-xl font-medium transition-all duration-200 ${currentPage === pageNumber
                        ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg scale-110'
                        : 'bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => fetchAnime(currentPage + 1)}
                disabled={currentPage === totalPages || loading}
                className="px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-medium hover:shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center gap-2"
              >
                <span className="hidden sm:inline">Next</span>
                <span>→</span>
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Anime Details Modal */}
      {showAnimeModal && selectedAnimeForModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 50 }}
            className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-hidden"
          >
            {/* Modal Header with Gradient */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-6 relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_#fff_0%,_transparent_50%)]"></div>
              <div className="relative flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                    <i className="ri-movie-2-line text-white text-2xl"></i>
                  </div>
                  <h2 className="text-3xl font-bold text-white drop-shadow-lg">Anime Details</h2>
                </div>
                <button
                  onClick={closeAnimeModal}
                  className="text-white/80 hover:text-white hover:bg-white/20 transition-all duration-200 p-3 rounded-xl backdrop-blur-sm"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-100px)] custom-scrollbar">
              {/* Modal Content */}
              <div className="p-6">
                <div className="flex flex-col lg:flex-row gap-6 mb-6">
                  {/* Poster */}
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex-shrink-0"
                  >
                    <div className="relative group">
                      <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl blur-xl opacity-30 group-hover:opacity-50 transition-opacity"></div>
                      <img
                        className="relative h-64 w-48 rounded-2xl object-cover border-4 border-white shadow-2xl transform group-hover:scale-105 transition-transform duration-300"
                        src={selectedAnimeForModal.poster_url || selectedAnimeForModal.thumbnail || '/placeholder-anime.jpg'}
                        alt={selectedAnimeForModal.title}
                        width={192}
                        height={256}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'https://via.placeholder.com/300x400/6366f1/ffffff?text=Anime';
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* Details */}
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex-1"
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                      <h3 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                        {selectedAnimeForModal.title}
                      </h3>
                      <span className={`px-4 py-1.5 rounded-full text-sm font-semibold backdrop-blur-sm border-2 ${getStatusColor(selectedAnimeForModal.status)} shadow-lg`}>
                        {getStatusIcon(selectedAnimeForModal.status)} {selectedAnimeForModal.status}
                      </span>
                    </div>

                    <p className="text-slate-600 text-base leading-relaxed mb-6 bg-slate-50 rounded-xl p-4 border border-slate-200">
                      {selectedAnimeForModal.description || 'No description available'}
                    </p>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-blue-50 rounded-xl p-4 border border-blue-100 shadow-sm"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <i className="ri-film-line text-blue-500 text-xl"></i>
                          <span className="text-xs font-medium text-blue-600">Episodes</span>
                        </div>
                        <p className="text-2xl font-bold text-blue-900">{selectedAnimeForModal.episode_count || 0}</p>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-amber-50 rounded-xl p-4 border border-amber-100 shadow-sm"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <i className="ri-star-line text-amber-500 text-xl"></i>
                          <span className="text-xs font-medium text-amber-600">Rating</span>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-amber-900">
                            {analyticsLoading ? '...' : (animeAnalytics?.analytics?.averageRating || 'N/A')}
                          </p>
                          {!analyticsLoading && animeAnalytics?.analytics?.totalReviews > 0 && (
                            <p className="text-xs text-amber-600">({animeAnalytics.analytics.totalReviews} reviews)</p>
                          )}
                        </div>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-purple-50 rounded-xl p-4 border border-purple-100 shadow-sm"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <i className="ri-eye-line text-purple-500 text-xl"></i>
                          <span className="text-xs font-medium text-purple-600">Views</span>
                        </div>
                        <div>
                          <p className="text-2xl font-bold text-purple-900">
                            {analyticsLoading ? '...' : (animeAnalytics?.analytics?.views || 0).toLocaleString()}
                          </p>
                          {!analyticsLoading && animeAnalytics?.analytics?.completedViews > 0 && (
                            <p className="text-xs text-purple-600">({animeAnalytics.analytics.completedViews} completed)</p>
                          )}
                        </div>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-sm"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <i className="ri-calendar-line text-slate-500 text-xl"></i>
                          <span className="text-xs font-medium text-slate-600">Added</span>
                        </div>
                        <p className="text-sm font-bold text-slate-900">{new Date(selectedAnimeForModal.created_at).toLocaleDateString()}</p>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-red-50 rounded-xl p-4 border border-red-100 shadow-sm"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <i className="ri-flag-line text-red-500 text-xl"></i>
                          <span className="text-xs font-medium text-red-600">Reports</span>
                        </div>
                        <p className="text-2xl font-bold text-red-900">
                          {analyticsLoading ? '...' : (animeAnalytics?.analytics?.reports || 0)}
                        </p>
                      </motion.div>

                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        className="bg-slate-50 rounded-xl p-4 border border-slate-100 shadow-sm transition-all duration-200"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <i className="ri-hashtag text-slate-500 text-xl"></i>
                            <span className="text-xs font-medium text-slate-600">Anime ID</span>
                          </div>
                          <button
                            onClick={() => handleCopyId(selectedAnimeForModal.id)}
                            className={`p-1 rounded-md transition-all duration-200 flex items-center justify-center ${copiedId
                              ? 'bg-emerald-100 text-emerald-700 shadow-sm'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 shadow-sm'
                              }`}
                            title="Copy Anime ID"
                          >
                            <i className={copiedId ? 'ri-check-line text-xs font-bold' : 'ri-file-copy-line text-xs'}></i>
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-1.5 mt-2">
                          <p className="font-mono text-xs text-slate-900 truncate select-all flex-1" title={selectedAnimeForModal.id}>
                            {selectedAnimeForModal.id}
                          </p>
                          {copiedId && (
                            <span className="text-[10px] font-semibold text-emerald-600 animate-pulse whitespace-nowrap">
                              Copied!
                            </span>
                          )}
                        </div>
                      </motion.div>
                    </div>

                    {/* Genres */}
                    {selectedAnimeForModal.genres && selectedAnimeForModal.genres.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 bg-slate-50 rounded-xl p-4 border border-slate-200"
                      >
                        <div className="flex items-center gap-2 mb-3">
                          <i className="ri-price-tag-3-line text-slate-500"></i>
                          <span className="text-sm font-semibold text-slate-700">Genres:</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedAnimeForModal.genres.map((genre: string, index: number) => (
                            <span key={index} className="flex items-center space-x-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold border border-blue-200">
                              <span>{getGenreIcon(genre)}</span>
                              <span>{genre}</span>
                            </span>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                </div>

                {/* Episodes Management */}
                <div className="border-t border-slate-200 pt-6 mt-6">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                      Episodes Management
                    </h4>
                    {episodesCache[selectedAnimeForModal?.id] && (
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-medium border border-emerald-200">
                        ⚡ {episodesCache[selectedAnimeForModal.id].length} episodes loaded instantly
                      </span>
                    )}
                  </div>

                  <div className="space-y-3">
                    {episodesLoading ? (
                      <div className="text-center py-8">
                        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                        <p className="text-slate-500 text-sm">Loading episodes...</p>
                      </div>
                    ) : animeEpisodes.length === 0 ? (
                      <div className="text-center py-8">
                        <i className="ri-play-circle-line text-slate-300 text-4xl mb-2"></i>
                        <p className="text-slate-600 font-medium">No episodes yet</p>
                        <p className="text-slate-400 text-sm">Add the first episode to get started</p>
                      </div>
                    ) : (
                      <>
                        {paginatedEpisodes.map((episode) => (
                          <div key={episode.id} className="bg-slate-50 rounded-lg p-4 border border-slate-200 hover:bg-slate-100 transition-colors">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-4">
                                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-md">
                                  {episode.episode_number}
                                </div>
                                <div>
                                  <h5 className="text-slate-900 font-semibold text-lg">{episode.title}</h5>
                                  <p className="text-slate-500 text-sm mt-1">
                                    Duration: {episode.duration ? `${Math.floor(episode.duration / 60)}:${(episode.duration % 60).toString().padStart(2, '0')}` : 'N/A'}
                                  </p>
                                  <p className="text-slate-400 text-xs mt-1">
                                    Added: {new Date(episode.created_at).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <button
                                  onClick={() => handleEditEpisode(episode)}
                                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteEpisode(episode.id, episode.title)}
                                  disabled={editingEpisode === episode.id}
                                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow-md"
                                >
                                  {editingEpisode === episode.id ? 'Deleting...' : 'Delete'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}

                        {totalEpisodePages > 1 && (
                          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6 bg-slate-50 border border-slate-200 p-4 rounded-2xl shadow-sm">
                            <span className="text-xs font-semibold text-slate-500">
                              Showing {episodeStartIndex + 1} to {Math.min(episodeStartIndex + EPISODES_PER_PAGE, animeEpisodes.length)} of {animeEpisodes.length} episodes
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setEpisodePage(prev => Math.max(prev - 1, 1))}
                                disabled={safeEpisodePage === 1}
                                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-sm text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                              >
                                <span>←</span> Previous
                              </button>

                              {Array.from({ length: totalEpisodePages }, (_, i) => i + 1).map(pageNumber => {
                                const showPage =
                                  pageNumber === 1 ||
                                  pageNumber === totalEpisodePages ||
                                  Math.abs(pageNumber - safeEpisodePage) <= 1;

                                const showEllipsis =
                                  (pageNumber === safeEpisodePage - 2 && safeEpisodePage > 3) ||
                                  (pageNumber === safeEpisodePage + 2 && safeEpisodePage < totalEpisodePages - 2);

                                if (showEllipsis) {
                                  return (
                                    <span key={pageNumber} className="px-1.5 text-slate-400 text-xs">
                                      ···
                                    </span>
                                  );
                                }

                                if (!showPage) return null;

                                return (
                                  <button
                                    key={pageNumber}
                                    onClick={() => setEpisodePage(pageNumber)}
                                    className={`w-8 h-8 rounded-lg text-xs font-semibold flex items-center justify-center transition-all ${safeEpisodePage === pageNumber
                                        ? 'bg-blue-600 text-white shadow-md'
                                        : 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-700'
                                      }`}
                                  >
                                    {pageNumber}
                                  </button>
                                );
                              })}

                              <button
                                onClick={() => setEpisodePage(prev => Math.min(prev + 1, totalEpisodePages))}
                                disabled={safeEpisodePage === totalEpisodePages}
                                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-sm text-xs font-semibold flex items-center justify-center gap-1 transition-all"
                              >
                                Next <span>→</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Add Anime Modal */}
      <AddAnimeModal
        isOpen={showAddAnimeModal}
        onClose={() => setShowAddAnimeModal(false)}
        onSuccess={handleAnimeCreated}
      />

      {/* Add Episode Modal */}
      {selectedAnimeForEpisode && (
        <AddEpisodeModal
          isOpen={showAddEpisodeModal}
          onClose={() => {
            setShowAddEpisodeModal(false);
            setSelectedAnimeForEpisode(null);
          }}
          onSuccess={handleEpisodeCreated}
          animeId={selectedAnimeForEpisode.id}
          animeTitle={selectedAnimeForEpisode.title}
          nextEpisodeNumber={(selectedAnimeForEpisode.episode_count || 0) + 1}
        />
      )}

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showConfirmationDialog}
        onClose={() => setShowConfirmationDialog(false)}
        onConfirm={confirmationConfig?.onConfirm || (() => { })}
        title={confirmationConfig?.title || ''}
        message={confirmationConfig?.message || ''}
        confirmText={confirmationConfig?.confirmText || 'Confirm'}
        type={confirmationConfig?.type || 'danger'}
        isLoading={updatingAnime !== null || editingEpisode !== null}
      />

      {/* Edit Episode Modal */}
      <EditEpisodeModal
        isOpen={showEditEpisodeModal}
        onClose={() => {
          setShowEditEpisodeModal(false);
          setSelectedEpisodeForEdit(null);
        }}
        onSuccess={handleEpisodeUpdated}
        episode={selectedEpisodeForEdit}
      />

      {/* Edit Anime Modal */}
      <EditAnimeModal
        isOpen={showEditAnimeModal}
        onClose={() => {
          setShowEditAnimeModal(false);
          setSelectedAnimeForEdit(null);
        }}
        onSuccess={handleAnimeUpdated}
        anime={selectedAnimeForEdit}
      />


      {/* Anime Importer Modal */}
      {showImporter && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-lg flex items-center justify-center z-50 p-4"
          onClick={() => setShowImporter(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            className="relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-3xl border border-purple-200/60 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/80 via-purple-500/80 to-pink-500/80" />
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top_left,_#fff5,_#ffffff00_45%)]" />

            <div className="relative flex items-center justify-between px-6 py-5 border-b border-white/20 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shadow-lg">
                  <i className="ri-download-2-line text-white text-2xl"></i>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white drop-shadow">Anime Data Importer</h2>
                  <p className="text-white/80 text-sm">Bulk import with validation and previews</p>
                </div>
              </div>
              <button
                onClick={() => setShowImporter(false)}
                className="text-white/80 hover:text-white hover:bg-white/15 transition-all duration-200 p-3 rounded-xl"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="relative p-6 overflow-y-auto max-h-[calc(90vh-90px)] bg-white/5 backdrop-blur-xl">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-lg">
                <EnhancedAnimeImporter onImportComplete={handleAnimeImported} />
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Episode Scraper Modal */}
      {showScraper && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-lg flex items-center justify-center z-50 p-4"
          onClick={() => setShowScraper(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 30 }}
            className={`relative w-full max-w-6xl max-h-[90vh] overflow-hidden rounded-3xl border shadow-2xl transition-all duration-300 ${activeScraperTab === '9anime' ? 'border-indigo-200/60' : activeScraperTab === 'animesuge' ? 'border-violet-200/60' : 'border-rose-200/60'
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`absolute inset-0 transition-all duration-500 bg-gradient-to-br ${activeScraperTab === '9anime'
                ? 'from-indigo-600/85 via-purple-600/85 to-pink-500/80'
                : activeScraperTab === 'animesuge'
                  ? 'from-violet-600/85 via-indigo-600/85 to-purple-500/80'
                  : 'from-rose-600/85 via-red-600/85 to-amber-500/80'
                }`}
            />
            <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_bottom_right,_#fff7,_#ffffff00_45%)]" />

            <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-5 border-b border-white/20 backdrop-blur-xl">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shadow-lg transition-all duration-300 ${activeScraperTab === 'reanime' ? 'animate-pulse' : ''
                  }`}>
                  <i className={`text-white text-2xl transition-all duration-300 ${activeScraperTab === '9anime' ? 'ri-search-line' : activeScraperTab === 'reanime' ? 'ri-fire-line' : activeScraperTab === 'sanjianime' ? 'ri-play-circle-line' : 'ri-vidicon-line'
                    }`}></i>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white drop-shadow">
                    {activeScraperTab === '9anime' ? '9Anime Scraper' : activeScraperTab === 'reanime' ? 'Re:ANIME Scraper' : activeScraperTab === 'sanjianime' ? 'Sanji Anime Scraper' : 'AnimeSuge.cz Scraper'}
                  </h2>
                  <p className="text-white/80 text-sm">Streamed progress with SSE</p>
                </div>
              </div>

              {/* Scraper Selector Tabs */}
              <div className="flex items-center gap-2 bg-black/20 p-1 rounded-2xl border border-white/10 backdrop-blur-md">
                <button
                  onClick={() => setActiveScraperTab('9anime')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 ${activeScraperTab === '9anime'
                    ? 'bg-white text-indigo-700 shadow-md scale-105'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <i className="ri-tv-line"></i>
                  9Anime.org.lv
                </button>
                <button
                  onClick={() => setActiveScraperTab('reanime')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 ${activeScraperTab === 'reanime'
                    ? 'bg-white text-rose-700 shadow-md scale-105'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <i className="ri-fire-line"></i>
                  Re:ANIME
                </button>
                <button
                  onClick={() => setActiveScraperTab('sanjianime')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 ${activeScraperTab === 'sanjianime'
                    ? 'bg-white text-cyan-700 shadow-md scale-105'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <i className="ri-play-circle-line"></i>
                  Sanji Anime
                </button>
                <button
                  onClick={() => setActiveScraperTab('animesuge')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all duration-300 flex items-center gap-1.5 ${activeScraperTab === 'animesuge'
                    ? 'bg-white text-violet-700 shadow-md scale-105'
                    : 'text-white/80 hover:text-white hover:bg-white/10'
                    }`}
                >
                  <i className="ri-vidicon-line"></i>
                  AnimeSuge.cz
                </button>
              </div>

              <button
                onClick={() => setShowScraper(false)}
                className="text-white/80 hover:text-white hover:bg-white/15 transition-all duration-200 p-3 rounded-xl self-end sm:self-auto"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="relative p-6 overflow-y-auto max-h-[calc(90vh-90px)] bg-white/5 backdrop-blur-xl">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-lg">
                {activeScraperTab === '9anime' ? (
                  <NineAnimeScraperComponent initialSelectedAnime={selectedAnimeForScraping} />
                ) : activeScraperTab === 'reanime' ? (
                  <ReAnimeScraperComponent initialSelectedAnime={selectedAnimeForScraping} />
                ) : activeScraperTab === 'sanjianime' ? (
                  <SanjiAnimeScraperComponent initialSelectedAnime={selectedAnimeForScraping} />
                ) : (
                  <AnimeSugeScraperComponent initialSelectedAnime={selectedAnimeForScraping} />
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Scraped Episodes Modal */}
      {showScrapedEpisodesModal && selectedAnimeForScraping && (
        <ScrapedEpisodesModal
          isOpen={showScrapedEpisodesModal}
          onClose={handleCloseScrapedEpisodesModal}
          animeId={selectedAnimeForScraping.id}
          animeTitle={selectedAnimeForScraping.title}
          scrapedEpisodes={scrapedEpisodes}
          failedEpisodes={failedEpisodes}
          summary={scrapingSummary}
          onEpisodesAdded={() => {
            // Refresh episodes cache for this anime
            if (episodesCache[selectedAnimeForScraping.id]) {
              delete episodesCache[selectedAnimeForScraping.id];
              setEpisodesCache({ ...episodesCache });
            }
            // Invalidate TQ caches so other pages see new episodes
            invalidateAnimeCaches(queryClient, selectedAnimeForScraping.id);
          }}
        />
      )}

      {/* Large Anime Scraper Modal */}
      {showLargeScraper && selectedAnimeForLargeScraping && (
        <div
          className="fixed inset-0 bg-black/75 backdrop-blur-xl z-50 flex items-center justify-center p-4"
          onClick={handleCloseLargeScraper}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 40 }}
            className="relative bg-gradient-to-br from-indigo-900/90 via-purple-900/90 to-black/90 border border-purple-500/30 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_left,_#a855f7_0,_transparent_40%)]" />
            <div className="absolute inset-0 opacity-15 bg-[radial-gradient(circle_at_bottom_right,_#22d3ee_0,_transparent_45%)]" />

            <div className="relative flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shadow-lg">
                  <i className="ri-rocket-line text-white text-2xl"></i>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white drop-shadow">Large Anime Scraper</h2>
                  <p className="text-white/70 text-sm">High-volume episode scraping with batching</p>
                </div>
              </div>
              <button
                onClick={handleCloseLargeScraper}
                className="text-white/80 hover:text-white hover:bg-white/15 transition-all duration-200 p-3 rounded-xl"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="relative p-6 overflow-y-auto max-h-[calc(90vh-110px)]">
              <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-4 shadow-xl">
                <LargeAnimeScraper
                  animeId={selectedAnimeForLargeScraping.id}
                  animeTitle={selectedAnimeForLargeScraping.title}
                  totalEpisodes={selectedAnimeForLargeScraping.total_episodes || 1000}
                  onScrapingComplete={async () => {
                    await handleCloseLargeScraper();
                    setSuccessMessage('Large scraping completed successfully! Episodes have been refreshed.');
                    setTimeout(() => setSuccessMessage(null), 5000);
                  }}
                />
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}