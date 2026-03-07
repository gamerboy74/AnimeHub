# Redis Docker Container for AnimeHub (PowerShell)

# Stop and remove existing container if it exists
docker stop animehub-redis 2>$null
docker rm animehub-redis 2>$null

# Run Redis container
docker run -d `
  --name animehub-redis `
  -p 6379:6379 `
  --restart unless-stopped `
  redis:7-alpine `
  redis-server --appendonly yes

Write-Host "✅ Redis container started on port 6379" -ForegroundColor Green
Write-Host "Redis URL: redis://localhost:6379" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check logs: docker logs animehub-redis"
Write-Host "To stop: docker stop animehub-redis"
Write-Host "To remove: docker rm animehub-redis"


