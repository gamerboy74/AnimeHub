import Bull from 'bull';
import { createClient } from 'redis';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Episode scraping queue
export const episodeQueue = new Bull('episodes', {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
  settings: {
    lockDuration: 30000, // 30s lock
    lockRenewTime: 15000, // Renew every 15s
    maxStalledCount: 2,
  },
});

// Redis client for state management
export const redisClient = createClient(redisConfig);

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err.message);
});

redisClient.on('connect', () => {
  console.log('✅ Redis connected');
});

export async function connectRedis() {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    throw err;
  }
}

export async function disconnectRedis() {
  try {
    await redisClient.quit();
    console.log('✅ Redis disconnected gracefully');
  } catch (err) {
    console.error('⚠️ Redis disconnect error:', err.message);
  }
}

// Queue event handlers
episodeQueue.on('completed', (job) => {
  console.log(`✅ Episode job ${job.id} completed: ${job.data.animeId} EP${job.data.episodeNumber}`);
});

episodeQueue.on('failed', (job, err) => {
  const isExhausted = job.attemptsMade >= job.opts.attempts;

  if (isExhausted) {
    // --- Dead letter alert: this job will NOT be retried again ---
    // Log loudly so it's obvious in prod that a scrape has permanently failed.
    console.error(
      `📬 DEAD LETTER — Episode job ${job.id} exhausted all ${job.opts.attempts} attempts and will NOT retry.` +
      ` | anime=${job.data.animeId} EP${job.data.episodeNumber} | Last error: ${err.message}`
    );
  } else {
    console.warn(`❌ Episode job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${err.message}`);
  }
});

episodeQueue.on('error', (err) => {
  console.error('❌ Queue error:', err.message);
});

export default { episodeQueue, redisClient, connectRedis, disconnectRedis };
