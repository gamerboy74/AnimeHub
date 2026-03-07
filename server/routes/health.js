/**
 * Health Check Endpoints
 * Provides system health information for monitoring
 */

import { log } from '../utils/logger.js';

function getHealthHandler() {
  return async (req, res) => {
    try {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '0.0.0',
      };

      res.json(health);
    } catch (error) {
      log.error('Health check failed', error);
      res.status(500).json({
        status: 'error',
        message: 'Health check failed',
      });
    }
  };
}

function getDetailedHealthHandler(supabase, redis) {
  return async (req, res) => {
    try {
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '0.0.0',
        services: {},
      };

      // Check Supabase connection
      try {
        const { data, error } = await supabase.from('anime').select('id').limit(1);
        health.services.database = {
          status: error ? 'error' : 'ok',
          error: error?.message,
        };
      } catch (error) {
        health.services.database = {
          status: 'error',
          error: error.message,
        };
      }

      // Check Redis connection
      if (redis) {
        try {
          await redis.ping();
          health.services.cache = {
            status: 'ok',
            type: 'redis',
          };
        } catch (error) {
          health.services.cache = {
            status: 'error',
            type: 'redis',
            error: error.message,
          };
        }
      } else {
        health.services.cache = {
          status: 'ok',
          type: 'in-memory',
        };
      }

      // Determine overall status
      const servicesStatus = Object.values(health.services).map(s => s.status);
      if (servicesStatus.some(s => s === 'error')) {
        health.status = 'degraded';
      }

      const statusCode = health.status === 'ok' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      log.error('Detailed health check failed', error);
      res.status(500).json({
        status: 'error',
        message: 'Health check failed',
      });
    }
  };
}

export {
  getHealthHandler,
  getDetailedHealthHandler,
};

