
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import DashboardStats from './components/DashboardStats';
import RecentActivity from './components/RecentActivity';
import QuickActions from './components/QuickActions';
import SystemHealth from './components/SystemHealth';
import { SparkleLoadingSpinner } from '../../components/base/LoadingSpinner';
import { useAdminStats, useRecentActivity, useSystemHealth } from '../../hooks/admin';
import { sessionManager } from '../../utils/session/manager';
import { usePerformanceMetrics } from '../../components/common/PerformanceMonitor';
import { useServiceWorker } from '../../utils/cache/serviceWorker';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const refreshSession = sessionManager.forceRefresh;
  const isSessionValid = sessionManager.isSessionValid;
  const { stats: adminStats, loading: statsLoading, error: statsError, refetch: refetchStats } = useAdminStats();
  const { activities, loading: activitiesLoading, error: activitiesError, refetch: refetchActivities } = useRecentActivity();
  const { health, loading: healthLoading, error: healthError, refetch: refetchHealth } = useSystemHealth();
  
  // Performance monitoring
  const webVitals = usePerformanceMetrics();
  const { getPerformanceMetrics } = useServiceWorker();
  const swMetrics = getPerformanceMetrics();

  const handleRefresh = async () => {
    try {
      // Refresh session first if needed
      if (!isSessionValid()) {
        await refreshSession();
      }
      
      // Then refresh all data
      refetchStats();
      refetchActivities();
      refetchHealth();
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
    }
  };

  // Show error if there are database issues
  const hasErrors = statsError || activitiesError || healthError;

  const handleQuickAction = (action: string) => {
    switch (action) {
      case 'add_anime':
        navigate('/admin/anime');
        break;
      case 'manage_users':
        navigate('/admin/users');
        break;
      case 'view_reports':
        // Refresh activities to show latest data
        refetchActivities();
        break;
      case 'system_settings':
        // Refresh system health
        refetchHealth();
        break;
      default:
        break;
    }
  };

  const isLoading = statsLoading || activitiesLoading || healthLoading;

  // Show error message if there are database issues
  if (hasErrors && !isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <i className="ri-error-warning-line text-6xl text-red-500 mb-4"></i>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Database Connection Error</h2>
          <p className="text-slate-600 mb-4">
            The admin dashboard cannot load due to database policy issues.
          </p>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-left">
            <p className="text-sm text-red-700 font-medium mb-2">To fix this:</p>
            <ol className="text-sm text-red-700 list-decimal list-inside space-y-1">
              <li>Open your Supabase Dashboard</li>
              <li>Go to SQL Editor</li>
              <li>Copy the content from <code className="bg-red-100 px-1 rounded">comprehensive-fix.sql</code></li>
              <li>Paste and run the script</li>
              <li>Refresh this page</li>
            </ol>
          </div>
          <button
            onClick={handleRefresh}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Add timeout to prevent infinite loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <SparkleLoadingSpinner size="xl" text="Loading admin dashboard..." />
          <p className="text-sm text-slate-500 mt-4">
            Fetching latest data from database
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2260%22%20height%3D%2260%22%20viewBox%3D%220%200%2060%2060%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cg%20fill%3D%22none%22%20fill-rule%3D%22evenodd%22%3E%3Cg%20fill%3D%22%239C92AC%22%20fill-opacity%3D%220.05%22%3E%3Ccircle%20cx%3D%2230%22%20cy%3D%2230%22%20r%3D%222%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40"></div>
      
        <main className="relative pt-8 px-4 sm:px-6 lg:px-8 pb-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8"
          >
            <div className="mb-4 sm:mb-0">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                  <i className="ri-dashboard-line text-white text-xl"></i>
                </div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Admin Dashboard
                </h1>
              </div>
              <p className="text-slate-600 text-lg">Welcome back! Here's what's happening with your platform</p>
            </div>
            <div className="flex items-center space-x-3">
              <div className="hidden sm:flex items-center space-x-2 text-sm text-slate-500">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>System Online</span>
              </div>
              <button
                onClick={handleRefresh}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 flex items-center space-x-2"
              >
                <i className="ri-refresh-line text-lg"></i>
                <span>Refresh Data</span>
              </button>
            </div>
          </motion.div>

          {/* Dashboard Stats */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <DashboardStats data={adminStats} />
          </motion.div>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
            {/* Recent Activity */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="lg:col-span-2"
            >
              <RecentActivity activities={activities} />
            </motion.div>

            {/* Quick Actions & System Health */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="space-y-8"
            >
              <QuickActions onAction={handleQuickAction} />
              <SystemHealth health={health} />
            </motion.div>
          </div>

          {/* Additional Stats Row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {/* Performance Metrics */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">Performance</h3>
                <button 
                  onClick={() => navigate('/admin/performance')}
                  className="w-10 h-10 bg-gradient-to-r from-green-400 to-blue-500 rounded-lg flex items-center justify-center hover:scale-105 transition-transform"
                >
                  <i className="ri-speed-line text-white text-lg"></i>
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">LCP</span>
                  <span className={`font-semibold ${
                    webVitals.LCP && webVitals.LCP <= 2500 ? 'text-green-600' : 
                    webVitals.LCP && webVitals.LCP <= 4000 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {webVitals.LCP ? `${Math.round(webVitals.LCP)}ms` : '...'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">CLS</span>
                  <span className={`font-semibold ${
                    webVitals.CLS && webVitals.CLS <= 0.1 ? 'text-green-600' : 
                    webVitals.CLS && webVitals.CLS <= 0.25 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {webVitals.CLS ? webVitals.CLS.toFixed(3) : '...'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Cache Hit Rate</span>
                  <span className={`font-semibold ${
                    swMetrics.cacheHitRate >= 70 ? 'text-green-600' : 
                    swMetrics.cacheHitRate >= 50 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {swMetrics.cacheHitRate.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Avg Response</span>
                  <span className={`font-semibold ${
                    swMetrics.averageResponseTime <= 200 ? 'text-green-600' : 
                    swMetrics.averageResponseTime <= 500 ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {swMetrics.averageResponseTime.toFixed(0)}ms
                  </span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-200">
                <button 
                  onClick={() => navigate('/admin/performance')}
                  className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  View Detailed Metrics →
                </button>
              </div>
            </div>

            {/* Content Overview */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">Content</h3>
                <div className="w-10 h-10 bg-gradient-to-r from-purple-400 to-pink-500 rounded-lg flex items-center justify-center">
                  <i className="ri-movie-line text-white text-lg"></i>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Total Anime</span>
                  <span className="font-semibold text-purple-600">{adminStats?.totalAnime || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Episodes</span>
                  <span className="font-semibold text-purple-600">{adminStats?.totalEpisodes || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Reviews</span>
                  <span className="font-semibold text-purple-600">{adminStats?.totalReviews || 0}</span>
                </div>
              </div>
            </div>

            {/* System Status */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-slate-800">System</h3>
                <div className="w-10 h-10 bg-gradient-to-r from-orange-400 to-red-500 rounded-lg flex items-center justify-center">
                  <i className="ri-server-line text-white text-lg"></i>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Database</span>
                  <span className="flex items-center space-x-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="font-semibold text-green-600">Healthy</span>
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Storage</span>
                  <span className="font-semibold text-blue-600">2.4GB</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Reports</span>
                  <span className="font-semibold text-orange-600">0</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
    
  );
}
