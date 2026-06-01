import { redisClient } from './bull-queue.js';
import { supabase } from '../config/supabase.js';

export class StateManager {
  constructor() {
    this.RATE_LIMIT_KEY = 'scheduler:episode:rate-limit';
    this.SCHEDULER_LOCK_KEY = 'scheduler:episode:lock';
    this.SCRAPER_STATS_PREFIX = 'scraper:stats:';
    this.RATE_LIMIT_TTL = 3600; // 1 hour
    this.LOCK_TTL = 300; // 5 minutes
    this.LOGS_KEY = 'scheduler:logs';
    this.CONSECUTIVE_FAILURES_PREFIX = 'scraper:consecutive_failures:';
  }

  /**
   * Attempt to acquire distributed lock (prevents concurrent scheduler runs)
   */
  async acquireLock() {
    const locked = await redisClient.set(
      this.SCHEDULER_LOCK_KEY,
      Date.now().toString(),
      {
        EX: this.LOCK_TTL,
        NX: true, // Only set if doesn't exist
      }
    );
    return locked === 'OK';
  }

  /**
   * Release the scheduler lock
   */
  async releaseLock() {
    await redisClient.del(this.SCHEDULER_LOCK_KEY);
  }

  /**
   * Check if scheduler is already running
   */
  async isLocked() {
    const exists = await redisClient.exists(this.SCHEDULER_LOCK_KEY);
    return exists === 1;
  }

  /**
   * Increment rate limit counter (returns new count)
   */
  async incrementRateLimit() {
    const count = await redisClient.incr(this.RATE_LIMIT_KEY);
    if (count === 1) {
      // First increment in this window, set expiry
      await redisClient.expire(this.RATE_LIMIT_KEY, this.RATE_LIMIT_TTL);
    }
    return count;
  }

  /**
   * Get current rate limit count
   */
  async getRateLimitCount() {
    const count = await redisClient.get(this.RATE_LIMIT_KEY);
    return parseInt(count || '0');
  }

  /**
   * Get rate limit status (used/limit + resetIn)
   */
  async getRateLimitStatus(limit = 30) {
    const used = await this.getRateLimitCount();
    const ttl = await redisClient.ttl(this.RATE_LIMIT_KEY);
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetIn: ttl > 0 ? ttl : 0,
    };
  }

  /**
   * Record a scraper success
   */
  async recordScraperSuccess(scraperName, responseTimeMs) {
    const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
    await redisClient.hIncrBy(key, 'success', 1);
    await redisClient.hIncrBy(key, 'totalMs', responseTimeMs);
    await redisClient.expire(key, 86400); // Keep for 24h

    // Reset consecutive failures
    const consecutiveKey = `${this.CONSECUTIVE_FAILURES_PREFIX}${scraperName}`;
    await redisClient.set(consecutiveKey, '0');
  }

  /**
   * Record a scraper failure
   */
  async recordScraperFailure(scraperName, errorType) {
    const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
    await redisClient.hIncrBy(key, 'failure', 1);
    await redisClient.hIncrBy(key, `error:${errorType}`, 1);
    await redisClient.expire(key, 86400);

    // Track consecutive failures
    const consecutiveKey = `${this.CONSECUTIVE_FAILURES_PREFIX}${scraperName}`;
    const consecutiveFailures = await redisClient.incr(consecutiveKey);
    await redisClient.expire(consecutiveKey, 86400);

    if (consecutiveFailures >= 5) {
      // Reset the failure counter so we don't trigger repeatedly
      await redisClient.set(consecutiveKey, '0');

      // Log the consecutive failures warning without automatically disabling it
      const displayName = scraperName.toUpperCase();
      await this.addLog(
        'warn',
        `${displayName} detected 5 consecutive failures/blocks (auto-disabling bypassed).`
      );
    }

    return consecutiveFailures;
  }

  /**
   * Add a system log entry
   */
  async addLog(level, message) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level, // 'success' | 'warn' | 'error' | 'info'
      message,
    };
    await redisClient.lPush(this.LOGS_KEY, JSON.stringify(logEntry));
    await redisClient.lTrim(this.LOGS_KEY, 0, 99); // Keep last 100 logs
  }

  /**
   * Get recent system log entries
   */
  async getLogs() {
    const logs = await redisClient.lRange(this.LOGS_KEY, 0, -1);
    return logs.map(l => JSON.parse(l));
  }

  /**
   * Clear system log entries
   */
  async clearLogs() {
    await redisClient.del(this.LOGS_KEY);
  }

  /**
   * Get scraper stats
   */
  async getScraperStats(scraperName) {
    const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
    const stats = await redisClient.hGetAll(key);
    if (Object.keys(stats).length === 0) {
      return { success: 0, failure: 0, totalMs: 0, successRate: 100 };
    }

    const success = parseInt(stats.success || '0');
    const failure = parseInt(stats.failure || '0');
    const total = success + failure;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

    return {
      success,
      failure,
      totalMs: parseInt(stats.totalMs || '0'),
      successRate,
      avgResponseTime: Math.round(
        parseInt(stats.totalMs || '0') / Math.max(1, success)
      ),
      errors: Object.entries(stats)
        .filter(([k]) => k.startsWith('error:'))
        .reduce((acc, [k, v]) => ({ ...acc, [k.replace('error:', '')]: parseInt(v) }), {}),
    };
  }

  /**
   * Get all scraper stats
   */
  async getAllScraperStats(scrapers = ['cinevo', 'animesuge', 'sanjianime', 'reanime', 'nineanime']) {
    const results = {};
    for (const scraper of scrapers) {
      results[scraper] = await this.getScraperStats(scraper);
    }
    return results;
  }

  /**
   * Reset rate limit (admin operation)
   */
  async resetRateLimit() {
    await redisClient.del(this.RATE_LIMIT_KEY);
  }

  /**
   * Clear all scraper stats (admin operation)
   */
  async clearScraperStats() {
    const keys = await redisClient.keys(`${this.SCRAPER_STATS_PREFIX}*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
    // Also reset consecutive failure keys
    const consecutiveKeys = await redisClient.keys(`${this.CONSECUTIVE_FAILURES_PREFIX}*`);
    if (consecutiveKeys.length > 0) {
      await redisClient.del(consecutiveKeys);
    }
  }
}

export default new StateManager();
