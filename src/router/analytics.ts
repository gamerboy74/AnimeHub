/**
 * Navigation Analytics
 * Tracks route changes, performance, and user navigation patterns
 */

import { log } from '../utils/logging';
import { errorTracker } from '../utils/monitoring/errorTracking';

interface NavigationMetrics {
  path: string;
  timestamp: number;
  loadTime?: number;
  previousPath?: string;
  method: 'push' | 'replace' | 'pop' | 'initial';
}

class NavigationAnalytics {
  private metrics: NavigationMetrics[] = [];
  private maxMetrics = 100;
  private startTime: number = 0;

  /**
   * Track navigation start
   */
  startNavigation(path: string, method: NavigationMetrics['method'] = 'push', previousPath?: string): void {
    this.startTime = performance.now();
    
    const metric: NavigationMetrics = {
      path,
      timestamp: Date.now(),
      method,
      previousPath,
    };

    this.metrics.push(metric);
    
    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift();
    }

    log.debug('Navigation started', { path, method, previousPath });
    
    // Track in analytics (if enabled)
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'page_view', {
        page_path: path,
        page_title: document.title,
      });
    }
  }

  /**
   * Track navigation complete
   */
  completeNavigation(path: string, success: boolean = true, error?: Error): void {
    const loadTime = this.startTime > 0 ? performance.now() - this.startTime : undefined;
    
    const metric = this.metrics.find(m => m.path === path && !m.loadTime);
    if (metric && loadTime) {
      metric.loadTime = loadTime;
    }

    if (success) {
      log.info('Navigation completed', { path, loadTime: loadTime ? `${loadTime.toFixed(2)}ms` : undefined });
      
      // Track performance
      if (loadTime && loadTime > 1000) {
        log.warn('Slow navigation detected', { path, loadTime });
      }
    } else {
      log.error('Navigation failed', error, { path });
      errorTracker.captureException(error || new Error('Navigation failed'), { path });
    }

    this.startTime = 0;
  }

  /**
   * Get navigation metrics
   */
  getMetrics(): NavigationMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get average load time
   */
  getAverageLoadTime(): number {
    const metricsWithLoadTime = this.metrics.filter(m => m.loadTime);
    if (metricsWithLoadTime.length === 0) return 0;
    
    const total = metricsWithLoadTime.reduce((sum, m) => sum + (m.loadTime || 0), 0);
    return total / metricsWithLoadTime.length;
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Track route visit
   */
  trackRouteVisit(path: string): void {
    // Could integrate with external analytics
    log.debug('Route visited', { path });
  }

  /**
   * Track navigation error
   */
  trackNavigationError(path: string, error: Error): void {
    log.error('Navigation error', error, { path });
    errorTracker.captureException(error, { path, type: 'navigation_error' });
  }
}

export const navigationAnalytics = new NavigationAnalytics();

