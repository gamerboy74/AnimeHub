# Docker Deployment Guide for AnimeHub

## Overview

AnimeHub uses Docker to containerize the Express backend server and Redis cache. The frontend is served separately (via Vite dev server or static hosting), while the backend runs in Docker for consistent development and deployment.

## Architecture

```
┌─────────────────┐
│   Frontend      │  (Vite/React - Port 5173)
│   (Browser)     │
└────────┬────────┘
         │
         │ HTTP Requests to http://localhost:3001
         ▼
┌─────────────────┐
│  Docker Host    │
│  ┌───────────┐  │
│  │  Server   │  │  (Express - Port 3001)
│  │ Container │◄─┼──Scraping APIs
│  └─────┬─────┘  │
│        │        │
│  ┌─────▼─────┐  │
│  │   Redis   │  │  (Cache - Port 6379)
│  │ Container │  │
│  └───────────┘  │
└─────────────────┘
```

## Quick Start

### 1. Prerequisites

- Docker Desktop installed (Windows/Mac) or Docker Engine (Linux)
- Node.js 18+ (for frontend development)
- `.env` file configured (copy from `.env.example`)

### 2. Start All Services

```powershell
# Start both Redis and Express server
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### 3. Start Frontend

```powershell
# In a separate terminal
npm run dev
```

### 4. Access Application

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001
- **Health Check:** http://localhost:3001/health
- **Redis:** localhost:6379

## Docker Commands

### Start Services

```powershell
# Start in detached mode (background)
docker-compose up -d

# Start with logs visible
docker-compose up

# Start only specific service
docker-compose up -d redis
docker-compose up -d server
```

### Stop Services

```powershell
# Stop all services
docker-compose down

# Stop and remove volumes (clears Redis data)
docker-compose down -v

# Stop specific service
docker-compose stop server
```

### View Logs

```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f server
docker-compose logs -f redis

# Last 50 lines
docker-compose logs --tail=50 server
```

### Rebuild Containers

```powershell
# Rebuild after code changes
docker-compose build

# Rebuild and restart
docker-compose up -d --build

# Force rebuild without cache
docker-compose build --no-cache
```

### Shell Access

```powershell
# Access server container shell
docker-compose exec server sh

# Access Redis CLI
docker-compose exec redis redis-cli

# Check Redis cache
docker-compose exec redis redis-cli KEYS "*"
```

## Development Workflow

### Option 1: Docker Backend + Local Frontend (Recommended)

```powershell
# Terminal 1: Start Docker services
docker-compose up -d

# Terminal 2: Start frontend
npm run dev

# Code changes to frontend auto-reload
# Code changes to backend require rebuild:
docker-compose restart server
```

### Option 2: All Services with Hot Reload

For backend development with hot reload:

```powershell
# Install nodemon in server container
docker-compose exec server npm install -g nodemon

# Or use volume mounting (already configured in docker-compose.yml)
# Server code changes auto-reflect without rebuild
docker-compose restart server
```

### Option 3: Local Development (No Docker)

```powershell
# Start Redis separately
.\scripts\docker\redis.ps1

# Start backend
npm run server

# Start frontend
npm run dev
```

## Environment Configuration

### Development (.env)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_URL=http://localhost:3001
REDIS_URL=redis://localhost:6379
NODE_ENV=development
```

### Docker Internal Networking

When services communicate within Docker:

```env
# In docker-compose.yml, server uses:
REDIS_URL=redis://redis:6379  # Uses service name 'redis'
```

When frontend (browser) connects to backend:

```env
# In .env for frontend:
VITE_BACKEND_URL=http://localhost:3001  # Uses host port
```

## Troubleshooting

### Port Already in Use

```powershell
# Check what's using port 3001
netstat -ano | findstr :3001

# Kill process (replace PID)
taskkill /PID <PID> /F

# Or change port in docker-compose.yml
ports:
  - "3002:3001"  # Host:Container
```

### Container Won't Start

```powershell
# Check logs
docker-compose logs server

# Remove and recreate
docker-compose down
docker-compose up -d --force-recreate

# Check Supabase env vars are set
docker-compose exec server printenv | grep SUPABASE
```

### Redis Connection Failed

```powershell
# Test Redis
docker-compose exec redis redis-cli ping
# Should return: PONG

# Check Redis is running
docker-compose ps redis

# Restart Redis
docker-compose restart redis
```

### Playwright/Browser Issues

```powershell
# Rebuild with fresh Playwright install
docker-compose build --no-cache server
docker-compose up -d server

# Check Chromium is installed
docker-compose exec server which chromium-browser
```

### Performance Issues

```powershell
# Check container resources
docker stats

# Increase Docker memory (Docker Desktop Settings)
# Recommended: 4GB+ RAM for scraping

# Limit concurrent scraping
# In .env:
SCRAPER_MAX_CONCURRENCY=1
```

## Production Deployment

### Build Production Image

```dockerfile
# Build optimized image
docker build -t animehub-server:prod -f Dockerfile .

# Run production container
docker run -d \
  --name animehub-server-prod \
  -p 3001:3001 \
  --env-file .env.production \
  animehub-server:prod
```

### Deploy to Cloud Platforms

#### Railway

```powershell
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

#### Render

1. Connect GitHub repository
2. Select "Docker" deployment
3. Set environment variables
4. Deploy automatically on push

#### AWS ECS / Azure Container Apps

- Push image to ECR/ACR
- Create task definition
- Configure load balancer
- Set environment variables

## Security Considerations

### Production Checklist

- [ ] Use `.env.production` with real secrets
- [ ] Never commit `.env` files to git
- [ ] Set `NODE_ENV=production`
- [ ] Configure CORS for your domain only
- [ ] Enable rate limiting
- [ ] Use HTTPS for backend URL
- [ ] Restrict Redis access
- [ ] Enable Docker health checks
- [ ] Set up monitoring/alerts

### Secrets Management

```powershell
# Use Docker secrets (Docker Swarm)
docker secret create supabase_key supabase_key.txt

# Or use environment variable injection
docker run --env-file .env.production animehub-server
```

## Mobile App Integration

When developing a mobile app:

1. **Backend URL:** Point to public URL, not localhost
   ```env
   VITE_BACKEND_URL=https://your-backend.railway.app
   ```

2. **CORS:** Add mobile app domain to CORS whitelist
   ```javascript
   // server/middleware/security.js
   allowedOrigins: ['https://your-mobile-app.com']
   ```

3. **Authentication:** Use JWT tokens in Authorization header
   ```javascript
   fetch('https://api.example.com/endpoint', {
     headers: {
       'Authorization': `Bearer ${jwtToken}`,
       'Content-Type': 'application/json'
     }
   })
   ```

4. **Network:** Mobile apps can't access `localhost`
   - Deploy backend to cloud service
   - Or use ngrok for testing: `ngrok http 3001`

## Maintenance

### Update Dependencies

```powershell
# Update Docker images
docker-compose pull

# Rebuild with new dependencies
docker-compose build --no-cache
docker-compose up -d
```

### Backup Redis Data

```powershell
# Backup Redis dump
docker-compose exec redis redis-cli SAVE
docker cp animehub-redis:/data/dump.rdb ./backup/

# Restore Redis dump
docker cp ./backup/dump.rdb animehub-redis:/data/
docker-compose restart redis
```

### Clean Up

```powershell
# Remove stopped containers
docker-compose rm

# Remove unused images
docker image prune

# Remove everything (careful!)
docker system prune -a --volumes
```

## Monitoring

### Health Checks

```powershell
# Test health endpoint
curl http://localhost:3001/health

# Check detailed health
curl http://localhost:3001/api/health
```

### Logs

```powershell
# Export logs
docker-compose logs --no-color > logs.txt

# Monitor in real-time
docker-compose logs -f --tail=100
```

## Support

- Docker Documentation: https://docs.docker.com
- Docker Compose: https://docs.docker.com/compose
- Playwright in Docker: https://playwright.dev/docs/docker

## Summary

- ✅ Redis and Express server run in Docker
- ✅ Frontend connects via `http://localhost:3001`
- ✅ Hot reload for frontend development
- ✅ Persistent Redis cache with volumes
- ✅ Easy one-command startup: `docker-compose up -d`
- ✅ Production-ready containerization
