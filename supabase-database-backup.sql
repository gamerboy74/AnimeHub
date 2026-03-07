-- ============================================================================
-- AnimeHub Complete Database Backup for Supabase
-- ============================================================================
-- This file contains the complete database schema, views, functions, and policies
-- for the AnimeHub streaming platform. Run this entire file in Supabase SQL Editor.
--
-- Last Updated: 2024
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2. CORE TABLES
-- ============================================================================

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  avatar_url TEXT,
  subscription_type VARCHAR(20) DEFAULT 'free' CHECK (subscription_type IN ('free', 'premium', 'vip')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Anime Table
CREATE TABLE IF NOT EXISTS anime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  title_english VARCHAR(255),
  title_romaji VARCHAR(255),
  title_japanese VARCHAR(255),
  title_synonyms TEXT[],
  mal_id INTEGER,
  nine_anime_slug VARCHAR(500),
  description TEXT,
  poster_url TEXT,
  banner_url TEXT,
  trailer_url TEXT,
  rating DECIMAL(3,1) CHECK (rating >= 0 AND rating <= 10),
  year INTEGER,
  status VARCHAR(20) CHECK (status IN ('ongoing', 'completed', 'upcoming')),
  type VARCHAR(20) CHECK (type IN ('tv', 'movie', 'ova', 'special')),
  genres TEXT[],
  studios TEXT[],
  total_episodes INTEGER,
  duration INTEGER,
  age_rating VARCHAR(10) CHECK (age_rating IN ('G', 'PG', 'PG-13', 'R', '18+')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Episodes Table
CREATE TABLE IF NOT EXISTS episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  title VARCHAR(255),
  description TEXT,
  thumbnail_url TEXT,
  video_url TEXT,
  duration INTEGER,
  is_premium BOOLEAN DEFAULT FALSE,
  air_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(anime_id, episode_number)
);

-- User Progress Table
CREATE TABLE IF NOT EXISTS user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES episodes(id) ON DELETE CASCADE,
  progress_seconds INTEGER DEFAULT 0 CHECK (progress_seconds >= 0),
  is_completed BOOLEAN DEFAULT FALSE,
  last_watched TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, episode_id)
);

-- User Favorites Table
CREATE TABLE IF NOT EXISTS user_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, anime_id)
);

-- User Watchlist Table
CREATE TABLE IF NOT EXISTS user_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, anime_id)
);

-- Reviews Table
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating >= 1 AND rating <= 10),
  review_text TEXT,
  is_spoiler BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 3. EXTENDED TABLES (Anime Relations, Characters, Studios)
-- ============================================================================

-- Anime Relations Table
CREATE TABLE IF NOT EXISTS anime_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  related_anime_id TEXT NOT NULL,
  relation_type VARCHAR(50) NOT NULL,
  anilist_id INTEGER,
  mal_id INTEGER,
  title VARCHAR(255),
  format VARCHAR(50),
  status VARCHAR(50),
  episodes INTEGER,
  year INTEGER,
  poster_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(anime_id, related_anime_id, relation_type)
);

-- Anime Characters Table
CREATE TABLE IF NOT EXISTS anime_characters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  name_japanese VARCHAR(255),
  name_romaji VARCHAR(255),
  image_url TEXT,
  role VARCHAR(50) CHECK (role IN ('main', 'supporting', 'antagonist', 'background')),
  description TEXT,
  voice_actor VARCHAR(255),
  voice_actor_japanese VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(anime_id, name)
);

-- Anime Studios Table
CREATE TABLE IF NOT EXISTS anime_studios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anilist_id INTEGER UNIQUE,
  name VARCHAR(255) NOT NULL UNIQUE,
  name_japanese VARCHAR(255),
  description TEXT,
  website TEXT,
  logo_url TEXT,
  founded_year INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Anime-Studio Relations Table
CREATE TABLE IF NOT EXISTS anime_studio_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anime_id UUID REFERENCES anime(id) ON DELETE CASCADE,
  studio_id UUID REFERENCES anime_studios(id) ON DELETE CASCADE,
  role VARCHAR(50) CHECK (role IN ('animation', 'production', 'music', 'sound', 'other')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(anime_id, studio_id, role)
);

-- ============================================================================
-- 4. INDEXES FOR PERFORMANCE
-- ============================================================================

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_anime_genres ON anime USING GIN (genres);
CREATE INDEX IF NOT EXISTS idx_anime_year ON anime (year);
CREATE INDEX IF NOT EXISTS idx_anime_rating ON anime (rating);
CREATE INDEX IF NOT EXISTS idx_anime_status ON anime (status);
CREATE INDEX IF NOT EXISTS idx_anime_type ON anime (type);
CREATE INDEX IF NOT EXISTS idx_episodes_anime_id ON episodes (anime_id);
CREATE INDEX IF NOT EXISTS idx_episodes_number ON episodes (anime_id, episode_number);
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON user_progress (user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_last_watched ON user_progress (last_watched);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_user_id ON user_watchlist (user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_anime_id ON reviews (anime_id);
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews (rating);

-- Optimization indexes
CREATE INDEX IF NOT EXISTS idx_anime_title_search ON anime USING GIN (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_user_progress_composite ON user_progress (user_id, episode_id, last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_anime_rating_year ON anime (rating DESC NULLS LAST, year DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_anime_ongoing ON anime (id, title, poster_url, rating) WHERE status = 'ongoing';
CREATE INDEX IF NOT EXISTS idx_anime_completed ON anime (id, title, poster_url, rating) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_episodes_premium ON episodes (anime_id, episode_number) WHERE is_premium = true;
CREATE INDEX IF NOT EXISTS idx_anime_genres_gin ON anime USING GIN (genres);
CREATE INDEX IF NOT EXISTS idx_anime_studios_gin ON anime USING GIN (studios);
CREATE INDEX IF NOT EXISTS idx_anime_year_type ON anime (year, type) WHERE year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_favorites_composite ON user_favorites (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_composite ON user_watchlist (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_anime_rating ON reviews (anime_id, rating DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_anime_episode_composite ON episodes (anime_id, episode_number, is_premium);

-- Extended tables indexes
CREATE INDEX IF NOT EXISTS idx_anime_relations_anime_id ON anime_relations(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_relations_related_anime_id ON anime_relations(related_anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_relations_type ON anime_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_anime_characters_anime_id ON anime_characters(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_characters_role ON anime_characters(role);
CREATE INDEX IF NOT EXISTS idx_anime_studio_relations_anime_id ON anime_studio_relations(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_studio_relations_studio_id ON anime_studio_relations(studio_id);

-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- Update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Optimized anime search function
CREATE OR REPLACE FUNCTION search_anime_optimized(
  search_term TEXT DEFAULT '',
  genre_filter TEXT DEFAULT NULL,
  year_filter INTEGER DEFAULT NULL,
  status_filter TEXT DEFAULT NULL,
  type_filter TEXT DEFAULT NULL,
  rating_min DECIMAL DEFAULT NULL,
  limit_count INTEGER DEFAULT 20,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title VARCHAR,
  title_japanese VARCHAR,
  description TEXT,
  poster_url TEXT,
  banner_url TEXT,
  rating DECIMAL,
  year INTEGER,
  status VARCHAR,
  type VARCHAR,
  genres TEXT[],
  studios TEXT[],
  total_episodes INTEGER,
  duration INTEGER,
  age_rating VARCHAR,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.title,
    a.title_japanese,
    a.description,
    a.poster_url,
    a.banner_url,
    a.rating,
    a.year,
    a.status,
    a.type,
    a.genres,
    a.studios,
    a.total_episodes,
    a.duration,
    a.age_rating,
    a.created_at,
    a.updated_at
  FROM anime a
  WHERE
    (search_term = '' OR 
     to_tsvector('english', COALESCE(a.title, '') || ' ' || COALESCE(a.description, '')) @@ plainto_tsquery('english', search_term) OR
     a.title ILIKE '%' || search_term || '%' OR
     a.title_japanese ILIKE '%' || search_term || '%')
    AND (genre_filter IS NULL OR genre_filter = ANY(a.genres))
    AND (year_filter IS NULL OR a.year = year_filter)
    AND (status_filter IS NULL OR a.status = status_filter)
    AND (type_filter IS NULL OR a.type = type_filter)
    AND (rating_min IS NULL OR a.rating >= rating_min)
  ORDER BY a.rating DESC NULLS LAST, a.year DESC NULLS LAST
  LIMIT limit_count
  OFFSET offset_count;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_anime_updated_at BEFORE UPDATE ON anime
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_anime_relations_updated_at BEFORE UPDATE ON anime_relations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_anime_characters_updated_at BEFORE UPDATE ON anime_characters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_anime_studios_updated_at BEFORE UPDATE ON anime_studios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_studios ENABLE ROW LEVEL SECURITY;
ALTER TABLE anime_studio_relations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
DROP POLICY IF EXISTS "Users can insert own profile" ON users;
DROP POLICY IF EXISTS "Anyone can view anime" ON anime;
DROP POLICY IF EXISTS "Anyone can insert anime" ON anime;
DROP POLICY IF EXISTS "Anyone can update anime" ON anime;
DROP POLICY IF EXISTS "Anyone can delete anime" ON anime;
DROP POLICY IF EXISTS "Anyone can view episodes" ON episodes;
DROP POLICY IF EXISTS "Anyone can insert episodes" ON episodes;
DROP POLICY IF EXISTS "Anyone can update episodes" ON episodes;
DROP POLICY IF EXISTS "Anyone can delete episodes" ON episodes;

-- Users policies
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Anime policies (public read, permissive write for scraping)
CREATE POLICY "Anyone can view anime" ON anime
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert anime" ON anime
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update anime" ON anime
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete anime" ON anime
  FOR DELETE USING (true);

-- Episodes policies (public read, permissive write for scraping)
CREATE POLICY "Anyone can view episodes" ON episodes
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert episodes" ON episodes
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update episodes" ON episodes
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can delete episodes" ON episodes
  FOR DELETE USING (true);

-- User progress policies
CREATE POLICY "Users can view own progress" ON user_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own progress" ON user_progress
  FOR ALL USING (auth.uid() = user_id);

-- User favorites policies
CREATE POLICY "Users can view own favorites" ON user_favorites
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own favorites" ON user_favorites
  FOR ALL USING (auth.uid() = user_id);

-- User watchlist policies
CREATE POLICY "Users can view own watchlist" ON user_watchlist
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own watchlist" ON user_watchlist
  FOR ALL USING (auth.uid() = user_id);

-- Reviews policies
CREATE POLICY "Anyone can view reviews" ON reviews
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own reviews" ON reviews
  FOR ALL USING (auth.uid() = user_id);

-- Extended tables policies
CREATE POLICY "Allow authenticated users to read anime_relations" ON anime_relations
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read anime_characters" ON anime_characters
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read anime_studios" ON anime_studios
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to read anime_studio_relations" ON anime_studio_relations
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- 9. MATERIALIZED VIEWS (for better query performance)
-- ============================================================================

-- Popular Anime View
CREATE MATERIALIZED VIEW IF NOT EXISTS popular_anime AS
SELECT 
  a.id,
  a.title,
  a.title_japanese,
  a.description,
  a.poster_url,
  a.banner_url,
  a.rating,
  a.year,
  a.status,
  a.type,
  a.genres,
  a.studios,
  a.total_episodes,
  a.duration,
  a.age_rating,
  a.created_at,
  a.updated_at,
  COALESCE(
    (SELECT COUNT(*) FROM user_favorites uf WHERE uf.anime_id = a.id) * 2 +
    (SELECT COUNT(*) FROM user_watchlist uw WHERE uw.anime_id = a.id) +
    (SELECT COUNT(*) FROM user_progress up 
     JOIN episodes e ON up.episode_id = e.id 
     WHERE e.anime_id = a.id AND up.last_watched > NOW() - INTERVAL '30 days') * 3 +
    (SELECT COUNT(*) FROM reviews r WHERE r.anime_id = a.id AND r.rating >= 7) * 1.5,
    0
  ) as popularity_score,
  (SELECT COUNT(*) FROM user_progress up 
   JOIN episodes e ON up.episode_id = e.id 
   WHERE e.anime_id = a.id AND up.last_watched > NOW() - INTERVAL '7 days') as recent_activity
FROM anime a
WHERE a.status IN ('ongoing', 'completed')
ORDER BY popularity_score DESC, a.rating DESC NULLS LAST;

CREATE INDEX IF NOT EXISTS idx_popular_anime_score ON popular_anime (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_popular_anime_recent ON popular_anime (recent_activity DESC);

-- Trending Anime View
CREATE MATERIALIZED VIEW IF NOT EXISTS trending_anime AS
SELECT 
  a.id,
  a.title,
  a.title_japanese,
  a.description,
  a.poster_url,
  a.banner_url,
  a.rating,
  a.year,
  a.status,
  a.type,
  a.genres,
  a.studios,
  a.total_episodes,
  a.duration,
  a.age_rating,
  a.created_at,
  a.updated_at,
  (SELECT COUNT(*) FROM user_progress up 
   JOIN episodes e ON up.episode_id = e.id 
   WHERE e.anime_id = a.id AND up.last_watched > NOW() - INTERVAL '7 days') as trending_score
FROM anime a
WHERE a.status = 'ongoing'
ORDER BY trending_score DESC, a.rating DESC NULLS LAST;

CREATE INDEX IF NOT EXISTS idx_trending_anime_score ON trending_anime (trending_score DESC);

-- ============================================================================
-- 10. GRANTS
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- ============================================================================
-- 11. ANALYZE TABLES (Update statistics for query planner)
-- ============================================================================

ANALYZE users;
ANALYZE anime;
ANALYZE episodes;
ANALYZE user_progress;
ANALYZE user_favorites;
ANALYZE user_watchlist;
ANALYZE reviews;
ANALYZE anime_relations;
ANALYZE anime_characters;
ANALYZE anime_studios;
ANALYZE anime_studio_relations;

-- ============================================================================
-- 12. STORAGE BUCKETS (Note: Create these in Supabase Storage section)
-- ============================================================================
-- Required buckets:
-- - anime-posters (public)
-- - anime-banners (public)
-- - anime-thumbnails (public)
-- - anime-videos (private)
-- - user-avatars (public)

-- ============================================================================
-- SETUP COMPLETE
-- ============================================================================
-- Your AnimeHub database is now ready!
-- Remember to:
-- 1. Create storage buckets in Supabase Dashboard > Storage
-- 2. Set up environment variables for Supabase URL and keys
-- 3. Configure any additional features as needed
-- ============================================================================

