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
    this.COOLDOWN_PREFIX = 'scraper:cooldown:';

    // Local in-memory fallbacks for development/offline environments
    this.localLock = null;
    this.localRateLimitCount = 0;
    this.localRateLimitExpiry = 0;
    this.localScraperStats = new Map();
    this.localConsecutiveFailures = new Map();
    this.localCooldowns = new Map();
    this.localLogs = [];
  }

  /**
   * Attempt to acquire distributed lock (prevents concurrent scheduler runs)
   */
  async acquireLock() {
    if (redisClient.isOpen) {
      try {
        const locked = await redisClient.set(
          this.SCHEDULER_LOCK_KEY,
          Date.now().toString(),
          {
            EX: this.LOCK_TTL,
            NX: true, // Only set if doesn't exist
          }
        );
        return locked === 'OK';
      } catch (err) {
        console.warn('⚠️ Redis acquireLock failed, falling back to local memory lock:', err.message);
      }
    }

    // Local in-memory lock fallback
    if (!this.localLock || Date.now() > this.localLock) {
      this.localLock = Date.now() + this.LOCK_TTL * 1000;
      return true;
    }
    return false;
  }

  /**
   * Release the scheduler lock
   */
  async releaseLock() {
    if (redisClient.isOpen) {
      try {
        await redisClient.del(this.SCHEDULER_LOCK_KEY);
        return;
      } catch (err) {
        console.warn('⚠️ Redis releaseLock failed:', err.message);
      }
    }
    this.localLock = null;
  }

  /**
   * Check if scheduler is already running
   */
  async isLocked() {
    if (redisClient.isOpen) {
      try {
        const exists = await redisClient.exists(this.SCHEDULER_LOCK_KEY);
        return exists === 1;
      } catch (err) {
        console.warn('⚠️ Redis isLocked failed:', err.message);
      }
    }
    return !!this.localLock && Date.now() <= this.localLock;
  }

  /**
   * Increment rate limit counter (returns new count)
   */
  async incrementRateLimit() {
    if (redisClient.isOpen) {
      try {
        const count = await redisClient.incr(this.RATE_LIMIT_KEY);
        if (count === 1) {
          await redisClient.expire(this.RATE_LIMIT_KEY, this.RATE_LIMIT_TTL);
        }
        return count;
      } catch (err) {
        console.warn('⚠️ Redis incrementRateLimit failed:', err.message);
      }
    }

    // Local in-memory rate-limiter fallback
    if (Date.now() > this.localRateLimitExpiry) {
      this.localRateLimitCount = 0;
      this.localRateLimitExpiry = Date.now() + this.RATE_LIMIT_TTL * 1000;
    }
    this.localRateLimitCount++;
    return this.localRateLimitCount;
  }

  /**
   * Decrement rate limit counter by 1 (used to undo an overshoot in atomic check)
   */
  async decrementRateLimit() {
    if (redisClient.isOpen) {
      try {
        const count = await redisClient.decr(this.RATE_LIMIT_KEY);
        // Never let it go below 0
        if (count < 0) await redisClient.set(this.RATE_LIMIT_KEY, '0');
        return Math.max(0, count);
      } catch (err) {
        console.warn('⚠️ Redis decrementRateLimit failed:', err.message);
      }
    }
    this.localRateLimitCount = Math.max(0, this.localRateLimitCount - 1);
    return this.localRateLimitCount;
  }

  /**
   * Get current rate limit count
   */
  async getRateLimitCount() {
    if (redisClient.isOpen) {
      try {
        const count = await redisClient.get(this.RATE_LIMIT_KEY);
        return parseInt(count || '0');
      } catch (err) {
        console.warn('⚠️ Redis getRateLimitCount failed:', err.message);
      }
    }

    if (Date.now() > this.localRateLimitExpiry) {
      return 0;
    }
    return this.localRateLimitCount;
  }

  /**
   * Get rate limit status (used/limit + resetIn)
   */
  async getRateLimitStatus(limit = 30) {
    const used = await this.getRateLimitCount();
    let ttl = 0;

    if (redisClient.isOpen) {
      try {
        ttl = await redisClient.ttl(this.RATE_LIMIT_KEY);
      } catch (err) {
        console.warn('⚠️ Redis ttl failed:', err.message);
        ttl = Math.max(0, Math.ceil((this.localRateLimitExpiry - Date.now()) / 1000));
      }
    } else {
      ttl = Math.max(0, Math.ceil((this.localRateLimitExpiry - Date.now()) / 1000));
    }

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
    // Reset local consecutive failures and remove cooldown
    this.localConsecutiveFailures.set(scraperName, 0);
    this.localCooldowns.delete(scraperName);

    if (redisClient.isOpen) {
      try {
        const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
        await redisClient.hIncrBy(key, 'success', 1);
        await redisClient.hIncrBy(key, 'totalMs', responseTimeMs);
        await redisClient.expire(key, 86400); // Keep for 24h

        // Reset consecutive failures
        const consecutiveKey = `${this.CONSECUTIVE_FAILURES_PREFIX}${scraperName}`;
        await redisClient.set(consecutiveKey, '0');

        // Remove active cooldown from Redis if exists
        const cooldownKey = `${this.COOLDOWN_PREFIX}${scraperName}`;
        await redisClient.del(cooldownKey);
      } catch (err) {
        console.warn(`⚠️ Redis recordScraperSuccess failed for ${scraperName}:`, err.message);
      }
    }

    // Local statistics tracking
    if (!this.localScraperStats.has(scraperName)) {
      this.localScraperStats.set(scraperName, { success: 0, failure: 0, totalMs: 0 });
    }
    const stats = this.localScraperStats.get(scraperName);
    stats.success++;
    stats.totalMs += responseTimeMs;
  }

  /**
   * Record a scraper failure
   */
  async recordScraperFailure(scraperName, errorType) {
    // Local consecutive failures tracking
    const localFailures = (this.localConsecutiveFailures.get(scraperName) || 0) + 1;
    this.localConsecutiveFailures.set(scraperName, localFailures);

    let consecutiveFailures = localFailures;

    if (redisClient.isOpen) {
      try {
        const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
        await redisClient.hIncrBy(key, 'failure', 1);
        await redisClient.hIncrBy(key, `error:${errorType}`, 1);
        await redisClient.expire(key, 86400);

        // Track consecutive failures in Redis
        const consecutiveKey = `${this.CONSECUTIVE_FAILURES_PREFIX}${scraperName}`;
        consecutiveFailures = await redisClient.incr(consecutiveKey);
        await redisClient.expire(consecutiveKey, 86400);
      } catch (err) {
        console.warn(`⚠️ Redis recordScraperFailure failed for ${scraperName}:`, err.message);
      }
    }

    // Local statistics tracking
    if (!this.localScraperStats.has(scraperName)) {
      this.localScraperStats.set(scraperName, { success: 0, failure: 0, totalMs: 0 });
    }
    const stats = this.localScraperStats.get(scraperName);
    stats.failure++;

    if (consecutiveFailures >= 5) {
      // Clear consecutive counter to avoid repeating warnings
      this.localConsecutiveFailures.set(scraperName, 0);
      if (redisClient.isOpen) {
        try {
          const consecutiveKey = `${this.CONSECUTIVE_FAILURES_PREFIX}${scraperName}`;
          await redisClient.set(consecutiveKey, '0');
        } catch { }
      }

      // Activate temporary scraper cooldown / Circuit Breaker (30 minutes)
      await this.setCooldown(scraperName);
    }

    return consecutiveFailures;
  }

  /**
   * Check if a scraper is cooling down
   */
  async isCoolingDown(scraperName) {
    const key = `${this.COOLDOWN_PREFIX}${scraperName}`;
    let isRedisCooling = false;
    let redisResetIn = 0;

    if (redisClient.isOpen) {
      try {
        const expiryTimeStr = await redisClient.get(key);
        if (expiryTimeStr) {
          const expiryTime = parseInt(expiryTimeStr);
          const remaining = expiryTime - Date.now();
          if (remaining > 0) {
            isRedisCooling = true;
            redisResetIn = remaining;
          } else {
            await redisClient.del(key);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Failed to check cooldown in Redis for ${scraperName}:`, err.message);
      }
    }

    // Always fallback / coordinate with local memory
    const localExpiry = this.localCooldowns.get(scraperName);
    let isLocalCooling = false;
    let localResetIn = 0;
    if (localExpiry) {
      const remaining = localExpiry - Date.now();
      if (remaining > 0) {
        isLocalCooling = true;
        localResetIn = remaining;
      } else {
        this.localCooldowns.delete(scraperName);
      }
    }

    const coolingDown = isRedisCooling || isLocalCooling;
    const resetInMs = Math.max(redisResetIn, localResetIn);

    return {
      coolingDown,
      resetInMs,
    };
  }

  /**
   * Set cooldown for a scraper (30 minutes)
   */
  async setCooldown(scraperName) {
    const cooldownMs = 30 * 60 * 1000;
    const expiryTime = Date.now() + cooldownMs;
    const key = `${this.COOLDOWN_PREFIX}${scraperName}`;

    // Update local memory
    this.localCooldowns.set(scraperName, expiryTime);

    if (redisClient.isOpen) {
      try {
        await redisClient.set(key, expiryTime.toString(), {
          EX: 1800, // 30 minutes in seconds
        });
      } catch (err) {
        console.warn(`⚠️ Failed to set cooldown in Redis for ${scraperName}:`, err.message);
      }
    }

    const displayName = scraperName.toUpperCase();
    await this.addLog(
      'warn',
      `🚨 [Circuit Breaker] ${displayName} cooling down for 30 minutes due to 5 consecutive failures.`
    );
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

    // Add to local array
    this.localLogs.unshift(logEntry);
    if (this.localLogs.length > 100) {
      this.localLogs.pop();
    }

    if (redisClient.isOpen) {
      try {
        await redisClient.lPush(this.LOGS_KEY, JSON.stringify(logEntry));
        await redisClient.lTrim(this.LOGS_KEY, 0, 99); // Keep last 100 logs
      } catch (err) {
        console.warn('⚠️ Redis addLog failed:', err.message);
      }
    }
  }

  /**
   * Get recent system log entries
   */
  async getLogs() {
    if (redisClient.isOpen) {
      try {
        const logs = await redisClient.lRange(this.LOGS_KEY, 0, -1);
        return logs.map(l => JSON.parse(l));
      } catch (err) {
        console.warn('⚠️ Redis getLogs failed, returning local logs:', err.message);
      }
    }
    return this.localLogs;
  }

  /**
   * Clear system log entries
   */
  async clearLogs() {
    this.localLogs = [];
    if (redisClient.isOpen) {
      try {
        await redisClient.del(this.LOGS_KEY);
      } catch (err) {
        console.warn('⚠️ Redis clearLogs failed:', err.message);
      }
    }
  }

  /**
   * Get scraper stats
   */
  async getScraperStats(scraperName) {
    let success = 0;
    let failure = 0;
    let totalMs = 0;
    let errors = {};

    if (redisClient.isOpen) {
      try {
        const key = `${this.SCRAPER_STATS_PREFIX}${scraperName}`;
        const stats = await redisClient.hGetAll(key);
        if (Object.keys(stats).length > 0) {
          success = parseInt(stats.success || '0');
          failure = parseInt(stats.failure || '0');
          totalMs = parseInt(stats.totalMs || '0');
          errors = Object.entries(stats)
            .filter(([k]) => k.startsWith('error:'))
            .reduce((acc, [k, v]) => ({ ...acc, [k.replace('error:', '')]: parseInt(v) }), {});
        }
      } catch (err) {
        console.warn(`⚠️ Redis getScraperStats failed for ${scraperName}:`, err.message);
      }
    }

    // Merge or fallback to local metrics if empty
    if (success === 0 && failure === 0) {
      const local = this.localScraperStats.get(scraperName);
      if (local) {
        success = local.success;
        failure = local.failure;
        totalMs = local.totalMs;
      }
    }

    const total = success + failure;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 100;

    return {
      success,
      failure,
      totalMs,
      successRate,
      avgResponseTime: Math.round(totalMs / Math.max(1, success)),
      errors,
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
    this.localRateLimitCount = 0;
    this.localRateLimitExpiry = 0;
    if (redisClient.isOpen) {
      try {
        await redisClient.del(this.RATE_LIMIT_KEY);
      } catch (err) {
        console.warn('⚠️ Redis resetRateLimit failed:', err.message);
      }
    }
  }

  /**
   * Clear all scraper stats (admin operation)
   */
  async clearScraperStats() {
    this.localScraperStats.clear();
    this.localConsecutiveFailures.clear();
    this.localCooldowns.clear();

    if (redisClient.isOpen) {
      try {
        // --- FIX: Use SCAN instead of KEYS to avoid blocking Redis during iteration ---
        // KEYS is O(N) and holds a global lock while scanning — SCAN is incremental and safe.
        const prefixes = [
          this.SCRAPER_STATS_PREFIX,
          this.CONSECUTIVE_FAILURES_PREFIX,
          this.COOLDOWN_PREFIX,
        ];

        for (const prefix of prefixes) {
          let cursor = 0;
          do {
            const reply = await redisClient.scan(cursor, { MATCH: `${prefix}*`, COUNT: 100 });
            cursor = reply.cursor;
            if (reply.keys.length > 0) {
              await redisClient.del(reply.keys);
            }
          } while (cursor !== 0);
        }
      } catch (err) {
        console.warn('⚠️ Redis clearScraperStats failed:', err.message);
      }
    }
  }
}

export default new StateManager();
