# Deployment Guide

## Pre-Deployment Checklist

### 1. Environment Configuration
- [ ] Copy `.env.example` to `.env` and fill in all required values
- [ ] Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
- [ ] Set `NODE_ENV=production` in production environment
- [ ] Configure Redis URL if using caching
- [ ] Set up error tracking DSN (Sentry, etc.) if enabled

### 2. Database Setup
- [ ] Run `supabase-database-backup.sql` in Supabase SQL Editor
- [ ] Create required storage buckets:
  - `anime-posters` (public)
  - `anime-banners` (public)
  - `anime-thumbnails` (public)
  - `anime-videos` (private)
  - `user-avatars` (public)
- [ ] Verify RLS policies are active
- [ ] Test database connections

### 3. Build & Optimization
- [ ] Run `npm run build` and verify no errors
- [ ] Check bundle sizes with `npm run build:analyze`
- [ ] Verify source maps are disabled in production (or hidden)
- [ ] Test production build locally: `npm run preview`

### 4. Security
- [ ] Review and configure security headers (helmet)
- [ ] Verify rate limiting is configured
- [ ] Check CORS settings for production domains
- [ ] Review API endpoints for authentication requirements
- [ ] Ensure no sensitive data in client-side code

### 5. Performance
- [ ] Run performance tests: `npm run test:performance`
- [ ] Verify Service Worker is registered
- [ ] Check Redis caching is working (if configured)
- [ ] Test CDN configuration (if using)

### 6. Monitoring
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Configure performance monitoring
- [ ] Set up uptime monitoring
- [ ] Configure alerting thresholds

### 7. Testing
- [ ] Test all critical user flows
- [ ] Verify authentication works
- [ ] Test video playback
- [ ] Check admin panel functionality
- [ ] Test on multiple browsers/devices

## Production Build

```bash
# Install dependencies
npm ci

# Build for production
npm run build

# Output will be in `out/` directory
```

## Deployment Options

### Vercel / Netlify (Frontend)

1. Connect your repository
2. Set environment variables in dashboard
3. Build command: `npm run build`
4. Output directory: `out`
5. Node version: 18+

### Docker Deployment

```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "server/index.js"]
```

### Traditional Server

1. Clone repository on server
2. Install dependencies: `npm ci`
3. Build: `npm run build`
4. Run server: `npm run server`
5. Use PM2 or similar for process management:
   ```bash
   pm2 start npm --name "animehub" -- run server
   ```

## Environment Variables

See `.env.example` and README.md for complete list.

**Critical Production Variables:**
- `NODE_ENV=production`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `REDIS_URL` (optional but recommended)

## Health Checks

The server includes health check endpoints:
- `GET /health` - Basic health check
- `GET /api/health` - Detailed health information

## Troubleshooting

### Build Fails
- Check Node.js version (18+)
- Clear cache: `npm run clean:cache`
- Verify all dependencies installed

### Runtime Errors
- Check server logs
- Verify environment variables
- Check database connectivity
- Verify Redis connection (if using)

### Performance Issues
- Enable Redis caching
- Check bundle sizes
- Review database queries
- Monitor server resources

## Post-Deployment

1. Monitor error logs
2. Check performance metrics
3. Verify all features working
4. Test on production URL
5. Set up backups for database

## Rollback Procedure

1. Revert to previous deployment
2. Restore database backup if needed
3. Clear CDN cache if applicable
4. Verify rollback successful

