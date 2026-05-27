-- Migration: Create get_distinct_genres function for fast lookup
-- Run this in Supabase SQL Editor to avoid scanning the entire anime table on the client side

CREATE OR REPLACE FUNCTION get_distinct_genres()
RETURNS TABLE (genre text)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT unnest(genres)
  FROM anime
  WHERE genres IS NOT NULL
  ORDER BY 1;
$$;
