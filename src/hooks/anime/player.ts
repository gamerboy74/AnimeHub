import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VideoService } from '../../services/media/video';
import type { VideoSource } from '../../services/media/video';
import { AnimeService } from '../../services/anime';
import { supabase } from '../../lib/database/supabase';

interface AnimeEpisode {
  number: number;
  sources: VideoSource[];
  title: string;
  id?: string;
  duration?: number;
}

interface WatchProgress {
  animeId: string;
  episodeNumber: number;
  timestamp: number;
}

// Module-level cache for episode sources (survives re-renders, cleared on page refresh)
const episodeSourcesCache = new Map<string, { data: AnimeEpisode; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useAnimePlayer = () => {
  const queryClient = useQueryClient();

  const normalizeLang = (lang?: string | null): 'sub' | 'dub' | undefined => {
    const normalized = lang?.toLowerCase();
    if (normalized === 'sub' || normalized === 'dub') return normalized;
    return undefined;
  };

  const getEpisodeSources = useCallback(async (animeId: string, episodeNumber: number): Promise<AnimeEpisode> => {
    try {
      // Check cache first
      const cacheKey = `${animeId}_${episodeNumber}`;
      const cached = episodeSourcesCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return cached.data;
      }

      // Get episode data from database
      const { data: episode, error } = await supabase
        .from('episodes')
        .select('*')
        .eq('anime_id', animeId)
        .eq('episode_number', episodeNumber)
        .single();

      if (error || !episode) {
        throw new Error('Episode not found');
      }

      // Generate video sources based on the video URL and servers list
      const videoUrl = episode.video_url;
      if (!videoUrl) {
        throw new Error('No video URL available for this episode');
      }

      const sourceType = VideoService.detectVideoSource(videoUrl);
      let sources: VideoSource[] = [];

      if (episode.video_servers && Array.isArray(episode.video_servers) && episode.video_servers.length > 0) {
        // Map database video_servers array directly to available player sources
        sources = episode.video_servers.map((srv: any) => {
          const type = VideoService.detectVideoSource(srv.url);
          return {
            quality: srv.name || 'HD',
            url: srv.url,
            provider: srv.name || 'Server',
            type: type,
            lang: normalizeLang(srv.lang) || (srv.url.toLowerCase().includes('dub') ? 'dub' : 'sub'),
          };
        });
      } else if (sourceType === 'youtube') {
        // Generate multiple quality options for YouTube
        sources = VideoService.generateYouTubeQualities(videoUrl);
      } else {
        // For direct sources, create a single source entry
        sources = [{
          quality: '720p',
          url: videoUrl,
          provider: 'Direct',
          type: sourceType,
        }];
      }

      const result: AnimeEpisode = {
        number: episodeNumber,
        sources,
        title: episode.title || `Episode ${episodeNumber}`,
        id: episode.id,
        duration: episode.duration || undefined
      };

      // Store in cache
      episodeSourcesCache.set(cacheKey, { data: result, ts: Date.now() });

      return result;
    } catch (error) {
      console.error('Error fetching episode sources:', error);
      throw new Error('Failed to fetch episode sources');
    }
  }, []);

  const updateWatchProgress = useCallback(async (
    animeId: string, 
    episodeNumber: number, 
    timestamp: number,
    accuracy: 'accurate' | 'estimated' | 'manual' = 'accurate',
    episodeId?: string,
    userId?: string,
    duration?: number
  ): Promise<void> => {
    console.log('⏳ [WatchProgress] Triggering progress save...', { animeId, episodeNumber, timestamp, accuracy, episodeId, userId });
    try {
      // Get user ID
      let activeUserId = userId;
      if (!activeUserId) {
        const { data: { user } } = await supabase.auth.getUser();
        activeUserId = user?.id;
      }
      
      // Always save to localStorage as backup
      const key = `watch_progress_${animeId}_${episodeNumber}`;
      localStorage.setItem(key, timestamp.toString());
      localStorage.setItem(`${key}_accuracy`, accuracy);
      
      // Update overall watchProgress object mapping in localStorage
      try {
        const savedProgress = JSON.parse(localStorage.getItem('watchProgress') || '{}');
        savedProgress[animeId] = Math.max(savedProgress[animeId] || 0, episodeNumber);
        localStorage.setItem('watchProgress', JSON.stringify(savedProgress));
      } catch (err) {
        console.error('Error updating watchProgress in localStorage:', err);
      }
      
      // Clear previous localStorage saves for other episodes of the same anime
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`watch_progress_${animeId}_`)) {
          if (!k.startsWith(`watch_progress_${animeId}_${episodeNumber}`)) {
            keysToRemove.push(k);
          }
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      
      if (!activeUserId) {
        console.log('💾 [WatchProgress] Saving to localStorage only (Not logged in)');
        return; // For non-authenticated users, only use localStorage
      }

      // Get episode ID and duration
      let activeEpisodeId = episodeId;
      let activeDuration = duration;

      if (!activeEpisodeId) {
        const { data: episode, error: episodeError } = await supabase
          .from('episodes')
          .select('id, duration')
          .eq('anime_id', animeId)
          .eq('episode_number', episodeNumber)
          .single();

        if (episodeError || !episode) {
          console.warn('⚠️ [WatchProgress] Episode not found in database for progress:', episodeError);
          return; // localStorage backup is already saved
        }
        activeEpisodeId = episode.id;
        activeDuration = episode.duration || undefined;
      }

      // Determine if episode is completed (90%+ watched)
      const finalDuration = activeDuration || 1440; // Default 24 minutes
      const isCompleted = timestamp >= finalDuration * 0.9;

      // Update or insert watch progress with metadata
      console.log('📤 [WatchProgress] Sending upsert to user_progress base table...');
      const { error } = await supabase
        .from('user_progress')
        .upsert({
          user_id: activeUserId,
          episode_id: activeEpisodeId,
          progress_seconds: timestamp,
          is_completed: isCompleted,
          last_watched: new Date().toISOString()
        }, {
          onConflict: 'user_id,episode_id'
        });

      if (error) {
        console.error('❌ [WatchProgress] Database Upsert Error:', error);
        // Don't throw error - localStorage backup is already saved
      } else {
        console.log('✅ [WatchProgress] Progress successfully saved to Supabase!');
        // Clear AnimeService memory cache to ensure that any cached queries are wiped
        AnimeService.clearCache();
        // Invalidate cached query data to refresh "Continue Watching", watch progress mapping, and anime details pages
        queryClient.invalidateQueries({ queryKey: ['user', 'continueWatching', activeUserId] });
        queryClient.invalidateQueries({ queryKey: ['anime', 'byId', animeId] });
        queryClient.invalidateQueries({ queryKey: ['user', 'watchProgress', activeUserId] });
      }
    } catch (error) {
      console.error('💥 [WatchProgress] Unexpected error saving progress:', error);
      // Don't throw error for progress updates - they're not critical
    }
  }, [queryClient]);

  // Manual progress update (user sets milestone)
  const updateWatchProgressManual = useCallback(async (
    animeId: string,
    episodeNumber: number,
    timestamp: number
  ): Promise<void> => {
    return updateWatchProgress(animeId, episodeNumber, timestamp, 'manual');
  }, [updateWatchProgress]);

  // Estimated progress update (time-based)
  const updateWatchProgressEstimated = useCallback(async (
    animeId: string,
    episodeNumber: number,
    timestamp: number
  ): Promise<void> => {
    return updateWatchProgress(animeId, episodeNumber, timestamp, 'estimated');
  }, [updateWatchProgress]);

  // Helper to estimate progress from time spent
  const estimateProgressFromTime = useCallback((timeSpentSeconds: number, estimatedDuration: number): number => {
    // Conservative estimate: use 80% of time spent
    return Math.floor(timeSpentSeconds * 0.8);
  }, []);

  const getWatchProgress = useCallback(async (animeId: string, episodeNumber: number): Promise<number> => {
    try {
      // Fast path: check localStorage first (instant)
      const key = `watch_progress_${animeId}_${episodeNumber}`;
      const localSaved = localStorage.getItem(key);
      const localProgress = localSaved ? parseInt(localSaved) : 0;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return localProgress;

      // Fetch episode + progress in parallel (instead of sequential)
      const [episodeResult] = await Promise.all([
        supabase
          .from('episodes')
          .select('id')
          .eq('anime_id', animeId)
          .eq('episode_number', episodeNumber)
          .single()
      ]);

      if (episodeResult.error || !episodeResult.data) {
        return localProgress;
      }

      const { data: progress, error: progressError } = await supabase
        .from('user_progress')
        .select('progress_seconds')
        .eq('user_id', user.id)
        .eq('episode_id', episodeResult.data.id)
        .maybeSingle();

      if (progressError) {
        return localProgress;
      }

      // Return whichever is further ahead (DB or localStorage)
      const dbProgress = progress?.progress_seconds || 0;
      return Math.max(dbProgress, localProgress);
    } catch (error) {
      console.error('Unexpected error fetching watch progress:', error);
      // Fallback to localStorage
      const key = `watch_progress_${animeId}_${episodeNumber}`;
      const saved = localStorage.getItem(key);
      return saved ? parseInt(saved) : 0;
    }
  }, []);

  return {
    getEpisodeSources,
    updateWatchProgress,
    updateWatchProgressManual,
    updateWatchProgressEstimated,
    estimateProgressFromTime,
    getWatchProgress
  };
};

export default useAnimePlayer;