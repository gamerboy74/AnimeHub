# AnimeHub - Anime Streaming Platform

A modern, full-featured anime streaming platform built with React, TypeScript, Vite, and Supabase.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Supabase account and project
- Redis (optional, for caching)

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy `.env.example` to `.env`: `cp .env.example .env`
   - Fill in your actual values in `.env`
   
   **Required Variables:**
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
   
   **Optional Variables:**
   - `REDIS_URL` - Redis connection URL for caching (defaults to in-memory cache)
   - `PORT` - Server port (default: 3001)
   - `SCRAPER_MAX_CONCURRENCY` - Max concurrent scraper requests (default: 2)
   - See `.env.example` for all available configuration options

3. **Set up database:**
   - Open Supabase SQL Editor
   - Run the entire contents of `supabase-database-backup.sql`
   - Create storage buckets in Supabase Dashboard > Storage:
     - `anime-posters` (public)
     - `anime-banners` (public)
     - `anime-thumbnails` (public)
     - `anime-videos` (private)
     - `user-avatars` (public)

4. **Start development:**
   ```bash
   # Start frontend only
   npm run dev

   # Start both frontend and backend
   npm run dev:full
   ```

## 📁 Project Structure

```
animehub/
├── src/                    # Source code
│   ├── components/        # React components
│   ├── pages/             # Page components
│   ├── services/          # API services
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions
│   └── router/            # Routing configuration
├── public/                # Static assets
├── scripts/               # Build and utility scripts
├── server-backend.js      # Express backend server
├── supabase-database-backup.sql  # Complete database schema
└── vite.config.ts        # Vite configuration
```

## 🛠️ Available Scripts

- `npm run dev` - Start development server
- `npm run dev:analyze` - Dev server with bundle analyzer
- `npm run build` - Production build
- `npm run build:analyze` - Build with bundle analysis
- `npm run preview` - Preview production build
- `npm run test:performance` - Run performance tests
- `npm run server` - Start backend server only
- `npm run optimize:images` - Optimize images

## 🗄️ Database

The complete database schema is in `supabase-database-backup.sql`. This file includes:
- All tables (anime, episodes, users, progress, favorites, watchlist, reviews, etc.)
- Indexes for performance
- RLS policies for security
- Functions and triggers
- Materialized views

Simply run the entire SQL file in Supabase SQL Editor to set up the complete database.

## 🎯 Features

- ✅ User authentication and profiles
- ✅ Anime browsing and search
- ✅ Episode streaming
- ✅ Watchlist and favorites
- ✅ Continue watching
- ✅ User reviews and ratings
- ✅ Admin panel
- ✅ Performance optimized
- ✅ Service worker for offline support
- ✅ Responsive design

## 📚 Tech Stack

- **Frontend:** React 19, TypeScript, Vite, React Router, Framer Motion
- **Backend:** Express.js, Playwright, Cheerio
- **Database:** Supabase (PostgreSQL)
- **Caching:** Redis (optional)
- **Build:** Vite, Terser
- **Performance:** React Query, Virtualization, Code splitting

## 🔧 Performance Optimizations

The project includes extensive performance optimizations:
- Route-level code splitting
- React Query for data fetching and caching
- Component memoization
- List virtualization
- Image optimization with srcset
- Service worker caching
- Redis backend caching
- Bundle optimization

## 🔐 Environment Variables

### Required
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anonymous key

### Optional - Server
- `PORT` - Server port (default: 3001)
- `REDIS_URL` - Redis connection URL for caching
- `UPSTASH_REDIS_REST_URL` - Alternative Redis REST API URL
- `IN_MEMORY_MAX_ENTRIES` - Max in-memory cache entries (default: 500)
- `SCRAPER_MAX_CONCURRENCY` - Max concurrent scraper requests (default: 2)
- `SCRAPER_BREAKER_THRESHOLD` - Circuit breaker failure threshold (default: 8)
- `SCRAPER_BREAKER_COOLDOWN_MS` - Circuit breaker cooldown in ms (default: 30000)

### Optional - Frontend Features
- `VITE_DISABLE_CONSOLE` - Disable console logs in production (default: false)
- `VITE_PRODUCTION_MODE` - Enable production optimizations (default: false)
- `VITE_ENABLE_PERFORMANCE_MONITORING` - Enable performance monitoring (default: true)
- `VITE_ENABLE_ERROR_TRACKING` - Enable error tracking (default: false)
- `VITE_SENTRY_DSN` - Sentry DSN for error tracking
- `VITE_ENABLE_SERVICE_WORKER` - Enable service worker caching (default: true)
- `VITE_CACHE_TTL` - Cache TTL in milliseconds (default: 300000)

### Optional - CDN & Media
- `VITE_CDN_URL` - CDN URL for static assets
- `VITE_ENABLE_IMAGE_OPTIMIZATION` - Enable image optimization (default: true)
- `VITE_IMAGE_QUALITY` - Image quality 0-100 (default: 80)

See `.env.example` for the complete list of environment variables.

## 📝 License

Private project

---

For detailed setup instructions, see the individual component documentation.

