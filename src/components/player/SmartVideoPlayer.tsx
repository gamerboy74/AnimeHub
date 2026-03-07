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



  // Initialize player with best available source (memoized for performance)
  const initializePlayer = useCallback(() => {
    if (sources.length === 0) {
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
    const available = sources.map(s => s.quality);
    const preferred = chooseBestQuality(available);
    const bestSource = sources.find(s => s.quality === preferred) || sources[0];

    setPlayerState(prev => {
      // If we already have the same source, don't update state to prevent flickering
      if (prev.currentSource?.url === bestSource.url) {
        return prev;
      }

      return {
        ...prev,
        currentSource: bestSource,
        quality: bestSource.quality,
        isLoading: false,
        error: null,
        retryCount: 0,
        isRetrying: false
      };
    });
  }, [sources]);

  useEffect(() => {
    // Only initialize if we have sources
    if (sources.length === 0) {
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
  }, [sources.length, JSON.stringify(sources.map(s => s.url))]);



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

  // Video preloading for next episode
  const preloadNextEpisode = useCallback(() => {
    if (sources.length > 1) {
      const nextSource = sources[1]; // Preload next source
      const preloadLink = document.createElement('link');
      preloadLink.rel = 'preload';
      preloadLink.as = 'video';
      preloadLink.href = nextSource.url;
      document.head.appendChild(preloadLink);
    }
  }, [sources]);

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
    if (videoRef.current && sources.length > 1) {
      const video = videoRef.current;
      const currentTime = video.currentTime;
      
      // Switch quality based on buffer health
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const bufferAhead = bufferedEnd - currentTime;
        
        // If buffer is low, switch to lower quality
        if (bufferAhead < 10 && playerState.quality !== '480p') {
          const lowerQualitySource = sources.find(s => s.quality === '480p') || sources[sources.length - 1];
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
          const higherQualitySource = sources.find(s => s.quality === '1080p') || sources[0];
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
  }, [sources, playerState.quality]);

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
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const currentTime = videoRef.current.currentTime;
      const duration = videoRef.current.duration;
      
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
    const newSource = sources.find(s => s.quality === quality);
    if (newSource) {
      setPlayerState(prev => ({
        ...prev,
        currentSource: newSource,
        quality,
        isLoading: true
      }));
    }
  }, [sources]);

  // Get available qualities
  const availableQualities = sources.map(s => s.quality).filter((quality, index, self) => 
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
        onLoad={handleYouTubeReady}
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

    // For our own embed URLs (relative paths), append start time as query param
    const embedUrl = (isByseEmbed || isMegaEmbed)
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
          {sources.length > 1 && (
            <button
              onClick={() => {
                // Try next available source
                const currentIndex = sources.findIndex(s => s.url === source.url);
                const nextSource = sources[currentIndex + 1] || sources[0];
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
        onTimeUpdate={handleTimeUpdate}
        onPlay={handlePlay}
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
        onLoadStart={() => setPlayerState(prev => ({ ...prev, isLoading: true }))}
        onLoadedData={() => setPlayerState(prev => ({ ...prev, isLoading: false }))}
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
    if (sources.length > 1) {
      const currentIndex = sources.findIndex(s => s === playerState.currentSource);
      const nextSource = sources[(currentIndex + 1) % sources.length];
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
  }, [sources, playerState.currentSource]);

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

  // Quality selector (deferred until metadata loaded)
  const renderQualitySelector = () => (
    <div className="absolute top-4 right-4 z-10">
      <div className="bg-black/80 backdrop-blur-sm rounded-lg p-2">
        <select
          value={playerState.quality}
          onChange={(e) => changeQuality(e.target.value)}
          className="bg-transparent text-white text-sm border border-gray-600 rounded px-2 py-1"
        >
          {availableQualities.map(quality => (
            <option key={quality} value={quality} className="bg-gray-800">
              {quality}
            </option>
          ))}
        </select>
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

  if (playerState.isLoading || !playerState.currentSource) {
    return (
      <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
        {renderLoading()}
      </div>
    );
  }

  const sourceType = VideoService.detectVideoSource(playerState.currentSource.url);

  return (
    <div className={`relative bg-black rounded-lg overflow-hidden ${className}`}>
      {/* Quality Selector */}
      {availableQualities.length > 1 && !playerState.isLoading && renderQualitySelector()}
      
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
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // Destroy previous instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

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
        if (autoPlay) video.play().catch(() => {});
        if (startTime && startTime > 0) video.currentTime = startTime;
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
      if (startTime && startTime > 0) video.currentTime = startTime;
    } else {
      onError?.('HLS playback is not supported in this browser');
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <video
      ref={videoRef}
      className="w-full h-full"
      controls
      crossOrigin="anonymous"
      onTimeUpdate={onTimeUpdate}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onEnded}
      onLoadStart={() => {
        onLoadStart?.();
        optimizeBuffer?.();
      }}
      onLoadedData={onLoadedData}
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
  );
}
