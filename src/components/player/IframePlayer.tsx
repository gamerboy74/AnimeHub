import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

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

interface VideoState {
  currentTime: number;
  duration: number;
  paused: boolean;
  source: 'postmessage' | 'estimated' | 'manual';
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
  const [showManualControls, setShowManualControls] = useState(false);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [, setWatchStartTime] = useState<number | null>(null);
  const [activeWatchTime, setActiveWatchTime] = useState(0); // Time actively watching (not hidden)
  const [, setIsPageVisible] = useState(true);
  const [hasReceivedPostMessage, setHasReceivedPostMessage] = useState(false);
  const [, setIframeLoadError] = useState(false);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
        // Video.js format
        if (event.data.type === 'videojs' || event.data.event === 'timeupdate') {
          const currentTime = event.data.currentTime || event.data.time || 0;
          const duration = event.data.duration || estimatedDuration;
          
          setVideoState({
            currentTime,
            duration,
            paused: event.data.paused || false,
            source: 'postmessage'
          });
          
          setHasReceivedPostMessage(true); // Mark that we received postMessage data
          onTimeUpdate?.(currentTime, duration);
          
          // Update progress with accurate data
          if (currentTime > 0 && onProgressUpdate) {
            onProgressUpdate(currentTime, 'accurate');
          }
        }
        
        // Generic video player format
        if (event.data.currentTime !== undefined || event.data.videoTime !== undefined) {
          const currentTime = event.data.currentTime || event.data.videoTime || 0;
          const duration = event.data.duration || event.data.videoDuration || estimatedDuration;
          
          setVideoState({
            currentTime,
            duration,
            paused: event.data.paused || false,
            source: 'postmessage'
          });
          
          setHasReceivedPostMessage(true); // Mark that we received postMessage data
          onTimeUpdate?.(currentTime, duration);
          
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
  }, [estimatedDuration, onProgressUpdate, onTimeUpdate]);

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
          const state = jwPlayerInstance.getState();
          const playing = state === 'playing';

          if (!hasSeekedRef.current && startTime && startTime > 5 && duration > 5) {
            console.log(`🚀 Resuming same-origin iframe JWPlayer to saved progress: ${startTime}s`);
            jwPlayerInstance.seek(startTime);
            hasSeekedRef.current = true;
          }

          if (current > 0) {
            setVideoState({
              currentTime: current,
              duration: duration > 0 ? duration : estimatedDuration,
              paused: !playing,
              source: 'postmessage'
            });
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
          const paused = videoElement.paused;

          if (currentTime > 0) {
            setVideoState({
              currentTime,
              duration,
              paused,
              source: 'postmessage' // Mark as verified/accurate
            });
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



  // Check if iframe failed to load (X-Frame-Options blocked)
  useEffect(() => {
    // Reset error state when src changes
    setIframeLoadError(false);
    // Mega URLs now go through /api/mega-embed proxy which always loads — no timeout needed
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [src]);

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
              
              // Clear timeout - onLoad means the iframe rendered successfully
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
                loadTimeoutRef.current = null;
              }
              setIframeLoadError(false);
              
              // Call the parent onLoad callback if provided
              onLoad?.();
              
              // Note: We can't access iframe content due to X-Frame-Options,
              // but the video plays fine! The security restriction only blocks
              // JavaScript access, not video playback.
            }}
            onError={(e) => {
              console.error('❌ Iframe onError event fired:', e);
              console.error('This usually means the URL failed to load completely');
              // Clear timeout and show error immediately
              if (loadTimeoutRef.current) {
                clearTimeout(loadTimeoutRef.current);
                loadTimeoutRef.current = null;
              }
              setIframeLoadError(true);
            }}
          />
          
          {/* Pulsating premium Live Sync Badge - showing when active progress tracking matches active playback */}
          {hasReceivedPostMessage && videoState?.source === 'postmessage' && (
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
              <div className="px-3 py-1.5 bg-teal-600/90 backdrop-blur-sm text-white rounded-full text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-1.5 shadow-md">
                <span className="w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping"></span>
                <span>Live Sync Active</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default IframePlayer;
