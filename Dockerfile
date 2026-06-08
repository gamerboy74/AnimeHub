# AnimeHub Express Server Dockerfile
FROM node:22-alpine

# Install Chromium and dependencies for Playwright/stealth scrapers
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    wget

# Tell Playwright to skip download and use system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /app

# Copy package files first (separate layer — only rebuilds when deps change)
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production

# Copy server source
COPY server/ ./server/

# Expose server port
EXPOSE 3001

# Health check (uses wget which is already installed via apk)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Start server
CMD ["node", "server/index.js"]
