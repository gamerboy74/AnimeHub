/**
 * Centralized Error Handling Middleware
 * Provides consistent error responses and logging
 */

import { log } from '../utils/logger.js';

/**
 * Request ID middleware for error correlation
 */
let requestIdCounter = 0;
function requestIdMiddleware(req, res, next) {
  req.id = `req-${Date.now()}-${++requestIdCounter}`;
  res.setHeader('X-Request-ID', req.id);
  next();
}

/**
 * Error handler middleware
 */
function errorHandler(err, req, res, next) {
  const requestId = req.id || 'unknown';
  
  // Log error with context
  log.error('Unhandled error', err, {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip || req.headers['x-forwarded-for'],
    userAgent: req.headers['user-agent'],
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || err.statusCode || 500).json({
    success: false,
    error: isDevelopment ? err.message : 'Internal server error',
    requestId,
    ...(isDevelopment && { stack: err.stack }),
  });
}

/**
 * 404 handler
 */
function notFoundHandler(req, res) {
  const requestId = req.id || 'unknown';
  
  log.warn('Route not found', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip || req.headers['x-forwarded-for'],
  });

  res.status(404).json({
    success: false,
    error: 'Not Found',
    requestId,
  });
}

/**
 * Async error wrapper for route handlers
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export {
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
  asyncHandler,
};

