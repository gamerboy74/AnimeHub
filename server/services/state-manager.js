import { redisClient } from './bull-queue.js';

export class StateManager {
  constructor() {
    this.RATE_LIMIT_KEY = 'scheduler:episode:rate-limit';
    this.SCHEDULER_LOCK_KEY = 'scheduler:episode:lock';
    this.SCRAPER_STATS_PREFIX = 'scraper:stats:';
    this.RATE_LIMIT_TTL = 3600; // 1 hour
    this.LOCK_TTL = 300; // 5 minutes
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
  }

  /**
   * Record a scraper failure
   */
  async recordScraperFailure(scraperName, errorType) {
    const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
    await redisClient.hIncrBy(key, 'failure', 1);
    await redisClient.hIncrBy(key, `error:${errorType}`, 1);
    await redisClient.expire(key, 86400);
  }

  /**
   * Get scraper stats
   */
  async getScraperStats(scraperName) {
    const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
    const stats = await redisClient.hGetAll(key);
    if (Object.keys(stats).length === 0) {
      return { success: 0, failure: 0, totalMs: 0 };
    }
    return {
      success: parseInt(stats.success || '0'),
      failure: parseInt(stats.failure || '0'),
      totalMs: parseInt(stats.totalMs || '0'),
      avgResponseTime: Math.round(
        parseInt(stats.totalMs || '0') / Math.max(1, parseInt(stats.success || '1'))
      ),
      errors: Object.entries(stats)
        .filter(([k]) => k.startsWith('error:'))
        .reduce((acc, [k, v]) => ({ ...acc, [k.replace('error:', '')]: parseInt(v) }), {}),
    };
  }

  /**
   * Get all scraper stats
   */
  async getAllScraperStats(scrapers = ['gogoanime', 'nineanime', 'animesuge', 'reanime']) {
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
  }
}

export default new StateManager();
