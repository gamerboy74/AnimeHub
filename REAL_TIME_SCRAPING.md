# Real-Time Episode Scraping Progress

## Overview
The scraping system now supports real-time progress updates, showing you live status for each episode as it's being scraped.

## How It Works

### Backend (Server-Sent Events)
New streaming endpoint: `/api/batch-scrape-episodes-stream`

**Event Types:**
1. **start** - Scraping begins
   ```json
   {
     "type": "start",
     "total": 5,
     "animeTitle": "One Piece"
   }
   ```

2. **progress** - Episode is being scraped
   ```json
   {
     "type": "progress",
     "episode": 1,
     "current": 1,
     "total": 5,
     "status": "scraping"
   }
   ```

3. **success** - Episode scraped successfully
   ```json
   {
     "type": "success",
     "episode": 1,
     "current": 1,
     "total": 5,
     "url": "https://...",
     "title": "Episode 1: The Beginning"
   }
   ```

4. **error** - Episode failed
   ```json
   {
     "type": "error",
     "episode": 2,
     "current": 2,
     "total": 5,
     "error": "Timeout"
   }
   ```

5. **complete** - All episodes processed
   ```json
   {
     "type": "complete",
     "successCount": 4,
     "errorCount": 1,
     "total": 5,
     "successRate": 80
   }
   ```

### Frontend (React Component)
The admin scraper component now displays live progress messages:

**Progress Messages Display:**
- 🎬 Starting to scrape X episodes...
- 📺 Scraping episode 1 (1/5)...
- ✅ Episode 1 scraped successfully!
- 📺 Scraping episode 2 (2/5)...
- ✅ Episode 2 scraped successfully!
- 📺 Scraping episode 3 (3/5)...
- ❌ Episode 3 failed: Timeout
- ...
- 🎉 Batch scraping completed!
- ✅ Success: 4/5
- ❌ Errors: 1/5
- 📊 Success rate: 80%

**Progress Counter:**
Shows live stats in the header: `3/5 episodes - ✅ 2 ❌ 1`

## Usage

### 1. Admin Panel
1. Go to Admin Panel → HiAnime Scraper
2. Select an anime (or enter title + ID)
3. Enter episode range (e.g., `1-5` or `1,3,5`)
4. Click "📺 Batch Scrape"
5. Watch real-time progress appear below!

### 2. API Direct Usage
```javascript
// Using the service
await HiAnimeScraperService.batchScrapeEpisodesWithProgress(
  'One Piece',
  'anime-id-uuid',
  [1, 2, 3, 4, 5],
  (event) => {
    console.log(`[${event.type}]`, event);
    
    if (event.type === 'success') {
      console.log(`✅ Episode ${event.episode} scraped!`);
    }
    
    if (event.type === 'error') {
      console.log(`❌ Episode ${event.episode} failed: ${event.error}`);
    }
    
    if (event.type === 'complete') {
      console.log(`🎉 Done! ${event.successCount}/${event.total} successful`);
    }
  },
  {
    timeout: 30000,
    retries: 2,
    delayBetweenEpisodes: 3000
  }
);
```

### 3. Direct HTTP Request
```bash
curl -X POST http://localhost:3001/api/batch-scrape-episodes-stream \
  -H "Content-Type: application/json" \
  -d '{
    "animeTitle": "One Piece",
    "animeId": "your-anime-uuid",
    "episodeNumbers": [1, 2, 3],
    "options": {
      "timeout": 30000,
      "retries": 2,
      "delayBetweenEpisodes": 2000
    }
  }'
```

The response will be a stream of Server-Sent Events:
```
data: {"type":"start","total":3,"animeTitle":"One Piece"}

data: {"type":"progress","episode":1,"current":1,"total":3,"status":"scraping"}

data: {"type":"success","episode":1,"current":1,"total":3,"url":"https://..."}

data: {"type":"progress","episode":2,"current":2,"total":3,"status":"scraping"}

data: {"type":"success","episode":2,"current":2,"total":3,"url":"https://..."}

data: {"type":"complete","successCount":2,"errorCount":0,"total":3,"successRate":100}
```

## Technical Details

### Server Implementation
- Uses `res.setHeader('Content-Type', 'text/event-stream')` for SSE
- Writes progress events as `data: {json}\n\n` format
- Maintains connection until all episodes are processed
- Gracefully handles errors and timeouts

### Client Implementation
- Uses Fetch API with ReadableStream
- Parses SSE format: `data: {json}\n\n`
- Updates React state for each event
- Displays progress in real-time UI component

### Benefits
1. **User Experience**: See exactly what's happening
2. **Debugging**: Identify which episodes fail immediately
3. **Transparency**: No more "waiting blindly"
4. **Control**: Can monitor long-running operations
5. **Feedback**: Know when to expect completion

## Comparison

### Old Way (Non-Streaming)
```
[User clicks "Batch Scrape"]
[... 2 minutes of silence ...]
[All results appear at once]
```

### New Way (Streaming)
```
[User clicks "Batch Scrape"]
🎬 Starting to scrape 5 episodes...
📺 Scraping episode 1 (1/5)...
✅ Episode 1 scraped successfully!
📺 Scraping episode 2 (2/5)...
✅ Episode 2 scraped successfully!
... (live updates every few seconds)
🎉 Batch scraping completed!
```

## Browser Compatibility
- ✅ Chrome/Edge (all versions)
- ✅ Firefox (all versions)
- ✅ Safari 15+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

Server-Sent Events (SSE) is widely supported across all modern browsers.

## Troubleshooting

### Progress Not Showing
1. Check Docker container is running: `docker ps`
2. Check server logs: `docker logs animehub-server`
3. Verify backend URL in `.env`: `VITE_BACKEND_URL=http://localhost:3001`
4. Check browser console for errors

### Events Delayed
- This is normal! Episodes take 5-30 seconds each to scrape
- Default delay between episodes: 2-3 seconds
- Network and scraping complexity affect timing

### Connection Closes Early
- Check server timeout settings
- Verify no proxy/firewall blocking SSE
- Check browser console for connection errors

## Future Enhancements
- [ ] Progress bar with percentage
- [ ] Pause/Resume functionality
- [ ] Cancel button to stop scraping
- [ ] Save partial results if cancelled
- [ ] Websocket alternative for bidirectional communication
