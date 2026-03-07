/**
 * Production Logging System
 * Structured logging with levels, context, and optional external service integration
 */

import { env } from '../config/env';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: Error;
  stack?: string;
}

class Logger {
  private minLevel: LogLevel;
  private enableConsole: boolean;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 100;

  constructor() {
    // In production, default to WARN level unless explicitly enabled
    this.minLevel = env.productionMode
      ? (env.enableErrorTracking ? LogLevel.WARN : LogLevel.ERROR)
      : LogLevel.DEBUG;
    
    this.enableConsole = !env.disableConsole && (!env.productionMode || env.enableErrorTracking);
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
    const prefix = LogLevel[level];
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    const errorStr = error ? ` ${error.message}` : '';
    return `[${prefix}] ${message}${contextStr}${errorStr}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel;
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error,
      stack: error?.stack,
    };
  }

  private output(entry: LogEntry): void {
    // Buffer logs for batch sending
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Console output
    if (this.enableConsole) {
      const formatted = this.formatMessage(entry.level, entry.message, entry.context, entry.error);
      
      switch (entry.level) {
        case LogLevel.DEBUG:
          console.debug(formatted, entry.context || '');
          break;
        case LogLevel.INFO:
          console.info(formatted, entry.context || '');
          break;
        case LogLevel.WARN:
          console.warn(formatted, entry.context || '');
          break;
        case LogLevel.ERROR:
          console.error(formatted, entry.context || '', entry.error || '');
          break;
      }
    }

    // Send to external service (e.g., Sentry) for errors in production
    if (env.productionMode && entry.level === LogLevel.ERROR && env.enableErrorTracking) {
      this.sendToErrorTracking(entry);
    }
  }

  private sendToErrorTracking(entry: LogEntry): void {
    // Integration with error tracking services
    // Example: Sentry
    if (env.sentryDsn && typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(entry.error || new Error(entry.message), {
        extra: entry.context,
        level: 'error',
      });
    }
    
    // Custom analytics tracking
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'exception', {
        description: entry.message,
        fatal: false,
        custom_map: entry.context,
      });
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.output(this.createLogEntry(LogLevel.DEBUG, message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.output(this.createLogEntry(LogLevel.INFO, message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.output(this.createLogEntry(LogLevel.WARN, message, context));
    }
  }

  error(message: string, error?: Error, context?: LogContext): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.output(this.createLogEntry(LogLevel.ERROR, message, context, error));
    }
  }

  /**
   * Get recent logs for debugging
   */
  getRecentLogs(level?: LogLevel): LogEntry[] {
    if (level !== undefined) {
      return this.logBuffer.filter(entry => entry.level === level);
    }
    return [...this.logBuffer];
  }

  /**
   * Clear log buffer
   */
  clearBuffer(): void {
    this.logBuffer = [];
  }
}

// Export singleton logger instance
export const logger = new Logger();

// Convenience functions for common use cases
export const log = {
  debug: (message: string, context?: LogContext) => logger.debug(message, context),
  info: (message: string, context?: LogContext) => logger.info(message, context),
  warn: (message: string, context?: LogContext) => logger.warn(message, context),
  error: (message: string, error?: Error, context?: LogContext) => logger.error(message, error, context),
};

export default logger;

