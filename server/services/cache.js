import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "..", "..", ".env") });

const inMemoryCache = new Map();
const IN_MEMORY_MAX_ENTRIES = parseInt(
  process.env.IN_MEMORY_MAX_ENTRIES || "1000",
  10
);

export async function cacheGet(key) {
  const entry = inMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inMemoryCache.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet(key, value, ttlMs = 60_000) {
  inMemoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (inMemoryCache.size > IN_MEMORY_MAX_ENTRIES) {
    const toDelete = inMemoryCache.size - IN_MEMORY_MAX_ENTRIES;
    let i = 0;
    for (const k of inMemoryCache.keys()) {
      inMemoryCache.delete(k);
      i++;
      if (i >= toDelete) break;
    }
  }
}

export function cacheInvalidatePattern(pattern) {
  const regex = new RegExp(pattern);
  let count = 0;
  for (const key of inMemoryCache.keys()) {
    if (regex.test(key)) {
      inMemoryCache.delete(key);
      count++;
    }
  }
  if (count > 0) console.log(`🗑️ Invalidated ${count} cache entries matching /${pattern}/`);
}

export function cacheInvalidateAnime(animeId) {
  if (animeId) cacheInvalidatePattern(`episodes.*${animeId}|${animeId}.*episodes`);
  cacheInvalidatePattern('GET:/api/anime');
}

export function cacheMiddleware(ttlMs = 60_000) {
  return async (req, res, next) => {
    if (req.method !== "GET") return next();
    const key = `${req.method}:${req.originalUrl}`;
    try {
      const cached = await cacheGet(key);
      if (cached) {
        res.set("X-Cache", "HIT");
        return res.json(cached);
      }
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        res.set("X-Cache", "MISS");
        try {
          void cacheSet(key, body, ttlMs);
        } catch { }
        return originalJson(body);
      };
      next();
    } catch (err) {
      next();
    }
  };
}
