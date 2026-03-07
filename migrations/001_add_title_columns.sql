-- Migration: Add title variant columns and nine_anime_slug for robust episode extraction
-- Run this in Supabase SQL Editor if you already have the database set up

-- Add English title (what 9anime uses for URL slugs)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS title_english VARCHAR(255);

-- Add Romaji title (Jikan default title format)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS title_romaji VARCHAR(255);

-- Add alternative title synonyms
ALTER TABLE anime ADD COLUMN IF NOT EXISTS title_synonyms TEXT[] DEFAULT '{}';

-- Add MAL ID for Jikan lookups
ALTER TABLE anime ADD COLUMN IF NOT EXISTS mal_id INTEGER;

-- Add verified 9anime slug (cached once found, avoids re-resolution)
ALTER TABLE anime ADD COLUMN IF NOT EXISTS nine_anime_slug VARCHAR(500);

-- Create index on nine_anime_slug for fast lookups
CREATE INDEX IF NOT EXISTS idx_anime_nine_anime_slug ON anime(nine_anime_slug) WHERE nine_anime_slug IS NOT NULL;

-- Create index on mal_id for Jikan cross-referencing
CREATE INDEX IF NOT EXISTS idx_anime_mal_id ON anime(mal_id) WHERE mal_id IS NOT NULL;

-- Backfill: For existing anime imported from Jikan, the current 'title' is likely the romaji title
-- You can run this to populate title_romaji for existing records:
-- UPDATE anime SET title_romaji = title WHERE title_romaji IS NULL;
