import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../../../lib/database/supabase';
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner';
import { apiClient } from '../../../utils/api/client';


// ─── Session-storage keys for persisting scrape state across tab switches / refreshes ───
const SS_SCRAPE_STATUS = 'maintenance:scrapingStatus';
const SS_SCRAPE_ALL_ID = 'maintenance:scrapingAllAnimeId';
const SS_SCRAPE_ALL_MSG = 'maintenance:scrapeAllProgressMsg';

/** Read + parse a sessionStorage JSON value, falling back to `fallback` on any error. */
function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Restore scrapingStatus from sessionStorage.  
 * Any entry whose status is 'scraping' is marked as 'error' with an
 * "Interrupted" message — the HTTP request died when the page reloaded,
 * so we can't continue it, but we at least tell the user what happened.
 */
function restoreScrapingStatus(): Record<string, { status: 'idle' | 'scraping' | 'success' | 'error'; message?: string }> {
  const saved = readSession<Record<string, { status: string; message?: string }>>(SS_SCRAPE_STATUS, {});
  const out: Record<string, { status: 'idle' | 'scraping' | 'success' | 'error'; message?: string }> = {};
  for (const [id, entry] of Object.entries(saved)) {
    out[id] = entry.status === 'scraping'
      ? { status: 'error', message: 'Interrupted — page was reloaded while scraping. Click Auto-Scrape to retry.' }
      : (entry as any);
  }
  return out;
}

interface EpisodeServer {
  name: string;
  url: string;
  lang: string;
}

interface Episode {
  id: string;
  episode_number: number;
  title: string;
  video_url: string | null;
  video_servers: EpisodeServer[] | null;
  air_date?: string | null;
  anime_id: string;
  anime: {
    id: string;
    title: string;
    title_english: string | null;
    poster_url: string | null;
    status: string;
    scraper_urls?: Record<string, any> | null;
  } | null;
}

export default function AdminMaintenance() {
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Episode[] | null>(null);
  // FIX #5: surface scan errors to the user instead of silently swallowing them
  const [scanError, setScanError] = useState<string | null>(null);

  // Stats summary
  const [stats, setStats] = useState({
    totalChecked: 0,
    totalIncomplete: 0,
    missingUrl: 0,
    missingServers: 0,
  });

  // FIX #12: single source of truth for "bad URL" checks — handles null, empty, and legacy 'null' string
  const isBadUrl = (url: string | null | undefined): boolean =>
    !url || url.trim() === '' || url === 'null';

  // FIX #12: same for servers
  const isBadServers = (servers: EpisodeServer[] | null | undefined): boolean =>
    !servers || !Array.isArray(servers) || servers.length === 0;

  const isUpcomingEpisode = (ep: Episode): boolean => {
    if (ep.anime?.status?.toLowerCase() !== 'ongoing') return false;

    // Normalize air_date literal 'null' string values
    const airDateStr = ep.air_date && ep.air_date !== 'null' ? ep.air_date.trim() : null;

    // If air_date is in the future, it is upcoming
    if (airDateStr) {
      const airDate = new Date(airDateStr);
      if (!isNaN(airDate.getTime())) {
        return airDate > new Date();
      }
    }

    // If air_date is null/unset, and the title is generic (e.g. "Episode 8"), it is likely upcoming
    const title = (ep.title || '').trim().toLowerCase();
    const isGeneric = !ep.title ||
      title === `episode ${ep.episode_number}` ||
      title === `ep ${ep.episode_number}` ||
      /^\s*episode\s*\d+\s*$/i.test(title);

    if (!airDateStr && isGeneric && isBadUrl(ep.video_url)) {
      return true;
    }

    return false;
  };

  // Filters & Sorting state
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'missing_url' | 'missing_servers' | 'both_missing'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'ongoing' | 'completed'>('all');
  const [sortBy, setSortBy] = useState<'problems_desc' | 'ep_asc' | 'ep_desc'>('problems_desc');
  const [onlyLessServers, setOnlyLessServers] = useState(false);
  const [expandedAnime, setExpandedAnime] = useState<string | null>(null);

  // Edit Modal State
  const [editingEpisode, setEditingEpisode] = useState<Episode | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editServers, setEditServers] = useState<EpisodeServer[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ─── Scraper live-status — persisted to sessionStorage so tab-switches
  // and soft refreshes restore the last known state automatically. ───────────
  const [scrapingStatus, setScrapingStatus] = useState<Record<string, {
    status: 'idle' | 'scraping' | 'success' | 'error';
    message?: string;
  }>>(() => restoreScrapingStatus());

  // Batch Scrape All states — also persisted so the accordion stays open
  // and the progress message survives a quick tab-switch.
  const [scrapingAllAnimeId, setScrapingAllAnimeId] = useState<string | null>(
    // On restore, if a batch was mid-run it's now dead — reset to null so the
    // Scrape All button is re-enabled and the user can re-trigger the batch.
    () => null
  );
  const [scrapeAllProgressMsg, setScrapeAllProgressMsg] = useState('');

  // Write scraping state to sessionStorage whenever it changes so it
  // survives tab-switches (component unmount/remount) and refreshes.
  useEffect(() => {
    try {
      sessionStorage.setItem(SS_SCRAPE_STATUS, JSON.stringify(scrapingStatus));
    } catch { /* quota exceeded — safe to ignore */ }
  }, [scrapingStatus]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SS_SCRAPE_ALL_ID, JSON.stringify(scrapingAllAnimeId));
    } catch { /* quota exceeded — safe to ignore */ }
  }, [scrapingAllAnimeId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SS_SCRAPE_ALL_MSG, JSON.stringify(scrapeAllProgressMsg));
    } catch { /* quota exceeded — safe to ignore */ }
  }, [scrapeAllProgressMsg]);

  // FIX #13: Escape key closes the Quick Edit modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editingEpisode) closeEditModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingEpisode]);

  // Clear persisted scraping state when a full Refresh Scan is triggered so
  // old status badges from a previous session don't confuse the new scan.
  const clearPersistedScrapeState = () => {
    try {
      sessionStorage.removeItem(SS_SCRAPE_STATUS);
      sessionStorage.removeItem(SS_SCRAPE_ALL_ID);
      sessionStorage.removeItem(SS_SCRAPE_ALL_MSG);
    } catch { /* ignore */ }
    setScrapingStatus({});
    setScrapingAllAnimeId(null);
    setScrapeAllProgressMsg('');
  };

  useEffect(() => {
    // Perform initial automatic scan on mount
    handleScanDatabase();
  }, []);


  const handleScanDatabase = async () => {
    try {
      setScanning(true);
      setScanResults(null);
      setScanError(null);
      setExpandedAnime(null);
      // Clear stale scraping badges so a fresh scan starts with a clean slate
      clearPersistedScrapeState();

      // Fetch stats count, incomplete episodes, and catalog anime list concurrently
      const [countResult, episodesResult, animeListResult] = await Promise.all([
        supabase
          .from('episodes')
          .select('*', { count: 'exact', head: true }),
        supabase
          .from('episodes')
          .select(`
            id,
            episode_number,
            title,
            video_url,
            video_servers,
            air_date,
            anime_id,
            anime:anime_id (
              id,
              title,
              title_english,
              poster_url,
              status,
              scraper_urls
            )
          `)
          .or('video_url.is.null,video_servers.is.null,video_servers.eq.[]')
          .order('episode_number', { ascending: true })
          .limit(10000),
        supabase
          .from('anime')
          .select(`
            id,
            title,
            title_english,
            poster_url,
            status,
            type,
            total_episodes,
            scraper_urls,
            episodes (
              id
            )
          `)
          .limit(2000)
          .limit(1, { foreignTable: 'episodes' })
      ]);

      const { count: totalEpCount, error: countError } = countResult;
      const { data: episodes, error } = episodesResult;
      const { data: animeList, error: animeError } = animeListResult;

      if (countError) throw countError;
      if (error) throw error;
      if (animeError) throw animeError;

      const typedEpisodes = (episodes || []) as unknown as Episode[];
      const missingEpisodeAnime = (animeList || []).filter((a: any) => !a.episodes || a.episodes.length === 0);

      // Construct virtual Episode 1 stubs for completely missing anime or movies
      const virtualEpisodes: Episode[] = [];
      missingEpisodeAnime.forEach(a => {
        virtualEpisodes.push({
          id: `virtual-${a.id}-1`,
          episode_number: 1,
          title: `Episode 1`,
          video_url: null,
          video_servers: null,
          anime_id: a.id,
          anime: {
            id: a.id,
            title: a.title,
            title_english: a.title_english,
            poster_url: a.poster_url,
            status: a.status,
            scraper_urls: a.scraper_urls
          }
        });
      });

      // Construct virtual stubs for anime that have less than 2 scraper URLs (but do have episodes)
      const missingScrapersAnime = (animeList || []).filter((a: any) => {
        const scraperUrls = a.scraper_urls;
        const scraperUrlsCount = scraperUrls && typeof scraperUrls === 'object' && !Array.isArray(scraperUrls)
          ? Object.keys(scraperUrls).length
          : 0;
        return scraperUrlsCount < 2 && a.episodes && a.episodes.length > 0;
      });

      missingScrapersAnime.forEach(a => {
        const totalEpCount = a.total_episodes || 1;
        for (let epNum = 1; epNum <= totalEpCount; epNum++) {
          const existsInTyped = typedEpisodes.some(te => te.anime_id === a.id && te.episode_number === epNum);
          const existsInVirtual = virtualEpisodes.some(ve => ve.anime_id === a.id && ve.episode_number === epNum);

          if (!existsInTyped && !existsInVirtual) {
            virtualEpisodes.push({
              id: `virtual-${a.id}-scrapers-${epNum}`,
              episode_number: epNum,
              title: `Episode ${epNum}`,
              video_url: 'placeholder',
              video_servers: [
                { name: 'Placeholder 1', url: 'placeholder', lang: 'sub' },
                { name: 'Placeholder 2', url: 'placeholder', lang: 'sub' }
              ],
              anime_id: a.id,
              anime: {
                id: a.id,
                title: a.title,
                title_english: a.title_english,
                poster_url: a.poster_url,
                status: a.status,
                scraper_urls: a.scraper_urls
              }
            });
          }
        }
      });

      const combinedEpisodes = [...typedEpisodes, ...virtualEpisodes];

      // FIX #12: use centralised helpers for consistency
      const incomplete = combinedEpisodes.filter(ep => {
        const isProblem = isBadUrl(ep.video_url) || isBadServers(ep.video_servers);

        // Also flag as incomplete if the anime has less than 2 scraper URLs
        const scraperUrls = ep.anime?.scraper_urls;
        const scraperUrlsCount = scraperUrls && typeof scraperUrls === 'object' && !Array.isArray(scraperUrls)
          ? Object.keys(scraperUrls).length
          : 0;
        const isScraperProblem = scraperUrlsCount < 2;

        return (isProblem || isScraperProblem) && !isUpcomingEpisode(ep);
      });

      const missingUrlCount = incomplete.filter(ep => isBadUrl(ep.video_url)).length;
      const missingServersCount = incomplete.filter(ep => isBadServers(ep.video_servers)).length;

      setScanResults(incomplete);
      setStats({
        totalChecked: (totalEpCount || 0) + virtualEpisodes.length,
        totalIncomplete: incomplete.length,
        missingUrl: missingUrlCount,
        missingServers: missingServersCount
      });
    } catch (err) {
      console.error('Maintenance Scan failed:', err);
      // FIX #5: surface the error to the user
      setScanError(err instanceof Error ? err.message : 'Database scan failed. Please try again.');
    } finally {
      setScanning(false);
    }
  };

  // Filter and Sort results
  const getFilteredAndGroupedResults = () => {
    if (!scanResults) return [];

    let filtered = [...scanResults];

    // 1. Text search by anime title
    if (searchTerm.trim() !== '') {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(ep => {
        const title = ep.anime?.title?.toLowerCase() || '';
        const engTitle = ep.anime?.title_english?.toLowerCase() || '';
        return title.includes(q) || engTitle.includes(q);
      });
    }

    // 2. Filter by issue type — FIX #12: use centralised helpers
    if (filterType === 'missing_url') {
      filtered = filtered.filter(ep => isBadUrl(ep.video_url));
    } else if (filterType === 'missing_servers') {
      filtered = filtered.filter(ep => isBadServers(ep.video_servers));
    } else if (filterType === 'both_missing') {
      filtered = filtered.filter(ep => isBadUrl(ep.video_url) && isBadServers(ep.video_servers));
    }

    // 3. Filter by anime release status
    if (filterStatus !== 'all') {
      filtered = filtered.filter(ep => ep.anime?.status?.toLowerCase() === filterStatus);
    }

    // 4. Filter by having less than 2 scraper / server URLs if active
    if (onlyLessServers) {
      filtered = filtered.filter(ep => {
        // Safe check for scraper URLs count (JSON/object or null)
        const scraperUrls = ep.anime?.scraper_urls;
        const scraperUrlsCount = scraperUrls && typeof scraperUrls === 'object' && !Array.isArray(scraperUrls)
          ? Object.keys(scraperUrls).length
          : 0;

        // Safe check for video servers count (JSONB array or null/empty)
        const serverUrlsCount = Array.isArray(ep.video_servers)
          ? ep.video_servers.length
          : 0;

        return scraperUrlsCount < 2 || serverUrlsCount < 2;
      });
    } else {
      // If the toggle is OFF, we ONLY show episodes that are actually broken (missing URL or servers)
      filtered = filtered.filter(ep => isBadUrl(ep.video_url) || isBadServers(ep.video_servers));
    }

    // Group by Anime
    const groupedMap = new Map<string, {
      animeId: string;
      animeTitle: string;
      posterUrl: string | null;
      status: string;
      episodes: Episode[];
    }>();

    filtered.forEach(ep => {
      const animeId = ep.anime_id;
      const animeTitle = ep.anime?.title || 'Unknown Anime';
      const posterUrl = ep.anime?.poster_url || null;
      const status = ep.anime?.status || 'unknown';

      if (!groupedMap.has(animeId)) {
        groupedMap.set(animeId, { animeId, animeTitle, posterUrl, status, episodes: [] });
      }
      groupedMap.get(animeId)!.episodes.push(ep);
    });

    // Convert Map to Array
    let groupedList = Array.from(groupedMap.values());

    // Sort the list of anime groups
    if (sortBy === 'problems_desc') {
      groupedList.sort((a, b) => b.episodes.length - a.episodes.length);
    } else {
      groupedList.sort((a, b) => a.animeTitle.localeCompare(b.animeTitle));
    }

    // Sort episodes inside each group
    groupedList.forEach(group => {
      if (sortBy === 'ep_desc') {
        group.episodes.sort((a, b) => b.episode_number - a.episode_number);
      } else {
        // Default to ascending order (covers 'problems_desc' and 'ep_asc')
        group.episodes.sort((a, b) => a.episode_number - b.episode_number);
      }
    });

    return groupedList;
  };

  // Open Quick Edit Modal
  const openEditModal = (ep: Episode) => {
    setEditingEpisode(ep);
    setEditTitle(ep.title || '');
    setEditVideoUrl(ep.video_url || '');
    setEditServers(ep.video_servers || []);
    setEditError(null);
  };

  // Close Quick Edit Modal
  const closeEditModal = () => {
    setEditingEpisode(null);
    setEditServers([]);
    setEditError(null);
  };

  // Add Server slot in quick edit modal
  const addServerRow = () => {
    setEditServers([...editServers, { name: 'AnimeSuge Active', url: '', lang: 'sub' }]);
  };

  // Remove Server slot in quick edit modal
  const removeServerRow = (index: number) => {
    setEditServers(editServers.filter((_, idx) => idx !== index));
  };

  // Update server slot values in quick edit modal
  const handleServerChange = (index: number, key: keyof EpisodeServer, val: string) => {
    const updated = [...editServers];
    updated[index] = { ...updated[index], [key]: val };
    setEditServers(updated);
  };

  // Save quick edits to database
  const saveQuickEdit = async () => {
    if (!editingEpisode) return;
    try {
      setSavingEdit(true);
      setEditError(null);

      // Clean empty server fields
      const cleanServers = editServers.filter(s => s.name.trim() !== '' && s.url.trim() !== '');

      const payload = {
        title: editTitle.trim() || `${editingEpisode.anime?.title || 'Anime'} - Episode ${editingEpisode.episode_number}`,
        video_url: editVideoUrl.trim() || null,
        video_servers: cleanServers.length > 0 ? cleanServers : null,
      };

      let resultData;
      if (editingEpisode.id.startsWith('virtual-')) {
        // Insert new episode stub for virtual stub
        const insertPayload = {
          anime_id: editingEpisode.anime_id,
          episode_number: editingEpisode.episode_number,
          title: payload.title,
          video_url: payload.video_url,
          video_servers: payload.video_servers,
          duration: 1440,
          description: `Episode ${editingEpisode.episode_number} of ${editingEpisode.anime?.title}`,
          created_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('episodes')
          .insert(insertPayload)
          .select()
          .single();

        if (error) throw error;
        resultData = data;
      } else {
        // Update existing episode
        const { data, error } = await supabase
          .from('episodes')
          .update(payload)
          .eq('id', editingEpisode.id)
          .select()
          .single();

        if (error) throw error;
        resultData = data;
      }

      // Update local state lists in real-time
      const updatedEpisode = {
        ...editingEpisode,
        id: resultData.id, // Ensure real ID is used going forward
        title: resultData.title,
        video_url: resultData.video_url,
        video_servers: resultData.video_servers
      };

      const updateList = (list: Episode[]) =>
        list.map(ep => ep.id === editingEpisode.id || ep.id === resultData.id ? updatedEpisode : ep)
          .filter(ep => isBadUrl(ep.video_url) || isBadServers(ep.video_servers)); // FIX #12

      setScanResults(prev => prev ? updateList(prev) : null);

      // FIX #11: only decrement counters based on the pre-edit state of the episode,
      // not just whether the new payload is filled — prevents over-decrementing.
      setStats(prev => {
        const wasNoUrl = isBadUrl(editingEpisode.video_url);
        const wasNoServers = isBadServers(editingEpisode.video_servers);
        const isNowFixed = !isBadUrl(updatedEpisode.video_url) && !isBadServers(updatedEpisode.video_servers);
        return {
          ...prev,
          totalIncomplete: Math.max(0, prev.totalIncomplete - (isNowFixed ? 1 : 0)),
          missingUrl: Math.max(0, prev.missingUrl - (wasNoUrl && !isBadUrl(updatedEpisode.video_url) ? 1 : 0)),
          missingServers: Math.max(0, prev.missingServers - (wasNoServers && !isBadServers(updatedEpisode.video_servers) ? 1 : 0)),
        };
      });

      closeEditModal();
    } catch (err) {
      console.error('Failed to save manual episode edit:', err);
      setEditError(err instanceof Error ? err.message : 'Database update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  // Trigger sequential multi-scraper live update for single episode
  const triggerAutoScrape = async (ep: Episode) => {
    const epId = ep.id;
    try {
      setScrapingStatus(prev => ({
        ...prev,
        [epId]: { status: 'scraping', message: 'Triggering sequential scrapers...' }
      }));

      const data = await apiClient.post('/api/admin/maintenance/scrape-sequential', {
        animeId: ep.anime_id,
        episodeNumber: ep.episode_number
      });

      if (data.success && data.episode) {
        setScrapingStatus(prev => ({
          ...prev,
          [epId]: { status: 'success', message: data.message || 'Scraped successfully!' }
        }));

        // Merge saved data into state
        const updated = {
          ...ep,
          id: data.episode.id, // Update virtual ID to real database ID!
          title: data.episode.title,
          video_url: data.episode.video_url,
          video_servers: data.episode.video_servers
        };

        // FIX #1: only decrement totalIncomplete if the episode is FULLY fixed
        const wasNoUrl = isBadUrl(ep.video_url);
        const wasNoServers = isBadServers(ep.video_servers);
        const isNowFixed = !isBadUrl(updated.video_url) && !isBadServers(updated.video_servers);

        setStats(prev => ({
          ...prev,
          totalIncomplete: Math.max(0, prev.totalIncomplete - (isNowFixed ? 1 : 0)),
          missingUrl: Math.max(0, prev.missingUrl - (wasNoUrl && !isBadUrl(updated.video_url) ? 1 : 0)),
          missingServers: Math.max(0, prev.missingServers - (wasNoServers && !isBadServers(updated.video_servers) ? 1 : 0)),
        }));

        // FIX #8: brief success flash (1.2 s) before the card vanishes so the user
        // gets visual reward feedback instead of the card abruptly disappearing.
        await new Promise(r => setTimeout(r, 1200));

        const updateList = (list: Episode[]) =>
          list.map(item => item.id === epId ? updated : item)
            .filter(item => isBadUrl(item.video_url) || isBadServers(item.video_servers)); // FIX #12

        setScanResults(prev => prev ? updateList(prev) : null);

        // FIX #2: clean up scrapingStatus for the removed episode to prevent stale
        // status messages from reappearing if the same ep ID shows up after a re-scan.
        setScrapingStatus(prev => {
          const next = { ...prev };
          delete next[epId];
          // Also clean up the real ID in case a virtual -> real mapping happened
          if (data.episode.id !== epId) delete next[data.episode.id];
          return next;
        });

      } else {
        setScrapingStatus(prev => ({
          ...prev,
          [epId]: { status: 'error', message: data.message || data.error || 'Scraping returned no servers.' }
        }));
      }
    } catch (err) {
      console.error('Sequential scrape request failed:', err);
      setScrapingStatus(prev => ({
        ...prev,
        [epId]: { status: 'error', message: err instanceof Error ? err.message : 'Connection error' }
      }));
    }
  };

  // Run sequential scrapes for all incomplete episodes under a specific anime
  const handleScrapeAllForAnime = async (animeId: string, episodesToScrape: Episode[]) => {
    try {
      setScrapingAllAnimeId(animeId);
      setExpandedAnime(animeId);

      // Create a static copy to prevent looping issues during live state shifts
      const staticList = [...episodesToScrape].sort((a, b) => a.episode_number - b.episode_number);

      console.log(`🤖 Starting Scrape All for Anime ID ${animeId} (${staticList.length} episodes)`);

      for (let i = 0; i < staticList.length; i++) {
        const ep = staticList[i];
        setScrapeAllProgressMsg(`Scraping EP ${ep.episode_number} (${i + 1}/${staticList.length})`);

        // Wait for this episode's sequential scrape to resolve
        await triggerAutoScrape(ep);

        // Wait 2 seconds to pace Playwright threads gently
        if (i < staticList.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (err) {
      console.error("Batch scrape execution failed:", err);
    } finally {
      setScrapingAllAnimeId(null);
      setScrapeAllProgressMsg('');
    }
  };

  const groupedResults = getFilteredAndGroupedResults();

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-800 font-sans overflow-x-hidden pb-16">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.05%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%222%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40 pointer-events-none"></div>

      {/* Ambient Glowing Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-gradient-to-br from-blue-400/20 to-purple-400/20 blur-[120px] pointer-events-none animate-pulse duration-[6000ms]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] rounded-full bg-gradient-to-br from-indigo-400/15 to-rose-400/15 blur-[120px] pointer-events-none animate-pulse duration-[8000ms]"></div>

      <div className="relative z-10 container mx-auto px-4 py-8 max-w-7xl">
        {/* Page Title & Controls */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6 mb-8 border-b border-slate-200/60 pb-6">
          <div>
            <div className="flex items-center gap-3.5 mb-2">
              <div className="w-12 h-12 bg-gradient-to-tr from-blue-600 via-indigo-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20 hover:scale-105 transition-transform">
                <i className="ri-shield-flash-fill text-white text-2xl animate-pulse"></i>
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-black bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
                  Integrity & Maintenance
                </h1>
                <p className="text-slate-500 text-xs font-mono tracking-widest uppercase mt-0.5">Database Diagnostic Panel</p>
              </div>
            </div>
            <p className="text-slate-600 text-sm sm:text-base max-w-2xl font-medium mt-1">
              Isolate broken stream links, find missing episode servers, and invoke automated multi-pipeline sequence scraping in one click.
            </p>
          </div>

          <button
            onClick={handleScanDatabase}
            disabled={scanning}
            className="px-6 py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-2xl text-sm font-extrabold transition-all duration-300 shadow-md hover:shadow-lg hover:shadow-blue-500/20 flex items-center gap-2.5 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
          >
            {scanning ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Scanning catalog...</span>
              </>
            ) : (
              <>
                <i className="ri-radar-line text-base animate-pulse"></i>
                <span>Refresh Diagnostics</span>
              </>
            )}
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Scan error banner */}
          {scanError && (
            <div className="mb-6 bg-rose-50 border border-rose-200 text-rose-700 rounded-3xl px-5 py-4 flex items-start gap-3 shadow-md">
              <i className="ri-error-warning-fill text-xl flex-shrink-0 mt-0.5"></i>
              <div>
                <div className="font-bold text-sm">Scan Failed</div>
                <div className="text-xs mt-0.5 text-rose-600">{scanError}</div>
              </div>
              <button
                onClick={handleScanDatabase}
                className="ml-auto px-3.5 py-1.5 bg-rose-100 hover:bg-rose-200 border border-rose-300 rounded-xl text-xs font-bold text-rose-700 transition-colors flex-shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {[
              { label: 'Total Checked', val: stats.totalChecked, icon: 'ri-bookmark-3-line', color: 'from-blue-500 to-indigo-600 shadow-blue-500/10' },
              { label: 'Incomplete Episodes', val: stats.totalIncomplete, icon: 'ri-error-warning-line', color: 'from-rose-500 to-pink-600 shadow-rose-500/10' },
              { label: 'Missing Primary URLs', val: stats.missingUrl, icon: 'ri-link-unlink-m', color: 'from-amber-500 to-orange-600 shadow-amber-500/10' },
              { label: 'Missing Server Slots', val: stats.missingServers, icon: 'ri-server-fill', color: 'from-cyan-500 to-blue-600 shadow-cyan-500/10' }
            ].map((card, idx) => (
              <div key={idx} className="bg-white/65 backdrop-blur-md border border-white/45 rounded-3xl p-5 shadow-lg shadow-slate-100/50 hover:shadow-xl hover:border-slate-350 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] group relative overflow-hidden flex flex-col justify-between">
                <div className="absolute -right-4 -bottom-4 text-slate-100 group-hover:text-slate-200/50 text-7xl group-hover:scale-110 transition-all duration-500 pointer-events-none select-none">
                  <i className={card.icon}></i>
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-1.5">
                    <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${card.color} text-white flex items-center justify-center shadow-md`}>
                      <i className={`${card.icon} text-xs`}></i>
                    </div>
                    {card.label}
                  </div>
                  <div className="text-3xl font-black font-mono tracking-tight text-slate-800 mt-2">{card.val.toLocaleString()}</div>
                </div>
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mt-4">
                  <div className={`h-full bg-gradient-to-r ${card.color}`} style={{ width: card.val > 0 ? '100%' : '0%' }}></div>
                </div>
              </div>
            ))}
          </div>

          {/* Filters Controls Panel */}
          <div className="bg-white/60 border border-white/40 backdrop-blur-md rounded-3xl p-6 mb-8 shadow-xl shadow-slate-100/30">
            <div className="flex items-center justify-between gap-4 mb-5 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <i className="ri-equalizer-line text-blue-600 text-lg"></i>
                <h3 className="font-extrabold text-sm text-slate-800 uppercase tracking-wider">Integrity Filters</h3>
              </div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-100/80 px-2.5 py-1 rounded-full border border-slate-200/50">Diagnostic Tools</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Search Input */}
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <i className="ri-search-2-line text-base"></i>
                </span>
                <input
                  type="text"
                  placeholder="Search anime title..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full bg-white/70 border border-slate-200 rounded-2xl pl-10 pr-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 transition-all shadow-sm font-semibold"
                />
              </div>

              {/* Filter by Problem Type */}
              <div className="relative">
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value as any)}
                  className="w-full bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 cursor-pointer transition-all shadow-sm appearance-none font-semibold"
                >
                  <option value="all">All Stream Problems</option>
                  <option value="missing_url">Missing Primary Video URL</option>
                  <option value="missing_servers">Empty Video Server List</option>
                  <option value="both_missing">Complete Stream Info Missing</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <i className="ri-arrow-down-s-line text-lg"></i>
                </div>
              </div>

              {/* Filter by Release Status */}
              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value as any)}
                  className="w-full bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 cursor-pointer transition-all shadow-sm appearance-none font-semibold"
                >
                  <option value="all">All Anime Statuses</option>
                  <option value="ongoing">Ongoing Anime</option>
                  <option value="completed">Completed Anime</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <i className="ri-arrow-down-s-line text-lg"></i>
                </div>
              </div>

              {/* Sort Results */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="w-full bg-white/70 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 cursor-pointer transition-all shadow-sm appearance-none font-semibold"
                >
                  <option value="problems_desc">Most Problematic Anime First</option>
                  <option value="ep_asc">Episode Number: Low to High</option>
                  <option value="ep_desc">Episode Number: High to Low</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3.5 flex items-center pointer-events-none text-slate-400">
                  <i className="ri-arrow-down-s-line text-lg"></i>
                </div>
              </div>
            </div>

            {/* Integrity Diagnostics Toggles */}
            <div className="mt-5 pt-4 border-t border-slate-100/80 flex flex-wrap gap-6 items-center animate-in fade-in duration-300">
              <div
                onClick={() => setOnlyLessServers(prev => !prev)}
                className={`flex items-center gap-3.5 px-4 py-2.5 rounded-2xl border transition-all duration-300 cursor-pointer select-none group shadow-sm ${onlyLessServers
                  ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-rose-500/5'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-800'
                  }`}
              >
                <button
                  type="button"
                  id="only-less-servers-toggle"
                  className={`relative w-9 h-5.5 rounded-full transition-colors duration-300 focus:outline-none flex-shrink-0 ${onlyLessServers ? 'bg-rose-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform duration-300 ${onlyLessServers ? 'translate-x-3.5' : 'translate-x-0'}`} />
                </button>
                <span className="text-xs sm:text-sm font-extrabold flex items-center gap-2">
                  <i className={`ri-shield-cross-line text-base ${onlyLessServers ? 'text-rose-500 animate-pulse' : 'text-slate-400'}`}></i>
                  Show only Anime with &lt; 2 Scraper/Server URLs
                </span>
              </div>
            </div>
          </div>

          {/* Results Stream Area */}
          {scanning ? (
            <div className="flex justify-center items-center py-20">
              <SparkleLoadingSpinner size="lg" text="Scanning Supabase tables for stream integrity..." />
            </div>
          ) : groupedResults.length === 0 ? (
            <div className="text-center py-16 bg-white/60 border border-white/40 rounded-3xl backdrop-blur-md shadow-xl max-w-2xl mx-auto animate-in zoom-in-95 duration-350">
              <div className="w-16 h-16 mx-auto mb-4 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100 text-emerald-600 shadow-inner animate-bounce">
                <i className="ri-checkbox-circle-fill text-3xl"></i>
              </div>
              <h3 className="text-xl font-black text-slate-800">Catalog Integrity 100% Secure!</h3>
              <p className="text-slate-500 text-sm max-w-sm mx-auto mt-2 px-4 leading-relaxed font-medium">
                No problematic streams detected. All scanned episodes contain valid primary streaming links and modular server routes.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between px-1.5">
                <span className="text-xs uppercase font-black text-slate-400 tracking-widest font-mono">
                  Problematic Catalog ({groupedResults.length} Anime, {stats.totalIncomplete} Episodes)
                </span>
              </div>

              {groupedResults.map((group) => {
                const isExpanded = expandedAnime === group.animeId;
                return (
                  <div
                    key={group.animeId}
                    className={`bg-white/60 hover:bg-white/80 border border-white/50 backdrop-blur-md rounded-3xl overflow-hidden transition-all duration-350 shadow-md hover:shadow-xl hover:scale-[1.005] hover:border-blue-200/60 ${isExpanded ? 'ring-2 ring-blue-500/10' : ''
                      }`}
                  >
                    {/* Accordion Trigger Header */}
                    <div
                      onClick={() => setExpandedAnime(isExpanded ? null : group.animeId)}
                      className="px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-5 cursor-pointer select-none"
                    >
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        {group.posterUrl ? (
                          <img
                            src={group.posterUrl}
                            alt=""
                            className="w-12 h-16 object-cover rounded-2xl shadow-lg border border-slate-200/60 flex-shrink-0 hover:scale-105 transition-transform"
                            width={48}
                            height={64}
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-12 h-16 bg-slate-100 rounded-2xl flex items-center justify-center flex-shrink-0 border border-slate-200 text-slate-400">
                            <i className="ri-film-line text-xl"></i>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="font-extrabold text-slate-800 hover:text-blue-600 transition-colors truncate text-base tracking-wide uppercase">
                            {group.animeTitle}
                          </h3>
                          <div className="flex items-center gap-2.5 mt-2 flex-wrap">
                            <span className="bg-rose-50 text-rose-600 border border-rose-200/80 px-2.5 py-0.5 rounded-xl text-[10px] font-black uppercase tracking-wider shadow-sm flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping"></span>
                              {group.episodes.length} episodes broken
                            </span>
                            <span className="bg-slate-100 text-slate-500 border border-slate-200 px-2.5 py-0.5 rounded-xl text-[10px] font-black uppercase tracking-wide">
                              {group.status}
                            </span>
                            {group.episodes[0]?.anime?.scraper_urls && (
                              <span className="bg-blue-50 text-blue-600 border border-blue-200/50 px-2.5 py-0.5 rounded-xl text-[10px] font-black uppercase tracking-wide flex items-center gap-1">
                                <i className="ri-links-fill text-[11px]"></i>
                                {Object.keys(group.episodes[0].anime.scraper_urls).length} Scrapers
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end md:self-center">
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            handleScrapeAllForAnime(group.animeId, group.episodes);
                          }}
                          disabled={scrapingAllAnimeId !== null}
                          title={
                            scrapingAllAnimeId !== null && scrapingAllAnimeId !== group.animeId
                              ? `A batch scrape is already running for another anime \u2014 please wait for it to finish.`
                              : `Auto-scrape all ${group.episodes.length} broken episodes sequentially`
                          }
                          className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl text-xs font-extrabold shadow-md flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
                        >
                          {scrapingAllAnimeId === group.animeId ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>{scrapeAllProgressMsg}</span>
                            </>
                          ) : (
                            <>
                              <i className="ri-play-list-add-line text-sm"></i>
                              <span>Auto-Repair All ({group.episodes.length})</span>
                            </>
                          )}
                        </button>

                        <a
                          href={`/admin/anime?id=${group.animeId}`}
                          onClick={e => e.stopPropagation()}
                          className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-2xl text-xs font-extrabold shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5"
                        >
                          <i className="ri-external-link-line"></i>
                          Manage
                        </a>
                        <div className={`w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-all ${isExpanded ? 'bg-slate-100 text-blue-500' : ''}`}>
                          <i className={`text-xl transition-transform duration-300 ${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
                        </div>
                      </div>
                    </div>

                    {/* Accordion Dropdown Content */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: 'easeInOut' }}
                          className="border-t border-slate-100 bg-slate-50/40 backdrop-blur-sm"
                        >
                          <div className="px-6 py-5 space-y-3.5">
                            {group.episodes.map((ep) => {
                              const isScraping = scrapingStatus[ep.id]?.status === 'scraping';
                              const isUpcoming = isUpcomingEpisode(ep);
                              const noUrl = isBadUrl(ep.video_url);
                              const noServers = isBadServers(ep.video_servers);

                              return (
                                <div
                                  key={ep.id}
                                  className="bg-white/80 border border-slate-100 hover:border-slate-200/80 rounded-2xl p-4 flex flex-col md:flex-row justify-between md:items-center gap-4 transition-all hover:scale-[1.01] hover:shadow-md shadow-sm"
                                >
                                  {/* Episode details */}
                                  <div className="space-y-1.5">
                                    <div className="text-sm font-extrabold text-slate-800">
                                      <span className="text-blue-600 font-black mr-2 font-mono tracking-tight">EP {ep.episode_number}</span>
                                      {ep.title || `Episode ${ep.episode_number}`}
                                    </div>

                                    {/* Scraper Status */}
                                    {scrapingStatus[ep.id] && (
                                      <div className={`text-xs font-extrabold ${scrapingStatus[ep.id].status === 'success' ? 'text-green-600' :
                                        scrapingStatus[ep.id].status === 'error' ? 'text-rose-600' :
                                          'text-amber-600 animate-pulse'
                                        } flex items-center gap-1.5`}>
                                        {scrapingStatus[ep.id].status === 'scraping' && <i className="ri-loader-4-line animate-spin text-sm"></i>}
                                        {scrapingStatus[ep.id].status === 'success' && <i className="ri-checkbox-circle-fill text-sm"></i>}
                                        {scrapingStatus[ep.id].status === 'error' && <i className="ri-error-warning-fill text-sm"></i>}
                                        <span>{scrapingStatus[ep.id].message}</span>
                                      </div>
                                    )}

                                    <div className="flex flex-wrap gap-2.5 pt-1">
                                      {isUpcoming ? (
                                        <span className="bg-slate-50 text-slate-500 border border-slate-200 px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                                          <i className="ri-calendar-todo-fill text-indigo-500"></i>
                                          Upcoming / Unreleased
                                        </span>
                                      ) : (
                                        <>
                                          {noUrl && (
                                            <span className="bg-rose-50 text-rose-600 px-2.5 py-0.5 rounded-lg text-[10px] font-black border border-rose-200/80 flex items-center gap-1">
                                              <i className="ri-link-unlink"></i>
                                              Missing Primary URL
                                            </span>
                                          )}
                                          {noServers && (
                                            <span className="bg-amber-50 text-amber-600 px-2.5 py-0.5 rounded-lg text-[10px] font-black border border-amber-200/80 flex items-center gap-1">
                                              <i className="ri-server-line"></i>
                                              No Video Servers
                                            </span>
                                          )}
                                        </>
                                      )}
                                      {!noServers && (
                                        <span className="bg-blue-50 text-blue-600 px-2.5 py-0.5 rounded-lg text-[10px] font-black border border-blue-200/60 flex items-center gap-1.5">
                                          <i className="ri-server-fill text-xs text-blue-500"></i>
                                          {ep.video_servers?.length} servers loaded
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Action Buttons */}
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => openEditModal(ep)}
                                      disabled={isScraping}
                                      className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 hover:text-slate-800 rounded-2xl text-xs font-extrabold transition-all border border-slate-200 flex items-center gap-1.5"
                                      title="Edit streams manually"
                                    >
                                      <i className="ri-edit-2-line text-sm text-slate-500"></i>
                                      Quick Edit
                                    </button>

                                    <button
                                      onClick={() => triggerAutoScrape(ep)}
                                      disabled={isScraping}
                                      className="px-4 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-2xl text-xs font-extrabold transition-all flex items-center gap-1.5 shadow disabled:opacity-50 hover:scale-105 active:scale-95"
                                      title={isUpcoming ? "Scrape upcoming episode anyway" : "Run all scrapers sequentially to repair streams"}
                                    >
                                      {isScraping ? (
                                        <>
                                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                          <span>Scraping...</span>
                                        </>
                                      ) : isUpcoming ? (
                                        <>
                                          <i className="ri-time-line text-blue-200"></i>
                                          <span>Force Scrape</span>
                                        </>
                                      ) : (
                                        <>
                                          <i className="ri-play-fill text-sm"></i>
                                          <span>Auto-Repair</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Quick Edit Dialog Modal Overlay */}
      <AnimatePresence>
        {editingEpisode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white/95 backdrop-blur-md border border-white/50 w-full max-w-2xl rounded-[32px] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] relative text-slate-800"
            >
              {/* Modal Header */}
              <div className="px-6 py-5 bg-slate-50/80 border-b border-slate-200/60 flex justify-between items-center relative z-10">
                <div>
                  <h3 className="font-black text-lg text-slate-800 tracking-wide uppercase">
                    Quick Edit Stream: EP {editingEpisode.episode_number}
                  </h3>
                  <p className="text-blue-600 font-extrabold text-xs truncate max-w-md mt-0.5">
                    {editingEpisode.anime?.title}
                  </p>
                </div>
                <button
                  onClick={closeEditModal}
                  className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors border border-transparent hover:border-slate-200"
                >
                  <i className="ri-close-line text-2xl"></i>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto relative z-10">
                {editingEpisode && scrapingStatus[editingEpisode.id]?.status === 'scraping' && (
                  <div className="bg-amber-50 border border-amber-200/80 text-amber-700 rounded-2xl p-4 text-xs flex items-center gap-3 shadow-inner">
                    <div className="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
                    <span className="font-semibold"><strong>Auto-scrape in progress</strong> for this episode. Saving manual edits now may conflict with the scraper result. Consider waiting for it to finish.</span>
                  </div>
                )}
                {editError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-600 rounded-2xl p-4 text-xs flex items-center gap-2">
                    <i className="ri-error-warning-fill text-lg"></i>
                    <span className="font-semibold">{editError}</span>
                  </div>
                )}

                {/* Title */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                    Episode Custom Title
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    placeholder={`Episode ${editingEpisode.episode_number}`}
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 transition-all font-semibold shadow-sm"
                  />
                </div>

                {/* Primary Video URL */}
                <div className="space-y-2">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                    Primary Video Stream URL
                  </label>
                  <input
                    type="text"
                    value={editVideoUrl}
                    onChange={e => setEditVideoUrl(e.target.value)}
                    placeholder="Enter direct video source URL (.mp4, .m3u8, etc.)"
                    className="w-full bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100/60 transition-all font-semibold shadow-sm"
                  />
                </div>

                {/* Servers Array slots */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest font-mono">
                      Video Servers Slots list ({editServers.length})
                    </label>
                    <button
                      type="button"
                      onClick={addServerRow}
                      className="px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200/50 rounded-xl text-xs font-extrabold transition-all hover:scale-105 active:scale-95 flex items-center gap-1 shadow-sm"
                    >
                      <i className="ri-add-fill text-base"></i> Add Server
                    </button>
                  </div>

                  {editServers.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50/50 rounded-2xl border border-slate-200/60 text-slate-450 text-xs font-medium leading-relaxed">
                      No server entries configured yet. Click "Add Server" to manually insert source links.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {editServers.map((srv, idx) => (
                        <div key={idx} className="bg-slate-50/60 backdrop-blur-sm border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-end relative shadow-inner">
                          {/* Name Input */}
                          <div className="w-full sm:flex-1 space-y-1.5">
                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Server Name</label>
                            <input
                              type="text"
                              value={srv.name}
                              onChange={e => handleServerChange(idx, 'name', e.target.value)}
                              placeholder="e.g. Gogo HLS"
                              className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 font-semibold shadow-sm"
                            />
                          </div>

                          {/* URL Input */}
                          <div className="w-full sm:flex-[2] space-y-1.5">
                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Iframe/Playable Stream URL</label>
                            <input
                              type="text"
                              value={srv.url}
                              onChange={e => handleServerChange(idx, 'url', e.target.value)}
                              placeholder="Embed watch link or direct HLS source"
                              className="w-full bg-white border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 font-semibold shadow-sm"
                            />
                          </div>

                          {/* Language Selection */}
                          <div className="w-full sm:w-auto space-y-1.5">
                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Language</label>
                            <select
                              value={srv.lang}
                              onChange={e => handleServerChange(idx, 'lang', e.target.value)}
                              className="w-full sm:w-auto bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-blue-500 cursor-pointer font-bold shadow-sm"
                            >
                              <option value="sub">Sub</option>
                              <option value="dub">Dub</option>
                              <option value="raw">Raw</option>
                            </select>
                          </div>

                          {/* Remove button */}
                          <button
                            type="button"
                            onClick={() => removeServerRow(idx)}
                            className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 transition-colors shadow-sm"
                            title="Remove server"
                          >
                            <i className="ri-delete-bin-line text-base"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-200/60 flex justify-end gap-3 relative z-10">
                <button
                  onClick={closeEditModal}
                  disabled={savingEdit}
                  className="px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl text-sm font-extrabold text-slate-600 hover:text-slate-855 transition-all shadow-sm hover:scale-105 active:scale-95"
                >
                  Cancel
                </button>

                <button
                  onClick={saveQuickEdit}
                  disabled={savingEdit}
                  className="px-6 py-2.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white font-extrabold rounded-2xl text-sm transition-all flex items-center gap-1.5 shadow shadow-blue-500/10 hover:scale-105 active:scale-95"
                >
                  {savingEdit ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      <span>Saving links...</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-save-line text-base"></i>
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
