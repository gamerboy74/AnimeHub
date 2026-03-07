/**
 * Security Middleware
 * Enhanced security headers, rate limiting, and input validation
 */

import { log } from '../utils/logger.js';

/**
 * Enhanced Helmet configuration
 */
function getHelmetConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind requires unsafe-inline
        scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts for video players
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        connectSrc: ["'self'", process.env.VITE_SUPABASE_URL || '', "https:", "wss:"],
        fontSrc: ["'self'", "data:"],
        mediaSrc: ["'self'", "https:", "blob:", "data:"],
        frameSrc: ["'self'", "https:", "http:"], // Allow iframes from any https source
        childSrc: ["'self'", "https:", "blob:"],
        workerSrc: ["'self'", "blob:"],
      },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding for video players
    crossOriginResourcePolicy: false, // Allow loading resources from other origins
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  };
}

/**
 * CORS configuration
 */
function getCorsConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [];
  
  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // In production, check against allowed origins
      if (isProduction && allowedOrigins.length > 0) {
        if (allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          log.warn('CORS blocked origin', { origin });
          callback(new Error('Not allowed by CORS'));
        }
      } else {
        // Development: allow all origins
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'X-Cache'],
    maxAge: 86400, // 24 hours
  };
}

/**
 * Enhanced rate limiter
 */
class RateLimiter {
  constructor() {
    this.windows = new Map();
    this.defaultWindow = 60 * 1000; // 1 minute
    this.defaultMax = 60; // requests per window
  }

  middleware(windowMs = this.defaultWindow, maxRequests = this.defaultMax) {
    return (req, res, next) => {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
      const key = `${ip}:${req.path}`;
      const now = Date.now();

      let entry = this.windows.get(key);
      
      if (!entry || now > entry.resetAt) {
        entry = {
          count: 0,
          resetAt: now + windowMs,
        };
        this.windows.set(key, entry);
      }

      entry.count++;

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': Math.max(0, maxRequests - entry.count),
        'X-RateLimit-Reset': new Date(entry.resetAt).toISOString(),
      });

      if (entry.count > maxRequests) {
        log.warn('Rate limit exceeded', {
          ip,
          path: req.path,
          count: entry.count,
          limit: maxRequests,
        });

        return res.status(429).json({
          success: false,
          error: 'Too many requests, please try again later',
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        });
      }

      next();
    };
  }

  // Cleanup old entries periodically
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.windows.entries()) {
      if (now > entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }
}

// Create singleton rate limiter
const rateLimiter = new RateLimiter();

// Cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);

/**
 * Input sanitization middleware
 */
function sanitizeInput(req, res, next) {
  // Sanitize string inputs (basic XSS prevention)
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .trim();
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    return obj;
  };

  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitize(req.body);
  }
  
  // Note: req.query is read-only in Express, so we skip query parameter sanitization
  // Query parameters are typically simple values (IDs, limits, etc.) and less prone to XSS
  // Body sanitization is more critical and is handled above

  next();
}

/**
 * Request size validation
 */
function validateRequestSize(maxSize = 10 * 1024 * 1024) { // 10MB default
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    
    if (contentLength > maxSize) {
      return res.status(413).json({
        success: false,
        error: `Request too large. Maximum size: ${maxSize / 1024 / 1024}MB`,
      });
    }

    next();
  };
}

export {
  getHelmetConfig,
  getCorsConfig,
  rateLimiter,
  sanitizeInput,
  validateRequestSize,
};

