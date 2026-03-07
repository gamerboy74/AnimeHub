/**
 * Environment Configuration Utilities
 * Type-safe environment variable access with validation
 */

interface EnvConfig {
  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
  
  // Server
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  
  // Redis
  redisUrl?: string;
  upstashRedisUrl?: string;
  inMemoryMaxEntries: number;
  
  // Scraper
  scraperMaxConcurrency: number;
  scraperBreakerThreshold: number;
  scraperBreakerCooldownMs: number;
  
  // Frontend Features
  disableConsole: boolean;
  productionMode: boolean;
  enablePerformanceMonitoring: boolean;
  performanceSampleRate: number;
  enableErrorTracking: boolean;
  sentryDsn?: string;
  enableAnalytics: boolean;
  enableServiceWorker: boolean;
  
  // CDN & Media
  cdnUrl?: string;
  enableImageOptimization: boolean;
  imageQuality: number;
  
  // Caching
  cacheTtl: number;
  
  // Database
  dbPoolSize: number;
  dbQueryTimeout: number;
  
  // Video
  enableVideoPreloading: boolean;
  videoBufferSize: number;
  
  // Security
  enableCsp: boolean;
  enableHsts: boolean;
  
  // Build
  enableTreeShaking: boolean;
  enableCodeSplitting: boolean;
  chunkSizeLimit: number;
  
  // Monitoring
  enableRum: boolean;
  rumSampleRate: number;
  
  // Base Path
  basePath: string;
}

/**
 * Validates required environment variables
 */
function validateEnv(): void {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY'
  ];
  
  const missing: string[] = [];
  
  for (const key of required) {
    if (!import.meta.env[key]) {
      missing.push(key);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
}

/**
 * Get environment configuration with type safety
 */
function getEnvConfig(): EnvConfig {
  // Validate required vars in development
  if (import.meta.env.DEV) {
    try {
      validateEnv();
    } catch (error) {
      console.warn('Environment validation warning:', error);
    }
  }
  
  return {
    // Supabase
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    
    // Server (only available on server-side)
    port: parseInt(import.meta.env.PORT || '3001', 10),
    nodeEnv: (import.meta.env.MODE || 'development') as 'development' | 'production' | 'test',
    
    // Redis
    redisUrl: import.meta.env.REDIS_URL,
    upstashRedisUrl: import.meta.env.UPSTASH_REDIS_REST_URL,
    inMemoryMaxEntries: parseInt(import.meta.env.IN_MEMORY_MAX_ENTRIES || '500', 10),
    
    // Scraper
    scraperMaxConcurrency: parseInt(import.meta.env.SCRAPER_MAX_CONCURRENCY || '2', 10),
    scraperBreakerThreshold: parseInt(import.meta.env.SCRAPER_BREAKER_THRESHOLD || '8', 10),
    scraperBreakerCooldownMs: parseInt(import.meta.env.SCRAPER_BREAKER_COOLDOWN_MS || '30000', 10),
    
    // Frontend Features
    disableConsole: import.meta.env.VITE_DISABLE_CONSOLE === 'true',
    productionMode: import.meta.env.VITE_PRODUCTION_MODE === 'true',
    enablePerformanceMonitoring: import.meta.env.VITE_ENABLE_PERFORMANCE_MONITORING !== 'false',
    performanceSampleRate: parseFloat(import.meta.env.VITE_PERFORMANCE_SAMPLE_RATE || '0.1'),
    enableErrorTracking: import.meta.env.VITE_ENABLE_ERROR_TRACKING === 'true',
    sentryDsn: import.meta.env.VITE_SENTRY_DSN,
    enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
    enableServiceWorker: import.meta.env.VITE_ENABLE_SERVICE_WORKER !== 'false',
    
    // CDN & Media
    cdnUrl: import.meta.env.VITE_CDN_URL,
    enableImageOptimization: import.meta.env.VITE_ENABLE_IMAGE_OPTIMIZATION !== 'false',
    imageQuality: parseInt(import.meta.env.VITE_IMAGE_QUALITY || '80', 10),
    
    // Caching
    cacheTtl: parseInt(import.meta.env.VITE_CACHE_TTL || '300000', 10),
    
    // Database
    dbPoolSize: parseInt(import.meta.env.VITE_DB_POOL_SIZE || '10', 10),
    dbQueryTimeout: parseInt(import.meta.env.VITE_DB_QUERY_TIMEOUT || '30000', 10),
    
    // Video
    enableVideoPreloading: import.meta.env.VITE_ENABLE_VIDEO_PRELOADING !== 'false',
    videoBufferSize: parseInt(import.meta.env.VITE_VIDEO_BUFFER_SIZE || '10', 10),
    
    // Security
    enableCsp: import.meta.env.VITE_ENABLE_CSP !== 'false',
    enableHsts: import.meta.env.VITE_ENABLE_HSTS !== 'false',
    
    // Build
    enableTreeShaking: import.meta.env.VITE_ENABLE_TREE_SHAKING !== 'false',
    enableCodeSplitting: import.meta.env.VITE_ENABLE_CODE_SPLITTING !== 'false',
    chunkSizeLimit: parseInt(import.meta.env.VITE_CHUNK_SIZE_LIMIT || '500', 10),
    
    // Monitoring
    enableRum: import.meta.env.VITE_ENABLE_REAL_USER_MONITORING === 'true',
    rumSampleRate: parseFloat(import.meta.env.VITE_RUM_SAMPLE_RATE || '0.05'),
    
    // Base Path
    basePath: import.meta.env.BASE_PATH || '/',
  };
}

/**
 * Server-side environment configuration (uses process.env)
 */
function getServerEnvConfig() {
  return {
    supabaseUrl: process.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
    redisUrl: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL,
    inMemoryMaxEntries: parseInt(process.env.IN_MEMORY_MAX_ENTRIES || '500', 10),
    scraperMaxConcurrency: parseInt(process.env.SCRAPER_MAX_CONCURRENCY || '2', 10),
    scraperBreakerThreshold: parseInt(process.env.SCRAPER_BREAKER_THRESHOLD || '8', 10),
    scraperBreakerCooldownMs: parseInt(process.env.SCRAPER_BREAKER_COOLDOWN_MS || '30000', 10),
  };
}

// Export singleton config instance
export const env = getEnvConfig();
export const serverEnv = typeof process !== 'undefined' ? getServerEnvConfig() : null;

// Validate on module load (development only)
if (import.meta.env.DEV) {
  try {
    validateEnv();
  } catch (error) {
    console.warn('⚠️ Environment validation:', error);
  }
}

export default env;

