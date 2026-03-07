import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AdminService, type AnalyticsData } from '../../../services/admin';
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner';

export default function AdminAnalytics() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalAnime: 0,
    totalViews: 0,
    activeSessions: 0
  });

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const [analytics, adminStats] = await Promise.all([
          AdminService.getAnalyticsData(timeRange),
          AdminService.getAdminStats()
        ]);
        
        setAnalyticsData(analytics);
        setStats({
          totalUsers: adminStats.totalUsers,
          totalAnime: adminStats.totalAnime,
          totalViews: adminStats.totalEpisodes, // Using episodes as proxy for views
          activeSessions: adminStats.activeUsers
        });
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch analytics data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [timeRange]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

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
                <i className="ri-line-chart-line text-white text-xl"></i>
              </div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Analytics Dashboard
            </h1>
            </div>
            <p className="text-slate-600 text-lg">Comprehensive insights into your platform performance</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm text-slate-500">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span>Live Data</span>
            </div>
            <div className="flex items-center space-x-2">
              <label htmlFor="timeRange" className="text-sm font-medium text-slate-700">
                Time Range:
              </label>
              <select
                id="timeRange"
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as '7d' | '30d' | '90d')}
                className="px-4 py-2 bg-white/80 backdrop-blur-sm border border-slate-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 shadow-sm"
                disabled={loading}
              >
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
              </select>
            </div>
          </div>
        </div>

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

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <SparkleLoadingSpinner size="lg" text="Loading analytics data..." />
          </div>
        ) : (
          <>
            {/* Enhanced Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 hover:shadow-xl transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-blue-600 rounded-xl flex items-center justify-center">
                    <i className="ri-user-line text-white text-xl"></i>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-800">{stats.totalUsers.toLocaleString()}</p>
                    <p className="text-sm text-slate-600">Total Users</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm text-green-600 font-medium">+12% from last month</span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 hover:shadow-xl transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-green-400 to-green-600 rounded-xl flex items-center justify-center">
                    <i className="ri-movie-2-line text-white text-xl"></i>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-800">{stats.totalAnime.toLocaleString()}</p>
                    <p className="text-sm text-slate-600">Total Anime</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm text-blue-600 font-medium">+5 new this week</span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 hover:shadow-xl transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-purple-400 to-purple-600 rounded-xl flex items-center justify-center">
                    <i className="ri-eye-line text-white text-xl"></i>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-800">{stats.totalViews.toLocaleString()}</p>
                    <p className="text-sm text-slate-600">Total Views</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-sm text-purple-600 font-medium">+23% this month</span>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20 hover:shadow-xl transition-all duration-300"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-orange-400 to-orange-600 rounded-xl flex items-center justify-center">
                    <i className="ri-user-heart-line text-white text-xl"></i>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-slate-800">{stats.activeSessions.toLocaleString()}</p>
                    <p className="text-sm text-slate-600">Active Users</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                  <span className="text-sm text-orange-600 font-medium">Online now</span>
                </div>
              </motion.div>
            </div>

            {/* Enhanced Charts Grid */}
            {analyticsData && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* User Growth Chart */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-slate-800">User Growth ({timeRange})</h2>
                    <div className="w-8 h-8 bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg flex items-center justify-center">
                      <i className="ri-line-chart-line text-white text-sm"></i>
                    </div>
                  </div>
                  {analyticsData.userGrowth.length > 0 ? (
                    <div className="space-y-4">
                      {analyticsData.userGrowth.slice(-7).map((item, index) => (
                        <div key={index} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-700">{formatDate(item.date)}</span>
                            <span className="text-sm font-bold text-slate-800">{item.users}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-3">
                            <div 
                              className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500" 
                              style={{ 
                                width: `${Math.min(100, (item.users / Math.max(...analyticsData.userGrowth.map(g => g.users))) * 100)}%` 
                              }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                      <i className="ri-line-chart-line text-5xl mb-4"></i>
                      <p className="text-lg font-medium">No user growth data available</p>
                      <p className="text-sm">Data will appear as users register</p>
                    </div>
                  )}
                </motion.div>

                {/* Top Anime by Views */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-slate-800">Top Anime by Views</h2>
                    <div className="w-8 h-8 bg-gradient-to-r from-green-400 to-green-600 rounded-lg flex items-center justify-center">
                      <i className="ri-trophy-line text-white text-sm"></i>
                    </div>
                  </div>
                  {analyticsData.animeViews.length > 0 ? (
                    <div className="space-y-4">
                      {analyticsData.animeViews.slice(0, 5).map((item, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl">
                          <div className="flex items-center space-x-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                              index === 0 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600 text-white' :
                              index === 1 ? 'bg-gradient-to-r from-gray-400 to-gray-600 text-white' :
                              index === 2 ? 'bg-gradient-to-r from-orange-400 to-orange-600 text-white' :
                              'bg-slate-200 text-slate-600'
                            }`}>
                              {index + 1}
                            </div>
                            <span className="text-sm font-medium text-slate-700 truncate max-w-32">{item.anime}</span>
                          </div>
                          <div className="flex items-center space-x-3">
                            <div className="w-20 bg-slate-200 rounded-full h-2">
                              <div 
                                className="bg-gradient-to-r from-green-500 to-green-600 h-2 rounded-full transition-all duration-500" 
                                style={{ 
                                  width: `${Math.min(100, (item.views / Math.max(...analyticsData.animeViews.map(a => a.views))) * 100)}%` 
                                }}
                              ></div>
                            </div>
                            <span className="text-sm font-bold text-slate-800 w-12 text-right">{item.views}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                      <i className="ri-trophy-line text-5xl mb-4"></i>
                      <p className="text-lg font-medium">No anime view data available</p>
                      <p className="text-sm">Data will appear as users watch episodes</p>
                    </div>
                  )}
                </motion.div>

                {/* Popular Genres */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-slate-800">Popular Genres</h2>
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-purple-600 rounded-lg flex items-center justify-center">
                      <i className="ri-bar-chart-line text-white text-sm"></i>
                    </div>
                  </div>
                  {analyticsData.popularGenres.length > 0 ? (
                    <div className="space-y-4">
                      {analyticsData.popularGenres.slice(0, 8).map((item, index) => (
                        <div key={index} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-700">{item.genre}</span>
                            <span className="text-sm font-bold text-slate-800">{item.count}</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-2">
                            <div 
                              className="bg-gradient-to-r from-purple-500 to-purple-600 h-2 rounded-full transition-all duration-500" 
                              style={{ 
                                width: `${Math.min(100, (item.count / Math.max(...analyticsData.popularGenres.map(g => g.count))) * 100)}%` 
                              }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-slate-500">
                      <i className="ri-bar-chart-line text-5xl mb-4"></i>
                      <p className="text-lg font-medium">No genre data available</p>
                      <p className="text-sm">Data will appear as anime are categorized</p>
                    </div>
                  )}
                </motion.div>

                {/* Device Usage */}
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.8 }}
                  className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20"
                >
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-semibold text-slate-800">Device Usage</h2>
                    <div className="w-8 h-8 bg-gradient-to-r from-orange-400 to-orange-600 rounded-lg flex items-center justify-center">
                      <i className="ri-smartphone-line text-white text-sm"></i>
                    </div>
                  </div>
                  <div className="space-y-6">
                    {analyticsData.deviceStats.map((item, index) => (
                      <div key={index} className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-slate-700">{item.device}</span>
                          <span className="text-sm font-bold text-slate-800">{item.percentage}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-3">
                          <div 
                            className={`h-3 rounded-full transition-all duration-500 ${
                              index === 0 ? 'bg-gradient-to-r from-blue-500 to-blue-600' : 
                              index === 1 ? 'bg-gradient-to-r from-green-500 to-green-600' : 
                              'bg-gradient-to-r from-orange-500 to-orange-600'
                            }`}
                            style={{ width: `${item.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}