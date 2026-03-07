/**
 * Server-side Logging System
 * Structured logging for Express backend
 */

const isProduction = process.env.NODE_ENV === 'production';
const enableConsole = !process.env.VITE_DISABLE_CONSOLE || process.env.VITE_DISABLE_CONSOLE === 'false';

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class ServerLogger {
  constructor() {
    this.minLevel = isProduction ? LogLevel.WARN : LogLevel.DEBUG;
    this.enableConsole = enableConsole || !isProduction;
    this.logBuffer = [];
    this.maxBufferSize = 100;
  }

  formatMessage(level, message, context = {}) {
    const prefix = Object.keys(LogLevel).find(key => LogLevel[key] === level);
    const timestamp = new Date().toISOString();
    const contextStr = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] [${prefix}] ${message}${contextStr}`;
  }

  shouldLog(level) {
    return level >= this.minLevel;
  }

  output(level, message, context = {}, error = null) {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      error: error ? error.message : null,
      stack: error ? error.stack : null,
    };

    // Buffer logs
    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // Console output
    if (this.enableConsole) {
      const formatted = this.formatMessage(level, message, context);
      
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formatted);
          break;
        case LogLevel.INFO:
          console.info(formatted);
          break;
        case LogLevel.WARN:
          console.warn(formatted);
          break;
        case LogLevel.ERROR:
          console.error(formatted, error || '');
          break;
      }
    }

    // Send errors to monitoring service in production
    if (isProduction && level === LogLevel.ERROR && error) {
      // Integration point for error tracking services
      // Example: Sentry, DataDog, etc.
    }
  }

  debug(message, context = {}) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.output(LogLevel.DEBUG, message, context);
    }
  }

  info(message, context = {}) {
    if (this.shouldLog(LogLevel.INFO)) {
      this.output(LogLevel.INFO, message, context);
    }
  }

  warn(message, context = {}) {
    if (this.shouldLog(LogLevel.WARN)) {
      this.output(LogLevel.WARN, message, context);
    }
  }

  error(message, error = null, context = {}) {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.output(LogLevel.ERROR, message, context, error);
    }
  }

  getRecentLogs(level = null) {
    if (level !== null) {
      return this.logBuffer.filter(entry => entry.level === level);
    }
    return [...this.logBuffer];
  }

  clearBuffer() {
    this.logBuffer = [];
  }
}

const loggerInstance = new ServerLogger();

// Export convenience functions
export const logger = loggerInstance;
export const log = {
  debug: (message, context) => loggerInstance.debug(message, context),
  info: (message, context) => loggerInstance.info(message, context),
  warn: (message, context) => loggerInstance.warn(message, context),
  error: (message, error, context) => loggerInstance.error(message, error, context),
};

