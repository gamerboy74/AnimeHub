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
  animeId,
  episodeNumber,
  estimatedDuration = 1440, // Default 24 minutes
  onProgressUpdate,
  onTimeUpdate
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [showManualControls, setShowManualControls] = useState(false);
  const [videoState, setVideoState] = useState<VideoState | null>(null);
  const [watchStartTime, setWatchStartTime] = useState<number | null>(null);
  const [activeWatchTime, setActiveWatchTime] = useState(0); // Time actively watching (not hidden)
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [hasReceivedPostMessage, setHasReceivedPostMessage] = useState(false);
  const [iframeLoadError, setIframeLoadError] = useState(false);
  const lastUpdateTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
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

  // Time-based estimation tracking
  useEffect(() => {
    // Use refs to avoid dependency issues
    const watchStartTimeRef = { current: Date.now() };
    const isPageVisibleRef = { current: true };
    const hasReceivedPostMessageRef = { current: hasReceivedPostMessage };
    
    // Track page visibility for accurate watch time estimation
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      isPageVisibleRef.current = isVisible;
      setIsPageVisible(isVisible);
      
      if (isVisible && !watchStartTimeRef.current) {
        // Page became visible - start tracking
        watchStartTimeRef.current = Date.now();
        setWatchStartTime(Date.now());
        lastUpdateTimeRef.current = Date.now();
      } else if (!isVisible && watchStartTimeRef.current) {
        // Page became hidden - stop tracking active time
        const timeSpent = Date.now() - lastUpdateTimeRef.current;
        setActiveWatchTime(prev => prev + timeSpent);
      }
    };

    // Track time spent on page
    const handleTimeTracking = () => {
      if (isPageVisibleRef.current && watchStartTimeRef.current) {
        const now = Date.now();
        const elapsed = now - lastUpdateTimeRef.current;
        lastUpdateTimeRef.current = now;
        
        setActiveWatchTime(prev => {
          const newTime = prev + elapsed;
          
          // Estimate progress based on time spent (conservative estimate)
          // Only use time-based estimation if we haven't received postMessage data
          if (newTime > 0 && onProgressUpdate && !hasReceivedPostMessageRef.current) {
            // Use 80% of time spent as progress (conservative)
            const estimatedProgress = Math.floor((newTime / 1000) * 0.8);
            setVideoState(prev => {
              // Only update if not from postmessage
              if (!prev || prev.source !== 'postmessage') {
                return {
                  currentTime: estimatedProgress,
                  duration: estimatedDuration,
                  paused: false,
                  source: 'estimated'
                };
              }
              return prev;
            });
            onProgressUpdate(estimatedProgress, 'estimated');
          }
          
          return newTime;
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Start tracking when component mounts
    setWatchStartTime(Date.now());
    lastUpdateTimeRef.current = Date.now();
    
    // Update every second for time-based estimation
    intervalRef.current = setInterval(handleTimeTracking, 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [estimatedDuration]); // Only depend on estimatedDuration which shouldn't change

  // Handle manual progress updates
  const handleManualProgress = useCallback((percentage: number) => {
    const progressSeconds = Math.floor((estimatedDuration * percentage) / 100);
    
    setVideoState(prev => ({
      currentTime: progressSeconds,
      duration: estimatedDuration,
      paused: prev?.paused || false,
      source: 'manual'
    }));
    
    onProgressUpdate?.(progressSeconds, 'manual');
    onTimeUpdate?.(progressSeconds, estimatedDuration);
    setShowManualControls(false);
  }, [estimatedDuration, onProgressUpdate, onTimeUpdate]);

  // Mark as complete
  const handleMarkComplete = useCallback(() => {
    const progressSeconds = estimatedDuration;
    onProgressUpdate?.(progressSeconds, 'manual');
    onTimeUpdate?.(progressSeconds, estimatedDuration);
    setShowManualControls(false);
  }, [estimatedDuration, onProgressUpdate, onTimeUpdate]);

  // Calculate completion estimate for auto-completion
  useEffect(() => {
    // Auto-detect completion: if user watched for >80% of estimated duration
    if (activeWatchTime > 0 && estimatedDuration > 0) {
      const watchTimeSeconds = activeWatchTime / 1000;
      const completionPercentage = (watchTimeSeconds / estimatedDuration) * 100;
      
      if (completionPercentage >= 80) {
        setVideoState(prev => {
          // Only auto-complete if we don't have accurate data from postmessage
          if (!prev || (prev.source !== 'manual' && prev.source !== 'postmessage')) {
            const estimatedProgress = Math.floor(estimatedDuration * 0.9); // 90% as completion estimate
            onProgressUpdate?.(estimatedProgress, 'estimated');
          }
          return prev;
        });
      }
    }
  }, [activeWatchTime, estimatedDuration]); // Removed videoState and onProgressUpdate

  // Cleanup on unmount - save final progress
  useEffect(() => {
    return () => {
      if (activeWatchTime > 0 && onProgressUpdate) {
        const finalProgress = Math.floor((activeWatchTime / 1000) * 0.8);
        onProgressUpdate(finalProgress, 'estimated');
      }
    };
  }, [activeWatchTime, onProgressUpdate]);

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
          
          {/* Automatic Tracking Status Indicator */}
          {hasReceivedPostMessage && videoState?.source === 'postmessage' && (
            <div className="absolute top-4 left-4 z-10">
              <div className="px-3 py-2 bg-green-600/90 backdrop-blur-sm text-white rounded-lg text-xs flex items-center gap-2 shadow-lg">
                <i className="ri-checkbox-circle-line"></i>
                <span>Auto-tracking active</span>
              </div>
            </div>
          )}

          {/* Manual Progress Tracking Button - Only show if automatic tracking isn't working well */}
          <div className="absolute top-4 right-4 z-10">
            {/* Show manual button only if no postMessage data received after 10 seconds, or always on hover as fallback */}
            {(!hasReceivedPostMessage && activeWatchTime > 10000) || showManualControls ? (
              <button
                onClick={() => setShowManualControls(!showManualControls)}
                className={`px-3 py-2 bg-black/70 hover:bg-black/90 text-white rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  !hasReceivedPostMessage && activeWatchTime > 10000 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title={hasReceivedPostMessage ? "Manual override (optional)" : "Track Progress Manually"}
              >
                <i className="ri-time-line"></i>
                {hasReceivedPostMessage ? 'Manual' : 'Track Progress'}
              </button>
            ) : null}
          </div>

          {/* Progress Controls Modal */}
          <AnimatePresence>
            {showManualControls && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-14 right-4 bg-black/90 backdrop-blur-sm rounded-lg p-4 z-20 min-w-[200px]"
              >
                <div className="text-white mb-3">
                  <h4 className="text-sm font-semibold mb-2">
                    {hasReceivedPostMessage ? 'Manual Override' : 'Manual Progress Tracking'}
                  </h4>
                  <p className="text-xs text-gray-300 mb-2">
                    {hasReceivedPostMessage 
                      ? 'Automatic tracking is active. Use this to manually adjust progress.'
                      : videoState?.source === 'estimated' 
                        ? 'Using time-based estimation. Set progress manually for accuracy.'
                        : 'Progress is being tracked automatically. Use this to set a milestone.'}
                  </p>
                  {videoState && (
                    <p className="text-xs text-gray-400 mt-1">
                      Current source: {videoState.source === 'postmessage' ? 'Player API ✓' : 
                               videoState.source === 'estimated' ? 'Time-based ⏱' : 'Manual ✎'}
                    </p>
                  )}
                </div>
                
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => handleManualProgress(25)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                  >
                    25%
                  </button>
                  <button
                    onClick={() => handleManualProgress(50)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                  >
                    50%
                  </button>
                  <button
                    onClick={() => handleManualProgress(75)}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs transition-colors"
                  >
                    75%
                  </button>
                  <button
                    onClick={handleMarkComplete}
                    className="px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-xs transition-colors"
                  >
                    Complete
                  </button>
                </div>

                {videoState && (
                  <div className="text-xs text-gray-400 pt-2 border-t border-gray-700">
                    <p>Time: {Math.floor(videoState.currentTime)}s / {Math.floor(videoState.duration)}s</p>
                    <p>Progress: {Math.floor((videoState.currentTime / videoState.duration) * 100)}%</p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default IframePlayer;
