import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import Hls from 'hls.js';
import { SparkleLoadingSpinner } from '../base/LoadingSpinner';
import { VideoService, type VideoSource } from '../../services/media/video';
import { chooseBestQuality } from '../../utils/media/player';
import IframePlayer from './IframePlayer';

interface SmartVideoPlayerProps {
  sources: VideoSource[];
  animeId: string;
  episodeNumber: number;
  title: string;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (error: string) => void;
  onProgressUpdate?: (progress: number, accuracy: 'accurate' | 'estimated' | 'manual') => void;
  autoPlay?: boolean;
  startTime?: number;
  className?: string;
}

interface PlayerState {
  currentSource: VideoSource | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  volume: number;
  isMuted: boolean;
  quality: string;
  retryCount: number;
  isRetrying: boolean;
}

export default function SmartVideoPlayer({
  sources,
  animeId,
  episodeNumber,
  title,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
  onError,
  onProgressUpdate,
  autoPlay = false,
  startTime = 0,
  className = ''
}: SmartVideoPlayerProps) {
  const [playerState, setPlayerState] = useState<PlayerState>({
    currentSource: null,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    isLoading: true,
    error: null,
    volume: 1,
    isMuted: false,
    quality: '720p',
    retryCount: 0,
    isRetrying: false
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const directSeekedRef = useRef(false);

  const normalizeLang = useCallback((lang?: string | null): 'sub' | 'dub' | undefined => {
    const normalized = lang?.toLowerCase();
    if (normalized === 'sub' || normalized === 'dub') return normalized;
    return undefined;
  }, []);

  useEffect(() => {
    directSeekedRef.current = false;
  }, [playerState.currentSource?.url]);

  const seekToStartTimeDirect = useCallback((video: HTMLVideoElement) => {
    if (!directSeekedRef.current && startTime && startTime > 0) {
      if (video.readyState >= 2) { // readyState >= 2 (HAVE_CURRENT_DATA) is required for browser seek to succeed
        const duration = video.duration;
        if (duration && !isNaN(duration) && duration > 0) {
          console.log(`🚀 Executing robust direct HTML5 seek to: ${startTime}s (readyState: ${video.readyState}, duration: ${duration}s)`);
          video.currentTime = Math.min(startTime, duration - 1);
          directSeekedRef.current = true;
        } else {
          console.log(`⏳ Direct HTML5 player readyState is ${video.readyState} but duration is ${duration} (not seekable yet)`);
        }
      } else {
        console.log(`⏳ Direct HTML5 player not ready for seek yet (readyState: ${video.readyState})`);
      }
    }
  }, [startTime]);

  const [activeLang, setActiveLang] = useState<'sub' | 'dub'>('sub');

  // Find which languages are available in sources
  const availableLangs = useMemo(() => {
    const langs = new Set<'sub' | 'dub'>();
    sources.forEach(s => {
      const normalizedLang = normalizeLang(s.lang);
      if (normalizedLang) langs.add(normalizedLang);
    });
    return Array.from(langs);
  }, [sources, normalizeLang]);

  useEffect(() => {
    if (availableLangs.length > 0) {
      if (availableLangs.includes('sub')) {
        setActiveLang('sub');
      } else {
        setActiveLang(availableLangs[0]);
      }
    }
  }, [availableLangs]);

  const filteredSources = useMemo(() => {
    const hasLangTags = sources.some(s => !!s.lang);
    if (!hasLangTags) return sources;
    return sources.filter(s => normalizeLang(s.lang) === activeLang);
  }, [sources, activeLang, normalizeLang]);

  // Group sources by language for server selector below player
  const subSources = useMemo(() => sources.filter(s => !s.lang || normalizeLang(s.lang) === 'sub'), [sources, normalizeLang]);
  const dubSources = useMemo(() => sources.filter(s => normalizeLang(s.lang) === 'dub'), [sources, normalizeLang]);

  // Select a source manually from the selector below player
  const selectSource = useCallback((source: VideoSource) => {
    const normalizedLang = normalizeLang(source.lang);
    if (normalizedLang) {
      setActiveLang(normalizedLang);
    }
    setPlayerState(prev => ({
      ...prev,
      currentSource: source,
      quality: source.quality,
      isLoading: true,
      error: null,
      retryCount: 0,
      isRetrying: false
    }));
  }, []);

  // Initialize player with best available source (memoized for performance)
  const initializePlayer = useCallback(() => {
    if (filteredSources.length === 0) {
      // Don't set error if sources are still loading - parent handles loading state
      setPlayerState(prev => ({ 
        ...prev, 
        currentSource: null,
        isLoading: true,
        error: null 
      }));
      return;
    }

    // Pick adaptive best source based on network conditions
    const available = filteredSources.map(s => s.quality);
    const preferred = chooseBestQuality(available);
    const bestSource = filteredSources.find(s => s.quality === preferred) || filteredSources[0];

    setPlayerState(prev => {
      // If we already have a valid source from the current filtered sources, keep it!
      if (prev.currentSource && filteredSources.some(s => s.url === prev.currentSource?.url)) {
        return {
          ...prev,
          isLoading: false,
          error: null
        };
      }

      // If we already have the same source, don't update state to prevent flickering
      if (prev.currentSource?.url === bestSource.url) {
        return prev;
      }

      return {
        ...prev,
        currentSource: bestSource,
        quality: bestSource.quality,
        isLoading: true,
        error: null,
        retryCount: 0,
        isRetrying: false
      };
    });
  }, [filteredSources]);

  useEffect(() => {
    // Only initialize if we have sources
    if (filteredSources.length === 0) {
      // Reset to loading state if sources are empty (only if not already in loading state)
      setPlayerState(prev => {
        if (prev.currentSource === null && prev.isLoading) return prev;
        return {
          ...prev,
          currentSource: null,
          isLoading: true,
          error: null
        };
      });
      return;
    }

    // Initialize player - it will handle checking if source changed
    initializePlayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSources.length, JSON.stringify(filteredSources.map(s => s.url))]);



  // Preconnect to video host for faster startup
  useEffect(() => {
    const url = playerState.currentSource?.url;
    if (!url) return;
    try {
      const { host, protocol } = new URL(url);
      const href = `${protocol}//${host}`;
      const preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = href;
      preconnect.crossOrigin = 'anonymous';
      document.head.appendChild(preconnect);

      const dnsPrefetch = document.createElement('link');
      dnsPrefetch.rel = 'dns-prefetch';
      dnsPrefetch.href = href;
      document.head.appendChild(dnsPrefetch);

      return () => {
        preconnect.remove();
        dnsPrefetch.remove();
      };
    } catch {}
  }, [playerState.currentSource?.url]);

  // Instantly resolve loading state for external fallback sources that can't be embedded
  useEffect(() => {
    if (playerState.currentSource) {
      const isExternal = VideoService.isStreamingSitePage(playerState.currentSource.url) && 
                         !playerState.currentSource.url.toLowerCase().includes('hianime.do');
      if (isExternal) {
        setPlayerState(prev => ({ ...prev, isLoading: false }));
      }
    }
  }, [playerState.currentSource]);

  // Video preloading for next episode
  const preloadNextEpisode = useCallback(() => {
    if (filteredSources.length > 1) {
      const nextSource = filteredSources[1]; // Preload next source
      const preloadLink = document.createElement('link');
      preloadLink.rel = 'preload';
      preloadLink.as = 'video';
      preloadLink.href = nextSource.url;
      document.head.appendChild(preloadLink);
    }
  }, [filteredSources]);

  // Buffer optimization
  const optimizeBuffer = useCallback(() => {
    if (videoRef.current) {
      const video = videoRef.current;
      
      // Note: webkitAudioDecodedByteCount is read-only, cannot be set
      // We can only read it for monitoring purposes
      
      // Set preload strategy
      video.preload = 'metadata';
      
      // Optimize for mobile
      if (navigator.userAgent.includes('Mobile')) {
        video.playsInline = true;
        video.controls = true;
      }
    }
  }, []);

  // Throttle utility for adaptive bitrate
  const throttle = useCallback((func: Function, delay: number) => {
    let timeoutId: NodeJS.Timeout | null = null;
    let lastExecTime = 0;
    
    return (...args: any[]) => {
      const currentTime = Date.now();
      
      if (currentTime - lastExecTime > delay) {
        func(...args);
        lastExecTime = currentTime;
      } else {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func(...args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }, []);

  // Throttled adaptive bitrate streaming (max 1 call per 2 seconds)
  const throttledAdaptiveBitrate = useCallback(() => {
    if (videoRef.current && filteredSources.length > 1) {
      const video = videoRef.current;
      const currentTime = video.currentTime;
      
      // Switch quality based on buffer health
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferAhead = bufferedEnd - currentTime;
        
        // If buffer is low, switch to lower quality
        if (bufferAhead < 10 && playerState.quality !== '480p') {
          const lowerQualitySource = filteredSources.find(s => s.quality === '480p') || filteredSources[filteredSources.length - 1];
          if (lowerQualitySource) {
            setPlayerState(prev => ({
              ...prev,
              currentSource: lowerQualitySource,
              quality: lowerQualitySource.quality
            }));
          }
        }
        // If buffer is healthy, switch to higher quality
        else if (bufferAhead > 30 && playerState.quality !== '1080p') {
          const higherQualitySource = filteredSources.find(s => s.quality === '1080p') || filteredSources[0];
          if (higherQualitySource) {
            setPlayerState(prev => ({
              ...prev,
              currentSource: higherQualitySource,
              quality: higherQualitySource.quality
            }));
          }
        }
      }
    }
  }, [filteredSources, playerState.quality]);

  // Create throttled version (max 1 call per 2 seconds)
  const throttledHandleAdaptiveBitrate = useMemo(() => 
    throttle(throttledAdaptiveBitrate, 2000), 
    [throttle, throttledAdaptiveBitrate]
  );

  // Handle YouTube iframe API
  const handleYouTubeReady = useCallback(() => {
    if (!iframeRef.current) return;

    // YouTube iframe API would be initialized here
    // For now, we'll handle basic iframe events
    console.log('YouTube player ready');
  }, []);

  // Handle video time updates
  const handleTimeUpdate = useCallback((e?: any) => {
    const video = e?.currentTarget || videoRef.current;
    if (video) {
      const currentTime = video.currentTime;
      const duration = video.duration;
      
      setPlayerState(prev => ({ ...prev, currentTime, duration }));
      onTimeUpdate?.(currentTime, duration);
    }
  }, [onTimeUpdate]);

  // Handle play/pause
  const handlePlay = useCallback(() => {
    setPlayerState(prev => ({ ...prev, isPlaying: true }));
    onPlay?.();
  }, [onPlay]);

  const handlePause = useCallback(() => {
    setPlayerState(prev => ({ ...prev, isPlaying: false }));
    onPause?.();
  }, [onPause]);

  // Handle video end
  const handleEnded = useCallback(() => {
    setPlayerState(prev => ({ ...prev, isPlaying: false }));
    onEnded?.();
  }, [onEnded]);

  // Handle errors with retry mechanism
  const handleError = useCallback((error: string) => {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    setPlayerState(prev => {
      if (prev.retryCount < maxRetries) {
        // Retry after delay
        setTimeout(() => {
          setPlayerState(current => ({
            ...current,
            isRetrying: true,
            error: null,
            isLoading: true,
            retryCount: current.retryCount + 1
          }));
          
          // Force reload the video
          if (videoRef.current) {
            videoRef.current.load();
          }
        }, retryDelay);
        
        return {
          ...prev,
          error: `Retrying... (${prev.retryCount + 1}/${maxRetries})`,
          isLoading: false,
          isRetrying: true
        };
      } else {
        // Max retries reached
        return {
          ...prev,
          error: `Failed after ${maxRetries} attempts: ${error}`,
          isLoading: false,
          isRetrying: false
        };
      }
    });
    
    onError?.(error);
  }, [onError]);

  // Change quality
  const changeQuality = useCallback((quality: string) => {
    const newSource = filteredSources.find(s => s.quality === quality);
    if (newSource) {
      setPlayerState(prev => ({
        ...prev,
        currentSource: newSource,
        quality,
        isLoading: true
      }));
    }
  }, [filteredSources]);

  // Get available qualities
  const availableQualities = filteredSources.map(s => s.quality).filter((quality, index, self) => 
    self.indexOf(quality) === index
  );

  // Render YouTube iframe
  const renderYouTubePlayer = (source: VideoSource) => {
    const embedUrl = VideoService.getYouTubeEmbedUrl(source.url, {
      autoplay: autoPlay,
      start: startTime,
      quality: source.quality,
    });

    return (
      <iframe
        ref={iframeRef}
        src={embedUrl}
        title={title}
        className="w-full h-full"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        loading="lazy"
        onLoad={() => {
          handleYouTubeReady();
          setPlayerState(prev => ({ ...prev, isLoading: false }));
        }}
      />
    );
  };

  // Render iframe for streaming sites (anikai.to, etc.) with enhanced tracking
  const renderIframePlayer = (source: VideoSource) => {
    // Check if this is a streaming site page that can't be embedded
    // But allow HiAnime.do to be embedded directly
    if (VideoService.isStreamingSitePage(source.url) && !source.url.toLowerCase().includes('hianime.do')) {
      return renderExternalLinkFallback(source);
    }

    // For bysesayeveum URLs, route through our clean ad-free embed proxy
    let sourceUrl = source.url;
    let isByseEmbed = false;
    let isMegaEmbed = false;
    let isVidmolyEmbed = false;
    if (sourceUrl.includes('bysesayeveum.com/e/')) {
      const videoId = sourceUrl.split('/e/')[1]?.split(/[?#]/)[0];
      if (videoId) {
        // Use relative URL so it goes through the Vite proxy (same-origin, no X-Frame-Options issue)
        sourceUrl = `/api/video-embed/${videoId}`;
        isByseEmbed = true;
        console.log('🛡️ Routing bysesayeveum through clean embed:', sourceUrl);
      }
    }

    // For mega URLs, route through our clean ad-free mega embed proxy
    if (!isByseEmbed && sourceUrl.match(/mega(play|cloud|backup|cdn|stream)[^/]*\/(?:embed|e)\//i)) {
      const megaMatch = sourceUrl.match(/https?:\/\/([^/]+)\/(?:embed|e)\/([a-zA-Z0-9]+)/);
      if (megaMatch) {
        const [, megaHost, megaId] = megaMatch;
        sourceUrl = `/api/mega-embed/${megaHost}/${megaId}`;
        isMegaEmbed = true;
        console.log('🛡️ Routing mega through clean embed:', sourceUrl);
      }
    }

    // For vidmoly URLs, route through our clean ad-free vidmoly embed proxy
    if (!isByseEmbed && !isMegaEmbed && sourceUrl.match(/vidmoly\.(biz|net)/)) {
      const vidmolyMatch = sourceUrl.match(/vidmoly\.(?:biz|net)\/embed-([a-zA-Z0-9]+)/);
      if (vidmolyMatch) {
        sourceUrl = `/api/vidmoly-embed/${vidmolyMatch[1]}`;
        isVidmolyEmbed = true;
        console.log('🛡️ Routing vidmoly through clean embed:', sourceUrl);
      }
    }

    // For our own embed URLs (relative paths), append start time as query param
    const embedUrl = (isByseEmbed || isMegaEmbed || isVidmolyEmbed)
      ? (startTime > 0 ? `${sourceUrl}?start=${Math.floor(startTime)}` : sourceUrl)
      : VideoService.getIframeEmbedUrl(sourceUrl, {
          autoplay: autoPlay,
          start: startTime,
          quality: source.quality,
        });

    console.log('🎬 Rendering IframePlayer with URL:', embedUrl);
    console.log('🔍 Source type detected:', VideoService.detectVideoSource(source.url));

    // Get episode duration for estimation (default 24 minutes = 1440 seconds)
    const estimatedDuration = 1440; // Could be fetched from episode data if available

    return (
      <IframePlayer
        src={embedUrl}
        title={title}
        width="100%"
        height="100%"
        animeId={animeId}
        episodeNumber={episodeNumber}
        estimatedDuration={estimatedDuration}
        onProgressUpdate={onProgressUpdate}
        onTimeUpdate={onTimeUpdate}
        startTime={startTime}
        onLoad={() => {
          console.log('Iframe loaded - clearing spinner');
          setPlayerState(prev => ({ ...prev, isLoading: false }));
        }}
        className="w-full h-full"
      />
    );
  };

  // Render external link fallback for streaming sites
  const renderExternalLinkFallback = (source: VideoSource) => (
    <div className="w-full h-full bg-gradient-to-br from-blue-900 to-black flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center text-white max-w-md mx-auto px-4"
      >
        <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-external-link-line text-3xl text-blue-400"></i>
        </div>
        <h3 className="text-xl font-bold mb-2">External Video Source</h3>
        <p className="text-gray-400 mb-4">
          This video is hosted on an external streaming site. Click the button below to watch it in a new tab.
        </p>
        
        <div className="bg-gray-800/50 rounded-lg p-3 mb-4">
          <p className="text-sm text-gray-300 break-all">{source.url}</p>
        </div>
        
        <div className="flex gap-2 justify-center">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <i className="ri-external-link-line"></i>
            Watch on External Site
          </a>
          {filteredSources.length > 1 && (
            <button
              onClick={() => {
                // Try next available source
                const currentIndex = filteredSources.findIndex(s => s.url === source.url);
                const nextSource = filteredSources[currentIndex + 1] || filteredSources[0];
                setPlayerState(prev => ({
                  ...prev,
                  currentSource: nextSource,
                  error: null,
                  isLoading: true
                }));
              }}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              Try Different Source
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );

  // Render HLS video player with hls.js support
  const renderHLSPlayer = (source: VideoSource) => {
    const processedSource = VideoService.processVideoSource(source, animeId, episodeNumber, {
      autoplay: autoPlay,
      start: startTime,
      quality: source.quality,
    });

    return (
      <HLSVideoPlayer
        src={processedSource.url}
        autoPlay={autoPlay}
        startTime={startTime}
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={handleError}
        onLoadStart={() => setPlayerState(prev => ({ ...prev, isLoading: true }))}
        onLoadedData={() => {
          setPlayerState(prev => ({ ...prev, isLoading: false }));
          preloadNextEpisode();
        }}
        onProgress={throttledHandleAdaptiveBitrate}
        optimizeBuffer={optimizeBuffer}
      />
    );
  };

  // Render direct video player
  const renderDirectVideoPlayer = (source: VideoSource) => {
    const processedSource = VideoService.processVideoSource(source, animeId, episodeNumber, {
      autoplay: autoPlay,
      start: startTime,
      quality: source.quality,
    });

    return (
      <video
        ref={videoRef}
        src={processedSource.url}
        className="w-full h-full"
        controls
        autoPlay={autoPlay}
        crossOrigin="anonymous"
        onTimeUpdate={(e) => {
          const video = e.currentTarget;
          seekToStartTimeDirect(video);
          if (onTimeUpdate) {
            onTimeUpdate(video.currentTime, video.duration || 0);
          }
        }}
        onLoadedMetadata={(e) => {
          seekToStartTimeDirect(e.currentTarget);
        }}
        onCanPlay={(e) => {
          seekToStartTimeDirect(e.currentTarget);
        }}
        onDurationChange={(e) => {
          seekToStartTimeDirect(e.currentTarget);
        }}
        onPlay={(e) => {
          handlePlay();
          seekToStartTimeDirect(e.currentTarget);
        }}
        onPlaying={(e) => {
          seekToStartTimeDirect(e.currentTarget);
        }}
        onPause={handlePause}
        onEnded={handleEnded}
        onError={(e) => {
          const target = e.target as HTMLVideoElement;
          const error = target.error;
          let errorMessage = 'Video playback failed';
          
          if (error) {
            switch (error.code) {
              case 1: errorMessage = 'Video loading aborted'; break;
              case 2: errorMessage = 'Network error - check your connection'; break;
              case 3: errorMessage = 'Video decoding error'; break;
              case 4: errorMessage = 'Video source not supported'; break;
            }
          }
          
          handleError(errorMessage);
        }}
        onLoadedData={(e) => {
          setPlayerState(prev => ({ ...prev, isLoading: false }));
        }}
      >
        Your browser does not support the video tag.
      </video>
    );
  };

  // Render loading state
  const renderLoading = () => (
    <div className="w-full h-full bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center text-white"
      >
        <SparkleLoadingSpinner size="xl" text="Loading Player..." />
        <p className="text-gray-400 mt-4">Preparing your video experience</p>
      </motion.div>
    </div>
  );

  // Manual retry function
  const handleManualRetry = useCallback(() => {
    setPlayerState(prev => ({
      ...prev,
      error: null,
      isLoading: true,
      retryCount: 0,
      isRetrying: false
    }));
    
    if (videoRef.current) {
      videoRef.current.load();
    }
  }, []);

  // Try different source
  const handleTryDifferentSource = useCallback(() => {
    if (filteredSources.length > 1) {
      const currentIndex = filteredSources.findIndex(s => s === playerState.currentSource);
      const nextSource = filteredSources[(currentIndex + 1) % filteredSources.length];
      setPlayerState(prev => ({
        ...prev,
        currentSource: nextSource,
        quality: nextSource.quality,
        error: null,
        isLoading: true,
        retryCount: 0,
        isRetrying: false
      }));
    }
  }, [filteredSources, playerState.currentSource]);

  // Render error state
  const renderError = () => (
    <div className="w-full h-full bg-gradient-to-br from-red-900 to-black flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center text-white max-w-md mx-auto px-4"
      >
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="ri-error-warning-line text-3xl text-red-400"></i>
        </div>
        <h3 className="text-xl font-bold mb-2">Playback Error</h3>
        <p className="text-gray-400 mb-4">{playerState.error}</p>
        
        {/* Retry status */}
        {playerState.isRetrying && (
          <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-center">
              <SparkleLoadingSpinner size="sm" />
              <span className="ml-2 text-blue-200">Retrying...</span>
            </div>
          </div>
        )}
        
        {/* CORS-specific error message */}
        {playerState.error?.includes('CORS') && (
          <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3 mb-4">
            <p className="text-yellow-200 text-sm">
              This video source is blocked by CORS policy. Try using a different video source or contact the site administrator.
            </p>
          </div>
        )}
        
        <div className="flex gap-2 justify-center">
          <button
            onClick={handleManualRetry}
            disabled={playerState.isRetrying}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <i className="ri-refresh-line mr-2"></i>
            Try Again
          </button>
          {sources.length > 1 && (
            <button
              onClick={handleTryDifferentSource}
              disabled={playerState.isRetrying}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <i className="ri-swap-line mr-2"></i>
              Try Different Source
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );

  // Premium server/source selector dropdown
  const renderQualitySelector = () => (
    <div className="absolute top-4 right-4 z-20">
      <div className="bg-slate-950/80 backdrop-blur-md rounded-xl p-1.5 border border-white/10 shadow-2xl flex items-center gap-2 transition-all hover:border-emerald-500/30">
        <div className="flex items-center gap-1.5 text-slate-400 px-2 text-[11px] font-semibold tracking-wide uppercase">
          <i className="ri-server-line text-emerald-400 text-xs"></i>
          <span>Server</span>
        </div>
        <select
          value={playerState.quality}
          onChange={(e) => changeQuality(e.target.value)}
          className="bg-slate-900/90 text-slate-100 text-xs border border-white/10 rounded-lg pl-3 pr-8 py-1.5 focus:ring-2 focus:ring-emerald-500/30 font-medium cursor-pointer outline-none transition-all appearance-none relative"
          style={{
            backgroundImage: `url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%2310b981' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E")`,
            backgroundPosition: 'right 0.5rem center',
            backgroundSize: '1.25em 1.25em',
            backgroundRepeat: 'no-repeat'
          }}
        >
          {availableQualities.map(quality => (
            <option key={quality} value={quality} className="bg-slate-950 text-slate-200">
              {quality}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  // Language selector (Sub / Dub tabs)
  const renderLangSelector = () => (
    <div className="absolute top-4 left-4 z-20">
      <div className="bg-slate-950/80 backdrop-blur-md rounded-xl p-1 border border-white/10 shadow-2xl flex gap-1">
        {availableLangs.includes('sub') && (
          <button
            onClick={() => setActiveLang('sub')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1 cursor-pointer ${
              activeLang === 'sub'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <i className="ri-chat-3-line"></i>
            Sub
          </button>
        )}
        {availableLangs.includes('dub') && (
          <button
            onClick={() => setActiveLang('dub')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1 cursor-pointer ${
              activeLang === 'dub'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}
          >
            <i className="ri-volume-up-line"></i>
            Dub
          </button>
        )}
      </div>
    </div>
  );

  // Main render
  if (playerState.error) {
    return (
      <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
        {renderError()}
      </div>
    );
  }

  if (!playerState.currentSource) {
    return (
      <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
        {renderLoading()}
      </div>
    );
  }

  const sourceType = VideoService.detectVideoSource(playerState.currentSource.url);

  return (
    <>
      <div className={`relative bg-black overflow-hidden ${className}`}>
        {/* Video Player */}
        {sourceType === 'youtube' ? (
          renderYouTubePlayer(playerState.currentSource)
        ) : sourceType === 'iframe' ? (
          renderIframePlayer(playerState.currentSource)
        ) : sourceType === 'hls' ? (
          renderHLSPlayer(playerState.currentSource)
        ) : (
          renderDirectVideoPlayer(playerState.currentSource)
        )}
        
        {/* Loading Overlay */}
        {playerState.isLoading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {/* Elegant, high-end server switcher directly below the player - matching the Animehub light glassmorphism teal theme */}
      <div className="bg-white/95 backdrop-blur-md border border-teal-100/80 rounded-2xl p-3 sm:p-4 md:p-5 mt-3 sm:mt-4 shadow-xl flex flex-col lg:flex-row lg:items-start justify-between gap-3 sm:gap-4 md:gap-5 transition-all duration-300 hover:shadow-2xl hover:border-teal-200/80">
        {/* Left Info Column */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <span className="hidden sm:block text-teal-600 text-[10px] font-extrabold uppercase tracking-widest">
            YOU ARE WATCHING
          </span>
          <h4 className="flex flex-wrap items-center gap-1 sm:gap-2 text-teal-900 text-sm sm:text-base md:text-lg font-extrabold tracking-wide leading-tight">
            <span className="sm:hidden text-[10px] font-extrabold uppercase tracking-[0.18em] text-teal-500">
              Watching
            </span>
            <span className="sm:hidden text-teal-200 font-normal">|</span>
            <span>Episode {episodeNumber}</span>
            {title && (
              <>
                <span className="text-teal-200 font-normal">|</span>
                <span className="min-w-0 text-teal-700 font-semibold text-xs sm:text-sm md:text-base line-clamp-1 break-words">
                  {title.replace(/.*- Episode \d+\s*-?\s*/i, '') || title}
                </span>
              </>
            )}
          </h4>
          <p className="hidden sm:flex text-slate-500 text-[11px] sm:text-xs items-start gap-1.5 font-medium max-w-2xl">
            <i className="ri-information-line text-teal-500 text-sm"></i>
            If current server doesn't work please try other servers beside.
          </p>
        </div>

        {/* Right Switchers Column */}
        <div className="flex flex-col gap-1.5 sm:gap-2 w-full lg:min-w-[280px] lg:max-w-[520px]">
          {/* SUB Row */}
          {subSources.length > 0 && (
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-1.5 text-teal-800 text-[11px] sm:text-xs font-black tracking-wider min-w-0 shrink-0">
                <i className="ri-closed-captioning-line text-teal-600 text-base"></i>
                <span>SUB:</span>
              </div>
              <div className="flex flex-nowrap overflow-x-auto max-w-full gap-1.5 sm:gap-2 pb-1 sm:pb-0 no-scrollbar">
                {subSources.map((source, index) => {
                  const isActive = playerState.currentSource?.url === source.url;
                  return (
                    <button
                      key={`sub-${index}-${source.quality}`}
                      onClick={() => selectSource(source)}
                      className={`shrink-0 px-2.5 py-1.5 sm:px-4 rounded-lg text-[10px] sm:text-xs font-black tracking-wide transition-all duration-300 shadow-md active:scale-95 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-extrabold shadow-[0_4px_12px_rgba(20,184,166,0.3)] border border-transparent'
                          : 'bg-teal-50/60 hover:bg-teal-100/80 text-teal-800 border border-teal-200/50 hover:border-teal-300/60'
                      }`}
                    >
                      {source.quality}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* DUB Row */}
          {dubSources.length > 0 && (
            <div className="flex flex-row items-center gap-2 sm:gap-3">
              <div className="hidden sm:flex items-center gap-1.5 text-teal-800 text-[11px] sm:text-xs font-black tracking-wider min-w-0 shrink-0">
                <i className="ri-mic-line text-teal-600 text-base"></i>
                <span>DUB:</span>
              </div>
              <div className="flex flex-nowrap overflow-x-auto max-w-full gap-1.5 sm:gap-2 pb-1 sm:pb-0 no-scrollbar">
                {dubSources.map((source, index) => {
                  const isActive = playerState.currentSource?.url === source.url;
                  return (
                    <button
                      key={`dub-${index}-${source.quality}`}
                      onClick={() => selectSource(source)}
                      className={`shrink-0 px-2.5 py-1.5 sm:px-4 rounded-lg text-[10px] sm:text-xs font-black tracking-wide transition-all duration-300 shadow-md active:scale-95 cursor-pointer ${
                        isActive
                          ? 'bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-extrabold shadow-[0_4px_12px_rgba(20,184,166,0.3)] border border-transparent'
                          : 'bg-teal-50/60 hover:bg-teal-100/80 text-teal-800 border border-teal-200/50 hover:border-teal-300/60'
                      }`}
                    >
                      {source.quality}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Dedicated HLS player component using hls.js for cross-browser support.
 * Safari supports HLS natively; Chrome/Firefox need hls.js.
 */
function HLSVideoPlayer({
  src,
  autoPlay,
  startTime,
  onTimeUpdate,
  onPlay,
  onPause,
  onEnded,
  onError,
  onLoadStart,
  onLoadedData,
  onProgress,
  optimizeBuffer,
}: {
  src: string;
  autoPlay?: boolean;
  startTime?: number;
  onTimeUpdate?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onError?: (msg: string) => void;
  onLoadStart?: () => void;
  onLoadedData?: () => void;
  onProgress?: () => void;
  optimizeBuffer?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hlsSeekedRef = useRef(false);
  const controlsHideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [qualityLevels, setQualityLevels] = useState<Array<{ index: number; label: string }>>([]);
  const [selectedQuality, setSelectedQuality] = useState<'auto' | string>('auto');
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [hasCaptions, setHasCaptions] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const formatTime = useCallback((timeInSeconds: number) => {
    if (!Number.isFinite(timeInSeconds) || timeInSeconds < 0) return '0:00';
    const hours = Math.floor(timeInSeconds / 3600);
    const minutes = Math.floor((timeInSeconds % 3600) / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  const syncNativeCaptionTracks = useCallback((enabled: boolean) => {
    const video = videoRef.current;
    if (!video) return;

    const textTracks = video.textTracks;
    if (!textTracks || textTracks.length === 0) return;

    for (let index = 0; index < textTracks.length; index += 1) {
      textTracks[index].mode = enabled && index === 0 ? 'showing' : 'disabled';
    }
  }, []);

  const syncHlsCaptions = useCallback((enabled: boolean) => {
    const hls = hlsRef.current;
    if (!hls || hls.subtitleTracks.length === 0) return;
    hls.subtitleTrack = enabled ? 0 : -1;
  }, []);

  const applyCaptions = useCallback((enabled: boolean) => {
    syncHlsCaptions(enabled);
    syncNativeCaptionTracks(enabled);
  }, [syncHlsCaptions, syncNativeCaptionTracks]);

  const seekBy = useCallback((offsetSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    const nextTime = Math.max(0, Math.min((video.duration || duration || 0), video.currentTime + offsetSeconds));
    video.currentTime = nextTime;
  }, [duration]);

  const seekTo = useCallback((timeInSeconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(timeInSeconds)) return;

    const nextTime = Math.max(0, Math.min(video.duration || duration || 0, timeInSeconds));
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current) {
      clearTimeout(controlsHideTimerRef.current);
      controlsHideTimerRef.current = null;
    }
  }, []);

  const showControls = useCallback((shouldAutoHide = false) => {
    setControlsVisible(true);
    clearControlsHideTimer();

    if (!shouldAutoHide) return;

    controlsHideTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.ended || isSeeking) return;
      setControlsVisible(false);
    }, 3000);
  }, [clearControlsHideTimer, isSeeking]);

  const toggleFullscreen = useCallback(async () => {
    const video = videoRef.current;
    const container = containerRef.current;

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }

    if (video && typeof (video as any).webkitEnterFullscreen === 'function' && /iPad|iPhone|iPod/.test(navigator.userAgent)) {
      (video as any).webkitEnterFullscreen();
      return;
    }

    if (container?.requestFullscreen) {
      await container.requestFullscreen().catch(() => {});
      return;
    }

    if (video?.requestFullscreen) {
      await video.requestFullscreen().catch(() => {});
    }
  }, []);

  const seekToStartTime = useCallback((video: HTMLVideoElement) => {
    if (!hlsSeekedRef.current && startTime && startTime > 0 && video.readyState >= 2) {
      const duration = video.duration;
      if (duration && !isNaN(duration) && duration > 0) {
        console.log(`🚀 Executing robust HLS seek to: ${startTime}s (readyState: ${video.readyState}, duration: ${duration}s)`);
        video.currentTime = Math.min(startTime, duration - 1);
        hlsSeekedRef.current = true;
      } else {
        console.log(`⏳ HLS player readyState is ${video.readyState} but duration is ${duration} (not seekable yet)`);
      }
    }
  }, [startTime]);

  const toggleCaptions = useCallback(() => {
    setCaptionsEnabled(prev => {
      const next = !prev;
      applyCaptions(next);
      return next;
    });
  }, [applyCaptions]);

  const changeQuality = useCallback((qualityValue: string) => {
    const hls = hlsRef.current;
    if (!hls) return;

    setSelectedQuality(qualityValue);
    if (qualityValue === 'auto') {
      hls.currentLevel = -1;
      return;
    }

    const levelIndex = Number(qualityValue);
    if (Number.isFinite(levelIndex)) {
      hls.currentLevel = levelIndex;
    }
  }, []);

  useEffect(() => {
    hlsSeekedRef.current = false;
    clearControlsHideTimer();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsMuted(false);
    setSelectedQuality('auto');
    setQualityLevels([]);
    setCaptionsEnabled(false);
    setHasCaptions(false);
    setControlsVisible(true);
  }, [src, clearControlsHideTimer]);

  useEffect(() => {
    if (isPlaying && !isSeeking) {
      showControls(true);
    } else {
      clearControlsHideTimer();
      setControlsVisible(true);
    }

    return clearControlsHideTimer;
  }, [isPlaying, isSeeking, showControls, clearControlsHideTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    const handlePlay = () => {
      seekToStartTime(video);
    };
    const handlePlaying = () => {
      seekToStartTime(video);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('playing', handlePlaying);

    if (Hls.isSupported()) {
      // Chrome, Firefox, Edge — use hls.js
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startLevel: -1, // auto quality
      });
      hlsRef.current = hls;

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ HLS manifest parsed, levels:', hls.levels.length);
        setQualityLevels([
          { index: -1, label: 'Auto' },
          ...hls.levels
            .map((level, index) => ({
              index,
              label: level.height ? `${level.height}p` : level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : `Level ${index + 1}`,
            }))
            .filter((level, index, self) => self.findIndex(item => item.label === level.label) === index),
        ]);
        setHasCaptions(hls.subtitleTracks.length > 0);
        applyCaptions(captionsEnabled);
        onLoadedData?.();
        if (autoPlay) video.play().catch(() => {});
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        setHasCaptions(hls.subtitleTracks.length > 0);
        applyCaptions(captionsEnabled);
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (selectedQuality === 'auto') return;
        setSelectedQuality(String(data.level));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('🔄 HLS network error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('🔄 HLS media error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.log('❌ Fatal HLS error:', data.type, data.details);
              onError?.('HLS stream failed: ' + data.details);
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari — native HLS support
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    } else {
      onError?.('HLS playback is not supported in this browser');
    }

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('playing', handlePlaying);
      clearControlsHideTimer();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, startTime, clearControlsHideTimer, seekToStartTime]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black overflow-hidden group"
      onMouseMove={() => showControls(isPlaying)}
      onMouseEnter={() => showControls(isPlaying)}
      onTouchStart={() => showControls(isPlaying)}
      onClick={() => showControls(isPlaying)}
    >
      <video
        ref={videoRef}
        className="w-full h-full object-contain bg-black"
        controls={false}
        playsInline
        crossOrigin="anonymous"
        onClick={togglePlay}
        style={{ cursor: 'pointer' }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (isSeeking) return;
          setCurrentTime(video.currentTime);
          setDuration(video.duration || 0);
          onTimeUpdate?.(event);
          seekToStartTime(video);
        }}
        onPlay={(event) => {
          setIsPlaying(true);
          onPlay?.();
          seekToStartTime(event.currentTarget);
          const video = event.currentTarget;
          setIsMuted(video.muted);
          showControls(true);
        }}
        onPlaying={(event) => {
          seekToStartTime(event.currentTarget);
        }}
        onPause={() => {
          setIsPlaying(false);
          onPause?.();
          showControls(false);
        }}
        onEnded={() => {
          setIsPlaying(false);
          onEnded?.();
          showControls(false);
        }}
        onVolumeChange={(event) => {
          const video = event.currentTarget;
          setIsMuted(video.muted);
        }}
        onDurationChange={(event) => {
          const video = event.currentTarget;
          setDuration(video.duration || 0);
          seekToStartTime(video);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setDuration(video.duration || 0);
          seekToStartTime(video);
        }}
        onCanPlay={(event) => {
          seekToStartTime(event.currentTarget);
        }}
        onLoadStart={() => {
          onLoadStart?.();
          optimizeBuffer?.();
        }}
        onLoadedData={(event) => {
          onLoadedData?.();
          seekToStartTime(event.currentTarget);
        }}
        onProgress={onProgress}
        onWaiting={onProgress}
        onError={(e) => {
          const target = e.target as HTMLVideoElement;
          const error = target.error;
          let errorMessage = 'HLS stream failed to load';
          if (error) {
            switch (error.code) {
              case 1: errorMessage = 'Video loading aborted'; break;
              case 2: errorMessage = 'Network error - check your connection'; break;
              case 3: errorMessage = 'Video decoding error'; break;
              case 4: errorMessage = 'Video source not supported'; break;
            }
          }
          onError?.(errorMessage);
        }}
      />

      <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 py-1.5 sm:px-3 sm:py-3 md:px-4 md:py-4 transition-opacity duration-300 ${controlsVisible || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="mb-1.5 sm:mb-3 flex items-center gap-2 sm:gap-3">
          <span className="hidden text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60 sm:inline">Seek</span>
          <input
            type="range"
            min="0"
            max={Math.max(duration, 0)}
            step="0.1"
            value={Math.min(currentTime, duration || currentTime)}
            disabled={!duration || Number.isNaN(duration)}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={(event) => seekTo(Number(event.target.value))}
            onMouseUp={() => setIsSeeking(false)}
            onTouchEnd={() => setIsSeeking(false)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-emerald-400"
            aria-label="Seek video"
          />
        </div>

        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-1 sm:gap-3">
            <button
              type="button"
              onClick={() => seekBy(-10)}
              className="inline-flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Skip backward 10 seconds"
            >
              <i className="ri-rewind-mini-line text-base sm:text-lg" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              className="inline-flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-emerald-500 text-black transition hover:bg-emerald-400"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              <i className={`text-lg sm:text-xl ${isPlaying ? 'ri-pause-fill' : 'ri-play-fill'}`} />
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              className="inline-flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              aria-label="Skip forward 10 seconds"
            >
              <i className="ri-speed-mini-line text-base sm:text-lg" />
            </button>

            <span className="hidden text-[11px] font-medium text-white/75 sm:inline sm:text-xs">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                video.muted = !video.muted;
                setIsMuted(video.muted);
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2 text-[11px] sm:h-auto sm:px-2.5 sm:py-2 sm:text-xs font-semibold text-white transition hover:bg-white/20"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <i className={`${isMuted ? 'ri-volume-mute-line' : 'ri-volume-up-line'} text-sm`} />
              <span className="hidden sm:inline">{isMuted ? 'Muted' : 'Sound'}</span>
            </button>

            <button
              type="button"
              onClick={toggleCaptions}
              disabled={!hasCaptions}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2 text-[11px] sm:h-auto sm:px-2.5 sm:py-2 sm:text-xs font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={captionsEnabled ? 'Turn captions off' : 'Turn captions on'}
            >
              <i className="ri-closed-captioning-line text-sm" />
              <span className="hidden sm:inline">{captionsEnabled ? 'CC On' : 'CC Off'}</span>
            </button>

            <label className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2 text-[11px] sm:h-auto sm:px-2.5 sm:py-2 sm:text-xs font-semibold text-white transition hover:bg-white/20">
              <i className="ri-settings-3-line hidden text-sm sm:inline" />
              <select
                value={selectedQuality}
                onChange={(event) => changeQuality(event.target.value)}
                className="min-w-[60px] sm:min-w-[92px] appearance-none rounded-md border border-white/10 bg-transparent px-1 py-0.5 text-[11px] sm:px-1.5 sm:py-1 sm:text-xs text-white outline-none"
                aria-label="Select quality"
              >
                {qualityLevels.length === 0 ? (
                  <option value="auto">Auto</option>
                ) : (
                  qualityLevels.map(level => (
                    <option key={level.index} value={level.index === -1 ? 'auto' : String(level.index)} className="text-slate-900">
                      {level.label}
                    </option>
                  ))
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={() => { void toggleFullscreen(); }}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2 text-[11px] sm:h-auto sm:px-2.5 sm:py-2 sm:text-xs font-semibold text-white transition hover:bg-white/20"
              aria-label="Toggle fullscreen"
            >
              <i className="ri-fullscreen-line text-sm" />
              <span className="hidden sm:inline">Fullscreen</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
