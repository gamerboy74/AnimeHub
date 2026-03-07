#!/bin/bash
# Redis Docker Container for AnimeHub

# Stop and remove existing container if it exists
docker stop animehub-redis 2>/dev/null || true
docker rm animehub-redis 2>/dev/null || true

# Run Redis container
docker run -d \
  --name animehub-redis \
  -p 6379:6379 \
  --restart unless-stopped \
  redis:7-alpine \
  redis-server --appendonly yes

echo "✅ Redis container started on port 6379"
echo "Redis URL: redis://localhost:6379"
echo ""
echo "To check logs: docker logs animehub-redis"
echo "To stop: docker stop animehub-redis"
echo "To remove: docker rm animehub-redis"


