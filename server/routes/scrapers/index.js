/**
 * Scrapers route barrel — aggregates all scraper sub-routers.
 * Mount this in index.js as: app.use("/api", scrapersRouter)
 *
 * Route groups:
 *  scraper-cache  →  /api/scrape-episode, /api/scraper-cache/*
 *  nineanime      →  /api/test-*, /api/resolve-slug, /api/batch-resolve-slugs,
 *                    /api/scrape-all-episodes, /api/batch-scrape-episodes(-stream)
 *  reanime        →  /api/scrape-reanime-episode, /api/batch-scrape-reanime-episodes-stream
 *  cinevo         →  /api/scrape-cinevo-episode
 *  sanjianime     →  /api/scrape-sanjianime-episode, /api/batch-scrape-sanjianime-episodes-stream
 *  animesuge      →  /api/scrape-animesuge-episode, /api/batch-scrape-animesuge-episodes-stream
 */
import express from "express";
import scraperCacheRouter from "./scraper-cache.js";
import nineAnimeRouter from "./nineanime.js";
import reAnimeRouter from "./reanime.js";
import cinevoRouter from "./cinevo.js";
import sanjiAnimeRouter from "./sanjianime.js";
import animeSugeRouter from "./animesuge.js";

const router = express.Router();

router.use(scraperCacheRouter);
router.use(nineAnimeRouter);
router.use(reAnimeRouter);
router.use(cinevoRouter);
router.use(sanjiAnimeRouter);
router.use(animeSugeRouter);

export default router;
