import React, { useState, useEffect } from 'react'
import { ImportAnalyticsService } from '../../services/analytics/imports'
import { ImageOptimizationService } from '../../services/media/images'
import Card from '../base/Card'
import Button from '../base/Button'
import LoadingSpinner from '../base/LoadingSpinner'

interface AnalyticsData {
  totalImports: number
  successfulImports: number
  failedImports: number
  totalAnimeImported: number
  totalAnimeSkipped: number
  averageImportTime: number
  mostImportedGenres: Array<{ genre: string; count: number }>
  importTrends: Array<{ date: string; count: number }>
  sourceBreakdown: Array<{ source: string; count: number }>
  errorAnalysis: Array<{ error: string; count: number }>
}

interface PerformanceMetrics {
  averageImportTime: number
  successRate: number
  errorRate: number
  peakImportHour: number
  mostEfficientSource: string
}

export const ImportAnalyticsDashboard: React.FC = () => {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null)
  const [trends, setTrends] = useState<Array<{ date: string; imports: number; anime: number }>>([])
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<'day' | 'week' | 'month' | 'year'>('month')
  const [cacheStats, setCacheStats] = useState<any>(null)

  useEffect(() => {
    loadAnalytics()
  }, [selectedPeriod])

  const loadAnalytics = async () => {
    try {
      setLoading(true)
      const [analyticsData, performanceData, trendsData, cacheData] = await Promise.all([
        ImportAnalyticsService.getAnalytics(selectedPeriod),
        ImportAnalyticsService.getPerformanceMetrics(),
        ImportAnalyticsService.getImportTrends(30),
        ImageOptimizationService.getCacheStats()
      ])
      
      setAnalytics(analyticsData)
      setPerformance(performanceData)
      setTrends(trendsData)
      setCacheStats(cacheData)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateReport = async () => {
    try {
      const report = await ImportAnalyticsService.generateReport('monthly')
      console.log('Generated report:', report)
      alert('Report generated successfully! Check console for details.')
    } catch (error) {
      console.error('Failed to generate report:', error)
      alert('Failed to generate report')
    }
  }

  const clearCache = async () => {
    try {
      await ImageOptimizationService.clearCache()
      alert('Image cache cleared successfully!')
      loadAnalytics()
    } catch (error) {
      console.error('Failed to clear cache:', error)
      alert('Failed to clear cache')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">📊 Import Analytics Dashboard</h2>
          <p className="text-gray-600">Comprehensive insights into your anime import system</p>
        </div>
        <div className="flex gap-3">
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="day">Last 24 Hours</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="year">Last Year</option>
          </select>
          <Button onClick={generateReport} variant="secondary">
            📄 Generate Report
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <span className="text-blue-600 text-xl">📥</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Total Imports</p>
              <p className="text-2xl font-bold text-gray-900">{analytics?.totalImports || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <span className="text-green-600 text-xl">✅</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Anime Imported</p>
              <p className="text-2xl font-bold text-gray-900">{analytics?.totalAnimeImported || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <span className="text-yellow-600 text-xl">⚠️</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">
                {performance?.successRate ? `${performance.successRate.toFixed(1)}%` : '0%'}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
              <span className="text-purple-600 text-xl">⚡</span>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Avg Import Time</p>
              <p className="text-2xl font-bold text-gray-900">
                {performance?.averageImportTime ? `${(performance.averageImportTime / 1000).toFixed(1)}s` : '0s'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Charts and Detailed Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Trends */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">📈 Import Trends</h3>
          <div className="space-y-3">
            {trends.slice(0, 7).map((trend, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm text-gray-600">{trend.date}</span>
                <div className="flex gap-4 text-sm">
                  <span className="text-blue-600">{trend.imports} imports</span>
                  <span className="text-green-600">{trend.anime} anime</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Source Breakdown */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">🔗 Source Breakdown</h3>
          <div className="space-y-3">
            {analytics?.sourceBreakdown.map((source, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm font-medium capitalize">{source.source}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ 
                        width: `${(source.count / (analytics?.totalAnimeImported || 1)) * 100}%` 
                      }}
                    ></div>
                  </div>
                  <span className="text-sm text-gray-600">{source.count}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Top Genres */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">🏷️ Most Imported Genres</h3>
          <div className="space-y-3">
            {analytics?.mostImportedGenres.slice(0, 5).map((genre, index) => (
              <div key={index} className="flex justify-between items-center">
                <span className="text-sm font-medium">{genre.genre}</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-600 h-2 rounded-full"
                      style={{ 
                        width: `${(genre.count / (analytics?.mostImportedGenres[0]?.count || 1)) * 100}%` 
                      }}
                    ></div>
                  </div>
                  <span className="text-sm text-gray-600">{genre.count}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Performance Metrics */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">⚡ Performance Metrics</h3>
          <div className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Peak Import Hour</span>
              <span className="text-sm font-medium">{performance?.peakImportHour || 0}:00</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Most Efficient Source</span>
              <span className="text-sm font-medium capitalize">{performance?.mostEfficientSource || 'N/A'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-gray-600">Error Rate</span>
              <span className="text-sm font-medium text-red-600">
                {performance?.errorRate ? `${performance.errorRate.toFixed(1)}%` : '0%'}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Image Cache Statistics */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">🖼️ Image Cache Statistics</h3>
          <Button onClick={clearCache} variant="secondary" size="sm">
            🗑️ Clear Cache
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{cacheStats?.totalImages || 0}</p>
            <p className="text-sm text-gray-600">Cached Images</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">
              {cacheStats?.totalSize ? `${(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB` : '0 MB'}
            </p>
            <p className="text-sm text-gray-600">Cache Size</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">
              {cacheStats?.oldestEntry ? new Date(cacheStats.oldestEntry).toLocaleDateString() : 'N/A'}
            </p>
            <p className="text-sm text-gray-600">Oldest Entry</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-orange-600">
              {cacheStats?.newestEntry ? new Date(cacheStats.newestEntry).toLocaleDateString() : 'N/A'}
            </p>
            <p className="text-sm text-gray-600">Newest Entry</p>
          </div>
        </div>
      </Card>

      {/* Error Analysis */}
      {analytics?.errorAnalysis && analytics.errorAnalysis.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">❌ Error Analysis</h3>
          <div className="space-y-3">
            {analytics.errorAnalysis.map((error, index) => (
              <div key={index} className="flex justify-between items-center p-3 bg-red-50 rounded-lg">
                <span className="text-sm font-medium text-red-800">{error.error}</span>
                <span className="text-sm text-red-600">{error.count} occurrences</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recommendations */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">💡 Recommendations</h3>
        <div className="space-y-3">
          {performance?.successRate && performance.successRate < 80 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                ⚠️ Success rate is below 80%. Consider implementing better error handling and retry logic.
              </p>
            </div>
          )}
          
          {performance?.averageImportTime && performance.averageImportTime > 5000 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                ⚡ Import times are high. Consider optimizing API calls or using batch processing.
              </p>
            </div>
          )}

          {analytics?.mostImportedGenres && analytics.mostImportedGenres.length > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">
                🎯 Focus on importing more {analytics.mostImportedGenres[0].genre} anime as it's popular among users.
              </p>
            </div>
          )}

          <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <p className="text-sm text-purple-800">
              📊 Generate detailed reports regularly to track import performance and identify optimization opportunities.
            </p>
          </div>
        </div>
      </Card>
    </div>
  )
}
