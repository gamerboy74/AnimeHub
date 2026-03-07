import { useCallback, useRef } from 'react';
import { VideoService } from '../../services/media/video';
import type { VideoSource } from '../../services/media/video';
import { AnimeService } from '../../services/anime';
import { supabase } from '../../lib/database/supabase';

interface AnimeEpisode {
  number: number;
  sources: VideoSource[];
  title: string;
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

      // Generate video sources based on the video URL
      const videoUrl = episode.video_url;
      if (!videoUrl) {
        throw new Error('No video URL available for this episode');
      }

      const sourceType = VideoService.detectVideoSource(videoUrl);
      let sources: VideoSource[] = [];

      if (sourceType === 'youtube') {
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
        title: episode.title || `Episode ${episodeNumber}`
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
    accuracy: 'accurate' | 'estimated' | 'manual' = 'accurate'
  ): Promise<void> => {
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Always save to localStorage as backup
      const key = `watch_progress_${animeId}_${episodeNumber}`;
      localStorage.setItem(key, timestamp.toString());
      localStorage.setItem(`${key}_accuracy`, accuracy);
      
      if (!user) {
        return; // For non-authenticated users, only use localStorage
      }

      // Get episode ID
      const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .select('id, duration')
        .eq('anime_id', animeId)
        .eq('episode_number', episodeNumber)
        .single();

      if (episodeError || !episode) {
        console.warn('Episode not found for progress update:', episodeError);
        return; // localStorage backup is already saved
      }

      // Determine if episode is completed (90%+ watched or manual complete)
      const duration = episode.duration || 1440; // Default 24 minutes
      const isCompleted = accuracy === 'manual' && timestamp >= duration * 0.9 || timestamp >= duration * 0.9;

      // Update or insert watch progress with metadata
      // Store accuracy in metadata JSON field (if available) or use a separate approach
      const { error } = await supabase
        .from('user_progress')
        .upsert({
          user_id: user.id,
          episode_id: episode.id,
          progress_seconds: timestamp,
          is_completed: isCompleted,
          last_watched: new Date().toISOString()
          // Note: If your schema has a metadata JSON field, add:
          // metadata: { accuracy, source: accuracy === 'postmessage' ? 'postmessage' : accuracy }
        }, {
          onConflict: 'user_id,episode_id'
        });

      if (error) {
        console.warn('Error updating watch progress in database:', error);
        // Don't throw error - localStorage backup is already saved
      }
    } catch (error) {
      console.error('Error updating watch progress:', error);
      // Don't throw error for progress updates - they're not critical
    }
  }, []);

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