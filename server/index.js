import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import axios from "axios";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import http from "http";
import https from "https";

import {
  requestIdMiddleware,
  errorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import {
  getHelmetConfig,
  getCorsConfig,
  rateLimiter,
  sanitizeInput,
  validateRequestSize,
} from "./middleware/security.js";
import { getHealthHandler, getDetailedHealthHandler } from "./routes/health.js";
import imageProxyRouter from "./routes/imageProxy.js";

// Get the directory name of the current module (for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (one level up from server/)
dotenv.config({ path: join(__dirname, "..", ".env") });


import { supabase } from "./config/supabase.js";

import { closeBrowser } from "./services/queue.js";

import { productionScheduler } from "./services/production-scheduler.js";
import { connectRedis, disconnectRedis } from "./services/bull-queue.js";

// Import modular routes
import resolverRouter from "./routes/resolver.js";
import schedulerRouter from "./routes/scheduler.js";
import scrapersRouter from "./routes/scrapers/index.js";
import animeRouter from "./routes/anime.js";
import adminRouter from "./routes/admin.js";
import perfMetricsRouter from "./routes/perfMetrics.js";

const app = express();
const PORT = process.env.PORT || 3001;
const redis = null; // Redis disabled

// Global Middlewares
app.use(requestIdMiddleware); // Request ID for error correlation
app.use(helmet(getHelmetConfig())); // Enhanced security headers
app.use((req, res, next) => {
  res.set("Connection", "keep-alive");
  next();
});
app.use(cors(getCorsConfig())); // Configurable CORS
app.use(validateRequestSize()); // Request size validation
app.use(sanitizeInput); // Input sanitization

app.use(
  compression({
    threshold: 4096,
    filter: (req, res) => {
      const url = req.url || "";
      if (url.endsWith(".m3u8") || url.endsWith(".mpd") || url.endsWith(".ts"))
        return false;
      return compression.filter(req, res);
    },
  })
);
app.use(morgan("combined"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Axios Configuration
axios.defaults.timeout = 15000;
axios.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
axios.defaults.httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
});

// General API rate limit
app.use("/api", rateLimiter.middleware(60_000, 60)); // 60 requests per minute

// Image Proxy route - higher rate limit since pages load many images
app.use("/api/image-proxy", rateLimiter.middleware(60_000, 200));
app.use("/api/image-proxy", imageProxyRouter);

// Stricter rate limiting for scraper endpoints
app.use("/api/scrape", rateLimiter.middleware(60_000, 10)); // 10 requests per minute

// Performance metrics collector
app.use("/api/perf-metrics", perfMetricsRouter);

// Health check endpoints
app.get("/health", getHealthHandler());
app.get("/api/health", getDetailedHealthHandler(supabase, redis));


// Register Modular Routers
// IMPORTANT: Public routers MUST come before admin-protected routers.
app.use("/api", resolverRouter);          // Public: /api/resolve-*, /api/video-embed, etc.
app.use("/api/anime", animeRouter);       // Public: /api/anime/* browsing endpoints
app.use("/api", adminRouter);             // Admin: /api/add-scraped-episode, etc.
app.use("/api/admin", adminRouter);       // Admin: /api/admin/* CRUD (anime, episodes, requests)
app.use("/api/scheduler", schedulerRouter); // Admin-only scheduler control
app.use("/api/admin", schedulerRouter);   // Admin: /api/admin/maintenance/scrape-sequential
app.use("/api", scrapersRouter);          // Admin-only scraper endpoints

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// 404 handler (must be last)
app.use(notFoundHandler);

const server = app.listen(PORT, async () => {
  console.log(`🚀 AnimeHub Server booting as a standalone bootstrapper on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎬 Scrapers, Resolver, Anime, and Admin routers successfully mounted!`);

  // Connect to Redis and start the production scheduler
  try {
    await connectRedis();
    await productionScheduler.start();
  } catch (err) {
    console.error('❌ Failed to initialize production scheduler:', err.message);
  }
});

// Graceful Shutdown Handler
async function gracefulShutdown(signal) {
  console.log(`\n⚠️  ${signal} received. Initiating graceful shutdown...`);

  // 1. Stop scheduler
  console.log("⏱️ Stopping scheduler...");
  await productionScheduler.stop();

  // 2. Disconnect Redis
  console.log("🔴 Disconnecting Redis...");
  await disconnectRedis();

  // 3. Close Playwright browser instance
  await closeBrowser();

  // 4. Stop Express HTTP server
  console.log("🕸️ Closing HTTP server connections...");
  server.close(() => {
    console.log("✅ HTTP server closed. Process exiting.");
    process.exit(0);
  });

  // Force exit if server connection close takes too long (e.g. 10s)
  setTimeout(() => {
    console.warn("⚠️ Forced shutdown threshold reached. Exiting immediately.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// Global exception and promise rejection safety handlers for Playwright/CDP target closures.
// When scrapers click server rows, popup ads or redirect windows open and close rapidly,
// which causes Playwright/stealth plugins to throw async unhandled errors (such as
// "Target page, context or browser has been closed" or "cdpSession.send"). We catch and ignore
// these safe-to-ignore errors so the Node.js process does not exit.
const playwrightIgnorePattern = /Target page, context or browser has been closed|Target closed|cdpSession\.send|Protocol error/i;

process.on("unhandledRejection", (reason) => {
  const message = reason?.message || String(reason);
  if (playwrightIgnorePattern.test(message)) {
    console.warn("⚠️ [Playwright-Extra / CDP Warning] Ignored unhandled promise rejection:", message);
    return;
  }
  console.error("🔥 Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  const message = error?.message || String(error);
  if (playwrightIgnorePattern.test(message)) {
    console.warn("⚠️ [Playwright-Extra / CDP Warning] Ignored uncaught exception:", message);
    return;
  }
  console.error("🔥 Uncaught Exception:", error);
  // Only exit if it's a completely unrelated critical error (to let PM2/Docker auto-restart)
  if (!message.includes("playwright") && !message.includes("puppeteer")) {
    process.exit(1);
  }
});

export default app;
