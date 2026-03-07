import { useEffect, useState } from 'react';
import { onCLS, onFID, onFCP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { defaultBudgets, rateMetric } from '../../utils/monitoring/budgets';

interface PerformanceMetrics {
  CLS: number | null;
  FID: number | null;
  FCP: number | null;
  LCP: number | null;
  TTFB: number | null;
}

interface PerformanceMonitorProps {
  enabled?: boolean;
  showBadge?: boolean;
  analyticsEndpoint?: string;
}

export default function PerformanceMonitor({ 
  enabled = true, 
  showBadge = import.meta.env.DEV,
  analyticsEndpoint 
}: PerformanceMonitorProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    CLS: null,
    FID: null,
    FCP: null,
    LCP: null,
    TTFB: null
  });

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const handleMetric = (metric: Metric) => {
      const { name, value, delta, id } = metric;
      
      // Update metrics state
      setMetrics(prev => ({
        ...prev,
        [name]: value
      }));

      // Log to console in development
      if (import.meta.env.DEV) {
        console.log(`Web Vital - ${name}:`, {
          value: Math.round(value),
          delta: Math.round(delta),
          id,
          rating: getRating(name, value)
        });
      }

      // Send to analytics/back-end collector
      if (analyticsEndpoint) {
        sendToAnalytics(metric);
      }

      // Budget checks (warn in console when over budget)
      const rating = getRating(name, value);
      if (rating !== 'good' && import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(`[PerfBudget] ${name} over budget: ${Math.round(value)} (${rating})`);
      }
    };

    // Measure Web Vitals
    onCLS(handleMetric);
    onFID(handleMetric);
    onFCP(handleMetric);
    onLCP(handleMetric);
    onTTFB(handleMetric);

    // Show badge after collecting initial metrics
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, [enabled, analyticsEndpoint]);

  const getRating = (name: string, value: number): 'good' | 'needs-improvement' | 'poor' => {
    if (!['CLS','FID','FCP','LCP','TTFB'].includes(name)) return 'good';
    return rateMetric(name as keyof typeof defaultBudgets, value, defaultBudgets);
  };

  const sendToAnalytics = async (metric: Metric) => {
    try {
      await fetch(analyticsEndpoint || '/api/perf-metrics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: metric.name,
          value: metric.value,
          delta: metric.delta,
          id: metric.id,
          timestamp: Date.now(),
          url: window.location.href,
          userAgent: navigator.userAgent
        })
      });
    } catch (error) {
      console.error('Failed to send performance metric:', error);
    }
  };

  const getOverallScore = (): 'good' | 'needs-improvement' | 'poor' => {
    const scores = Object.entries(metrics)
      .filter(([_, value]) => value !== null)
      .map(([name, value]) => getRating(name, value!));

    if (scores.length === 0) return 'good';

    const poorCount = scores.filter(score => score === 'poor').length;
    const needsImprovementCount = scores.filter(score => score === 'needs-improvement').length;

    if (poorCount > 0) return 'poor';
    if (needsImprovementCount > 0) return 'needs-improvement';
    return 'good';
  };

  const getScoreColor = (score: 'good' | 'needs-improvement' | 'poor') => {
    switch (score) {
      case 'good': return 'text-green-600 bg-green-100';
      case 'needs-improvement': return 'text-yellow-600 bg-yellow-100';
      case 'poor': return 'text-red-600 bg-red-100';
    }
  };

  const overallScore = getOverallScore();

  if (!showBadge || !isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white rounded-lg shadow-lg border p-3 max-w-xs">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">Performance</h3>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getScoreColor(overallScore)}`}>
            {overallScore.replace('-', ' ')}
          </span>
        </div>
        
        <div className="space-y-1 text-xs">
          {Object.entries(metrics).map(([name, value]) => (
            <div key={name} className="flex justify-between">
              <span className="text-gray-600">{name}:</span>
              <span className={`font-medium ${
                value !== null ? getScoreColor(getRating(name, value)).split(' ')[0] : 'text-gray-400'
              }`}>
                {value !== null ? `${Math.round(value)}ms` : '...'}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 pt-2 border-t border-gray-200">
          <button
            onClick={() => setIsVisible(false)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Hide
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for accessing performance metrics
export function usePerformanceMetrics() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    CLS: null,
    FID: null,
    FCP: null,
    LCP: null,
    TTFB: null
  });

  useEffect(() => {
    const handleMetric = (metric: Metric) => {
      setMetrics(prev => ({
        ...prev,
        [metric.name]: metric.value
      }));
    };

    onCLS(handleMetric);
    onFID(handleMetric);
    onFCP(handleMetric);
    onLCP(handleMetric);
    onTTFB(handleMetric);
  }, []);

  return metrics;
}
