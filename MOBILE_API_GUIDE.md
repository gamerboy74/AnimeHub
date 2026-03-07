# AnimeHub API Documentation for Mobile Development

## Overview

This document provides complete API documentation for developing mobile applications that integrate with AnimeHub. The backend uses a hybrid architecture with Supabase (primary) and an optional Express server (for scraping).

## Base Architecture

```
Mobile App
    │
    ├─► Supabase APIs (Primary - 80% of features)
    │   ├─ Authentication
    │   ├─ Database CRUD
    │   └─ Storage
    │
    └─► Express Server APIs (Optional - 20% of features)
        └─ Scraping & Caching
```

---

## Authentication

### Auth Method: JWT Tokens

All authenticated requests require a JWT token in the Authorization header:

```http
Authorization: Bearer <jwt_token>
```

### Obtaining Tokens

Use Supabase SDK or REST API:

```javascript
// Using Supabase SDK (Recommended)
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Email/Password Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

// Access token
const token = data.session.access_token
const refreshToken = data.session.refresh_token
```

### Token Lifecycle

- **Access Token:** Valid for 60 minutes
- **Refresh Token:** Valid for 30 days
- **Auto-refresh:** Supabase SDK handles automatically
- **Manual refresh:** Call `supabase.auth.refreshSession()`

---

## API Endpoints

## 1. Supabase APIs (Primary Backend)

### Base URL
```
https://your-project.supabase.co
```

### Authentication Endpoints

#### POST /auth/v1/signup
Register a new user.

**Request:**
```http
POST /auth/v1/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "data": {
    "username": "cooluser"
  }
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "abc123...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "user_metadata": {
      "username": "cooluser"
    }
  }
}
```

#### POST /auth/v1/token
Login with email/password.

**Request:**
```http
POST /auth/v1/token?grant_type=password
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** Same as signup

#### POST /auth/v1/logout
Sign out user.

**Request:**
```http
POST /auth/v1/logout
Authorization: Bearer <token>
```

**Response (204):** No content

#### POST /auth/v1/recover
Request password reset email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

#### GET /auth/v1/user
Get current user info.

**Request:**
```http
GET /auth/v1/user
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "user_metadata": {...},
  "created_at": "2024-01-01T00:00:00Z"
}
```

---

### Database Endpoints

All database endpoints follow PostgREST conventions:

**Base URL:** `https://your-project.supabase.co/rest/v1`

**Required Headers:**
```http
Authorization: Bearer <token>
apikey: <supabase_anon_key>
Content-Type: application/json
```

#### GET /anime
List all anime with optional filters.

**Query Parameters:**
- `select=*` - Fields to return (default: all)
- `limit=20` - Max results (default: no limit)
- `offset=0` - Pagination offset
- `order=created_at.desc` - Sort order
- `genres=cs.{Action}` - Contains genre (cs = contains)
- `status=eq.ongoing` - Filter by status (eq = equals)
- `year=eq.2024` - Filter by year
- `title=ilike.*naruto*` - Search by title (case-insensitive)

**Example Request:**
```http
GET /rest/v1/anime?select=*&limit=20&order=rating.desc&status=eq.ongoing
Authorization: Bearer <token>
apikey: <anon_key>
```

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Attack on Titan",
    "title_japanese": "進撃の巨人",
    "description": "...",
    "poster_url": "https://...",
    "banner_url": "https://...",
    "trailer_url": "https://...",
    "rating": 9.5,
    "year": 2013,
    "status": "completed",
    "type": "tv",
    "genres": ["Action", "Fantasy", "Drama"],
    "studios": ["MAPPA", "Wit Studio"],
    "total_episodes": 87,
    "duration": 24,
    "age_rating": "R",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
]
```

#### GET /anime?id=eq.{uuid}
Get single anime by ID.

**Example:**
```http
GET /rest/v1/anime?id=eq.123e4567-e89b-12d3-a456-426614174000&select=*
```

#### POST /anime
Create new anime (admin only).

**Request:**
```json
{
  "title": "New Anime",
  "description": "...",
  "poster_url": "https://...",
  "rating": 8.5,
  "year": 2024,
  "status": "ongoing",
  "type": "tv",
  "genres": ["Action"],
  "studios": ["Studio A"],
  "total_episodes": 12,
  "duration": 24,
  "age_rating": "PG-13"
}
```

#### PATCH /anime?id=eq.{uuid}
Update anime (admin only).

**Request:**
```json
{
  "rating": 9.0,
  "total_episodes": 24
}
```

#### DELETE /anime?id=eq.{uuid}
Delete anime (admin only).

---

#### GET /episodes
List episodes for an anime.

**Query Parameters:**
- `anime_id=eq.{uuid}` - Filter by anime ID
- `order=episode_number.asc` - Sort by episode number

**Example:**
```http
GET /rest/v1/episodes?anime_id=eq.{uuid}&select=*&order=episode_number.asc
```

**Response:**
```json
[
  {
    "id": "uuid",
    "anime_id": "uuid",
    "episode_number": 1,
    "title": "Episode 1: Beginning",
    "description": "...",
    "thumbnail_url": "https://...",
    "video_url": "https://...",
    "duration": 1440,
    "is_premium": false,
    "air_date": "2024-01-01",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

#### POST /episodes
Create episode (admin only).

#### PATCH /episodes?id=eq.{uuid}
Update episode (admin only).

#### DELETE /episodes?id=eq.{uuid}
Delete episode (admin only).

---

#### GET /user_progress
Get user's watch progress.

**Query:**
```http
GET /rest/v1/user_progress?user_id=eq.{user_uuid}&select=*,episodes(*)
Authorization: Bearer <token>
```

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "episode_id": "uuid",
    "progress_seconds": 720,
    "is_completed": false,
    "last_watched": "2024-01-01T12:00:00Z",
    "episodes": {
      "id": "uuid",
      "title": "Episode 1",
      "episode_number": 1
    }
  }
]
```

#### POST /user_progress
Save watch progress.

**Request:**
```json
{
  "user_id": "uuid",
  "episode_id": "uuid",
  "progress_seconds": 720,
  "is_completed": false
}
```

#### PATCH /user_progress
Update progress (use upsert for idempotent updates).

---

#### GET /user_favorites
Get user's favorites.

**Query:**
```http
GET /rest/v1/user_favorites?user_id=eq.{uuid}&select=*,anime(*)
```

**Response:**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "anime_id": "uuid",
    "created_at": "2024-01-01T00:00:00Z",
    "anime": {
      "id": "uuid",
      "title": "Attack on Titan",
      "poster_url": "..."
    }
  }
]
```

#### POST /user_favorites
Add to favorites.

**Request:**
```json
{
  "user_id": "uuid",
  "anime_id": "uuid"
}
```

#### DELETE /user_favorites?id=eq.{uuid}
Remove from favorites.

---

#### GET /user_watchlist
Get user's watchlist (same pattern as favorites).

#### POST /user_watchlist
Add to watchlist.

#### DELETE /user_watchlist
Remove from watchlist.

---

#### GET /reviews
Get reviews for anime.

**Query:**
```http
GET /rest/v1/reviews?anime_id=eq.{uuid}&select=*,users(username,avatar_url)
```

#### POST /reviews
Create review.

**Request:**
```json
{
  "user_id": "uuid",
  "anime_id": "uuid",
  "rating": 9,
  "review_text": "Amazing anime!",
  "is_spoiler": false
}
```

---

## 2. Express Server APIs (Optional)

### Base URL
```
http://localhost:3001 (Development)
https://your-backend.railway.app (Production)
```

**Note:** These APIs are primarily for admin scraping functionality. **Not required for mobile app user features.**

### Health Endpoints

#### GET /health
Basic health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### GET /api/health
Detailed health with DB/cache status.

**Response:**
```json
{
  "status": "ok",
  "supabase": "connected",
  "redis": "connected",
  "memory": {
    "used": "123MB",
    "total": "512MB"
  }
}
```

---

### Cached Anime Queries (Optional - Faster than Supabase)

#### GET /api/anime/featured
Get featured anime (5 min cache).

**Query Parameters:**
- `limit=5` - Number of results (default: 5)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "...",
      "poster_url": "...",
      "rating": 9.5
    }
  ]
}
```

#### GET /api/anime/trending
Get trending anime (5 min cache).

**Query:** `limit=10`

#### GET /api/anime/popular
Get popular anime (5 min cache).

**Query:** `limit=10`

#### GET /api/anime/recent
Get recently added anime (2 min cache).

**Query:** `limit=20`

#### GET /api/anime/{animeId}/episodes
Get episodes with 30-second cache.

---

### Scraping APIs (Admin Only - Skip for Mobile)

These endpoints are used by the admin panel to scrape anime data. **Not needed for mobile app**.

- POST /api/scrape-episode
- POST /api/scrape-all-episodes
- POST /api/batch-scrape-episodes
- POST /api/add-scraped-episode

---

## Mobile Development Guide

### 1. Setup Supabase SDK

**React Native:**
```bash
npm install @supabase/supabase-js @react-native-async-storage/async-storage
```

**Flutter:**
```bash
flutter pub add supabase_flutter
```

**Swift (iOS):**
```swift
.package(url: "https://github.com/supabase/supabase-swift", from: "2.0.0")
```

**Kotlin (Android):**
```kotlin
implementation("io.github.jan-tennert.supabase:supabase-kt:2.0.0")
```

### 2. Initialize Client

**React Native:**
```javascript
import { createClient } from '@supabase/supabase-js'
import AsyncStorage from '@react-native-async-storage/async-storage'

const supabase = createClient(
  'https://your-project.supabase.co',
  'your-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  }
)
```

### 3. Authentication Flow

```javascript
// Register
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password',
  options: {
    data: { username: 'cooluser' }
  }
})

// Login
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
})

// Get current user
const { data: { user } } = await supabase.auth.getUser()

// Logout
await supabase.auth.signOut()

// Listen to auth changes
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN') console.log('User signed in')
  if (event === 'SIGNED_OUT') console.log('User signed out')
})
```

### 4. Data Fetching

```javascript
// Get anime list
const { data, error } = await supabase
  .from('anime')
  .select('*')
  .eq('status', 'ongoing')
  .order('rating', { ascending: false })
  .limit(20)

// Get anime with episodes
const { data, error } = await supabase
  .from('anime')
  .select('*, episodes(*)')
  .eq('id', animeId)
  .single()

// Get user's favorites
const { data, error } = await supabase
  .from('user_favorites')
  .select('*, anime(*)')
  .eq('user_id', userId)

// Save watch progress (upsert)
const { error } = await supabase
  .from('user_progress')
  .upsert({
    user_id: userId,
    episode_id: episodeId,
    progress_seconds: 720,
    is_completed: false
  }, {
    onConflict: 'user_id,episode_id'
  })
```

### 5. Real-time Subscriptions

```javascript
// Listen to new episodes
const channel = supabase
  .channel('episodes')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'episodes',
    filter: `anime_id=eq.${animeId}`
  }, (payload) => {
    console.log('New episode!', payload.new)
  })
  .subscribe()

// Unsubscribe
channel.unsubscribe()
```

### 6. Error Handling

```javascript
const { data, error } = await supabase
  .from('anime')
  .select('*')

if (error) {
  switch (error.code) {
    case 'PGRST116':
      // No rows found
      break
    case '401':
      // Unauthorized
      break
    case '403':
      // Forbidden
      break
    default:
      console.error('Error:', error.message)
  }
}
```

### 7. Offline Support

```javascript
// Use React Query for caching
import { useQuery } from '@tanstack/react-query'

const { data, isLoading } = useQuery({
  queryKey: ['anime', animeId],
  queryFn: async () => {
    const { data } = await supabase
      .from('anime')
      .select('*')
      .eq('id', animeId)
      .single()
    return data
  },
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 24 * 60 * 60 * 1000 // 24 hours
})
```

---

## Rate Limiting

### Supabase
- **Free Tier:** 500,000 requests/month
- **Pro Tier:** Unlimited

### Express Server
- **General:** 60 requests/minute per IP
- **Scraping:** 10 requests/minute per IP

---

## Error Codes

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `204` - No Content (success, no response)
- `400` - Bad Request (invalid data)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `422` - Unprocessable Entity (validation failed)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

### Supabase Error Codes
- `PGRST116` - No rows found
- `23505` - Unique constraint violation
- `23503` - Foreign key constraint violation

---

## Security Best Practices

1. **Never commit API keys** - Use environment variables
2. **Use Row Level Security** - Supabase RLS policies enforce access
3. **Validate user input** - Client and server-side
4. **Use HTTPS** - Never http:// in production
5. **Rotate tokens** - Implement refresh token flow
6. **Rate limit** - Prevent abuse
7. **Log errors** - Monitor for suspicious activity

---

## Testing APIs

### Using cURL

```bash
# Login
curl -X POST https://your-project.supabase.co/auth/v1/token?grant_type=password \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{"email":"user@example.com","password":"password"}'

# Get anime
curl https://your-project.supabase.co/rest/v1/anime?limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "apikey: YOUR_ANON_KEY"
```

### Using Postman

1. Import collection: Import > Link > `https://your-project.supabase.co`
2. Set environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TOKEN`
3. Test endpoints

---

## Support Resources

- **Supabase Docs:** https://supabase.com/docs
- **PostgREST API:** https://postgrest.org/en/stable/
- **React Native:** https://reactnative.dev
- **Flutter Supabase:** https://supabase.com/docs/guides/getting-started/tutorials/with-flutter

---

## Quick Reference

### Required Environment Variables
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
VITE_BACKEND_URL=https://your-backend.com (optional)
```

### Required Headers
```http
Authorization: Bearer <token>
apikey: <supabase_anon_key>
Content-Type: application/json
```

### Common Operations
- **List anime:** `GET /rest/v1/anime?select=*`
- **Get user:** `GET /auth/v1/user`
- **Save progress:** `POST /rest/v1/user_progress`
- **Add favorite:** `POST /rest/v1/user_favorites`

---

## Summary

✅ **Mobile-Ready:** 80% of features via Supabase  
✅ **Authentication:** JWT tokens  
✅ **Real-time:** WebSocket subscriptions  
✅ **Offline:** Client-side caching with React Query  
⚠️ **Express Server:** Optional for caching/scraping  
📱 **SDKs Available:** React Native, Flutter, Swift, Kotlin  

**Start building your mobile app using Supabase SDK - no custom backend required!**
