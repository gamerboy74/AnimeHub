import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePerformanceMetrics } from '../../../components/common/PerformanceMonitor';
import { useServiceWorker } from '../../../utils/cache/serviceWorker';

interface PerformanceData {
  webVitals: {
    CLS: number | null;
    FID: number | null;
    FCP: number | null;
    LCP: number | null;
    TTFB: number | null;
  };
  serviceWorker: {
    cacheHitRate: number;
    networkRequests: number;
    cacheRequests: number;
    averageResponseTime: number;
    errors: number;
    lastUpdated: number;
  };
  systemInfo: {
    userAgent: string;
    connection: string;
    memory: number | null;
    cores: number;
  };
}

export default function PerformanceDashboard() {
  const [performanceData, setPerformanceData] = useState<PerformanceData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  const webVitals = usePerformanceMetrics();
  const { getPerformanceMetrics, getCacheStats } = useServiceWorker();

  const fetchPerformanceData = async () => {
    setIsRefreshing(true);
    try {
      const swMetrics = getPerformanceMetrics();
      await getCacheStats(); // Cache stats not used in current implementation
      
      // Get system information
      const systemInfo = {
        userAgent: navigator.userAgent,
        connection: (navigator as any).connection?.effectiveType || 'unknown',
        memory: (performance as any).memory?.usedJSHeapSize || null,
        cores: navigator.hardwareConcurrency || 0
      };

      setPerformanceData({
        webVitals,
        serviceWorker: swMetrics,
        systemInfo
      });
    } catch (error) {
      console.error('Error fetching performance data:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchPerformanceData, 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [webVitals, autoRefresh]);

  const getScoreColor = (score: 'good' | 'needs-improvement' | 'poor') => {
    switch (score) {
      case 'good': return 'text-green-600 bg-green-100';
      case 'needs-improvement': return 'text-yellow-600 bg-yellow-100';
      case 'poor': return 'text-red-600 bg-red-100';
    }
  };

  const getWebVitalScore = (name: string, value: number | null): 'good' | 'needs-improvement' | 'poor' => {
    if (value === null) return 'good';
    
    const thresholds: Record<string, { good: number; poor: number }> = {
      CLS: { good: 0.1, poor: 0.25 },
      FID: { good: 100, poor: 300 },
      FCP: { good: 1800, poor: 3000 },
      LCP: { good: 2500, poor: 4000 },
      TTFB: { good: 800, poor: 1800 }
    };

    const threshold = thresholds[name];
    if (!threshold) return 'good';

    if (value <= threshold.good) return 'good';
    if (value <= threshold.poor) return 'needs-improvement';
    return 'poor';
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center shadow-lg">
                  <i className="ri-speed-line text-white text-xl"></i>
                </div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Performance Dashboard
                </h1>
              </div>
              <p className="text-slate-600">
                Real-time monitoring of Web Vitals, Service Worker metrics, and system performance
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm text-slate-600">Auto Refresh (5s)</span>
              </label>
              
              <button
                onClick={fetchPerformanceData}
                disabled={isRefreshing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors flex items-center space-x-2"
              >
                <i className={`ri-refresh-line ${isRefreshing ? 'animate-spin' : ''}`}></i>
                <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Web Vitals Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center">
              <i className="ri-speed-line mr-2 text-blue-600"></i>
              Web Vitals Metrics
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {Object.entries(performanceData?.webVitals || {}).map(([name, value]) => {
                const score = getWebVitalScore(name, value);
                return (
                  <div key={name} className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-600">{name}</span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getScoreColor(score)}`}>
                        {score.replace('-', ' ')}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-slate-800">
                      {value !== null ? `${Math.round(value)}ms` : '...'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>

        {/* Service Worker Metrics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center">
              <i className="ri-service-line mr-2 text-green-600"></i>
              Service Worker Performance
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Cache Hit Rate</div>
                <div className="text-2xl font-bold text-slate-800">
                  {performanceData?.serviceWorker.cacheHitRate.toFixed(1)}%
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Total Requests</div>
                <div className="text-2xl font-bold text-slate-800">
                  {(performanceData?.serviceWorker.networkRequests || 0) + (performanceData?.serviceWorker.cacheRequests || 0)}
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Avg Response Time</div>
                <div className="text-2xl font-bold text-slate-800">
                  {performanceData?.serviceWorker.averageResponseTime.toFixed(0)}ms
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Errors</div>
                <div className="text-2xl font-bold text-slate-800">
                  {performanceData?.serviceWorker.errors || 0}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* System Information */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center">
              <i className="ri-computer-line mr-2 text-purple-600"></i>
              System Information
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Connection Type</div>
                <div className="text-lg font-semibold text-slate-800 capitalize">
                  {performanceData?.systemInfo.connection || 'Unknown'}
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">CPU Cores</div>
                <div className="text-lg font-semibold text-slate-800">
                  {performanceData?.systemInfo.cores || 'Unknown'}
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Memory Usage</div>
                <div className="text-lg font-semibold text-slate-800">
                  {performanceData?.systemInfo.memory ? formatBytes(performanceData.systemInfo.memory) : 'N/A'}
                </div>
              </div>
              
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-medium text-slate-600 mb-2">Last Updated</div>
                <div className="text-lg font-semibold text-slate-800">
                  {performanceData?.serviceWorker.lastUpdated ? formatTime(performanceData.serviceWorker.lastUpdated) : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Performance Recommendations */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-white/20">
            <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center">
              <i className="ri-lightbulb-line mr-2 text-yellow-600"></i>
              Performance Recommendations
            </h2>
            
            <div className="space-y-3">
              {performanceData?.webVitals.LCP && performanceData.webVitals.LCP > 4000 && (
                <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                  <i className="ri-error-warning-line text-red-600 mt-1"></i>
                  <div>
                    <div className="font-medium text-red-800">Poor LCP Score</div>
                    <div className="text-sm text-red-600">
                      Largest Contentful Paint is {Math.round(performanceData.webVitals.LCP)}ms. 
                      Consider optimizing images and reducing server response time.
                    </div>
                  </div>
                </div>
              )}
              
              {performanceData?.webVitals.CLS && performanceData.webVitals.CLS > 0.25 && (
                <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                  <i className="ri-error-warning-line text-red-600 mt-1"></i>
                  <div>
                    <div className="font-medium text-red-800">Poor CLS Score</div>
                    <div className="text-sm text-red-600">
                      Cumulative Layout Shift is {performanceData.webVitals.CLS.toFixed(3)}. 
                      Fix layout shifts by setting dimensions for images and dynamic content.
                    </div>
                  </div>
                </div>
              )}
              
              {performanceData?.serviceWorker.cacheHitRate && performanceData.serviceWorker.cacheHitRate < 50 && (
                <div className="flex items-start space-x-3 p-3 bg-yellow-50 rounded-lg">
                  <i className="ri-information-line text-yellow-600 mt-1"></i>
                  <div>
                    <div className="font-medium text-yellow-800">Low Cache Hit Rate</div>
                    <div className="text-sm text-yellow-600">
                      Cache hit rate is {performanceData.serviceWorker.cacheHitRate.toFixed(1)}%. 
                      Consider implementing more aggressive caching strategies.
                    </div>
                  </div>
                </div>
              )}
              
              {performanceData?.serviceWorker.errors && performanceData.serviceWorker.errors > 0 && (
                <div className="flex items-start space-x-3 p-3 bg-red-50 rounded-lg">
                  <i className="ri-error-warning-line text-red-600 mt-1"></i>
                  <div>
                    <div className="font-medium text-red-800">Service Worker Errors</div>
                    <div className="text-sm text-red-600">
                      {performanceData.serviceWorker.errors} errors detected. 
                      Check service worker implementation and network requests.
                    </div>
                  </div>
                </div>
              )}
              
              {(!performanceData?.webVitals.LCP || performanceData.webVitals.LCP <= 2500) && 
               (!performanceData?.webVitals.CLS || performanceData.webVitals.CLS <= 0.1) && 
               (!performanceData?.webVitals.FID || performanceData.webVitals.FID <= 100) && (
                <div className="flex items-start space-x-3 p-3 bg-green-50 rounded-lg">
                  <i className="ri-check-line text-green-600 mt-1"></i>
                  <div>
                    <div className="font-medium text-green-800">Excellent Performance</div>
                    <div className="text-sm text-green-600">
                      All Web Vitals are within good thresholds. Keep up the great work!
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
