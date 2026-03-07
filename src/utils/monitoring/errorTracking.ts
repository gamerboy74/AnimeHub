/**
 * Error Tracking Integration
 * Centralized error tracking with support for multiple services
 */

import { env } from '../config/env';
import { log } from '../logging';

interface ErrorContext {
  userId?: string;
  userAgent?: string;
  url?: string;
  route?: string;
  [key: string]: unknown;
}

class ErrorTracker {
  private isInitialized = false;
  private sentryEnabled = false;

  /**
   * Initialize error tracking services
   */
  initialize(): void {
    if (!env.enableErrorTracking) {
      log.debug('Error tracking disabled');
      return;
    }

    // Initialize Sentry if DSN is provided
    if (env.sentryDsn && typeof window !== 'undefined') {
      this.initializeSentry();
    }

    this.isInitialized = true;
    log.info('Error tracking initialized', { sentry: this.sentryEnabled });
  }

  /**
   * Initialize Sentry (placeholder - install @sentry/react for actual implementation)
   */
  private initializeSentry(): void {
    try {
      // Example Sentry initialization (uncomment when @sentry/react is installed)
      /*
      import * as Sentry from '@sentry/react';
      
      Sentry.init({
        dsn: env.sentryDsn,
        environment: env.nodeEnv,
        integrations: [
          new Sentry.BrowserTracing(),
          new Sentry.Replay(),
        ],
        tracesSampleRate: env.productionMode ? 0.1 : 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
      });
      */
      
      this.sentryEnabled = true;
      log.debug('Sentry initialized');
    } catch (error) {
      log.warn('Failed to initialize Sentry', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Capture an exception
   */
  captureException(error: Error, context?: ErrorContext): void {
    if (!env.enableErrorTracking) return;

    log.error('Error captured', error, context);

    // Send to Sentry
    if (this.sentryEnabled && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        extra: context,
        level: 'error',
      });
    }

    // Send to analytics
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: error.message,
        fatal: false,
        custom_map: context,
      });
    }
  }

  /**
   * Capture a message
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: ErrorContext): void {
    if (!env.enableErrorTracking) return;

    // Send to Sentry
    if (this.sentryEnabled && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureMessage(message, {
        level,
        extra: context,
      });
    }

    log[level](message, context);
  }

  /**
   * Set user context for error tracking
   */
  setUser(userId: string, email?: string, username?: string): void {
    if (!env.enableErrorTracking) return;

    if (this.sentryEnabled && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.setUser({
        id: userId,
        email,
        username,
      });
    }
  }

  /**
   * Clear user context
   */
  clearUser(): void {
    if (this.sentryEnabled && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.setUser(null);
    }
  }

  /**
   * Add breadcrumb for debugging
   */
  addBreadcrumb(message: string, category?: string, level: 'debug' | 'info' | 'warning' | 'error' = 'info', data?: Record<string, unknown>): void {
    if (!env.enableErrorTracking) return;

    if (this.sentryEnabled && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.addBreadcrumb({
        message,
        category,
        level,
        data,
      });
    }

    log[level](`[Breadcrumb] ${message}`, { category, ...data });
  }
}

// Export singleton instance
export const errorTracker = new ErrorTracker();

// Initialize on module load
if (typeof window !== 'undefined') {
  errorTracker.initialize();
}

export default errorTracker;

