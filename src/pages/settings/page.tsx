
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import Navbar from '../../components/feature/Navbar';
import Footer from '../../components/feature/Footer';
import { usePreferences } from '../../hooks/user/preferences';

const DEFAULTS = {
  theme: 'light',
  language: 'en',
  autoplay: true,
  quality: 'auto',
  subtitles: true,
  newEpisodes: true,
  recommendations: true,
  systemUpdates: false,
  emailNotifications: true,
  profileVisibility: 'public',
  watchHistoryVisible: true,
  allowRecommendations: true,
  skipIntro: true,
  skipOutro: false,
  continuousPlay: true,
  volume: 80,
};

// Map flat UI keys ↔ nested DB columns
function prefsToLocal(p: any) {
  if (!p) return DEFAULTS;
  const ns = p.notification_settings || {};
  const ps = p.privacy_settings || {};
  const pb = p.playback_settings || {};
  return {
    theme: p.theme_preference ?? DEFAULTS.theme,
    language: p.preferred_language ?? DEFAULTS.language,
    autoplay: p.auto_play_next ?? DEFAULTS.autoplay,
    quality: p.quality_preference ?? DEFAULTS.quality,
    subtitles: pb.subtitles ?? DEFAULTS.subtitles,
    newEpisodes: ns.new_episodes ?? DEFAULTS.newEpisodes,
    recommendations: ns.recommendations ?? DEFAULTS.recommendations,
    systemUpdates: ns.system_updates ?? DEFAULTS.systemUpdates,
    emailNotifications: ns.email ?? DEFAULTS.emailNotifications,
    profileVisibility: ps.profile_visibility ?? DEFAULTS.profileVisibility,
    watchHistoryVisible: ps.watch_history_visible ?? DEFAULTS.watchHistoryVisible,
    allowRecommendations: ps.allow_recommendations ?? DEFAULTS.allowRecommendations,
    skipIntro: pb.skip_intro ?? DEFAULTS.skipIntro,
    skipOutro: pb.skip_outro ?? DEFAULTS.skipOutro,
    continuousPlay: pb.continuous_play ?? DEFAULTS.continuousPlay,
    volume: pb.volume ?? DEFAULTS.volume,
  };
}

function localToPrefs(s: typeof DEFAULTS) {
  return {
    theme_preference: s.theme,
    preferred_language: s.language,
    auto_play_next: s.autoplay,
    quality_preference: s.quality,
    notification_settings: {
      new_episodes: s.newEpisodes,
      recommendations: s.recommendations,
      system_updates: s.systemUpdates,
      email: s.emailNotifications,
    },
    privacy_settings: {
      profile_visibility: s.profileVisibility,
      watch_history_visible: s.watchHistoryVisible,
      allow_recommendations: s.allowRecommendations,
    },
    playback_settings: {
      subtitles: s.subtitles,
      skip_intro: s.skipIntro,
      skip_outro: s.skipOutro,
      continuous_play: s.continuousPlay,
      volume: s.volume,
    },
  };
}

export default function SettingsPage() {
  const { preferences, isLoading, isSaving, saveError, updatePreferences } = usePreferences();
  const [settings, setSettings] = useState(DEFAULTS);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Populate local state from DB when preferences load
  useEffect(() => {
    if (preferences) setSettings(prefsToLocal(preferences));
  }, [preferences]);

  // Show error feedback when save fails
  useEffect(() => {
    if (saveError) {
      setSaveMsg('Failed to save — check console');
      const t = setTimeout(() => setSaveMsg(null), 3000);
      return () => clearTimeout(t);
    }
  }, [saveError]);

  // Show "Saved!" when mutation completes successfully
  const wasSaving = useRef(false);
  useEffect(() => {
    if (wasSaving.current && !isSaving && !saveError) {
      setSaveMsg('Saved!');
      const t = setTimeout(() => setSaveMsg(null), 2000);
      wasSaving.current = false;
      return () => clearTimeout(t);
    }
    wasSaving.current = isSaving;
  }, [isSaving, saveError]);

  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSave = () => {
    updatePreferences(localToPrefs(settings));
  };

  const handleReset = () => {
    setSettings(DEFAULTS);
    updatePreferences(localToPrefs(DEFAULTS));
  };

  const settingSections = [
    {
      title: 'Display & Playback',
      icon: 'ri-tv-line',
      settings: [
        {
          key: 'theme',
          label: 'Theme',
          type: 'select',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Auto' }
          ]
        },
        {
          key: 'language',
          label: 'Language',
          type: 'select',
          options: [
            { value: 'en', label: 'English' },
            { value: 'ja', label: '日本語' },
            { value: 'ko', label: '한국어' },
            { value: 'zh', label: '中文' }
          ]
        },
        {
          key: 'quality',
          label: 'Default Video Quality',
          type: 'select',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
            { value: '480p', label: '480p' }
          ]
        },
        {
          key: 'autoplay',
          label: 'Autoplay next episode',
          type: 'toggle'
        },
        {
          key: 'subtitles',
          label: 'Show subtitles by default',
          type: 'toggle'
        },
        {
          key: 'skipIntro',
          label: 'Skip intro automatically',
          type: 'toggle'
        },
        {
          key: 'skipOutro',
          label: 'Skip outro automatically',
          type: 'toggle'
        },
        {
          key: 'continuousPlay',
          label: 'Continuous play',
          type: 'toggle'
        },
        {
          key: 'volume',
          label: 'Default Volume',
          type: 'slider',
          min: 0,
          max: 100
        }
      ]
    },
    {
      title: 'Notifications',
      icon: 'ri-notification-line',
      settings: [
        {
          key: 'newEpisodes',
          label: 'New episode notifications',
          type: 'toggle'
        },
        {
          key: 'recommendations',
          label: 'Recommendation notifications',
          type: 'toggle'
        },
        {
          key: 'systemUpdates',
          label: 'System update notifications',
          type: 'toggle'
        },
        {
          key: 'emailNotifications',
          label: 'Email notifications',
          type: 'toggle'
        }
      ]
    },
    {
      title: 'Privacy & Security',
      icon: 'ri-shield-line',
      settings: [
        {
          key: 'profileVisibility',
          label: 'Profile Visibility',
          type: 'select',
          options: [
            { value: 'public', label: 'Public' },
            { value: 'friends', label: 'Friends Only' },
            { value: 'private', label: 'Private' }
          ]
        },
        {
          key: 'watchHistoryVisible',
          label: 'Show watch history to others',
          type: 'toggle'
        },
        {
          key: 'allowRecommendations',
          label: 'Allow personalized recommendations',
          type: 'toggle'
        }
      ]
    }
  ];

  const renderSetting = (setting: any) => {
    switch (setting.type) {
      case 'toggle':
        return (
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(settings[setting.key as keyof typeof settings])}
              onChange={(e) => handleSettingChange(setting.key, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-teal-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-teal-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
          </label>
        );

      case 'select':
        return (
          <select
            value={String(settings[setting.key as keyof typeof settings])}
            onChange={(e) => handleSettingChange(setting.key, e.target.value)}
            className="px-3 py-2 bg-white border border-teal-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent pr-8"
          >
            {setting.options.map((option: any) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        );

      case 'slider':
        return (
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={setting.min}
              max={setting.max}
              value={Number(settings[setting.key as keyof typeof settings])}
              onChange={(e) => handleSettingChange(setting.key, parseInt(e.target.value))}
              className="flex-1 h-2 bg-teal-200 rounded-lg appearance-none cursor-pointer slider"
            />
            <span className="text-sm text-teal-600 min-w-[3rem] text-right">
              {settings[setting.key as keyof typeof settings]}%
            </span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50">
      <Navbar />
      
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-bold text-teal-800 mb-2">Settings</h1>
          <p className="text-teal-600">Customize your AnimeHub experience</p>
        </motion.div>

        {/* Settings Sections */}
        <div className="space-y-8">
          {settingSections.map((section, sectionIndex) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: sectionIndex * 0.1 }}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-teal-200 overflow-hidden"
            >
              {/* Section Header */}
              <div className="px-6 py-4 border-b border-teal-200 bg-gradient-to-r from-teal-50 to-green-50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
                    <i className={`${section.icon} text-teal-600`}></i>
                  </div>
                  <h2 className="text-xl font-semibold text-teal-800">{section.title}</h2>
                </div>
              </div>

              {/* Section Settings */}
              <div className="p-6">
                <div className="space-y-6">
                  {section.settings.map((setting, settingIndex) => (
                    <motion.div
                      key={setting.key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: (sectionIndex * 0.1) + (settingIndex * 0.05) }}
                      className="flex items-center justify-between py-3"
                    >
                      <div className="flex-1">
                        <label className="text-sm font-medium text-teal-800">
                          {setting.label}
                        </label>
                      </div>
                      <div className="flex-shrink-0">
                        {renderSetting(setting)}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="mt-8 flex gap-4 items-center"
        >
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors duration-200 whitespace-nowrap cursor-pointer disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-teal-100 text-teal-700 rounded-xl hover:bg-teal-200 transition-colors duration-200 whitespace-nowrap cursor-pointer"
          >
            Reset to Default
          </button>
          {saveMsg && (
            <span className="text-sm text-teal-600 font-medium animate-pulse">{saveMsg}</span>
          )}
          {isLoading && (
            <span className="text-sm text-teal-500">Loading preferences...</span>
          )}
        </motion.div>

        {/* Account Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-12 bg-white/80 backdrop-blur-sm rounded-2xl shadow-sm border border-red-200 overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-red-200 bg-gradient-to-r from-red-50 to-pink-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
                <i className="ri-alert-line text-red-600"></i>
              </div>
              <h2 className="text-xl font-semibold text-red-800">Danger Zone</h2>
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <h3 className="text-sm font-medium text-red-800">Export Data</h3>
                  <p className="text-sm text-red-600">Download all your data including watchlist and preferences</p>
                </div>
                <button className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors duration-200 whitespace-nowrap cursor-pointer">
                  Export
                </button>
              </div>
              
              <div className="flex items-center justify-between py-3">
                <div>
                  <h3 className="text-sm font-medium text-red-800">Delete Account</h3>
                  <p className="text-sm text-red-600">Permanently delete your account and all associated data</p>
                </div>
                <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200 whitespace-nowrap cursor-pointer">
                  Delete Account
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <Footer />
    </div>
  );
}
