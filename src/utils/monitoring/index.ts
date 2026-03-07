// Performance Monitoring Utility for AnimeHub
// Tracks Web Vitals and custom performance metrics

interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  type: 'web-vital' | 'custom' | 'navigation' | 'resource';
}

interface PerformanceConfig {
  enableWebVitals: boolean;
  enableCustomMetrics: boolean;
  enableNavigationTiming: boolean;
  enableResourceTiming: boolean;
  sampleRate: number; // 0-1, percentage of users to track
}

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private config: PerformanceConfig;
  private observer: PerformanceObserver | null = null;

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      enableWebVitals: true,
      enableCustomMetrics: true,
      enableNavigationTiming: true,
      enableResourceTiming: false,
      sampleRate: 0.1, // Track 10% of users by default
      ...config
    };

    this.initialize();
  }

  private initialize() {
    // Only track performance for a sample of users
    if (Math.random() > this.config.sampleRate) {
      return;
    }

    if (this.config.enableWebVitals) {
      this.setupWebVitals();
    }

    if (this.config.enableNavigationTiming) {
      this.setupNavigationTiming();
    }

    if (this.config.enableResourceTiming) {
      this.setupResourceTiming();
    }
  }

  private setupWebVitals() {
    // Largest Contentful Paint (LCP)
    this.observeMetric('largest-contentful-paint', (entry) => {
      this.recordMetric('LCP', entry.startTime, 'web-vital');
    });

    // First Input Delay (FID)
    this.observeMetric('first-input', (entry) => {
      this.recordMetric('FID', entry.processingStart - entry.startTime, 'web-vital');
    });

    // Cumulative Layout Shift (CLS)
    let clsValue = 0;
    this.observeMetric('layout-shift', (entry) => {
      if (!entry.hadRecentInput) {
        clsValue += entry.value;
        this.recordMetric('CLS', clsValue, 'web-vital');
      }
    });

    // First Contentful Paint (FCP)
    this.observeMetric('paint', (entry) => {
      if (entry.name === 'first-contentful-paint') {
        this.recordMetric('FCP', entry.startTime, 'web-vital');
      }
    });
  }

  private setupNavigationTiming() {
    window.addEventListener('load', () => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      
      if (navigation) {
        this.recordMetric('DNS', navigation.domainLookupEnd - navigation.domainLookupStart, 'navigation');
        this.recordMetric('TCP', navigation.connectEnd - navigation.connectStart, 'navigation');
        this.recordMetric('Request', navigation.responseStart - navigation.requestStart, 'navigation');
        this.recordMetric('Response', navigation.responseEnd - navigation.responseStart, 'navigation');
        this.recordMetric('DOMContentLoaded', navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart, 'navigation');
        this.recordMetric('Load', navigation.loadEventEnd - navigation.loadEventStart, 'navigation');
        this.recordMetric('Total', navigation.loadEventEnd - navigation.navigationStart, 'navigation');
      }
    });
  }

  private setupResourceTiming() {
    this.observeMetric('resource', (entry) => {
      const resource = entry as PerformanceResourceTiming;
      if (resource.initiatorType === 'img') {
        this.recordMetric('ImageLoad', resource.duration, 'resource');
      } else if (resource.initiatorType === 'script') {
        this.recordMetric('ScriptLoad', resource.duration, 'resource');
      } else if (resource.initiatorType === 'link') {
        this.recordMetric('StyleLoad', resource.duration, 'resource');
      }
    });
  }

  private observeMetric(type: string, callback: (entry: PerformanceEntry) => void) {
    if (!this.observer) {
      this.observer = new PerformanceObserver((list) => {
        list.getEntries().forEach(callback);
      });
    }

    try {
      this.observer.observe({ type, buffered: true });
    } catch (error) {
      console.warn(`Performance monitoring for ${type} not supported:`, error);
    }
  }

  private recordMetric(name: string, value: number, type: PerformanceMetric['type']) {
    const metric: PerformanceMetric = {
      name,
      value: Math.round(value * 100) / 100, // Round to 2 decimal places
      timestamp: Date.now(),
      type
    };

    this.metrics.push(metric);

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`Performance Metric: ${name} = ${value}ms`);
    }

    // Send to analytics in production
    if (process.env.NODE_ENV === 'production') {
      this.sendToAnalytics(metric);
    }
  }

  // Custom performance marks
  markStart(name: string) {
    performance.mark(`${name}-start`);
  }

  markEnd(name: string) {
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
    
    const measure = performance.getEntriesByName(name)[0];
    if (measure) {
      this.recordMetric(name, measure.duration, 'custom');
    }
  }

  // Measure async operations
  async measureAsync<T>(name: string, operation: () => Promise<T>): Promise<T> {
    this.markStart(name);
    try {
      const result = await operation();
      this.markEnd(name);
      return result;
    } catch (error) {
      this.markEnd(name);
      throw error;
    }
  }

  // Measure component render time
  measureComponentRender(componentName: string, renderFn: () => void) {
    this.markStart(`render-${componentName}`);
    renderFn();
    this.markEnd(`render-${componentName}`);
  }

  // Measure API call performance
  measureApiCall<T>(endpoint: string, apiCall: () => Promise<T>): Promise<T> {
    return this.measureAsync(`api-${endpoint}`, apiCall);
  }

  // Measure database query performance
  measureDbQuery<T>(queryName: string, queryFn: () => Promise<T>): Promise<T> {
    return this.measureAsync(`db-${queryName}`, queryFn);
  }

  // Get performance summary
  getPerformanceSummary() {
    const summary = {
      totalMetrics: this.metrics.length,
      webVitals: this.metrics.filter(m => m.type === 'web-vital'),
      customMetrics: this.metrics.filter(m => m.type === 'custom'),
      navigationMetrics: this.metrics.filter(m => m.type === 'navigation'),
      resourceMetrics: this.metrics.filter(m => m.type === 'resource'),
      averageLoadTime: this.getAverageMetric('Total'),
      averageLCP: this.getAverageMetric('LCP'),
      averageFID: this.getAverageMetric('FID'),
      averageCLS: this.getAverageMetric('CLS')
    };

    return summary;
  }

  private getAverageMetric(name: string): number {
    const metrics = this.metrics.filter(m => m.name === name);
    if (metrics.length === 0) return 0;
    
    const sum = metrics.reduce((acc, metric) => acc + metric.value, 0);
    return Math.round((sum / metrics.length) * 100) / 100;
  }

  private sendToAnalytics(metric: PerformanceMetric) {
    // Send to your analytics service
    // Example: Google Analytics, Mixpanel, etc.
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'performance_metric', {
        metric_name: metric.name,
        metric_value: metric.value,
        metric_type: metric.type,
        timestamp: metric.timestamp
      });
    }
  }

  // Clear metrics (useful for testing)
  clearMetrics() {
    this.metrics = [];
  }

  // Get all metrics
  getAllMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }
}

// Global performance monitor instance
export const performanceMonitor = new PerformanceMonitor({
  enableWebVitals: true,
  enableCustomMetrics: true,
  enableNavigationTiming: true,
  enableResourceTiming: false,
  sampleRate: 0.1 // Track 10% of users
});

// Utility functions for common performance measurements
export const measurePageLoad = (pageName: string) => {
  performanceMonitor.markStart(`page-load-${pageName}`);
  window.addEventListener('load', () => {
    performanceMonitor.markEnd(`page-load-${pageName}`);
  });
};

export const measureComponentMount = (componentName: string) => {
  performanceMonitor.markStart(`mount-${componentName}`);
  return () => performanceMonitor.markEnd(`mount-${componentName}`);
};

export const measureUserInteraction = (interactionName: string) => {
  performanceMonitor.markStart(`interaction-${interactionName}`);
  return () => performanceMonitor.markEnd(`interaction-${interactionName}`);
};

// React hook for measuring component performance
export const usePerformanceMeasure = (componentName: string) => {
  const measureMount = measureComponentMount(componentName);
  
  return {
    measureMount,
    measureRender: (renderFn: () => void) => {
      performanceMonitor.measureComponentRender(componentName, renderFn);
    }
  };
};

export default performanceMonitor;
