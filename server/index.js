import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import dotenv from "dotenv";
import axios from "axios";
import { promises as fs } from "fs";
import { resolve as resolvePath, join, dirname } from "path";
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
import {
  cacheGet,
  cacheSet,
  cacheInvalidatePattern,
  cacheInvalidateAnime,
  cacheMiddleware
} from "./services/cache.js";

// Re-export core configurations and services for backward compatibility
export {
  supabase,
  cacheGet,
  cacheSet,
  cacheInvalidatePattern,
  cacheInvalidateAnime,
  cacheMiddleware
};

import { enqueue, getBrowser, closeBrowser } from "./services/queue.js";
export { enqueue, getBrowser, closeBrowser };

import { episodeScheduler, newAnimeScheduler } from "./scheduler.js";

// Import modular routes
import resolverRouter from "./routes/resolver.js";
import schedulerRouter from "./routes/scheduler.js";
import scrapersRouter from "./routes/scrapers.js";
import animeRouter from "./routes/anime.js";
import adminRouter from "./routes/admin.js";

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
app.post("/api/perf-metrics", async (req, res) => {
  try {
    const payload = req.body;
    const filePath = resolvePath(process.cwd(), "performance-report.json");
    let existing = [];
    try {
      const content = await fs.readFile(filePath, "utf-8");
      existing = JSON.parse(content);
      if (!Array.isArray(existing)) existing = [];
    } catch { }
    existing.push(payload);
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2));
    res.json({ success: true });
  } catch (e) {
    console.error("perf-metrics write failed", e);
    res.status(500).json({ success: false });
  }
});

// Health check endpoints
app.get("/health", getHealthHandler());
app.get("/api/health", getDetailedHealthHandler(supabase, redis));

// Legacy health endpoint
app.get("/health-old", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "9anime Scraper API",
  });
});

// Register Modular Routers
app.use(resolverRouter);
app.use(schedulerRouter);
app.use(scrapersRouter);
app.use(animeRouter);
app.use(adminRouter);

// Error handling middleware (must be after all routes)
app.use(errorHandler);

// 404 handler (must be last)
app.use(notFoundHandler);

const server = app.listen(PORT, () => {
  console.log(`🚀 AnimeHub Server booting as a standalone bootstrapper on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎬 Scrapers, Resolver, Anime, and Admin routers successfully mounted!`);

  // Start the schedulers
  episodeScheduler.start();
  newAnimeScheduler.start();
});

// Graceful Shutdown Handler
async function gracefulShutdown(signal) {
  console.log(`\n⚠️  ${signal} received. Initiating graceful shutdown...`);

  // 1. Stop schedulers
  console.log("⏱️ Stopping schedulers...");
  episodeScheduler.stop();
  newAnimeScheduler.stop();

  // 2. Close Playwright browser instance
  await closeBrowser();

  // 3. Stop Express HTTP server
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
