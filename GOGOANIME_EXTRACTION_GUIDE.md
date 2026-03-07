# Gogoanime URL Extraction Guide

## What was fixed

1. **Redis Connection Error** - Completely removed Redis dependency. The server now uses an in-memory cache system which is simpler and doesn't require external services.

2. **Improved Gogoanime Scraping** - Enhanced the scraper to better extract megaplay URLs from gogoanime.me.uk pages with multiple fallback methods.

## How to use

### 1. Start the server

```bash
npm run server
```

You should see:
```
✅ Using in-memory cache for performance optimization
🚀 9anime Scraper API running on port 3001
```

### 2. Test gogoanime URL extraction

Use the new test script:

```bash
node scripts/test-gogoanime-extract.js "https://gogoanime.me.uk/episode/your-anime-episode"
```

Example:
```bash
node scripts/test-gogoanime-extract.js "https://gogoanime.me.uk/episode/one-piece-episode-1"
```

### 3. Use the API endpoint directly

**Endpoint:** `POST http://localhost:3001/api/test-gogoanime-extract`

**Request body:**
```json
{
  "gogoanimeUrl": "https://gogoanime.me.uk/episode/one-piece-episode-1"
}
```

**Response:**
```json
{
  "success": true,
  "url": "https://gogoanime.me.uk/episode/one-piece-episode-1",
  "htmlLength": 12345,
  "results": {
    "megaplayUrls": ["https://megaplay.buzz/embed/..."],
    "allIframeUrls": [...],
    "otherVideoUrls": [...]
  },
  "recommended": "https://megaplay.buzz/embed/..."
}
```

## What the scraper does now

The improved scraper uses **multiple extraction methods**:

1. **Direct HTML fetch with regex patterns** - Fetches the gogoanime page HTML and searches for megaplay URLs using multiple patterns
2. **Playwright navigation** - Uses browser automation to access nested iframes
3. **Multiple URL pattern matching** - Tries various patterns to find video sources:
   - Standard iframe src attributes
   - data-src attributes
   - JavaScript variable assignments
   - Direct URL patterns in the HTML

## Testing the full scraper

To test the full episode scraping (which includes gogoanime extraction):

```bash
# Using curl
curl -X POST http://localhost:3001/api/test-scraper \
  -H "Content-Type: application/json" \
  -d '{"animeTitle": "One Piece", "episodeNumber": 1}'

# Or using the test endpoint
curl -X POST http://localhost:3001/api/scrape-episode \
  -H "Content-Type: application/json" \
  -d '{
    "animeTitle": "One Piece",
    "animeId": "your-anime-id",
    "episodeNumber": 1
  }'
```

## Troubleshooting

### If gogoanime URLs are blocked:
- The site might have anti-scraping protection
- Try using a different User-Agent
- Check if the gogoanime URL is accessible in your browser

### If megaplay URLs aren't found:
- The page structure might have changed
- Check the console logs to see what was extracted
- Use the test script to see all URLs found on the page

### Performance tips:
- In-memory cache is set to store 1000 entries by default
- You can increase this by setting `IN_MEMORY_MAX_ENTRIES` environment variable
- Cache TTL is 60 seconds for API responses

## Environment Variables

```bash
# Optional - increase cache size
IN_MEMORY_MAX_ENTRIES=2000

# Scraper settings
SCRAPER_MAX_CONCURRENCY=2
SCRAPER_BREAKER_THRESHOLD=8
SCRAPER_BREAKER_COOLDOWN_MS=30000
```

## Changes Made

### server/index.js
- Removed Redis import and connection logic
- Simplified cache functions to use only in-memory storage
- Enhanced gogoanime URL extraction with multiple patterns
- Added new `/api/test-gogoanime-extract` endpoint

### package.json
- Removed `ioredis` dependency

### New files
- `scripts/test-gogoanime-extract.js` - Test script for gogoanime extraction
