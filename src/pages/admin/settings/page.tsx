import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminService, type AdminSettings } from '../../../services/admin';
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner';

export default function AdminSettings() {
  const savingRef = useRef({ scrapers: false, global: false });
  // Tracks the latest toggled state so rapid toggles don't race with each other
  const pendingScraperSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settings, setSettings] = useState<AdminSettings>({
    site_name: 'AnimeHub',
    site_description: 'Your ultimate anime streaming platform',
    maintenance_mode: false,
    allow_registration: true,
    max_file_size: 5242880,
    allowed_file_types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    email_notifications: true,
    analytics_enabled: true,
    cache_enabled: true,
    cache_duration: 3600,
    social_login_enabled: true,
    premium_features_enabled: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'files' | 'features' | 'cache' | 'scrapers'>('general');

  // Scraper configurations state
  interface ScraperConfig {
    id: string;
    name: string;
    enabled: boolean;
    priority: number;
    timeout: number;
    delay: number;
  }
  const [scrapers, setScrapers] = useState<ScraperConfig[]>([]);
  const [loadingScrapers, setLoadingScrapers] = useState(false);
  const [savingScrapers, setSavingScrapers] = useState(false);

  // Advanced scraper pipeline states
  const [globalSwitch, setGlobalSwitch] = useState<boolean>(true);
  interface ScraperStat {
    success: number;
    failure: number;
    totalMs: number;
    successRate: number;
    avgResponseTime: number;
  }
  const [scraperStats, setScraperStats] = useState<Record<string, ScraperStat>>({});
  interface LogEntry {
    timestamp: string;
    level: 'success' | 'warn' | 'error' | 'info';
    message: string;
  }
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [editingScraper, setEditingScraper] = useState<ScraperConfig | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  interface SchedulerStatus {
    enabled: boolean;
    running: boolean;
    lastRun: string | null;
    nextRun: string | null;
    checkIntervalHours: number;
    maxConcurrent: number;
    rateLimit: number;
    scrapedThisHour: number;
    queue: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
  }
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [runningManualCheck, setRunningManualCheck] = useState(false);
  const [resettingRateLimit, setResettingRateLimit] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        setError(null);
        const fetchedSettings = await AdminService.getAdminSettings();
        setSettings(fetchedSettings);
      } catch (err) {
        console.error('Failed to fetch settings:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const fetchScrapersData = async (showLoading = false) => {
    try {
      if (showLoading) setLoadingScrapers(true);
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');

      // 1. Fetch scraper configs (Only on initial load or explicitly asked, never on background poll)
      if (showLoading && !savingRef.current.scrapers) {
        const resConfig = await fetch(`${API_BASE}/api/scheduler/scrapers`);
        const dataConfig = await resConfig.json();
        if (dataConfig.success) {
          setScrapers(dataConfig.scrapers);
        } else {
          throw new Error(dataConfig.error || 'Failed to load scraper configurations');
        }
      }

      // 2. Fetch scheduler status
      const resStatus = await fetch(`${API_BASE}/api/scheduler/status`);
      const dataStatus = await resStatus.json();
      if (dataStatus.success) {
        if (!savingRef.current.global) {
          setGlobalSwitch(dataStatus.enabled);
        }
        setSchedulerStatus(dataStatus);
      }

      // 3. Fetch scraper stats & queue stats
      const resStats = await fetch(`${API_BASE}/api/scheduler/queue/stats`);
      const dataStats = await resStats.json();
      if (dataStats.success) {
        setScraperStats(dataStats.scrapers || {});
      }

      // 4. Fetch logs
      const resLogs = await fetch(`${API_BASE}/api/scheduler/logs`);
      const dataLogs = await resLogs.json();
      if (dataLogs.success) {
        setLogs(dataLogs.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch scraper pipeline data:', err);
      if (showLoading) {
        setError(err instanceof Error ? err.message : 'Failed to load scraper configurations');
      }
    } finally {
      if (showLoading) setLoadingScrapers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'scrapers') {
      fetchScrapersData(true);

      // Set up periodic polling (every 5 seconds) for stats and logs to feel live
      const interval = setInterval(() => {
        fetchScrapersData(false);
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [activeTab]);

  /**
   * Save scraper configurations to the server.
   * @param configsToSave - The configs to save (explicit list or current state)
   * @param isAutoSave - If true (toggle-triggered), do NOT overwrite local state from server
   *                     response to avoid clobbering rapid-toggle optimistic updates.
   */
  const handleSaveScrapers = async (configsToSave = scrapers, isAutoSave = false) => {
    try {
      setSavingScrapers(true);
      savingRef.current.scrapers = true;
      if (!isAutoSave) {
        setError(null);
        setSuccess(null);
      }
      const finalConfigs = Array.isArray(configsToSave) ? configsToSave : scrapers;
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');
      const res = await fetch(`${API_BASE}/api/scheduler/scrapers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrapers: finalConfigs }),
      });
      const data = await res.json();
      if (data.success) {
        // Only sync from server on explicit Save Config button press.
        // For auto-saves (toggle), trust the local optimistic state — syncing from
        // server would overwrite any newer toggle the user may have made during the
        // in-flight request (the "hallucination" race condition).
        if (!isAutoSave) {
          setScrapers(data.scrapers);
          setSuccess('Scraper configurations saved successfully!');
          setTimeout(() => setSuccess(null), 3000);
        }
      } else {
        throw new Error(data.error || 'Failed to save scraper configurations');
      }
    } catch (err) {
      console.error('Failed to save scrapers:', err);
      if (!isAutoSave) {
        setError(err instanceof Error ? err.message : 'Failed to save scraper configurations');
      }
    } finally {
      setSavingScrapers(false);
      savingRef.current.scrapers = false;
    }
  };

  const handleToggleGlobalSwitch = async () => {
    try {
      savingRef.current.global = true;
      const newStatus = !globalSwitch;
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');
      const res = await fetch(`${API_BASE}/api/scheduler/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setGlobalSwitch(data.enabled);
        // Refresh logs
        const resLogs = await fetch(`${API_BASE}/api/scheduler/logs`);
        const dataLogs = await resLogs.json();
        if (dataLogs.success) setLogs(dataLogs.logs || []);
      }
    } catch (err) {
      console.error('Failed to toggle global switch:', err);
    } finally {
      savingRef.current.global = false;
    }
  };

  const handleResetMetrics = async () => {
    try {
      setError(null);
      setSuccess(null);
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');
      const res = await fetch(`${API_BASE}/api/scheduler/reset-metrics`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.success) {
        setSuccess('Pipeline metrics and system logs reset successfully!');
        setTimeout(() => setSuccess(null), 3000);
        fetchScrapersData(false);
      }
    } catch (err) {
      console.error('Failed to reset metrics:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset pipeline metrics');
    }
  };

  const handleForceRunScheduler = async () => {
    try {
      setRunningManualCheck(true);
      setError(null);
      setSuccess(null);
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');
      const res = await fetch(`${API_BASE}/api/scheduler/run`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSuccess('Manual scheduler run triggered successfully!');
        setTimeout(() => setSuccess(null), 3000);
        fetchScrapersData(false);
      } else {
        throw new Error(data.error || 'Failed to start scheduler run');
      }
    } catch (err) {
      console.error('Failed to trigger manual run:', err);
      setError(err instanceof Error ? err.message : 'Failed to trigger manual run');
    } finally {
      setRunningManualCheck(false);
    }
  };

  const handleResetRateLimit = async () => {
    try {
      setResettingRateLimit(true);
      setError(null);
      setSuccess(null);
      const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_BACKEND_URL || '');
      const res = await fetch(`${API_BASE}/api/scheduler/reset-rate-limit`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSuccess('Hourly rate limit counter reset successfully!');
        setTimeout(() => setSuccess(null), 3000);
        fetchScrapersData(false);
      }
    } catch (err) {
      console.error('Failed to reset rate limit:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset rate limit');
    } finally {
      setResettingRateLimit(false);
    }
  };

  // Drag and Drop reordering logic
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, _index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = [...scrapers];
    const temp = updated[draggedIndex];
    updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, temp);

    // Re-assign priorities (1-indexed based on new order)
    const prioritized = updated.map((scraper, idx) => ({
      ...scraper,
      priority: idx + 1
    }));

    setScrapers(prioritized);
    setDraggedIndex(null);
  };

  const toggleScraperEnabled = (id: string) => {
    const updated = scrapers.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s);
    // Optimistic local update — immediately reflects the toggle in the UI
    setScrapers(updated);

    // Debounce the auto-save so rapid toggles don't fire multiple concurrent
    // requests (which would race and potentially clobber each other on the server).
    if (pendingScraperSave.current) {
      clearTimeout(pendingScraperSave.current);
    }
    pendingScraperSave.current = setTimeout(() => {
      // Use the ref-captured latest scraper state to avoid stale closure issues
      setScrapers(latest => {
        // Fire the save with whatever state React has settled on after debounce
        handleSaveScrapers(latest, true /* isAutoSave */);
        return latest; // No state change, just reading current value
      });
      pendingScraperSave.current = null;
    }, 300);
  }

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      await AdminService.updateAdminSettings(settings);
      setSuccess('Settings saved successfully!');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field: keyof AdminSettings, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleFileTypesChange = (value: string) => {
    const types = value.split(',').map(type => type.trim()).filter(type => type);
    handleInputChange('allowed_file_types', types);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <SparkleLoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 text-slate-800 font-sans overflow-x-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.05%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%222%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40 pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 py-8"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
          <div className="mb-4 sm:mb-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                <i className="ri-settings-3-line text-white text-xl"></i>
              </div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Admin Settings
              </h1>
            </div>
            <p className="text-slate-600 text-lg">Configure your platform settings and preferences</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="hidden sm:flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Settings Synced</span>
            </div>
            {activeTab !== 'scrapers' && (
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center space-x-2 ${saving
                    ? 'bg-slate-400 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800'
                  }`}
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-save-line text-lg"></i>
                    <span>Save Settings</span>
                  </>
                )}
              </button>
            )}
            {activeTab === 'scrapers' && (
              <button
                onClick={() => handleSaveScrapers()}
                disabled={savingScrapers}
                className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center space-x-2 ${savingScrapers
                    ? 'bg-slate-400 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800'
                  }`}
              >
                {savingScrapers ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-save-line text-lg"></i>
                    <span>Save Config</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Status Messages */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border-l-4 border-red-500 text-red-700 px-4 py-3 rounded-xl mb-6 shadow-sm"
          >
            <div className="flex items-center space-x-2">
              <i className="ri-error-warning-line text-lg"></i>
              <span>{error}</span>
            </div>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-50 border-l-4 border-emerald-500 text-emerald-700 px-4 py-3 rounded-xl mb-6 shadow-sm"
          >
            <div className="flex items-center space-x-2">
              <i className="ri-check-line text-lg"></i>
              <span>{success}</span>
            </div>
          </motion.div>
        )}

        {/* Layout Wrapper: Sidebar + Details Box */}
        <div className="flex flex-col lg:flex-row gap-8 items-start w-full max-w-full">
          {/* Sidebar Navigation */}
          <aside className="w-full lg:w-72 flex-shrink-0 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-4 sticky top-6 z-20 max-w-full overflow-hidden lg:overflow-visible">
            <div className="flex flex-row lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-3 lg:pb-0 scrollbar-none snap-x snap-mandatory w-full max-w-full">
              {[
                { id: 'general', label: 'General Settings', icon: 'ri-settings-3-line', desc: 'Basic info & operational mode' },
                { id: 'files', label: 'File Uploads', icon: 'ri-upload-cloud-2-line', desc: 'Size limits & file types' },
                { id: 'features', label: 'Platform Features', icon: 'ri-toggle-line', desc: 'Auth, analytics, and alerts' },
                { id: 'cache', label: 'Cache Config', icon: 'ri-database-2-line', desc: 'Redis & site memory tuning' },
                { id: 'scrapers', label: 'Scrapers Control', icon: 'ri-robot-line', desc: 'Pipeline supervisor & logs' },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all duration-200 text-left w-auto lg:w-full relative flex-shrink-0 lg:flex-shrink snap-start ${isActive
                        ? 'bg-gradient-to-r from-blue-600/10 to-indigo-600/10 text-blue-600 shadow-sm border-l-4 border-blue-600'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border-l-4 border-transparent'
                      }`}
                  >
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all ${isActive ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-500'
                      }`}>
                      <i className={`${tab.icon} text-base`}></i>
                    </div>
                    <div className="min-w-[130px] lg:min-w-0 flex-1">
                      <div className="font-extrabold text-xs tracking-wider uppercase leading-none">{tab.label}</div>
                      <div className={`hidden lg:block text-[9px] mt-1.5 font-medium leading-none line-clamp-1 ${isActive ? 'text-blue-500' : 'text-slate-400'}`}>
                        {tab.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Details Pane */}
          <div className="flex-1 w-full lg:w-auto min-w-0">
            <AnimatePresence mode="wait">
              {activeTab === 'general' && (
                <motion.div
                  key="general"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 space-y-6"
                >
                  <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
                    <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-blue-600 rounded-xl flex items-center justify-center shadow-md">
                      <i className="ri-settings-3-line text-white text-lg"></i>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">General Settings</h2>
                      <p className="text-xs text-slate-500">Manage basic site information, metadata, and operational modes.</p>
                    </div>
                  </div>

                  {/* Site Name */}
                  <div>
                    <label htmlFor="site_name" className="block text-sm font-semibold text-slate-700 mb-2">
                      Site Name
                    </label>
                    <input
                      type="text"
                      id="site_name"
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 shadow-sm transition-all duration-200"
                      value={settings.site_name}
                      onChange={(e) => handleInputChange('site_name', e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  {/* Site Description */}
                  <div>
                    <label htmlFor="site_description" className="block text-sm font-semibold text-slate-700 mb-2">
                      Site Description
                    </label>
                    <textarea
                      id="site_description"
                      rows={4}
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 shadow-sm transition-all duration-200"
                      value={settings.site_description}
                      onChange={(e) => handleInputChange('site_description', e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  {/* Maintenance Mode */}
                  <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                    <div>
                      <label htmlFor="maintenance_mode" className="text-sm font-semibold text-slate-700">
                        Maintenance Mode
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">Enable to lock down the frontend and show a maintenance page to guests.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="maintenance_mode"
                        className="sr-only peer"
                        checked={settings.maintenance_mode}
                        onChange={(e) => handleInputChange('maintenance_mode', e.target.checked)}
                        disabled={saving}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Allow Registration */}
                  <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                    <div>
                      <label htmlFor="allow_registration" className="text-sm font-semibold text-slate-700">
                        Allow Registration
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">Allow guests to sign up for new accounts on the platform.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="allow_registration"
                        className="sr-only peer"
                        checked={settings.allow_registration}
                        onChange={(e) => handleInputChange('allow_registration', e.target.checked)}
                        disabled={saving}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </motion.div>
              )}

              {activeTab === 'files' && (
                <motion.div
                  key="files"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 space-y-6"
                >
                  <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
                    <div className="w-10 h-10 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
                      <i className="ri-upload-cloud-2-line text-white text-lg"></i>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">File Upload Settings</h2>
                      <p className="text-xs text-slate-500">Configure size thresholds, mime-types, and constraints for attachments.</p>
                    </div>
                  </div>

                  {/* Max File Size */}
                  <div>
                    <label htmlFor="max_file_size" className="block text-sm font-semibold text-slate-700 mb-2">
                      Max File Size (bytes)
                    </label>
                    <input
                      type="number"
                      id="max_file_size"
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 shadow-sm transition-all duration-200"
                      value={settings.max_file_size}
                      onChange={(e) => handleInputChange('max_file_size', parseInt(e.target.value))}
                      min="1024"
                      max="104857600"
                      disabled={saving}
                    />
                    <div className="mt-2.5 p-3.5 bg-blue-50/50 rounded-xl border border-blue-100">
                      <p className="text-xs text-blue-700 flex items-center gap-1.5">
                        <i className="ri-information-line text-sm"></i>
                        <span>Current Maximum Size Limit: <strong>{(settings.max_file_size / 1024 / 1024).toFixed(1)} MB</strong></span>
                      </p>
                    </div>
                  </div>

                  {/* Allowed File Types */}
                  <div>
                    <label htmlFor="allowed_file_types" className="block text-sm font-semibold text-slate-700 mb-2">
                      Allowed File Types
                    </label>
                    <input
                      type="text"
                      id="allowed_file_types"
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 shadow-sm transition-all duration-200"
                      value={settings.allowed_file_types.join(', ')}
                      onChange={(e) => handleFileTypesChange(e.target.value)}
                      placeholder="image/jpeg, image/png, image/gif, image/webp"
                      disabled={saving}
                    />
                    <div className="mt-2.5 p-3.5 bg-emerald-50/50 rounded-xl border border-emerald-100">
                      <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                        <i className="ri-information-line text-sm"></i>
                        <span>Use a comma-separated list of standard MIME types (e.g. image/png).</span>
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'features' && (
                <motion.div
                  key="features"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 space-y-4"
                >
                  <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
                    <div className="w-10 h-10 bg-gradient-to-r from-purple-400 to-purple-600 rounded-xl flex items-center justify-center shadow-md">
                      <i className="ri-toggle-line text-white text-lg"></i>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Platform Features</h2>
                      <p className="text-xs text-slate-500">Toggle premium behaviors, analytical trackers, and integration pathways.</p>
                    </div>
                  </div>

                  {[
                    {
                      id: 'email_notifications',
                      label: 'Email Notifications',
                      desc: 'Send automated platform notifications and transactional emails to registered users.',
                      checked: settings.email_notifications,
                      field: 'email_notifications'
                    },
                    {
                      id: 'analytics_enabled',
                      label: 'Analytics Tracking',
                      desc: 'Collect anonymous site telemetry and system usage statistics for administrators.',
                      checked: settings.analytics_enabled,
                      field: 'analytics_enabled'
                    },
                    {
                      id: 'social_login_enabled',
                      label: 'Social Login Integration',
                      desc: 'Enable third-party authentication services like Google or GitHub logins.',
                      checked: settings.social_login_enabled,
                      field: 'social_login_enabled'
                    },
                    {
                      id: 'premium_features_enabled',
                      label: 'Premium Tier features',
                      desc: 'Unlock premium subscription structures and paywall content capabilities.',
                      checked: settings.premium_features_enabled,
                      field: 'premium_features_enabled'
                    }
                  ].map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                      <div className="mr-4">
                        <label htmlFor={item.id} className="text-sm font-semibold text-slate-700">
                          {item.label}
                        </label>
                        <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                        <input
                          type="checkbox"
                          id={item.id}
                          className="sr-only peer"
                          checked={item.checked}
                          onChange={(e) => handleInputChange(item.field as any, e.target.checked)}
                          disabled={saving}
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  ))}
                </motion.div>
              )}

              {activeTab === 'cache' && (
                <motion.div
                  key="cache"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 space-y-6"
                >
                  <div className="flex items-center space-x-3 mb-6 pb-4 border-b border-slate-100">
                    <div className="w-10 h-10 bg-gradient-to-r from-orange-400 to-orange-600 rounded-xl flex items-center justify-center shadow-md">
                      <i className="ri-database-2-line text-white text-lg"></i>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800">Cache Settings</h2>
                      <p className="text-xs text-slate-500">Tune platform performance thresholds, cache duration, and store rules.</p>
                    </div>
                  </div>

                  {/* Cache Enabled */}
                  <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                    <div>
                      <label htmlFor="cache_enabled" className="text-sm font-semibold text-slate-700">
                        Cache Enabled
                      </label>
                      <p className="text-xs text-slate-500 mt-0.5">Enable internal site caching algorithms for high performance loads.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                      <input
                        type="checkbox"
                        id="cache_enabled"
                        className="sr-only peer"
                        checked={settings.cache_enabled}
                        onChange={(e) => handleInputChange('cache_enabled', e.target.checked)}
                        disabled={saving}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  {/* Cache Duration */}
                  <div>
                    <label htmlFor="cache_duration" className="block text-sm font-semibold text-slate-700 mb-2">
                      Cache Duration (seconds)
                    </label>
                    <input
                      type="number"
                      id="cache_duration"
                      className="w-full p-3.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 shadow-sm transition-all duration-200"
                      value={settings.cache_duration}
                      onChange={(e) => handleInputChange('cache_duration', parseInt(e.target.value))}
                      min="60"
                      max="86400"
                      disabled={saving}
                    />
                    <div className="mt-2.5 p-3.5 bg-orange-50/50 rounded-xl border border-orange-100">
                      <p className="text-xs text-orange-700 flex items-center gap-1.5">
                        <i className="ri-information-line text-sm"></i>
                        <span>Current cache items live for: <strong>{(settings.cache_duration / 60).toFixed(0)} minutes</strong> before refreshing.</span>
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'scrapers' && (
                <motion.div
                  key="scrapers"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -15 }}
                  transition={{ duration: 0.2 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 relative overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 border-b border-slate-100 pb-5">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
                        <i className="ri-robot-line text-white text-lg animate-pulse"></i>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-slate-800">Scrapers Pipeline Control</h2>
                        <p className="text-xs text-slate-500">Configure enabled scrapers, order of execution, timeouts, and delays.</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono bg-slate-50 px-3 py-1 rounded-full border border-slate-200 w-fit">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
                      <span>Active Pipeline Core</span>
                    </div>
                  </div>

                  {/* Global Switch & Dashboard HUD */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
                    {/* Pipeline Switch Hud */}
                    <div className="lg:col-span-2 p-5 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-sm">
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-md transition-all duration-500 ${globalSwitch ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                          <i className={`ri-flashlight-fill text-2xl ${globalSwitch ? 'animate-pulse' : ''}`}></i>
                        </div>
                        <div>
                          <h3 className="font-extrabold text-sm tracking-wider uppercase text-slate-800">Global Pipeline Switch</h3>
                          <p className="text-slate-500 text-[11px] mt-0.5">Automated queue processing controls and supervisor locks</p>
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-extrabold tracking-wider border ${globalSwitch ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                              {globalSwitch ? 'ACTIVE / RUNNING' : 'PAUSED / OFF-LINE'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={handleForceRunScheduler}
                          disabled={runningManualCheck || !globalSwitch}
                          className={`px-4 py-2 rounded-xl border text-xs font-bold transition-all duration-200 flex items-center gap-1.5 shadow-sm ${runningManualCheck
                              ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                              : !globalSwitch
                                ? 'bg-slate-50 text-slate-400 border-slate-200/50 cursor-not-allowed'
                                : 'bg-white hover:bg-blue-50 text-blue-600 hover:text-blue-700 border-blue-200 hover:border-blue-300'
                            }`}
                          title="Scan DB and enqueue missing episodes now"
                        >
                          {runningManualCheck ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                              <span>Scanning...</span>
                            </>
                          ) : (
                            <>
                              <i className="ri-play-line"></i>
                              <span>Run Scheduler</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={handleToggleGlobalSwitch}
                          id="global-pipeline-toggle"
                          className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 flex-shrink-0 ${globalSwitch ? 'bg-blue-600' : 'bg-slate-200'}`}
                        >
                          <span className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow transition-transform duration-300 flex items-center justify-center ${globalSwitch ? 'translate-x-6 text-blue-600' : 'translate-x-0 text-slate-400'}`}>
                            <i className={globalSwitch ? "ri-check-line font-bold" : "ri-close-line font-bold"}></i>
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Stats HUD Panel */}
                    <div className="p-5 bg-slate-50/50 rounded-2xl border border-slate-200/80 flex flex-col justify-between gap-3 shadow-sm">
                      <div>
                        <h4 className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">System Telemetry</h4>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-2xl font-black font-mono tracking-tight text-blue-600">
                            {Object.values(scraperStats).length > 0
                              ? Math.round(Object.values(scraperStats).reduce((acc, curr) => acc + (curr.successRate || 0), 0) / Object.values(scraperStats).length)
                              : 100}%
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">AVG SUCCESS</span>
                        </div>
                        <p className="text-[9px] text-slate-500 mt-2 flex items-center gap-1">
                          <i className="ri-pulse-line text-emerald-500 animate-pulse"></i> Real-time pipeline health
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetMetrics}
                        id="reset-pipeline-metrics"
                        className="w-full py-1.5 bg-white hover:bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-center gap-1.5 text-[10px] font-extrabold text-rose-600 hover:text-rose-700 transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98]"
                        title="Clear Cooldowns, Reset Stats & Purge Logs"
                      >
                        <i className="ri-refresh-line text-xs"></i>
                        <span>Reset Cooldowns & Cache</span>
                      </button>
                    </div>

                    {/* Hourly Rate Limit HUD */}
                    <div className="p-5 bg-slate-50/50 rounded-2xl border border-slate-200/80 flex flex-col justify-between gap-3 shadow-sm animate-in fade-in duration-300">
                      <div>
                        <h4 className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Hourly Rate Limit</h4>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-2xl font-black font-mono tracking-tight text-indigo-600">
                            {schedulerStatus ? `${schedulerStatus.scrapedThisHour}/${schedulerStatus.rateLimit}` : '0/30'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500">EPISODES</span>
                        </div>
                        {/* Progress Bar */}
                        {schedulerStatus && (
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200 mt-2">
                            <div
                              className="h-full rounded-full transition-all duration-500 bg-gradient-to-r from-indigo-500 to-blue-500"
                              style={{ width: `${Math.min(100, (schedulerStatus.scrapedThisHour / schedulerStatus.rateLimit) * 100)}%` }}
                            ></div>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleResetRateLimit}
                        disabled={resettingRateLimit}
                        className="w-full py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-1.5 text-[10px] font-extrabold text-slate-600 hover:text-slate-800 transition-all shadow-sm disabled:opacity-50"
                        title="Reset hourly scrape limit counter"
                      >
                        {resettingRateLimit ? (
                          <>
                            <div className="w-3 h-3 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                            <span>Resetting...</span>
                          </>
                        ) : (
                          <>
                            <i className="ri-speed-line text-xs text-blue-500"></i>
                            <span>Reset Rate Limit</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Queue Status Dashboard */}
                  {schedulerStatus && (
                    <div className="mb-8 grid grid-cols-2 md:grid-cols-5 gap-4 animate-in fade-in duration-500">
                      {[
                        { label: 'Active Jobs', val: schedulerStatus.queue?.active || 0, color: 'text-blue-600 bg-blue-50/50 border-blue-200', icon: 'ri-play-circle-line', ping: true },
                        { label: 'Waiting Jobs', val: schedulerStatus.queue?.waiting || 0, color: 'text-amber-600 bg-amber-50/50 border-amber-200', icon: 'ri-hourglass-2-line', ping: false },
                        { label: 'Delayed Jobs', val: schedulerStatus.queue?.delayed || 0, color: 'text-purple-600 bg-purple-50/50 border-purple-200', icon: 'ri-calendar-event-line', ping: false },
                        { label: 'Completed Jobs', val: schedulerStatus.queue?.completed || 0, color: 'text-emerald-600 bg-emerald-50/50 border-emerald-200', icon: 'ri-checkbox-circle-line', ping: false },
                        { label: 'Failed Jobs', val: schedulerStatus.queue?.failed || 0, color: 'text-rose-600 bg-rose-50/50 border-rose-200', icon: 'ri-error-warning-line', ping: false }
                      ].map((item, idx) => (
                        <div key={idx} className={`border rounded-xl p-4 backdrop-blur-sm relative overflow-hidden flex flex-col justify-between ${item.color}`}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{item.label}</span>
                            <i className={`${item.icon} text-lg opacity-85`}></i>
                          </div>
                          <div className="flex items-baseline gap-1.5 mt-1">
                            <span className="text-2xl font-black font-mono tracking-tight text-slate-800">{item.val}</span>
                            {item.ping && item.val > 0 && (
                              <span className="flex h-2.5 w-2.5 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {loadingScrapers ? (
                    <div className="flex justify-center items-center py-20">
                      <SparkleLoadingSpinner size="lg" text="Streaming control configuration..." />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-6">
                      {/* Active Scrapers List */}
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <i className="ri-sort-asc text-blue-500"></i>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Active Pipeline Sequence</h3>
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono italic">Drag rows to change execution priority</span>
                        </div>

                        <div className="space-y-3">
                          {scrapers.map((scraper, index) => {
                            const stats = scraperStats[scraper.id] || { successRate: 100, success: 0, failure: 0, avgResponseTime: 0 };
                            const successRate = stats.successRate ?? 100;
                            const avgMs = stats.avgResponseTime || 0;

                            return (
                              <motion.div
                                layout
                                key={scraper.id}
                                draggable
                                onDragStart={(e: any) => handleDragStart(e, index)}
                                onDragOver={(e: any) => handleDragOver(e, index)}
                                onDrop={(e: any) => handleDrop(e, index)}
                                className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border transition-all duration-300 relative group cursor-grab active:cursor-grabbing ${scraper.enabled
                                    ? 'bg-white border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300'
                                    : 'bg-slate-50/70 border-slate-200/40 opacity-60'
                                  }`}
                              >
                                {/* Left details */}
                                <div className="flex items-center gap-3.5 min-w-0 flex-1 w-full md:w-auto">
                                  {/* Grab handle container */}
                                  <div className="text-slate-400 group-hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors flex-shrink-0">
                                    <i className="ri-drag-move-fill text-lg"></i>
                                  </div>

                                  {/* Rank Indicator */}
                                  <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-200 font-black text-xs text-blue-600 flex items-center justify-center flex-shrink-0 font-mono shadow-inner">
                                    {index + 1}
                                  </div>

                                  {/* Info text */}
                                  <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
                                    <div>
                                      <h4 className="font-extrabold text-sm tracking-wide text-slate-800 uppercase group-hover:text-blue-600 transition-colors">
                                        {scraper.name}
                                      </h4>
                                      <p className="text-[10px] text-slate-400 font-mono uppercase mt-0.5">{scraper.id}</p>
                                    </div>

                                    {/* Success rate details */}
                                    <div className="mt-2 sm:mt-0 flex flex-wrap items-center gap-3">
                                      {/* success badge & mini-bar */}
                                      <div className="flex items-center gap-2">
                                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200 flex-shrink-0">
                                          <div
                                            className={`h-full rounded-full transition-all duration-500 ${successRate >= 80 ? 'bg-gradient-to-r from-emerald-500 to-green-400' :
                                                successRate >= 50 ? 'bg-gradient-to-r from-amber-500 to-orange-400' :
                                                  'bg-gradient-to-r from-rose-500 to-red-400'
                                              }`}
                                            style={{ width: `${successRate}%` }}
                                          ></div>
                                        </div>
                                        <span className={`text-[10px] font-black font-mono tracking-wide ${successRate >= 80 ? 'text-emerald-600' :
                                            successRate >= 50 ? 'text-amber-600' :
                                              'text-rose-600'
                                          }`}>
                                          {successRate}%
                                        </span>
                                      </div>

                                      {/* avg response time */}
                                      {avgMs > 0 && (
                                        <span className="text-[9px] text-slate-500 font-mono font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                          ⚡ {avgMs.toLocaleString()}ms
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Right Controls */}
                                <div className="flex items-center gap-4 mt-4 md:mt-0 w-full md:w-auto justify-between md:justify-end">
                                  {/* Toggle toggle button */}
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleScraperEnabled(scraper.id);
                                      }}
                                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0 ${scraper.enabled ? 'bg-blue-600' : 'bg-slate-200'}`}
                                    >
                                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 ${scraper.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </button>
                                  </div>

                                  {/* Config button */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingScraper(scraper);
                                    }}
                                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-600 hover:text-blue-700 text-[10px] font-extrabold rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
                                  >
                                    <i className="ri-settings-4-line text-blue-500"></i> Configure
                                  </button>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Live Console Terminal */}
                      <div className="border border-slate-200 rounded-xl bg-slate-50/70 text-slate-700 p-5 shadow-inner relative overflow-hidden">
                        {/* Console Header Bar */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 border-b border-slate-200 pb-3 relative z-10">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                            <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 font-mono">Telemetry Streams Log</h3>
                          </div>

                          <div className="flex items-center gap-3">
                            {/* Copy logs */}
                            <button
                              type="button"
                              onClick={() => {
                                const logTexts = logs.map(l => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.level.toUpperCase()}: ${l.message}`).join('\n');
                                navigator.clipboard.writeText(logTexts);
                                setSuccess('Logs copied to clipboard!');
                                setTimeout(() => setSuccess(null), 2000);
                              }}
                              className="text-[10px] font-bold text-slate-600 hover:text-slate-800 uppercase tracking-wider flex items-center gap-1 bg-white px-2.5 py-1 rounded-md border border-slate-200 transition-colors shadow-sm"
                              title="Copy logs to clipboard"
                            >
                              <i className="ri-file-copy-line text-blue-500"></i> Copy Logs
                            </button>

                            {/* Manual Refresh */}
                            <button
                              type="button"
                              onClick={() => fetchScrapersData(false)}
                              className="text-[10px] font-bold text-slate-500 hover:text-slate-800 uppercase tracking-wider flex items-center gap-1 transition-colors"
                            >
                              <i className="ri-restart-line text-blue-500 animate-spin-slow"></i> Sync
                            </button>
                          </div>
                        </div>

                        {/* Terminal stdout output */}
                        <div className="space-y-1.5 max-h-60 overflow-y-auto font-mono text-[11px] leading-relaxed pr-1 custom-scrollbar scroll-smooth relative z-10 select-text">
                          {logs.length === 0 ? (
                            <div className="text-slate-400 text-center py-8 italic select-none">
                              &gt;_ No scraper stream frames processed. Telemetry begins on scheduler loops.
                            </div>
                          ) : (
                            logs.map((log, idx) => {
                              const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                              const isWarning = log.level === 'warn' || log.level === 'error';
                              const isSuccess = log.level === 'success';

                              return (
                                <div key={idx} className="flex gap-2 items-start py-1 border-b border-slate-100 last:border-0 hover:bg-slate-100/50 px-1.5 rounded transition-colors group">
                                  <span className="text-slate-400 flex-shrink-0 font-bold select-none">[{timeStr}]</span>
                                  <span className="flex-shrink-0 select-none">
                                    {isWarning ? (
                                      <i className="ri-error-warning-fill text-amber-500"></i>
                                    ) : isSuccess ? (
                                      <i className="ri-checkbox-circle-fill text-emerald-500"></i>
                                    ) : (
                                      <i className="ri-information-fill text-blue-500"></i>
                                    )}
                                  </span>
                                  <span className={`flex-1 break-all ${isWarning ? 'text-amber-600 font-semibold' : isSuccess ? 'text-emerald-700' : 'text-slate-600'}`}>
                                    {log.message}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Frost-HUD Scraper Config Modal */}
                  {editingScraper && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200 text-slate-800">
                        {/* Header */}
                        <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <i className="ri-settings-4-line text-white"></i>
                            <h3 className="font-extrabold text-sm tracking-wider uppercase">Tweak {editingScraper.name}</h3>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingScraper(null)}
                            className="text-white/80 hover:text-white transition-colors"
                          >
                            <i className="ri-close-line text-xl"></i>
                          </button>
                        </div>

                        {/* Form fields */}
                        <div className="p-5 space-y-5">
                          {/* Timeout slider & display */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Request Timeout</label>
                              <span className="font-mono text-xs font-black text-blue-600">{editingScraper.timeout.toLocaleString()}ms</span>
                            </div>
                            <input
                              type="range"
                              className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              value={editingScraper.timeout}
                              onChange={(e) => setEditingScraper({ ...editingScraper, timeout: parseInt(e.target.value) || 5000 })}
                              min="5000"
                              max="120000"
                              step="5000"
                            />
                            <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-1 uppercase">
                              <span>5s min</span>
                              <span>120s max</span>
                            </div>
                          </div>

                          {/* Delay slider */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cooldown Delay</label>
                              <span className="font-mono text-xs font-black text-blue-600">{editingScraper.delay.toLocaleString()}ms</span>
                            </div>
                            <input
                              type="range"
                              className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                              value={editingScraper.delay}
                              onChange={(e) => setEditingScraper({ ...editingScraper, delay: parseInt(e.target.value) || 0 })}
                              min="0"
                              max="20000"
                              step="1000"
                            />
                            <div className="flex justify-between text-[8px] font-bold text-slate-400 mt-1 uppercase">
                              <span>0s (None)</span>
                              <span>20s max</span>
                            </div>
                          </div>

                          {/* Active Toggle Status */}
                          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-200">
                            <div>
                              <span className="text-xs font-extrabold text-slate-700 block">Supervisor Switch</span>
                              <span className="text-[9px] text-slate-500">Enable operations for this scraper</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setEditingScraper({ ...editingScraper, enabled: !editingScraper.enabled })}
                              className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0 ${editingScraper.enabled ? 'bg-blue-600' : 'bg-slate-200'}`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${editingScraper.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                          </div>
                        </div>

                        {/* Actions buttons */}
                        <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setEditingScraper(null)}
                            className="px-4 py-2 text-[10px] font-extrabold text-slate-500 hover:text-slate-800 transition-colors uppercase tracking-widest"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = scrapers.map(s => s.id === editingScraper.id ? editingScraper : s);
                              setScrapers(updated);
                              setEditingScraper(null);
                              handleSaveScrapers(updated);
                            }}
                            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-[10px] font-extrabold rounded-xl transition-all uppercase tracking-widest shadow-md hover:shadow-lg"
                          >
                            Commit Config
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}