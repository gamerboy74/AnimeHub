# Migration Guide: Console.log to Structured Logging

## Overview
This project now uses a structured logging system. Migrate from `console.log` to the new logger.

## Quick Migration

### Frontend (src/)

**Before:**
```typescript
console.log('Loading anime:', animeId);
console.error('Failed to fetch:', error);
```

**After:**
```typescript
import { log } from '@/utils/logging';

log.info('Loading anime', { animeId });
log.error('Failed to fetch', error);
```

### Backend (server/)

**Before:**
```javascript
console.log('Request received:', req.url);
console.error('Error:', error);
```

**After:**
```javascript
const { log } = require('./utils/logger');

log.info('Request received', { url: req.url });
log.error('Error occurred', error, { url: req.url });
```

## Log Levels

- `log.debug()` - Development debugging (filtered in production)
- `log.info()` - General information
- `log.warn()` - Warnings (important but not errors)
- `log.error()` - Errors (always logged)

## Automated Migration Script

A script will be created to help migrate common patterns. For now, migrate gradually:
1. Start with error logging (`console.error` → `log.error`)
2. Then info logging (`console.log` → `log.info`)
3. Finally debug logging (`console.log` → `log.debug`)

