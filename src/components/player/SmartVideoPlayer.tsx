import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import Hls from 'hls.js';
import { SparkleLoadingSpinner } from '../base/LoadingSpinner';
import { VideoService, type VideoSource } from '../../services/media/video';
import { chooseBestQuality } from '../../utils/media/player';

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

  // Universal HLS resolution state — tried for ALL iframe-type sources.
  // On success, HLSVideoPlayer is used (full controls); on failure, falls back to iframe.
  const [resolvedHls, setResolvedHls] = useState<string | null>(null);
  const [hlsResolving, setHlsResolving] = useState(false);

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

  // Universal HLS resolver: 3-tier cascade that works even when backend is offline.
  //
  //  Tier 1 – Backend /api/resolve-hls  (5s timeout, full Playwright on server)
  //  Tier 2 – Client-side CORS fetch    (no backend needed, works for permissive hosts)
  //  Tier 3 – Iframe fallback           (always works — video plays, no custom controls)
  useEffect(() => {
    const source = playerState.currentSource;
    if (!source) { setResolvedHls(null); return; }

    const sourceType = VideoService.detectVideoSource(source.url);
    if (sourceType !== 'iframe') { setResolvedHls(null); return; }

    // Megaplay-style embeds already have a fast iframe/proxy path below.
    // Skip the universal HLS resolver so playback can start immediately.
    const isMegaSource = !!(source.url.match(/mega(play|cloud|backup|cdn|stream)/i) || source.url.includes('mega.'));
    const isByseSource = source.url.includes('bysesayeveum.com/e/');
    const isCleanProxySource = source.url.startsWith('/api/mega-embed/') || source.url.startsWith('/api/vidmoly-embed/') || source.url.startsWith('/api/video-embed/');
    const isDirectIframeOnly = !!(source.url.match(/(vidwish|streamwish|streamtape|streamhide|doodstream|voe|filemoon|mixdrop|rapidcloud|upstream)/i));
    if (isMegaSource || isByseSource || isCleanProxySource || isDirectIframeOnly) {
      setResolvedHls(null);
      setHlsResolving(false);
      return;
    }

    // Streaming site pages (9anime, etc.) skip directly to iframe
    if (VideoService.isStreamingSitePage(source.url) && !source.url.toLowerCase().includes('hianime.do')) {
      setResolvedHls(null);
      return;
    }

    let cancelled = false;
    setResolvedHls(null);
    setHlsResolving(true);

    // ── Tier 2 helper: client-side CORS fetch (no backend) ───────────────────
    const clientSideExtract = async (embedUrl: string): Promise<string | null> => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const resp = await fetch(embedUrl, { signal: ctrl.signal, headers: { Accept: 'text/html,*/*' } });
        clearTimeout(timer);
        const html = await resp.text();
        const patterns = [
          /sources\s*[=:]\s*\[\s*\{[^}]*?(?:file|src|url)\s*[=:]\s*["']([^"']*\.m3u8[^"']*)/i,
          /file\s*:\s*["']([^"']*\.m3u8[^"']*)/i,
          /"(?:file|src|url|hls|stream)"\s*:\s*"([^"]*\.m3u8[^"]*)"/i,
          /["'](https?:\/\/[^"'\s]*\.m3u8[^"'\s]*?)["']/i,
          /(https?:\/\/[^\s"'<>]*\.m3u8[^\s"'<>]*)/i,
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m?.[1]) {
            const url = m[1].replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
            if (url.startsWith('http')) {
              console.log('[SmartVideoPlayer] ✅ [Tier 2 - Client] HLS found:', url.substring(0, 60));
              return url;
            }
          }
        }
        return null;
      } catch {
        return null; // CORS block or network error — expected and safe
      }
    };

    // ── Main cascade ──────────────────────────────────────────────────────────
    const resolve = async () => {
      const embedUrl = source.url;

      // ── Tier 1: backend with hard 5s abort timeout ───────────────────────
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const resp = await fetch(`/api/resolve-hls?url=${encodeURIComponent(embedUrl)}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (resp.ok) {
          const data = await resp.json();
          if (data.success && data.hlsUrl) {
            if (!cancelled) {
              console.log('[SmartVideoPlayer] ✅ [Tier 1 - Backend] HLS resolved:', data.hlsUrl.substring(0, 60));
              setResolvedHls(data.hlsUrl);
              setHlsResolving(false);
            }
            return;
          }
        }
        console.log('[SmartVideoPlayer] ⚠️ [Tier 1] Backend returned no HLS, trying Tier 2...');
      } catch {
        console.log('[SmartVideoPlayer] ⚠️ [Tier 1] Backend unreachable (offline/timeout), trying Tier 2...');
      }

      if (cancelled) return;

      // ── Tier 2: client-side CORS fetch ───────────────────────────────────
      const clientHls = await clientSideExtract(embedUrl);
      if (!cancelled && clientHls) {
        setResolvedHls(clientHls);
        setHlsResolving(false);
        return;
      }

      if (cancelled) return;

      // ── Tier 3: iframe fallback (video always plays) ─────────────────────
      console.log('[SmartVideoPlayer] ℹ️ [Tier 3] Using iframe fallback');
      setResolvedHls(null);
      setHlsResolving(false);
    };

    resolve();
    return () => { cancelled = true; };
  }, [playerState.currentSource?.url]);




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
        className="w-full h-full object-cover bg-black"
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
        onLoadedData={() => {
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
  const isIframeSource = sourceType === 'iframe';

  return (
    <>
      <div className={`relative bg-black overflow-hidden ${className}`}>
        {/* Video Player */}
        {sourceType === 'youtube' ? (
          renderYouTubePlayer(playerState.currentSource)
        ) : isIframeSource && resolvedHls ? (
          // Iframe source resolved to HLS → use HLSVideoPlayer for full custom controls
          <HLSVideoPlayer
            src={resolvedHls}
            autoPlay={autoPlay}
            startTime={startTime}
            onTimeUpdate={handleTimeUpdate}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onError={handleError}
            onLoadStart={() => setPlayerState(prev => ({ ...prev, isLoading: true }))}
            onLoadedData={() => setPlayerState(prev => ({ ...prev, isLoading: false }))}
            onProgress={throttledHandleAdaptiveBitrate}
            optimizeBuffer={optimizeBuffer}
          />
        ) : isIframeSource && hlsResolving ? (
          // Still resolving — show spinner
          renderLoading()
        ) : sourceType === 'iframe' ? (
          renderIframePlayer(playerState.currentSource)
        ) : sourceType === 'hls' ? (
          renderHLSPlayer(playerState.currentSource)
        ) : (
          renderDirectVideoPlayer(playerState.currentSource)
        )}
        
        {/* Loading Overlay */}
        {playerState.isLoading && !isIframeSource && (
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
  // Web Audio API refs for volume boost beyond 100%
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  // volume: 0-2 where >1 means gain boost (200% max)
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const volumeSliderRef = useRef<HTMLDivElement>(null);
  // true when slider was explicitly clicked open — hover-leave won't close it
  const volumePinnedRef = useRef(false);
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

  // Lazy Web Audio API initialiser — must be called inside a user gesture
  const initAudioBoost = useCallback(() => {
    const video = videoRef.current;
    if (!video || audioCtxRef.current) return; // already initialised
    try {
      const ctx = new AudioContext();
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const source = ctx.createMediaElementSource(video);
      source.connect(gain);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
      mediaSourceRef.current = source;
    } catch (err) {
      console.warn('[SmartVideoPlayer] Web Audio API init failed:', err);
    }
  }, []);

  // Apply volume: 0-1 uses native, 1-2 uses GainNode boost
  const applyVolume = useCallback((val: number, muted: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    if (muted || val === 0) {
      video.muted = true;
      if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;
      return;
    }
    video.muted = false;
    if (val <= 1) {
      video.volume = val;
      if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;
    } else {
      // Keep native at 100%, boost with gain node
      video.volume = 1;
      if (gainNodeRef.current) gainNodeRef.current.gain.value = val;
    }
  }, []);

  useEffect(() => {
    hlsSeekedRef.current = false;
    clearControlsHideTimer();
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setIsMuted(false);
    setVolume(1);
    // Reset gain on source change
    if (gainNodeRef.current) gainNodeRef.current.gain.value = 1;
    setSelectedQuality('auto');
    setQualityLevels([]);
    setCaptionsEnabled(false);
    setHasCaptions(false);
    setControlsVisible(true);
  }, [src, clearControlsHideTimer]);

  // Close volume slider when tapping/clicking outside — handles both mouse and touch
  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (volumeSliderRef.current && !volumeSliderRef.current.contains(e.target as Node)) {
        volumePinnedRef.current = false; // unpin on outside click
        setShowVolumeSlider(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, []);

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
        className="w-full h-full object-cover bg-black"
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
          if (!video.muted) setVolume(video.volume);
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
          {/* Seek bar with filled progress */}
          <input
            type="range"
            min="0"
            max={Math.max(duration, 1)}
            step="0.1"
            value={Math.min(currentTime, duration || currentTime)}
            disabled={!duration || Number.isNaN(duration)}
            onMouseDown={() => setIsSeeking(true)}
            onTouchStart={() => setIsSeeking(true)}
            onChange={(event) => seekTo(Number(event.target.value))}
            onMouseUp={() => setIsSeeking(false)}
            onTouchEnd={() => setIsSeeking(false)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background: (() => {
                const pct = duration > 0 ? (Math.min(currentTime, duration) / duration) * 100 : 0;
                return `linear-gradient(to right, #34d399 0%, #34d399 ${pct}%, rgba(255,255,255,0.15) ${pct}%, rgba(255,255,255,0.15) 100%)`;
              })()
            }}
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
            {/* Volume control: mute button + expandable slider */}
            <div
              ref={volumeSliderRef}
              className="relative flex items-center"
              onMouseEnter={() => { initAudioBoost(); setShowVolumeSlider(true); }}
              onMouseLeave={() => {
                // Only close on hover-leave if NOT pinned open by a click
                if (!volumePinnedRef.current) setShowVolumeSlider(false);
              }}
            >
              <button
                type="button"
                onClick={() => {
                  initAudioBoost();
                  if (isMuted) {
                    // Unmute — restore volume and pin slider open
                    const restoreVol = volume > 0 ? volume : 1;
                    setIsMuted(false);
                    applyVolume(restoreVol, false);
                    volumePinnedRef.current = true;
                    setShowVolumeSlider(true);
                  } else if (showVolumeSlider && volumePinnedRef.current) {
                    // Already pinned open — click again to close
                    volumePinnedRef.current = false;
                    setShowVolumeSlider(false);
                  } else {
                    // Pin open (works for both hover-preview and first click)
                    volumePinnedRef.current = true;
                    setShowVolumeSlider(true);
                  }
                }}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-white/10 px-2 text-[11px] sm:h-auto sm:px-2.5 sm:py-2 sm:text-xs font-semibold text-white transition hover:bg-white/20"
                aria-label={isMuted ? 'Unmute' : 'Volume'}
              >
                <i className={`${
                  isMuted || volume === 0
                    ? 'ri-volume-mute-line'
                    : volume < 0.4
                    ? 'ri-volume-down-line'
                    : 'ri-volume-up-line'
                } text-sm`} />
                <span className="hidden sm:inline">
                  {isMuted ? 'Muted' : `${Math.round(volume * 100)}%`}
                  {!isMuted && volume > 1 && <span className="ml-0.5 text-amber-400">⚡</span>}
                </span>
              </button>

              {/* Volume slider popup */}
              {showVolumeSlider && (
                <div
                  className="absolute bottom-full left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 sm:gap-1 bg-black/85 backdrop-blur-sm rounded-lg sm:rounded-xl px-2 py-2 sm:px-3 sm:py-3 shadow-xl z-20 min-w-[40px] sm:min-w-[56px]"
                >
                  {/* % label */}
                  <span className={`text-[9px] sm:text-[10px] font-bold leading-none ${volume > 1 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {Math.round((isMuted ? 0 : volume) * 100)}%
                  </span>

                  {/* Vertical range — 0 to 2 (200%) */}
                  <div className="relative flex items-center">
                    {/* 100% marker line */}
                    <div
                      className="absolute left-1/2 -translate-x-1/2 w-full h-px bg-white/25 pointer-events-none"
                      style={{ bottom: '50%' }}
                    />
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.01"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        initAudioBoost();
                        const val = Number(e.target.value);
                        setVolume(val);
                        setIsMuted(val === 0);
                        applyVolume(val, val === 0);
                      }}
                      className="h-16 sm:h-28 cursor-pointer appearance-none rounded-full"
                      style={{
                        writingMode: 'vertical-lr' as any,
                        direction: 'rtl',
                        touchAction: 'none',
                        background: (() => {
                          const currentVol = isMuted ? 0 : volume;
                          const pct = (currentVol / 2) * 100;
                          const midPct = 50;
                          if (currentVol <= 1) {
                            return `linear-gradient(to top, #34d399 0%, #34d399 ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`;
                          }
                          return `linear-gradient(to top, #34d399 0%, #34d399 ${midPct}%, #f59e0b ${midPct}%, #f59e0b ${pct}%, rgba(255,255,255,0.12) ${pct}%, rgba(255,255,255,0.12) 100%)`;
                        })()
                      }}
                      aria-label="Volume (0–200%)"
                    />
                  </div>
                </div>
              )}
            </div>

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

interface IframePlayerProps {
  src: string;
  title?: string;
  width?: string | number;
  height?: string | number;
  allowFullScreen?: boolean;
  className?: string;
  animeId?: string;
  episodeNumber?: number;
  estimatedDuration?: number; // Estimated episode duration in seconds
  onProgressUpdate?: (progress: number, accuracy: 'accurate' | 'estimated' | 'manual') => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onLoad?: () => void;
  startTime?: number; // Starting time for auto-resuming video
}

export const IframePlayer: React.FC<IframePlayerProps> = ({
  src,
  title = "Video Player",
  width = "100%",
  height = "500px",
  allowFullScreen = true,
  className = "",
  estimatedDuration = 1440, // Default 24 minutes
  onProgressUpdate,
  onTimeUpdate,
  onLoad,
  startTime = 0
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [hasReceivedPostMessage, setHasReceivedPostMessage] = useState(false);
  const hasSeekedRef = useRef(false);
  
  // Check if the URL is a 9anime page and needs special handling
  const is9animeUrl = src.includes('9anime.org.lv') || src.includes('hianime.do');
  
  // Check if it's a gogoanime URL (which should be embeddable)
  const isGogoanimeUrl = src.includes('gogoanime.me.uk') || src.includes('gogoanime');
  
  // Check if it's any mega URL (megaplay, megacloud, etc.) - convert to boolean to prevent re-renders
  const isMegaUrl = !!(src.match(/mega(play|cloud|backup|cdn|stream)/i) || src.includes('mega.'));

  // PostMessage listener for video state from embedded player
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security: Only accept messages from same origin or known video domains
      const allowedOrigins = [
        'https://gogoanime.me.uk',
        'https://gogoanime',
        'https://megaplay.buzz',
        'https://megaplay',
        'https://hianime.do',
        'https://flixcloud.cc',
        'https://fetch3.flixcloud.cc',
        'https://reanime.to',
        window.location.origin
      ];

      // Check if message is from a known origin (basic check)
      const origin = event.origin;
      const isAllowedOrigin = allowedOrigins.some(allowed => origin.includes(allowed));
      
      if (!isAllowedOrigin && event.origin !== window.location.origin) {
        // Still allow but be cautious
        console.warn('Received message from unknown origin:', origin);
      }

      // Handle different message formats from embedded players
      if (event.data && typeof event.data === 'object') {
        let isMatch = false;
        let currentTime = 0;
        let duration = estimatedDuration;

        // Video.js format
        if (event.data.type === 'videojs' || event.data.event === 'timeupdate') {
          isMatch = true;
          currentTime = event.data.currentTime || event.data.time || 0;
          duration = event.data.duration || estimatedDuration;
        }
        // Generic video player format
        else if (event.data.currentTime !== undefined || event.data.videoTime !== undefined) {
          isMatch = true;
          currentTime = event.data.currentTime || event.data.videoTime || 0;
          duration = event.data.duration || event.data.videoDuration || estimatedDuration;
        }

        if (isMatch) {
          // Prevent premature progress overwriting
          const isInitialSeekPending = startTime > 5 && !hasSeekedRef.current;
          if (isInitialSeekPending && currentTime < startTime - 5) {
            console.log(`⏳ Ignoring pre-seek postMessage: ${currentTime}s (initial seek to ${startTime}s pending)`);
            return;
          }

          if (startTime > 5 && !hasSeekedRef.current && currentTime >= startTime - 5) {
            console.log(`🎯 Initial seek resolved via postMessage playback at ${currentTime}s (start: ${startTime}s)`);
            hasSeekedRef.current = true;
          }

          setHasReceivedPostMessage(true); // Mark that we received postMessage data
          onTimeUpdate?.(currentTime, duration);
          
          // Update progress with accurate data
          if (currentTime > 0 && onProgressUpdate) {
            onProgressUpdate(currentTime, 'accurate');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [estimatedDuration, onProgressUpdate, onTimeUpdate, startTime]);

  // Request video state from embedded player via postMessage
  const requestVideoState = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;

    try {
      // Try different postMessage formats that various players might support
      const formats = [
        { type: 'getVideoState' },
        { type: 'videoState', action: 'get' },
        { method: 'getCurrentTime' },
        { event: 'requestVideoState' }
      ];

      formats.forEach((format, index) => {
        setTimeout(() => {
          iframeRef.current?.contentWindow?.postMessage(format, '*');
        }, index * 500); // Stagger requests
      });
    } catch (error) {
      console.warn('Failed to send postMessage to iframe:', error);
    }
  }, []);

  // Request video state periodically
  useEffect(() => {
    // Initial request after iframe loads
    const requestInterval = setInterval(() => {
      requestVideoState();
    }, 5000); // Request every 5 seconds

    return () => clearInterval(requestInterval);
  }, []); // requestVideoState is stable from useCallback with empty deps

  // Same-origin JS injection / DOM querying for progress tracking and auto-resume
  useEffect(() => {
    // Reset seek ref when src changes
    hasSeekedRef.current = false;

    const isSameOrigin = src.startsWith('/') || src.startsWith(window.location.origin);
    if (!isSameOrigin) return;

    console.log('⚡ Same-origin progress tracking/auto-resume helper active for:', src);

    const queryInterval = setInterval(() => {
      try {
        const iframe = iframeRef.current;
        if (!iframe) return;

        const win = iframe.contentWindow;
        const doc = iframe.contentDocument || win?.document;
        if (!doc || !win) return;

        // 1. Try JWPlayer via window.jwplayer inside the same-origin iframe
        let jwPlayerInstance: any = null;
        try {
          if (typeof (win as any).jwplayer === 'function') {
            jwPlayerInstance = (win as any).jwplayer();
          }
        } catch (e) {
          // fail silently
        }

        if (jwPlayerInstance && typeof jwPlayerInstance.getPosition === 'function') {
          const current = Math.floor(jwPlayerInstance.getPosition());
          const duration = Math.floor(jwPlayerInstance.getDuration());

          if (!hasSeekedRef.current && startTime && startTime > 5 && duration > 5) {
            console.log(`🚀 Resuming same-origin iframe JWPlayer to saved progress: ${startTime}s`);
            jwPlayerInstance.seek(startTime);
            hasSeekedRef.current = true;
          }

          if (current > 0) {
            setHasReceivedPostMessage(true);
            onTimeUpdate?.(current, duration > 0 ? duration : estimatedDuration);
            onProgressUpdate?.(current, 'accurate');
          }
          return; // If JWPlayer was processed, skip standard HTML5 video check
        }

        // 2. Try standard HTML5 Video element inside the same-origin document
        const videoElement = doc.querySelector('video');
        if (videoElement) {
          // Auto-Resume: Seek to start time on load once, checking readyState to avoid browser discard
          if (!hasSeekedRef.current && startTime && startTime > 0 && videoElement.readyState >= 2) {
            const duration = videoElement.duration;
            if (duration && !isNaN(duration) && duration > 0) {
              console.log(`🚀 Resuming same-origin iframe HTML5 video to saved progress: ${startTime}s (readyState: ${videoElement.readyState}, duration: ${duration}s)`);
              videoElement.currentTime = Math.min(startTime, duration - 1);
              hasSeekedRef.current = true;
            }
          }

          // Tracking: Retrieve current time and state
          const currentTime = videoElement.currentTime;
          const duration = videoElement.duration || estimatedDuration;

          if (currentTime > 0) {
            setHasReceivedPostMessage(true);
            onTimeUpdate?.(currentTime, duration);
            onProgressUpdate?.(currentTime, 'accurate');
          }
        }
      } catch (error) {
        // Cross-origin boundaries block this, fail silently (safely caught)
        console.debug('Cross-origin boundary blocks same-origin helper:', error);
      }
    }, 3000); // Check every 3 seconds for responsive tracking/seeking

    return () => clearInterval(queryInterval);
  }, [src, startTime, estimatedDuration, onProgressUpdate, onTimeUpdate]);

  // 3. Fallback Estimated Tracking for Cross-Origin Iframes
  useEffect(() => {
    const isSameOrigin = src.startsWith('/') || src.startsWith(window.location.origin);
    if (isSameOrigin) return; // Same-origin has its own accurate queryInterval

    console.log('⏰ [IframePlayer] Fallback estimated progress tracking activated for cross-origin player starting at:', startTime);
    
    let currentEstimatedTime = startTime;
    let isTabFocused = true;

    // Track tab focus to avoid counting time when user is in another tab
    const handleVisibilityChange = () => {
      isTabFocused = document.visibilityState === 'visible';
      console.log('📄 [IframePlayer] Tab visibility changed:', isTabFocused ? 'Visible' : 'Hidden');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      // If the tab is visible and we haven't received custom postMessage data
      // (postMessage accurate data has priority and overrides estimation)
      if (isTabFocused && !hasReceivedPostMessage) {
        currentEstimatedTime += 1;
        
        // Every 5 seconds, broadcast the estimated time to the parent
        if (currentEstimatedTime % 5 === 0) {
          console.log('📈 [IframePlayer] Broadcasting estimated progress:', currentEstimatedTime);
          onTimeUpdate?.(currentEstimatedTime, estimatedDuration);
          onProgressUpdate?.(currentEstimatedTime, 'estimated');
        }
      }
    }, 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
      // Immediately send final progress update on unmount
      if (currentEstimatedTime > startTime && !hasReceivedPostMessage) {
        console.log('📤 [IframePlayer] Sending final estimated progress on unmount:', currentEstimatedTime);
        onTimeUpdate?.(currentEstimatedTime, estimatedDuration);
        onProgressUpdate?.(currentEstimatedTime, 'estimated');
      }
    };
  }, [src, startTime, estimatedDuration, hasReceivedPostMessage, onProgressUpdate, onTimeUpdate]);

  // Instantly trigger onLoad if using the non-embeddable 9anime fallback view
  useEffect(() => {
    if (is9animeUrl && !isGogoanimeUrl && !isMegaUrl) {
      onLoad?.();
    }
  }, [src, is9animeUrl, isGogoanimeUrl, isMegaUrl, onLoad]);

  return (
    <div className={`iframe-player-container ${className}`}>
      {is9animeUrl && !isGogoanimeUrl && !isMegaUrl ? (
        <div className="relative w-full h-full bg-gray-900 rounded-lg overflow-hidden aspect-video">
          <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
            <div className="text-center text-white p-6">
              <div className="text-4xl mb-4">🎬</div>
              <h3 className="text-xl font-semibold mb-2">9anime Player</h3>
              <p className="text-gray-300 mb-4">
                This episode is hosted on 9anime.org.lv
              </p>
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <span className="mr-2">▶️</span>
                Watch on 9anime
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative w-full aspect-video group">
          
          <iframe
            ref={iframeRef}
            src={src}
            title={title}
            width={width}
            height={height}
            allowFullScreen={allowFullScreen}
            frameBorder="0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 w-full h-full rounded-lg shadow-lg"
            style={{
              minHeight: typeof height === 'string' ? height : `${height}px`,
              border: 'none',
              borderRadius: '8px'
            }}
            onLoad={() => {
              console.log('✅ Iframe onLoad fired - video is loading!');
              
              // Call the parent onLoad callback if provided
              onLoad?.();
              
              // Note: We can't access iframe content due to X-Frame-Options,
              // but the video plays fine! The security restriction only blocks
              // JavaScript access, not video playback.
            }}
            onError={(e) => {
              console.error('❌ Iframe onError event fired:', e);
              console.error('This usually means the URL failed to load completely');
            }}
          />
        </div>
      )}
    </div>
  );
};
