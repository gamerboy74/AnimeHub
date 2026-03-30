import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  checkIntervalHours: number;
  maxConcurrent: number;
  rateLimit: number;
  scrapedThisHour: number;
  lastResults: {
    checked: number;
    found: number;
    failed: number;
    skipped: number;
    details: Array<{
      anime: string;
      episode: number;
      status: string;
      error?: string;
    }>;
  } | null;
}

export default function EpisodeScheduler() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data);
      }
    } catch {
      // Server might not be running
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    try {
      const res = await fetch('/api/scheduler/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(prev => prev ? { ...prev, enabled: data.enabled } : null);
      }
    } catch {
      // ignore
    } finally {
      setToggling(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await fetch('/api/scheduler/run', { method: 'POST' });
      // Poll more frequently while running
      setTimeout(fetchStatus, 2000);
      setTimeout(fetchStatus, 5000);
      setTimeout(fetchStatus, 10000);
      setTimeout(fetchStatus, 20000);
    } catch {
      // ignore
    } finally {
      setTriggering(false);
    }
  };

  const formatTime = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = d.getTime() - now.getTime();

    // Past time (lastRun)
    if (diff < 0) {
      const ago = Math.abs(diff);
      if (ago < 60000) return 'just now';
      if (ago < 3600000) return `${Math.floor(ago / 60000)}m ago`;
      if (ago < 86400000) return `${Math.floor(ago / 3600000)}h ago`;
      return d.toLocaleDateString();
    }
    // Future time (nextRun)
    if (diff < 3600000) return `in ${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `in ${Math.floor(diff / 3600000)}h`;
    return d.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-slate-200 rounded w-1/3"></div>
          <div className="h-4 bg-slate-200 rounded w-2/3"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-r from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
            <i className="ri-calendar-schedule-line text-white text-lg"></i>
          </div>
          <h3 className="text-lg font-semibold text-slate-800">Episode Scheduler</h3>
        </div>
        <p className="text-slate-500 text-sm">Server not reachable. Start the backend to use the scheduler.</p>
      </div>
    );
  }

  const results = status.lastResults;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 overflow-hidden"
    >
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-amber-400 to-orange-500 rounded-lg flex items-center justify-center shadow-md">
              <i className="ri-calendar-schedule-line text-white text-lg"></i>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">Episode Scheduler</h3>
              <p className="text-xs text-slate-500">
                Auto-checks ongoing anime every {status.checkIntervalHours}h
              </p>
            </div>
          </div>

          {/* Toggle */}
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${
              status.enabled ? 'bg-green-500' : 'bg-slate-300'
            } ${toggling ? 'opacity-50' : 'cursor-pointer'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                status.enabled ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Status Row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-500 mb-0.5">Status</div>
            <div className="flex items-center justify-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${
                status.running ? 'bg-amber-500 animate-pulse' :
                status.enabled ? 'bg-green-500' : 'bg-slate-400'
              }`} />
              <span className="text-sm font-medium text-slate-700">
                {status.running ? 'Running' : status.enabled ? 'Idle' : 'Off'}
              </span>
            </div>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-500 mb-0.5">Last Run</div>
            <span className="text-sm font-medium text-slate-700">
              {formatTime(status.lastRun)}
            </span>
          </div>
          <div className="bg-slate-50 rounded-lg p-2.5 text-center">
            <div className="text-xs text-slate-500 mb-0.5">Next Run</div>
            <span className="text-sm font-medium text-slate-700">
              {status.enabled ? formatTime(status.nextRun) : '—'}
            </span>
          </div>
        </div>

        {/* Last Results Summary */}
        {results && (
          <div className="flex items-center gap-4 text-sm mb-4">
            <span className="flex items-center gap-1 text-slate-600">
              <i className="ri-search-eye-line text-blue-500"></i>
              {results.checked} checked
            </span>
            <span className="flex items-center gap-1 text-green-600">
              <i className="ri-check-double-line"></i>
              {results.found} new
            </span>
            {results.failed > 0 && (
              <span className="flex items-center gap-1 text-red-500">
                <i className="ri-close-circle-line"></i>
                {results.failed} failed
              </span>
            )}
            {results.skipped > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <i className="ri-skip-forward-line"></i>
                {results.skipped} skipped
              </span>
            )}
          </div>
        )}

        {/* Rate limit bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>Rate: {status.scrapedThisHour}/{status.rateLimit} this hour</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                status.scrapedThisHour / status.rateLimit > 0.8 ? 'bg-red-400' :
                status.scrapedThisHour / status.rateLimit > 0.5 ? 'bg-amber-400' : 'bg-green-400'
              }`}
              style={{ width: `${Math.min(100, (status.scrapedThisHour / status.rateLimit) * 100)}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleTrigger}
            disabled={triggering || status.running || !status.enabled}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-medium rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {status.running ? (
              <>
                <i className="ri-loader-4-line animate-spin"></i>
                Running…
              </>
            ) : (
              <>
                <i className="ri-play-line"></i>
                Run Now
              </>
            )}
          </button>
          {results && results.details.length > 0 && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
            >
              <i className={`ri-arrow-${showDetails ? 'up' : 'down'}-s-line`}></i>
            </button>
          )}
        </div>
      </div>

      {/* Details Panel */}
      {showDetails && results && results.details.length > 0 && (
        <div className="border-t border-slate-200 max-h-64 overflow-y-auto">
          {results.details.map((d, i) => (
            <div
              key={i}
              className="px-6 py-2.5 flex items-center justify-between text-sm border-b border-slate-100 last:border-0 hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <i className={`text-lg flex-shrink-0 ${
                  d.status === 'found' ? 'ri-check-line text-green-500' :
                  d.status === 'error' ? 'ri-error-warning-line text-red-500' :
                  'ri-time-line text-slate-400'
                }`} />
                <span className="truncate text-slate-700">{d.anime}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                <span className="text-slate-500">EP {d.episode}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  d.status === 'found' ? 'bg-green-100 text-green-700' :
                  d.status === 'error' ? 'bg-red-100 text-red-700' :
                  'bg-slate-100 text-slate-600'
                }`}>
                  {d.status === 'not_available' ? 'no new ep' : d.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
