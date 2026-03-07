/**
 * Server-side Environment Configuration
 * Validates and provides type-safe access to environment variables
 */

function validateEnv() {
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
}

function getEnvConfig() {
  // Validate in non-production environments
  if (process.env.NODE_ENV !== 'production') {
    try {
      validateEnv();
    } catch (error) {
      console.warn('⚠️  Environment validation warning:', error.message);
    }
  }
  
  return {
    // Supabase
    supabaseUrl: process.env.VITE_SUPABASE_URL || '',
    supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    
    // Server
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    
    // Redis
    redisUrl: process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL,
    inMemoryMaxEntries: parseInt(process.env.IN_MEMORY_MAX_ENTRIES || '500', 10),
    
    // Scraper
    scraperMaxConcurrency: parseInt(process.env.SCRAPER_MAX_CONCURRENCY || '2', 10),
    scraperBreakerThreshold: parseInt(process.env.SCRAPER_BREAKER_THRESHOLD || '8', 10),
    scraperBreakerCooldownMs: parseInt(process.env.SCRAPER_BREAKER_COOLDOWN_MS || '30000', 10),
  };
}

const env = getEnvConfig();

// Log configuration on startup (development only)
if (env.nodeEnv !== 'production') {
  console.log('📋 Environment Configuration:');
  console.log(`   Node Env: ${env.nodeEnv}`);
  console.log(`   Port: ${env.port}`);
  console.log(`   Redis: ${env.redisUrl ? '✅ Configured' : '❌ Not configured (using in-memory cache)'}`);
  console.log(`   Scraper Concurrency: ${env.scraperMaxConcurrency}`);
}

export default env;

