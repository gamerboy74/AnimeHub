import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AdminService, type AdminSettings } from '../../../services/admin';
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner';
import { supabase } from '../../../lib/database/supabase';

export default function AdminSettings() {
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
  const [activeTab, setActiveTab] = useState<'settings' | 'integrity'>('settings');

  // Database Integrity Scanner States
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Array<{
    id: string;
    episode_number: number;
    title: string;
    video_url: string | null;
    video_servers: any[] | null;
    anime: {
      id: string;
      title: string;
    } | null;
  }> | null>(null);
  const [scanSummary, setScanSummary] = useState({
    totalChecked: 0,
    totalIncomplete: 0,
    missingUrl: 0,
    missingServers: 0,
  });
  const [expandedAnime, setExpandedAnime] = useState<string | null>(null);

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

  // Database Scan handler
  const handleScanDatabase = async () => {
    try {
      setScanning(true);
      setError(null);
      setScanResults(null);
      setExpandedAnime(null);

      const { data: episodes, error: dbError } = await supabase
        .from('episodes')
        .select(`
          id,
          episode_number,
          title,
          video_url,
          video_servers,
          anime:anime_id (id, title)
        `);

      if (dbError) throw dbError;

      const results = (episodes || []).filter(ep => {
        const hasNoUrl = !ep.video_url || ep.video_url.trim() === '';
        const hasNoServers = !ep.video_servers || !Array.isArray(ep.video_servers) || ep.video_servers.length === 0;
        return hasNoUrl || hasNoServers;
      }) as any[];

      const missingUrlCount = results.filter(ep => !ep.video_url || ep.video_url.trim() === '').length;
      const missingServersCount = results.filter(ep => !ep.video_servers || !Array.isArray(ep.video_servers) || ep.video_servers.length === 0).length;

      setScanResults(results);
      setScanSummary({
        totalChecked: episodes?.length || 0,
        totalIncomplete: results.length,
        missingUrl: missingUrlCount,
        missingServers: missingServersCount,
      });
    } catch (err) {
      console.error('Database integrity scan failed:', err);
      setError(err instanceof Error ? err.message : 'Database scan failed');
    } finally {
      setScanning(false);
    }
  };

  const getGroupedResults = () => {
    if (!scanResults) return [];
    const groupedMap = new Map<string, { animeId: string; animeTitle: string; episodes: typeof scanResults }>();
    
    scanResults.forEach(ep => {
      const animeId = ep.anime?.id || 'unknown';
      const animeTitle = ep.anime?.title || 'Unknown Anime';
      
      if (!groupedMap.has(animeId)) {
        groupedMap.set(animeId, { animeId, animeTitle, episodes: [] });
      }
      groupedMap.get(animeId)!.episodes.push(ep);
    });
    
    return Array.from(groupedMap.values()).sort((a, b) => b.episodes.length - a.episodes.length);
  };

  const toggleExpandAnime = (animeId: string) => {
    setExpandedAnime(expandedAnime === animeId ? null : animeId);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <SparkleLoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.05%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%222%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40"></div>
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative container mx-auto px-4 py-8"
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
            {activeTab === 'settings' && (
              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center space-x-2 ${
                  saving 
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

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-8">
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
              activeTab === 'settings'
                ? 'bg-white/90 text-blue-600 shadow-lg'
                : 'text-slate-600 hover:text-slate-800 hover:bg-white/50'
            }`}
          >
            <i className="ri-settings-3-line mr-2"></i>
            General Settings
          </button>
          <button
            onClick={() => setActiveTab('integrity')}
            className={`px-6 py-3 rounded-xl font-medium transition-all duration-200 ${
              activeTab === 'integrity'
                ? 'bg-white/90 text-blue-600 shadow-lg'
                : 'text-slate-600 hover:text-slate-800 hover:bg-white/50'
            }`}
          >
            <i className="ri-shield-check-line mr-2"></i>
            Database Integrity
          </button>
        </div>

        {activeTab === 'settings' ? (
          /* Settings Grid */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* General Settings */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
            >
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-blue-600 rounded-xl flex items-center justify-center">
                  <i className="ri-settings-3-line text-white text-lg"></i>
                </div>
                <h2 className="text-xl font-semibold text-slate-800">General Settings</h2>
              </div>
              <div className="space-y-6">
                {/* Site Name */}
                <div>
                  <label htmlFor="site_name" className="block text-sm font-medium text-slate-700 mb-2">
                    Site Name
                  </label>
                  <input
                    type="text"
                    id="site_name"
                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200"
                    value={settings.site_name}
                    onChange={(e) => handleInputChange('site_name', e.target.value)}
                    disabled={saving}
                  />
                </div>

                {/* Site Description */}
                <div>
                  <label htmlFor="site_description" className="block text-sm font-medium text-slate-700 mb-2">
                    Site Description
                  </label>
                  <textarea
                    id="site_description"
                    rows={3}
                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200"
                    value={settings.site_description}
                    onChange={(e) => handleInputChange('site_description', e.target.value)}
                    disabled={saving}
                  />
                </div>

                {/* Maintenance Mode */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="maintenance_mode" className="text-sm font-medium text-slate-700">
                      Maintenance Mode
                    </label>
                    <p className="text-xs text-slate-500">Enable to show maintenance page to users</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
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
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="allow_registration" className="text-sm font-medium text-slate-700">
                      Allow Registration
                    </label>
                    <p className="text-xs text-slate-500">Allow new users to register</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
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
              </div>
            </motion.div>

            {/* File Upload Settings */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
            >
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-green-400 to-green-600 rounded-xl flex items-center justify-center">
                  <i className="ri-upload-line text-white text-lg"></i>
                </div>
                <h2 className="text-xl font-semibold text-slate-800">File Upload Settings</h2>
              </div>
              <div className="space-y-6">
                {/* Max File Size */}
                <div>
                  <label htmlFor="max_file_size" className="block text-sm font-medium text-slate-700 mb-2">
                    Max File Size (bytes)
                  </label>
                  <input
                    type="number"
                    id="max_file_size"
                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200"
                    value={settings.max_file_size}
                    onChange={(e) => handleInputChange('max_file_size', parseInt(e.target.value))}
                    min="1024"
                    max="104857600"
                    disabled={saving}
                  />
                  <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm text-blue-700">
                      <i className="ri-information-line mr-1"></i>
                      Current: {(settings.max_file_size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                </div>

                {/* Allowed File Types */}
                <div>
                  <label htmlFor="allowed_file_types" className="block text-sm font-medium text-slate-700 mb-2">
                    Allowed File Types
                  </label>
                  <input
                    type="text"
                    id="allowed_file_types"
                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-205"
                    value={settings.allowed_file_types.join(', ')}
                    onChange={(e) => handleFileTypesChange(e.target.value)}
                    placeholder="image/jpeg, image/png, image/gif"
                    disabled={saving}
                  />
                  <div className="mt-2 p-3 bg-green-50 rounded-lg">
                    <p className="text-sm text-green-700">
                      <i className="ri-information-line mr-1"></i>
                      Comma-separated MIME types
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Feature Settings */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
            >
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-purple-400 to-purple-600 rounded-xl flex items-center justify-center">
                  <i className="ri-flashlight-line text-white text-lg"></i>
                </div>
                <h2 className="text-xl font-semibold text-slate-800">Feature Settings</h2>
              </div>
              <div className="space-y-6">
                {/* Email Notifications */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="email_notifications" className="text-sm font-medium text-slate-700">
                      Email Notifications
                    </label>
                    <p className="text-xs text-slate-500">Send email notifications to users</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="email_notifications"
                      className="sr-only peer"
                      checked={settings.email_notifications}
                      onChange={(e) => handleInputChange('email_notifications', e.target.checked)}
                      disabled={saving}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Analytics Enabled */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="analytics_enabled" className="text-sm font-medium text-slate-700">
                      Analytics Enabled
                    </label>
                    <p className="text-xs text-slate-500">Track user analytics and usage</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="analytics_enabled"
                      className="sr-only peer"
                      checked={settings.analytics_enabled}
                      onChange={(e) => handleInputChange('analytics_enabled', e.target.checked)}
                      disabled={saving}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Social Login */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="social_login_enabled" className="text-sm font-medium text-slate-700">
                      Social Login
                    </label>
                    <p className="text-xs text-slate-500">Allow Google/GitHub login</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="social_login_enabled"
                      className="sr-only peer"
                      checked={settings.social_login_enabled}
                      onChange={(e) => handleInputChange('social_login_enabled', e.target.checked)}
                      disabled={saving}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {/* Premium Features */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="premium_features_enabled" className="text-sm font-medium text-slate-700">
                      Premium Features
                    </label>
                    <p className="text-xs text-slate-500">Enable premium subscription features</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      id="premium_features_enabled"
                      className="sr-only peer"
                      checked={settings.premium_features_enabled}
                      onChange={(e) => handleInputChange('premium_features_enabled', e.target.checked)}
                      disabled={saving}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            </motion.div>

            {/* Cache Settings */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
            >
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-gradient-to-r from-orange-400 to-orange-600 rounded-xl flex items-center justify-center">
                  <i className="ri-database-2-line text-white text-lg"></i>
                </div>
                <h2 className="text-xl font-semibold text-slate-800">Cache Settings</h2>
              </div>
              <div className="space-y-6">
                {/* Cache Enabled */}
                <div className="flex items-center justify-between p-4 bg-slate-50/50 rounded-xl">
                  <div>
                    <label htmlFor="cache_enabled" className="text-sm font-medium text-slate-700">
                      Cache Enabled
                    </label>
                    <p className="text-xs text-slate-500">Enable caching for better performance</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
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
                  <label htmlFor="cache_duration" className="block text-sm font-medium text-slate-700 mb-2">
                    Cache Duration (seconds)
                  </label>
                  <input
                    type="number"
                    id="cache_duration"
                    className="w-full p-3 border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm transition-all duration-200"
                    value={settings.cache_duration}
                    onChange={(e) => handleInputChange('cache_duration', parseInt(e.target.value))}
                    min="60"
                    max="86400"
                    disabled={saving}
                  />
                  <div className="mt-2 p-3 bg-orange-50 rounded-lg">
                    <p className="text-sm text-orange-700">
                      <i className="ri-information-line mr-1"></i>
                      Current: {(settings.cache_duration / 60).toFixed(0)} minutes
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          /* Database Integrity Scanner View */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
          >
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-md">
                  <i className="ri-shield-check-line text-white text-lg"></i>
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-slate-800">Database Integrity Scanner</h2>
                  <p className="text-xs text-slate-500">Scan for missing primary URLs or empty video server listings</p>
                </div>
              </div>
              
              <button
                onClick={handleScanDatabase}
                disabled={scanning}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-sm font-semibold transition-all duration-200 shadow hover:shadow-md disabled:opacity-50 flex items-center gap-2"
              >
                {scanning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Scanning Database...</span>
                  </>
                ) : (
                  <>
                    <i className="ri-radar-line"></i>
                    <span>Scan Database</span>
                  </>
                )}
              </button>
            </div>

            {scanning && (
              <div className="flex justify-center items-center py-12">
                <SparkleLoadingSpinner size="lg" text="Scanning catalog integrity..." />
              </div>
            )}

            {!scanning && scanResults === null && (
              <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50/30">
                <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
                  <i className="ri-database-2-line text-slate-400 text-2xl animate-pulse"></i>
                </div>
                <h3 className="text-slate-700 font-semibold mb-1">Integrity Check Required</h3>
                <p className="text-slate-500 text-xs max-w-sm mx-auto mb-4">Run a scan of your Supabase records to identify any incomplete streams or empty video servers.</p>
                <button
                  onClick={handleScanDatabase}
                  className="px-5 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-semibold rounded-xl transition-all shadow hover:shadow-md"
                >
                  Start Scan
                </button>
              </div>
            )}

            {!scanning && scanResults !== null && (
              <div className="space-y-6 animate-fadeIn">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                      <i className="ri-bookmark-line text-blue-500"></i>
                      Total Checked
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{scanSummary.totalChecked}</div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                      <i className="ri-error-warning-line text-red-500"></i>
                      Incomplete Episodes
                    </div>
                    <div className="text-2xl font-bold text-red-600">{scanSummary.totalIncomplete}</div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                      <i className="ri-link text-amber-500"></i>
                      Missing URLs
                    </div>
                    <div className="text-2xl font-bold text-amber-600">{scanSummary.missingUrl}</div>
                  </div>

                  <div className="bg-slate-50 rounded-xl p-4 shadow-sm border border-slate-100">
                    <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                      <i className="ri-server-line text-indigo-500"></i>
                      Missing Servers
                    </div>
                    <div className="text-2xl font-bold text-indigo-600">{scanSummary.missingServers}</div>
                  </div>
                </div>

                {/* List Results */}
                <div>
                  <h3 className="font-semibold text-slate-700 text-sm mb-3">Problematic Anime Records</h3>
                  {scanResults.length === 0 ? (
                    <div className="bg-emerald-50 text-emerald-800 p-6 rounded-2xl border border-emerald-100 text-center">
                      <i className="ri-checkbox-circle-fill text-emerald-500 text-3xl mb-2"></i>
                      <h4 className="font-bold">Catalog 100% Clean!</h4>
                      <p className="text-xs text-emerald-600 max-w-md mx-auto mt-1">All scanned episodes have valid stream URLs and functional video server configurations.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {getGroupedResults().map((group) => {
                        const isExpanded = expandedAnime === group.animeId;
                        return (
                          <div key={group.animeId} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden transition-all duration-200">
                            {/* Group Header */}
                            <div 
                              onClick={() => toggleExpandAnime(group.animeId)}
                              className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center font-bold flex-shrink-0">
                                  <i className="ri-film-line"></i>
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-medium text-slate-800 truncate text-sm">{group.animeTitle}</h4>
                                  <p className="text-xs text-slate-500">{group.episodes.length} incomplete episode(s)</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-4 flex-shrink-0">
                                <a 
                                  href={`/admin/anime?id=${group.animeId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100 transition-colors flex items-center gap-1"
                                >
                                  <i className="ri-external-link-line"></i>
                                  Manage
                                </a>
                                <i className={`text-slate-400 text-lg transition-transform ${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`}></i>
                              </div>
                            </div>

                            {/* Group Episodes List */}
                            <AnimatePresence>
                              {isExpanded && (
                                <motion.div 
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="border-t border-slate-100 bg-slate-50/30 px-5 py-3 space-y-2"
                                >
                                  {group.episodes.map((ep) => {
                                    const noUrl = !ep.video_url || ep.video_url.trim() === '';
                                    const noServers = !ep.video_servers || !Array.isArray(ep.video_servers) || ep.video_servers.length === 0;
                                    
                                    return (
                                      <div key={ep.id} className="bg-white rounded-lg p-3 border border-slate-200 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
                                        <div>
                                          <div className="text-sm font-medium text-slate-700">
                                            <span className="text-blue-600 font-bold mr-1">EP {ep.episode_number}</span>
                                            {ep.title}
                                          </div>
                                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            {noUrl && (
                                              <span className="bg-red-50 text-red-600 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-red-100 flex items-center gap-1">
                                                <i className="ri-link-unlink"></i>
                                                Missing URL
                                              </span>
                                            )}
                                            {noServers && (
                                              <span className="bg-amber-50 text-amber-600 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-amber-100 flex items-center gap-1">
                                                <i className="ri-server-fill"></i>
                                                Missing Servers
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <div className="flex gap-2">
                                          <a 
                                            href={`/admin/anime?id=${group.animeId}&scrape=true`}
                                            className="px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-xs font-semibold hover:from-amber-600 hover:to-orange-600 transition-all flex items-center gap-1 shadow-sm"
                                          >
                                            <i className="ri-play-line"></i>
                                            Scrape
                                          </a>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}