-- ============================================================================
-- AnimeHub Complete Database Schema
-- Last Updated: 2026
--
-- 🚀 NEW DATABASE SETUP CHECKLIST:
--
-- 1. DATABASE SCHEMA:
--    Run the contents of this file in the Supabase SQL Editor.
--
-- 2. SEED DATA (OPTIONAL):
--    To import your anime records and episodes, run migrations/supabase-data-seed.sql.
--
-- 3. STORAGE BUCKETS (MANUAL STEP REQUIRED):
--    Go to Supabase Dashboard > Storage and create the following buckets:
--    * anime-posters      - Public
--    * anime-banners      - Public
--    * anime-thumbnails   - Public
--    * anime-videos       - Private
--    * user-avatars       - Public
--
-- 4. ENVIRONMENT VARIABLES:
--    Update your local .env with the new project credentials:
--    * VITE_SUPABASE_URL
--    * VITE_SUPABASE_ANON_KEY
--    * SUPABASE_SERVICE_ROLE_KEY
-- ============================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."calculate_episode_scraping_next_run"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Only calculate next_run if enabled and interval_hours changed
  IF NEW.enabled = TRUE AND (OLD.interval_hours != NEW.interval_hours OR OLD.enabled = FALSE) THEN
    NEW.next_run = NOW() + (NEW.interval_hours || ' hours')::INTERVAL;
  ELSIF NEW.enabled = FALSE THEN
    NEW.next_run = NULL;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."calculate_episode_scraping_next_run"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_image_cache"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM image_cache 
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_image_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_analytics"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete analytics older than 1 year
  DELETE FROM import_analytics 
  WHERE created_at < NOW() - INTERVAL '1 year';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Delete reports older than 6 months
  DELETE FROM import_reports 
  WHERE created_at < NOW() - INTERVAL '6 months';
  
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_analytics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_old_progress"() RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_progress 
  WHERE is_completed = true 
    AND last_watched < NOW() - INTERVAL '1 year';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_image_cache_table"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Table creation is handled above, this function is just for service initialization
  NULL;
END;
$$;


ALTER FUNCTION "public"."create_image_cache_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_import_analytics_table"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Table creation is handled above, this function is just for service initialization
  NULL;
END;
$$;


ALTER FUNCTION "public"."create_import_analytics_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_import_logs_table"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Table creation is handled above, this function is just for service initialization
  NULL;
END;
$$;


ALTER FUNCTION "public"."create_import_logs_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_import_reports_table"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Table creation is handled above, this function is just for service initialization
  NULL;
END;
$$;


ALTER FUNCTION "public"."create_import_reports_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_scheduled_imports_table"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Table creation is handled above, this function is just for service initialization
  NULL;
END;
$$;


ALTER FUNCTION "public"."create_scheduled_imports_table"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_user_preferences"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- 1. Insert into public.users (explicitly prefixed)
  INSERT INTO public.users (id, email, username, subscription_type, role, is_admin)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NULLIF(regexp_replace(
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
        '[^a-zA-Z0-9]', '', 'g'
      ), ''),
      split_part(COALESCE(NEW.email, 'user@x.com'), '@', 1),
      'user'
    ) || '_' || substring(NEW.id::text, 1, 6),
    'free',
    'user',
    false
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Insert into public.user_preferences (ADDED public. PREFIX HERE TO FIX THE BUG)
  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_user_preferences"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_anime_recommendations"("user_uuid" "uuid", "limit_count" integer DEFAULT 10) RETURNS TABLE("id" "uuid", "title" character varying, "poster_url" "text", "rating" numeric, "year" integer, "genres" "text"[], "recommendation_score" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  WITH user_preferences AS (
    -- Get user's favorite genres
    SELECT unnest(a.genres) as genre, COUNT(*) as genre_count
    FROM anime a
    JOIN user_favorites uf ON a.id = uf.anime_id
    WHERE uf.user_id = user_uuid
    GROUP BY unnest(a.genres)
  ),
  user_watched AS (
    -- Get anime user has already watched
    SELECT DISTINCT e.anime_id
    FROM user_progress up
    JOIN episodes e ON up.episode_id = e.id
    WHERE up.user_id = user_uuid
  )
  SELECT 
    a.id,
    a.title,
    a.poster_url,
    a.rating,
    a.year,
    a.genres,
    -- Calculate recommendation score
    COALESCE(
      (SELECT SUM(up.genre_count) 
       FROM user_preferences up 
       WHERE up.genre = ANY(a.genres)) * 2 +
      a.rating * 0.5 +
      CASE WHEN a.status = 'ongoing' THEN 1 ELSE 0 END,
      0
    ) as recommendation_score
  FROM anime a
  WHERE a.id NOT IN (SELECT anime_id FROM user_watched)
    AND a.status IN ('ongoing', 'completed')
  ORDER BY recommendation_score DESC, a.rating DESC NULLS LAST
  LIMIT limit_count;
END;
$$;


ALTER FUNCTION "public"."get_anime_recommendations"("user_uuid" "uuid", "limit_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_daily_import_trends"("days_back" integer DEFAULT 30) RETURNS TABLE("date" "date", "import_count" bigint, "anime_count" bigint, "success_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    created_at::DATE as date,
    COUNT(*) as import_count,
    SUM(imported_count) as anime_count,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        (COUNT(*) FILTER (WHERE error_count = 0)::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0 
    END as success_rate
  FROM import_analytics
  WHERE created_at >= NOW() - INTERVAL '1 day' * days_back
  GROUP BY created_at::DATE
  ORDER BY date DESC;
END;
$$;


ALTER FUNCTION "public"."get_daily_import_trends"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_distinct_genres"() RETURNS TABLE("genre" "text")
    LANGUAGE "sql" STABLE
    AS $$
  SELECT DISTINCT unnest(genres)
  FROM anime
  WHERE genres IS NOT NULL
  ORDER BY 1;
$$;


ALTER FUNCTION "public"."get_distinct_genres"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_due_episode_scraping_imports"() RETURNS TABLE("id" "uuid", "name" character varying, "enabled" boolean, "interval_hours" integer, "anime_limit" integer, "batch_size" integer, "last_run" timestamp with time zone, "next_run" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ess.id,
    ess.name,
    ess.enabled,
    ess.interval_hours,
    ess.anime_limit,
    ess.batch_size,
    ess.last_run,
    ess.next_run
  FROM episode_scraping_schedules ess
  WHERE ess.enabled = true 
    AND ess.next_run <= NOW()
  ORDER BY ess.next_run ASC;
END;
$$;


ALTER FUNCTION "public"."get_due_episode_scraping_imports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_due_imports"() RETURNS TABLE("id" "uuid", "name" character varying, "enabled" boolean, "source" character varying, "type" character varying, "search_query" "text", "limit_count" integer, "frequency" character varying, "last_run" timestamp with time zone, "next_run" timestamp with time zone, "auto_approve" boolean)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    si.id,
    si.name,
    si.enabled,
    si.source,
    si.type,
    si.search_query,
    si.limit_count,
    si.frequency,
    si.last_run,
    si.next_run,
    si.auto_approve
  FROM scheduled_imports si
  WHERE si.enabled = true 
    AND si.next_run <= NOW()
  ORDER BY si.next_run ASC;
END;
$$;


ALTER FUNCTION "public"."get_due_imports"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_genre_statistics"("days_back" integer DEFAULT 30) RETURNS TABLE("genre" "text", "import_count" bigint, "anime_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    unnest(genres) as genre,
    COUNT(*) as import_count,
    SUM(imported_count) as anime_count
  FROM import_analytics
  WHERE created_at >= NOW() - INTERVAL '1 day' * days_back
    AND genres IS NOT NULL
    AND array_length(genres, 1) > 0
  GROUP BY unnest(genres)
  ORDER BY anime_count DESC;
END;
$$;


ALTER FUNCTION "public"."get_genre_statistics"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_image_cache_stats"() RETURNS TABLE("total_images" bigint, "total_size" bigint, "oldest_entry" timestamp with time zone, "newest_entry" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_images,
    COALESCE(SUM(size_bytes), 0) as total_size,
    MIN(created_at) as oldest_entry,
    MAX(created_at) as newest_entry
  FROM image_cache;
END;
$$;


ALTER FUNCTION "public"."get_image_cache_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_import_analytics_summary"("days_back" integer DEFAULT 30) RETURNS TABLE("total_imports" bigint, "successful_imports" bigint, "failed_imports" bigint, "total_anime_imported" bigint, "total_anime_skipped" bigint, "average_duration_ms" numeric, "success_rate" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_imports,
    COUNT(*) FILTER (WHERE error_count = 0) as successful_imports,
    COUNT(*) FILTER (WHERE error_count > 0) as failed_imports,
    COALESCE(SUM(imported_count), 0) as total_anime_imported,
    COALESCE(SUM(skipped_count), 0) as total_anime_skipped,
    COALESCE(AVG(duration_ms), 0) as average_duration_ms,
    CASE 
      WHEN COUNT(*) > 0 THEN 
        (COUNT(*) FILTER (WHERE error_count = 0)::NUMERIC / COUNT(*)::NUMERIC) * 100
      ELSE 0 
    END as success_rate
  FROM import_analytics
  WHERE created_at >= NOW() - INTERVAL '1 day' * days_back;
END;
$$;


ALTER FUNCTION "public"."get_import_analytics_summary"("days_back" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_related_anime"("anime_uuid" "uuid", "relation_types" "text"[] DEFAULT NULL::"text"[]) RETURNS TABLE("related_anime_id" "uuid", "title" character varying, "poster_url" "text", "year" integer, "format" character varying, "status" character varying, "relation_type" character varying)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ra.id,
    ra.title,
    ra.poster_url,
    ra.year,
    ra.format,
    ra.status,
    ar.relation_type
  FROM anime_relations ar
  JOIN anime ra ON ar.related_anime_uuid = ra.id
  WHERE ar.anime_id = anime_uuid
  AND (relation_types IS NULL OR ar.relation_type = ANY(relation_types))
  ORDER BY ra.year DESC;
END;
$$;


ALTER FUNCTION "public"."get_related_anime"("anime_uuid" "uuid", "relation_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_progress_with_anime"("user_uuid" "uuid") RETURNS TABLE("progress_id" "uuid", "anime_id" "uuid", "anime_title" character varying, "anime_poster" "text", "episode_id" "uuid", "episode_number" integer, "episode_title" character varying, "progress_seconds" integer, "is_completed" boolean, "last_watched" timestamp with time zone, "total_episodes" integer, "anime_rating" numeric)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.id as progress_id,
    a.id as anime_id,
    a.title as anime_title,
    a.poster_url as anime_poster,
    e.id as episode_id,
    e.episode_number,
    e.title as episode_title,
    up.progress_seconds,
    up.is_completed,
    up.last_watched,
    a.total_episodes,
    a.rating as anime_rating
  FROM user_progress up
  JOIN episodes e ON up.episode_id = e.id
  JOIN anime a ON e.anime_id = a.id
  WHERE up.user_id = user_uuid
  ORDER BY up.last_watched DESC;
END;
$$;


ALTER FUNCTION "public"."get_user_progress_with_anime"("user_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_anime_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
BEGIN
  -- Insert a notification for every registered user
  FOR user_record IN SELECT id FROM public.users LOOP
    INSERT INTO public.notifications (user_id, type, title, message, action_url, data)
    VALUES (
      user_record.id,
      'new_anime',
      'New Anime Added! 🚀',
      NEW.title || ' is now available to stream on AnimeHub. Check it out!',
      '/anime/' || NEW.id,
      jsonb_build_object('anime_id', NEW.id, 'title', NEW.title)
    );
  END LOOP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_anime_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_episode_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_record RECORD;
  anime_title text;
BEGIN
  -- Retrieve the title of the anime
  SELECT title INTO anime_title FROM public.anime WHERE id = NEW.anime_id;

  -- Find all users who have this anime in their watchlist or favorites
  FOR user_record IN 
    SELECT DISTINCT user_id 
    FROM (
      SELECT user_id FROM public.user_watchlist WHERE anime_id = NEW.anime_id
      UNION
      SELECT user_id FROM public.user_favorites WHERE anime_id = NEW.anime_id
    ) AS interested_users
  LOOP
    -- Insert a personalized notification for the user
    INSERT INTO public.notifications (user_id, type, title, message, action_url, data)
    VALUES (
      user_record.id,
      'episode',
      'New Episode Released! 🎬',
      'Episode ' || NEW.episode_number || ' of ' || anime_title || ' is now available.',
      '/watch/' || NEW.id,
      jsonb_build_object('anime_id', NEW.anime_id, 'episode_id', NEW.id, 'episode_number', NEW.episode_number)
    );
  END LOOP;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_episode_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_user_progress_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_watch_time INT;
  v_episodes_count INT;
  v_completed_anime_count INT;
  v_current_streak INT;
  v_longest_streak INT;
  v_last_watched TIMESTAMPTZ;
  
  -- New badge variables
  v_watchlist_count INT;
  v_action_episodes_count INT;
  
  -- Streak computation variables
  v_check_date DATE;
  v_prev_date DATE;
  v_streak_record RECORD;
  v_temp_streak INT := 0;
  v_best_streak INT := 0;
BEGIN
  -- 1. Get sum of watch time, episodes count and last watched
  SELECT 
    COALESCE(SUM(progress_seconds), 0), 
    COUNT(*),
    MAX(last_watched)
  INTO 
    v_watch_time, 
    v_episodes_count,
    v_last_watched
  FROM public.user_progress
  WHERE user_id = NEW.user_id;

  -- 2. Completed anime count (distinct anime_ids where is_completed = true)
  SELECT COUNT(DISTINCT e.anime_id)
  INTO v_completed_anime_count
  FROM public.user_progress up
  JOIN public.episodes e ON up.episode_id = e.id
  WHERE up.user_id = NEW.user_id AND up.is_completed = true;

  -- 3. Get watchlist count for HUNTER and LISTER badges
  SELECT COUNT(*) INTO v_watchlist_count
  FROM public.user_watchlist
  WHERE user_id = NEW.user_id;

  -- 4. Count episodes of 'Action' genre watched for SHONEN badge
  SELECT COUNT(*)
  INTO v_action_episodes_count
  FROM public.user_progress up
  JOIN public.episodes e ON up.episode_id = e.id
  JOIN public.anime a ON e.anime_id = a.id
  WHERE up.user_id = NEW.user_id AND 'Action' = ANY(a.genres);

  -- 5. Compute current and longest watch streaks
  v_current_streak := 0;
  v_check_date := CURRENT_DATE;
  
  -- Calculate current streak by checking consecutive days backward from today/yesterday
  LOOP
    SELECT COUNT(*) INTO v_temp_streak 
    FROM public.user_progress 
    WHERE user_id = NEW.user_id AND last_watched::DATE = v_check_date;
    
    IF v_temp_streak > 0 THEN
      v_current_streak := v_current_streak + 1;
      v_check_date := v_check_date - INTERVAL '1 day';
    ELSE
      -- Allow 1 day grace if they checked in yesterday but not yet today
      IF v_check_date = CURRENT_DATE THEN
        v_check_date := v_check_date - INTERVAL '1 day';
        SELECT COUNT(*) INTO v_temp_streak 
        FROM public.user_progress 
        WHERE user_id = NEW.user_id AND last_watched::DATE = v_check_date;
        
        IF v_temp_streak = 0 THEN
          EXIT;
        END IF;
      ELSE
        EXIT;
      END IF;
    END IF;
  END LOOP;

  -- Calculate longest streak ever (scanning history)
  v_temp_streak := 0;
  v_prev_date := NULL;
  FOR v_streak_record IN 
    SELECT DISTINCT last_watched::DATE as watch_date
    FROM public.user_progress
    WHERE user_id = NEW.user_id
    ORDER BY watch_date ASC
  LOOP
    IF v_prev_date IS NULL THEN
      v_temp_streak := 1;
    ELSIF v_streak_record.watch_date - v_prev_date = 1 THEN
      v_temp_streak := v_temp_streak + 1;
    ELSIF v_streak_record.watch_date - v_prev_date > 1 THEN
      v_temp_streak := 1;
    END IF;
    
    IF v_temp_streak > v_best_streak THEN
      v_best_streak := v_temp_streak;
    END IF;
    v_prev_date := v_streak_record.watch_date;
  END LOOP;
  
  v_longest_streak := GREATEST(v_best_streak, v_current_streak);

  -- 6. Upsert calculated metrics to user_stats table
  INSERT INTO public.user_stats (
    user_id, 
    total_watch_time, 
    episodes_watched_count, 
    completed_anime_count, 
    current_streak, 
    longest_streak, 
    last_watched_at
  )
  VALUES (
    NEW.user_id, 
    v_watch_time, 
    v_episodes_count, 
    v_completed_anime_count, 
    v_current_streak, 
    v_longest_streak, 
    v_last_watched
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_watch_time = EXCLUDED.total_watch_time,
    episodes_watched_count = EXCLUDED.episodes_watched_count,
    completed_anime_count = EXCLUDED.completed_anime_count,
    current_streak = EXCLUDED.current_streak,
    longest_streak = EXCLUDED.longest_streak,
    last_watched_at = EXCLUDED.last_watched_at;

  -- 7. AWARD BADGES BASED ON STATS
  
  -- Badge 1: FIRST EP (Watched at least 1 episode)
  IF v_episodes_count >= 1 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'FIRST_EP') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 2: HUNTER (Add 1 to watchlist)
  IF v_watchlist_count >= 1 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'HUNTER') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 3: DEDICATED (3-day watch streak)
  IF v_longest_streak >= 3 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'DEDICATED') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 4: LISTER (Add 5 to watchlist)
  IF v_watchlist_count >= 5 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'LISTER') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 5: SHONEN (Watch 5 Action episodes)
  IF v_action_episodes_count >= 5 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'SHONEN') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 6: VETERAN (Watch 10 episodes)
  IF v_episodes_count >= 10 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'VETERAN') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 7: WARRIOR (7-day streak)
  IF v_longest_streak >= 7 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'WARRIOR') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 8: BINGE SENSEI (Watch 5 hours = 18000 seconds of anime)
  IF v_watch_time >= 18000 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'BINGE') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 9: LEGEND (Watch 50 episodes)
  IF v_episodes_count >= 50 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'LEGEND') ON CONFLICT DO NOTHING;
  END IF;

  -- Badge 10: OTAKU KING (Watch 100 episodes)
  IF v_episodes_count >= 100 THEN
    INSERT INTO public.user_badges (user_id, badge_code)
    VALUES (NEW.user_id, 'OTAKU') ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_user_progress_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin_user"("user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM users 
    WHERE id = user_id 
    AND (role = 'admin' OR is_admin = true)
  );
END;
$$;


ALTER FUNCTION "public"."is_admin_user"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_admin"("user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  user_role TEXT;
  user_is_admin BOOLEAN;
BEGIN
  SELECT role, is_admin
  INTO user_role, user_is_admin
  FROM users 
  WHERE id = user_id;

  RETURN (user_role = 'admin' OR user_is_admin = true);
END;
$$;


ALTER FUNCTION "public"."is_user_admin"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_materialized_views"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY popular_anime;
  REFRESH MATERIALIZED VIEW CONCURRENTLY trending_anime;
  RETURN 'Materialized views refreshed successfully at ' || NOW();
END;
$$;


ALTER FUNCTION "public"."refresh_materialized_views"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_anime_optimized"("search_term" "text" DEFAULT ''::"text", "genre_filter" "text" DEFAULT NULL::"text", "year_filter" integer DEFAULT NULL::integer, "status_filter" "text" DEFAULT NULL::"text", "type_filter" "text" DEFAULT NULL::"text", "rating_min" numeric DEFAULT NULL::numeric, "limit_count" integer DEFAULT 20, "offset_count" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "title" character varying, "title_japanese" character varying, "description" "text", "poster_url" "text", "banner_url" "text", "rating" numeric, "year" integer, "status" character varying, "type" character varying, "genres" "text"[], "studios" "text"[], "total_episodes" integer, "duration" integer, "age_rating" character varying, "created_at" timestamp with time zone, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    AS $$
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
    (search_term = '' OR a.title ILIKE '%' || search_term || '%' OR a.description ILIKE '%' || search_term || '%')
    AND (genre_filter IS NULL OR a.genres @> ARRAY[genre_filter])
    AND (year_filter IS NULL OR a.year = year_filter)
    AND (status_filter IS NULL OR a.status = status_filter)
    AND (type_filter IS NULL OR a.type = type_filter)
    AND (rating_min IS NULL OR a.rating >= rating_min)
  ORDER BY 
    CASE 
      WHEN search_term != '' THEN 
        ts_rank(to_tsvector('english', a.title), plainto_tsquery('english', search_term))
      ELSE 0 
    END DESC,
    a.rating DESC NULLS LAST,
    a.year DESC NULLS LAST
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;


ALTER FUNCTION "public"."search_anime_optimized"("search_term" "text", "genre_filter" "text", "year_filter" integer, "status_filter" "text", "type_filter" "text", "rating_min" numeric, "limit_count" integer, "offset_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_episode_scraping_next_run"("schedule_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  schedule_interval INTEGER;
BEGIN
  SELECT interval_hours INTO schedule_interval
  FROM episode_scraping_schedules
  WHERE id = schedule_id;
  
  UPDATE episode_scraping_schedules
  SET 
    last_run = NOW(),
    next_run = NOW() + (schedule_interval || ' hours')::INTERVAL,
    updated_at = NOW()
  WHERE id = schedule_id;
END;
$$;


ALTER FUNCTION "public"."update_episode_scraping_next_run"("schedule_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_episode_scraping_schedules_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_episode_scraping_schedules_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_next_run"("import_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  import_frequency VARCHAR(20);
BEGIN
  SELECT frequency INTO import_frequency
  FROM scheduled_imports
  WHERE id = import_id;
  
  UPDATE scheduled_imports
  SET 
    last_run = NOW(),
    next_run = CASE 
      WHEN import_frequency = 'daily' THEN NOW() + INTERVAL '1 day'
      WHEN import_frequency = 'weekly' THEN NOW() + INTERVAL '1 week'
      WHEN import_frequency = 'monthly' THEN NOW() + INTERVAL '1 month'
      ELSE NOW() + INTERVAL '1 day'
    END,
    updated_at = NOW()
  WHERE id = import_id;
END;
$$;


ALTER FUNCTION "public"."update_next_run"("import_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_scraping_progress_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_scraping_progress_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upvote_anime_request"("request_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  update public.anime_requests
  set vote_count = vote_count + 1
  where id = request_id and status = 'pending';
end;
$$;


ALTER FUNCTION "public"."upvote_anime_request"("request_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."anime" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" character varying(255) NOT NULL,
    "title_japanese" character varying(255),
    "description" "text",
    "poster_url" "text",
    "banner_url" "text",
    "trailer_url" "text",
    "rating" numeric(3,1),
    "year" integer,
    "status" character varying(20),
    "type" character varying(20),
    "genres" "text"[],
    "studios" "text"[],
    "total_episodes" integer,
    "duration" integer,
    "age_rating" character varying(10),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "title_english" character varying(255),
    "title_romaji" character varying(255),
    "title_synonyms" "text"[] DEFAULT '{}'::"text"[],
    "mal_id" integer,
    "nine_anime_slug" character varying(500),
    "scraper_urls" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "anime_age_rating_check" CHECK ((("age_rating")::"text" = ANY ((ARRAY['G'::character varying, 'PG'::character varying, 'PG-13'::character varying, 'R'::character varying, '18+'::character varying])::"text"[]))),
    CONSTRAINT "anime_rating_check" CHECK ((("rating" >= (0)::numeric) AND ("rating" <= (10)::numeric))),
    CONSTRAINT "anime_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['ongoing'::character varying, 'completed'::character varying, 'upcoming'::character varying])::"text"[]))),
    CONSTRAINT "anime_type_check" CHECK ((("type")::"text" = ANY ((ARRAY['tv'::character varying, 'movie'::character varying, 'ova'::character varying, 'special'::character varying])::"text"[])))
);


ALTER TABLE "public"."anime" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid",
    "episode_number" integer NOT NULL,
    "title" character varying(255),
    "description" "text",
    "thumbnail_url" "text",
    "video_url" "text",
    "duration" integer,
    "is_premium" boolean DEFAULT false,
    "air_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "video_servers" "jsonb" DEFAULT '[]'::"jsonb"
);


ALTER TABLE "public"."episodes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."episodes"."video_servers" IS 'Ordered list of streaming servers: [{name: string, url: string}]. The player cycles through these when a server fails. First entry should match video_url for backwards compatibility.';



CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "anime_id" "uuid",
    "rating" integer,
    "review_text" "text",
    "is_spoiler" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 10)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "episode_id" "uuid",
    "progress_seconds" integer DEFAULT 0,
    "is_completed" boolean DEFAULT false,
    "last_watched" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_progress_progress_seconds_check" CHECK (("progress_seconds" >= 0))
);


ALTER TABLE "public"."user_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" character varying(255) NOT NULL,
    "username" character varying(50) NOT NULL,
    "avatar_url" "text",
    "subscription_type" character varying(20) DEFAULT 'free'::character varying,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role" character varying(20) DEFAULT 'user'::character varying,
    "is_admin" boolean DEFAULT false,
    "last_login" timestamp with time zone,
    "total_watch_time" integer DEFAULT 0,
    "anime_watched" integer DEFAULT 0,
    CONSTRAINT "users_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['user'::character varying, 'moderator'::character varying, 'admin'::character varying])::"text"[]))),
    CONSTRAINT "users_subscription_type_check" CHECK ((("subscription_type")::"text" = ANY ((ARRAY['free'::character varying, 'premium'::character varying, 'vip'::character varying])::"text"[])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_dashboard_stats" AS
 SELECT ( SELECT "count"(*) AS "count"
           FROM "public"."users") AS "total_users",
    ( SELECT "count"(*) AS "count"
           FROM "public"."anime") AS "total_anime",
    ( SELECT "count"(*) AS "count"
           FROM "public"."episodes") AS "total_episodes",
    ( SELECT "count"(*) AS "count"
           FROM "public"."reviews") AS "total_reviews",
    ( SELECT "count"(*) AS "count"
           FROM "public"."users"
          WHERE ("users"."created_at" >= ("now"() - '7 days'::interval))) AS "recent_users",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_progress"
          WHERE ("user_progress"."last_watched" >= ("now"() - '24:00:00'::interval))) AS "active_users",
    ( SELECT "count"(*) AS "count"
           FROM "public"."users"
          WHERE (("users"."subscription_type")::"text" <> 'free'::"text")) AS "premium_users",
    ( SELECT COALESCE("sum"("user_progress"."progress_seconds"), (0)::bigint) AS "coalesce"
           FROM "public"."user_progress") AS "total_watch_time_seconds";


ALTER VIEW "public"."admin_dashboard_stats" OWNER TO "postgres";


COMMENT ON VIEW "public"."admin_dashboard_stats" IS 'Aggregated statistics for the admin dashboard';



CREATE TABLE IF NOT EXISTS "public"."admin_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "site_name" character varying(255) DEFAULT 'AnimeHub'::character varying NOT NULL,
    "site_description" "text" DEFAULT 'Your ultimate anime streaming platform'::"text",
    "maintenance_mode" boolean DEFAULT false,
    "allow_registration" boolean DEFAULT true,
    "max_file_size" integer DEFAULT 5242880,
    "allowed_file_types" "text"[] DEFAULT ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/gif'::"text", 'image/webp'::"text"],
    "email_notifications" boolean DEFAULT true,
    "analytics_enabled" boolean DEFAULT true,
    "cache_enabled" boolean DEFAULT true,
    "cache_duration" integer DEFAULT 3600,
    "social_login_enabled" boolean DEFAULT true,
    "premium_features_enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."admin_settings" IS 'Stores global admin settings for the application';



CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "event_type" character varying(50) NOT NULL,
    "event_data" "jsonb",
    "user_agent" "text",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."analytics_events" IS 'Tracks user analytics events for reporting and insights';



CREATE TABLE IF NOT EXISTS "public"."anime_characters" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid",
    "name" character varying(255) NOT NULL,
    "name_japanese" character varying(255),
    "name_romaji" character varying(255),
    "image_url" "text",
    "role" character varying(50),
    "description" "text",
    "voice_actor" character varying(255),
    "voice_actor_japanese" character varying(255),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "anime_characters_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['main'::character varying, 'supporting'::character varying, 'antagonist'::character varying, 'background'::character varying])::"text"[])))
);


ALTER TABLE "public"."anime_characters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anime_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid",
    "related_anime_id" "text" NOT NULL,
    "relation_type" character varying(50) NOT NULL,
    "anilist_id" integer,
    "mal_id" integer,
    "title" character varying(255),
    "format" character varying(50),
    "status" character varying(50),
    "episodes" integer,
    "year" integer,
    "poster_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."anime_relations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anime_request_votes" (
    "request_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL
);


ALTER TABLE "public"."anime_request_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anime_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "mal_id" integer,
    "notes" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "vote_count" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "anime_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."anime_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anime_studio_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid",
    "studio_id" "uuid",
    "role" character varying(50),
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "anime_studio_relations_role_check" CHECK ((("role")::"text" = ANY ((ARRAY['animation'::character varying, 'production'::character varying, 'music'::character varying, 'sound'::character varying, 'other'::character varying])::"text"[])))
);


ALTER TABLE "public"."anime_studio_relations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."anime_studios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anilist_id" integer,
    "name" character varying(255) NOT NULL,
    "name_japanese" character varying(255),
    "description" "text",
    "website" "text",
    "logo_url" "text",
    "founded_year" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."anime_studios" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."anime_with_stats" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::character varying(255) AS "title",
    NULL::character varying(255) AS "title_japanese",
    NULL::"text" AS "description",
    NULL::"text" AS "poster_url",
    NULL::"text" AS "banner_url",
    NULL::"text" AS "trailer_url",
    NULL::numeric(3,1) AS "rating",
    NULL::integer AS "year",
    NULL::character varying(20) AS "status",
    NULL::character varying(20) AS "type",
    NULL::"text"[] AS "genres",
    NULL::"text"[] AS "studios",
    NULL::integer AS "total_episodes",
    NULL::integer AS "duration",
    NULL::character varying(10) AS "age_rating",
    NULL::timestamp with time zone AS "created_at",
    NULL::timestamp with time zone AS "updated_at",
    NULL::bigint AS "actual_episode_count",
    NULL::bigint AS "free_episode_count",
    NULL::bigint AS "premium_episode_count",
    NULL::bigint AS "favorite_count",
    NULL::bigint AS "watchlist_count",
    NULL::bigint AS "total_watches",
    NULL::bigint AS "completed_watches",
    NULL::bigint AS "review_count",
    NULL::numeric AS "user_rating_avg",
    NULL::bigint AS "recent_activity";


ALTER VIEW "public"."anime_with_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "content_type" character varying(20) NOT NULL,
    "report_type" character varying(50) NOT NULL,
    "title" character varying(255) NOT NULL,
    "description" "text" NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    "priority" character varying(10) DEFAULT 'medium'::character varying NOT NULL,
    "reported_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "resolved_by" "uuid",
    "resolution_notes" "text",
    CONSTRAINT "content_reports_content_type_check" CHECK ((("content_type")::"text" = ANY ((ARRAY['anime'::character varying, 'episode'::character varying])::"text"[]))),
    CONSTRAINT "content_reports_priority_check" CHECK ((("priority")::"text" = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying])::"text"[]))),
    CONSTRAINT "content_reports_report_type_check" CHECK ((("report_type")::"text" = ANY ((ARRAY['inappropriate_content'::character varying, 'copyright'::character varying, 'spam'::character varying, 'other'::character varying])::"text"[]))),
    CONSTRAINT "content_reports_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'investigating'::character varying, 'resolved'::character varying, 'dismissed'::character varying])::"text"[])))
);


ALTER TABLE "public"."content_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_scraping_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scraping_progress_id" "uuid",
    "episode_number" integer NOT NULL,
    "chunk_number" integer NOT NULL,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "video_url" "text",
    "error_message" "text",
    "scraped_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "episode_scraping_log_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'scraping'::character varying, 'success'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."episode_scraping_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."episode_scraping_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid",
    "schedule_type" character varying(50) NOT NULL,
    "interval_minutes" integer DEFAULT 60,
    "last_run_at" timestamp with time zone,
    "next_run_at" timestamp with time zone,
    "is_active" boolean DEFAULT true,
    "priority" integer DEFAULT 5,
    "max_episodes_per_run" integer DEFAULT 10,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "episode_scraping_schedules_schedule_type_check" CHECK ((("schedule_type")::"text" = ANY ((ARRAY['periodic'::character varying, 'on_demand'::character varying, 'new_episode_check'::character varying])::"text"[])))
);


ALTER TABLE "public"."episode_scraping_schedules" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."genre_stats" AS
 SELECT "genre",
    "count"(*) AS "anime_count",
    "avg"("rating") AS "avg_rating",
    "count"(
        CASE
            WHEN (("status")::"text" = 'ongoing'::"text") THEN 1
            ELSE NULL::integer
        END) AS "ongoing_count",
    "count"(
        CASE
            WHEN (("status")::"text" = 'completed'::"text") THEN 1
            ELSE NULL::integer
        END) AS "completed_count",
    "count"(
        CASE
            WHEN (("status")::"text" = 'upcoming'::"text") THEN 1
            ELSE NULL::integer
        END) AS "upcoming_count"
   FROM ( SELECT "unnest"("anime"."genres") AS "genre",
            "anime"."rating",
            "anime"."status"
           FROM "public"."anime") "genre_data"
  GROUP BY "genre"
  ORDER BY ("count"(*)) DESC, ("avg"("rating")) DESC;


ALTER VIEW "public"."genre_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."image_cache" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cache_key" "text" NOT NULL,
    "original_url" "text" NOT NULL,
    "optimized_url" "text" NOT NULL,
    "width" integer DEFAULT 0,
    "height" integer DEFAULT 0,
    "format" character varying(10) DEFAULT 'webp'::character varying,
    "size_bytes" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."image_cache" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" character varying(20) NOT NULL,
    "source" character varying(20) NOT NULL,
    "query" "text",
    "imported_count" integer DEFAULT 0,
    "skipped_count" integer DEFAULT 0,
    "error_count" integer DEFAULT 0,
    "duration_ms" integer DEFAULT 0,
    "genres" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "import_analytics_event_type_check" CHECK ((("event_type")::"text" = ANY ((ARRAY['search'::character varying, 'trending'::character varying, 'seasonal'::character varying, 'bulk'::character varying])::"text"[]))),
    CONSTRAINT "import_analytics_source_check" CHECK ((("source")::"text" = ANY ((ARRAY['jikan'::character varying, 'anilist'::character varying])::"text"[])))
);


ALTER TABLE "public"."import_analytics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "config_id" "uuid",
    "status" character varying(20) NOT NULL,
    "imported" integer DEFAULT 0,
    "skipped" integer DEFAULT 0,
    "errors" "text"[],
    "started_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone NOT NULL,
    "duration_ms" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "import_logs_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['success'::character varying, 'partial'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."import_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "text" NOT NULL,
    "report_type" character varying(20) NOT NULL,
    "period" "text" NOT NULL,
    "generated_at" timestamp with time zone NOT NULL,
    "analytics_data" "jsonb" NOT NULL,
    "recommendations" "text"[],
    "insights" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "import_reports_report_type_check" CHECK ((("report_type")::"text" = ANY ((ARRAY['daily'::character varying, 'weekly'::character varying, 'monthly'::character varying, 'custom'::character varying])::"text"[])))
);


ALTER TABLE "public"."import_reports" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."index_usage_stats" AS
 SELECT "schemaname",
    "relname" AS "table_name",
    "indexrelname" AS "index_name",
    "idx_scan",
    "idx_tup_read",
    "idx_tup_fetch"
   FROM "pg_stat_user_indexes"
  WHERE ("schemaname" = 'public'::"name")
  ORDER BY "idx_scan" DESC;


ALTER VIEW "public"."index_usage_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "type" character varying(50) DEFAULT 'system'::character varying NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb",
    "read" boolean DEFAULT false,
    "action_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "sub_label" "text",
    "free_value" "text" DEFAULT '✓'::"text" NOT NULL,
    "premium_value" "text" DEFAULT '✓'::"text" NOT NULL,
    "is_highlighted" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."plan_features" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_favorites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "anime_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_watchlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "anime_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_watchlist" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."popular_anime" AS
 SELECT "id",
    "title",
    "title_japanese",
    "description",
    "poster_url",
    "banner_url",
    "rating",
    "year",
    "status",
    "type",
    "genres",
    "studios",
    "total_episodes",
    "duration",
    "age_rating",
    "created_at",
    "updated_at",
    COALESCE((((((( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE ("uf"."anime_id" = "a"."id")) * 2) + ( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE ("uw"."anime_id" = "a"."id"))) + (( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
          WHERE (("e"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '30 days'::interval)))) * 3)))::numeric + ((( SELECT "count"(*) AS "count"
           FROM "public"."reviews" "r"
          WHERE (("r"."anime_id" = "a"."id") AND ("r"."rating" >= 7))))::numeric * 1.5)), (0)::numeric) AS "popularity_score",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
          WHERE (("e"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '7 days'::interval)))) AS "recent_activity"
   FROM "public"."anime" "a"
  WHERE (("status")::"text" = ANY ((ARRAY['ongoing'::character varying, 'completed'::character varying])::"text"[]))
  ORDER BY COALESCE((((((( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE ("uf"."anime_id" = "a"."id")) * 2) + ( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE ("uw"."anime_id" = "a"."id"))) + (( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
          WHERE (("e"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '30 days'::interval)))) * 3)))::numeric + ((( SELECT "count"(*) AS "count"
           FROM "public"."reviews" "r"
          WHERE (("r"."anime_id" = "a"."id") AND ("r"."rating" >= 7))))::numeric * 1.5)), (0)::numeric) DESC, "rating" DESC NULLS LAST
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."popular_anime" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "import_type" character varying(50) NOT NULL,
    "source" character varying(100),
    "config" "jsonb",
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "scheduled_at" timestamp with time zone NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "result" "jsonb",
    "error_message" "text",
    "retry_count" integer DEFAULT 0,
    "max_retries" integer DEFAULT 3,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "scheduled_imports_import_type_check" CHECK ((("import_type")::"text" = ANY ((ARRAY['new_anime_discovery'::character varying, 'episode_check'::character varying, 'bulk_import'::character varying, 'episode_scraping'::character varying])::"text"[]))),
    CONSTRAINT "scheduled_imports_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."scheduled_imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scraper_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_name" character varying(50) NOT NULL,
    "is_enabled" boolean DEFAULT true,
    "priority_weight" integer DEFAULT 1,
    "request_timeout_ms" integer DEFAULT 45000,
    "cooldown_delay_ms" integer DEFAULT 3000,
    "retries_count" integer DEFAULT 2,
    "user_agent_category" character varying(50) DEFAULT 'desktop_chrome'::character varying,
    "bypass_cf_turnstile" boolean DEFAULT false,
    "error_cooldown_threshold" integer DEFAULT 5,
    "last_success_at" timestamp with time zone,
    "last_error_msg" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."scraper_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scraping_progress" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "anime_id" "uuid" NOT NULL,
    "anime_title" character varying(255) NOT NULL,
    "total_episodes" integer NOT NULL,
    "completed_episodes" integer DEFAULT 0,
    "failed_episodes" integer DEFAULT 0,
    "current_chunk" integer DEFAULT 1,
    "total_chunks" integer DEFAULT 1,
    "chunk_size" integer DEFAULT 50,
    "status" character varying(20) DEFAULT 'pending'::character varying,
    "started_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "scraping_progress_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['pending'::character varying, 'in_progress'::character varying, 'completed'::character varying, 'failed'::character varying])::"text"[])))
);


ALTER TABLE "public"."scraping_progress" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "tier" "text" DEFAULT 'free'::"text" NOT NULL,
    "price_paise" integer DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "billing_cycle" "text",
    "badge" "text",
    "savings_text" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_health_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "metric_name" character varying(100) NOT NULL,
    "metric_value" numeric,
    "metric_unit" character varying(20),
    "status" character varying(20) DEFAULT 'healthy'::character varying,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "system_health_log_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['healthy'::character varying, 'warning'::character varying, 'error'::character varying])::"text"[])))
);


ALTER TABLE "public"."system_health_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_health_log" IS 'Monitors system health metrics and performance';



CREATE MATERIALIZED VIEW "public"."trending_anime" AS
 SELECT "id",
    "title",
    "title_japanese",
    "description",
    "poster_url",
    "banner_url",
    "rating",
    "year",
    "status",
    "type",
    "genres",
    "studios",
    "total_episodes",
    "duration",
    "age_rating",
    "created_at",
    "updated_at",
    COALESCE((((( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
          WHERE (("e"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '7 days'::interval)))) * 5) + (( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE (("uf"."anime_id" = "a"."id") AND ("uf"."created_at" > ("now"() - '7 days'::interval)))) * 3)) + (( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE (("uw"."anime_id" = "a"."id") AND ("uw"."created_at" > ("now"() - '7 days'::interval)))) * 2)), (0)::bigint) AS "trending_score"
   FROM "public"."anime" "a"
  WHERE ((("status")::"text" = ANY ((ARRAY['ongoing'::character varying, 'completed'::character varying])::"text"[])) AND ("created_at" > ("now"() - '2 years'::interval)))
  ORDER BY COALESCE((((( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
          WHERE (("e"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '7 days'::interval)))) * 5) + (( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE (("uf"."anime_id" = "a"."id") AND ("uf"."created_at" > ("now"() - '7 days'::interval)))) * 3)) + (( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE (("uw"."anime_id" = "a"."id") AND ("uw"."created_at" > ("now"() - '7 days'::interval)))) * 2)), (0)::bigint) DESC, "rating" DESC NULLS LAST
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."trending_anime" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "activity_type" character varying(50) NOT NULL,
    "activity_data" "jsonb",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_activity_log" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_activity_log" IS 'Logs user activities for audit and analytics purposes';



CREATE OR REPLACE VIEW "public"."user_activity_summary" AS
 SELECT "id" AS "user_id",
    "username",
    "email",
    "subscription_type",
    "created_at" AS "user_created_at",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_progress" "up"
          WHERE ("up"."user_id" = "u"."id")) AS "total_episodes_watched",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_progress" "up"
          WHERE (("up"."user_id" = "u"."id") AND ("up"."is_completed" = true))) AS "completed_episodes",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE ("uf"."user_id" = "u"."id")) AS "favorite_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE ("uw"."user_id" = "u"."id")) AS "watchlist_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."reviews" "r"
          WHERE ("r"."user_id" = "u"."id")) AS "review_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_progress" "up"
          WHERE (("up"."user_id" = "u"."id") AND ("up"."last_watched" > ("now"() - '7 days'::interval)))) AS "recent_activity",
    ( SELECT "max"("up"."last_watched") AS "max"
           FROM "public"."user_progress" "up"
          WHERE ("up"."user_id" = "u"."id")) AS "last_activity"
   FROM "public"."users" "u";


ALTER VIEW "public"."user_activity_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_badges" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "badge_code" character varying(50) NOT NULL,
    "earned_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_badges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_preferences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "favorite_genres" "text"[] DEFAULT '{}'::"text"[],
    "preferred_language" character varying(10) DEFAULT 'en'::character varying,
    "auto_play_next" boolean DEFAULT true,
    "quality_preference" character varying(10) DEFAULT 'auto'::character varying,
    "theme_preference" character varying(10) DEFAULT 'light'::character varying,
    "notification_settings" "jsonb" DEFAULT '{"push": true, "email": true, "recommendations": true}'::"jsonb",
    "privacy_settings" "jsonb" DEFAULT '{"profile_public": true, "watch_history_public": false}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "auto_skip_intro" boolean DEFAULT true NOT NULL,
    "audio_preference" "text" DEFAULT 'Japanese (Original)'::"text" NOT NULL,
    "two_factor_enabled" boolean DEFAULT false NOT NULL,
    "use_native_player" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."user_preferences" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_preferences"."auto_skip_intro" IS 'Preference to automatically click/skip intro and outro buttons in video player.';



COMMENT ON COLUMN "public"."user_preferences"."audio_preference" IS 'Default preferred audio track style (e.g. Japanese (Original) or English Dub).';



COMMENT ON COLUMN "public"."user_preferences"."two_factor_enabled" IS 'Security setting indicating if two-factor authentication is active.';



COMMENT ON COLUMN "public"."user_preferences"."use_native_player" IS 'When true (default), AnimeHub injects its own HUD controls (seek bar, play/pause, quality picker) over the embedded video player. When false, the embedded player''s own native controls are left untouched.';



CREATE TABLE IF NOT EXISTS "public"."user_push_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "device_name" "text" DEFAULT 'Unknown Device'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_push_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_push_tokens" IS 'Stores Expo push notification tokens for registered user devices. One row per user+token pair, supporting multiple devices per user.';



CREATE TABLE IF NOT EXISTS "public"."user_stats" (
    "user_id" "uuid" NOT NULL,
    "total_watch_time" integer DEFAULT 0,
    "episodes_watched_count" integer DEFAULT 0,
    "completed_anime_count" integer DEFAULT 0,
    "current_streak" integer DEFAULT 0,
    "longest_streak" integer DEFAULT 0,
    "last_watched_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_stats" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_watch_progress_detailed" AS
 SELECT "up"."id" AS "progress_id",
    "up"."user_id",
    "up"."progress_seconds",
    "up"."is_completed",
    "up"."last_watched",
    "up"."created_at" AS "progress_created_at",
    "e"."id" AS "episode_id",
    "e"."episode_number",
    "e"."title" AS "episode_title",
    "e"."description" AS "episode_description",
    "e"."thumbnail_url",
    "e"."video_url",
    "e"."duration" AS "episode_duration",
    "e"."is_premium",
    "e"."air_date",
    "a"."id" AS "anime_id",
    "a"."title" AS "anime_title",
    "a"."title_japanese",
    "a"."description" AS "anime_description",
    "a"."poster_url",
    "a"."banner_url",
    "a"."rating" AS "anime_rating",
    "a"."year",
    "a"."status" AS "anime_status",
    "a"."type" AS "anime_type",
    "a"."genres",
    "a"."studios",
    "a"."total_episodes",
    "a"."duration" AS "anime_duration",
    "a"."age_rating",
        CASE
            WHEN ("e"."duration" > 0) THEN (((("up"."progress_seconds")::numeric / ("e"."duration")::numeric) * (100)::numeric))::numeric(5,2)
            ELSE (0)::numeric
        END AS "progress_percentage"
   FROM (("public"."user_progress" "up"
     JOIN "public"."episodes" "e" ON (("up"."episode_id" = "e"."id")))
     JOIN "public"."anime" "a" ON (("e"."anime_id" = "a"."id")));


ALTER VIEW "public"."user_watch_progress_detailed" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_settings"
    ADD CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime_characters"
    ADD CONSTRAINT "anime_characters_anime_id_name_key" UNIQUE ("anime_id", "name");



ALTER TABLE ONLY "public"."anime_characters"
    ADD CONSTRAINT "anime_characters_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime"
    ADD CONSTRAINT "anime_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime_relations"
    ADD CONSTRAINT "anime_relations_anime_id_related_anime_id_relation_type_key" UNIQUE ("anime_id", "related_anime_id", "relation_type");



ALTER TABLE ONLY "public"."anime_relations"
    ADD CONSTRAINT "anime_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime_request_votes"
    ADD CONSTRAINT "anime_request_votes_pkey" PRIMARY KEY ("request_id", "user_id");



ALTER TABLE ONLY "public"."anime_requests"
    ADD CONSTRAINT "anime_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime_studio_relations"
    ADD CONSTRAINT "anime_studio_relations_anime_id_studio_id_role_key" UNIQUE ("anime_id", "studio_id", "role");



ALTER TABLE ONLY "public"."anime_studio_relations"
    ADD CONSTRAINT "anime_studio_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."anime_studios"
    ADD CONSTRAINT "anime_studios_anilist_id_key" UNIQUE ("anilist_id");



ALTER TABLE ONLY "public"."anime_studios"
    ADD CONSTRAINT "anime_studios_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."anime_studios"
    ADD CONSTRAINT "anime_studios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_scraping_log"
    ADD CONSTRAINT "episode_scraping_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episode_scraping_log"
    ADD CONSTRAINT "episode_scraping_log_scraping_progress_id_episode_number_key" UNIQUE ("scraping_progress_id", "episode_number");



ALTER TABLE ONLY "public"."episode_scraping_schedules"
    ADD CONSTRAINT "episode_scraping_schedules_anime_id_schedule_type_key" UNIQUE ("anime_id", "schedule_type");



ALTER TABLE ONLY "public"."episode_scraping_schedules"
    ADD CONSTRAINT "episode_scraping_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_anime_id_episode_number_key" UNIQUE ("anime_id", "episode_number");



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."image_cache"
    ADD CONSTRAINT "image_cache_cache_key_key" UNIQUE ("cache_key");



ALTER TABLE ONLY "public"."image_cache"
    ADD CONSTRAINT "image_cache_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_analytics"
    ADD CONSTRAINT "import_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_logs"
    ADD CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_reports"
    ADD CONSTRAINT "import_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_reports"
    ADD CONSTRAINT "import_reports_report_id_key" UNIQUE ("report_id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plan_features"
    ADD CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_imports"
    ADD CONSTRAINT "scheduled_imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scraper_config"
    ADD CONSTRAINT "scraper_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scraper_config"
    ADD CONSTRAINT "scraper_config_provider_name_key" UNIQUE ("provider_name");



ALTER TABLE ONLY "public"."scraping_progress"
    ADD CONSTRAINT "scraping_progress_anime_id_key" UNIQUE ("anime_id");



ALTER TABLE ONLY "public"."scraping_progress"
    ADD CONSTRAINT "scraping_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_health_log"
    ADD CONSTRAINT "system_health_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_activity_log"
    ADD CONSTRAINT "user_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_badge_code_key" UNIQUE ("user_id", "badge_code");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_user_id_anime_id_key" UNIQUE ("user_id", "anime_id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."user_progress"
    ADD CONSTRAINT "user_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_progress"
    ADD CONSTRAINT "user_progress_user_id_episode_id_key" UNIQUE ("user_id", "episode_id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_user_token_unique" UNIQUE ("user_id", "token");



ALTER TABLE ONLY "public"."user_stats"
    ADD CONSTRAINT "user_stats_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_watchlist"
    ADD CONSTRAINT "user_watchlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_watchlist"
    ADD CONSTRAINT "user_watchlist_user_id_anime_id_key" UNIQUE ("user_id", "anime_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");



CREATE INDEX "anime_requests_status_votes_idx" ON "public"."anime_requests" USING "btree" ("status", "vote_count" DESC);



CREATE INDEX "anime_requests_user_id_idx" ON "public"."anime_requests" USING "btree" ("user_id");



CREATE UNIQUE INDEX "anime_requests_user_title_uidx" ON "public"."anime_requests" USING "btree" ("user_id", "lower"(TRIM(BOTH FROM "title")));



CREATE INDEX "idx_analytics_events_created_at" ON "public"."analytics_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_analytics_events_type" ON "public"."analytics_events" USING "btree" ("event_type");



CREATE INDEX "idx_analytics_events_user_id" ON "public"."analytics_events" USING "btree" ("user_id");



CREATE INDEX "idx_anime_characters_anime_id" ON "public"."anime_characters" USING "btree" ("anime_id");



CREATE INDEX "idx_anime_characters_role" ON "public"."anime_characters" USING "btree" ("role");



CREATE INDEX "idx_anime_completed" ON "public"."anime" USING "btree" ("id", "title", "poster_url", "rating") WHERE (("status")::"text" = 'completed'::"text");



CREATE INDEX "idx_anime_genres" ON "public"."anime" USING "gin" ("genres");



CREATE INDEX "idx_anime_genres_gin" ON "public"."anime" USING "gin" ("genres");



CREATE INDEX "idx_anime_mal_id" ON "public"."anime" USING "btree" ("mal_id") WHERE ("mal_id" IS NOT NULL);



CREATE INDEX "idx_anime_nine_anime_slug" ON "public"."anime" USING "btree" ("nine_anime_slug") WHERE ("nine_anime_slug" IS NOT NULL);



CREATE INDEX "idx_anime_ongoing" ON "public"."anime" USING "btree" ("id", "title", "poster_url", "rating") WHERE (("status")::"text" = 'ongoing'::"text");



CREATE INDEX "idx_anime_rating" ON "public"."anime" USING "btree" ("rating");



CREATE INDEX "idx_anime_rating_year" ON "public"."anime" USING "btree" ("rating" DESC NULLS LAST, "year" DESC NULLS LAST);



CREATE INDEX "idx_anime_relations_anime_id" ON "public"."anime_relations" USING "btree" ("anime_id");



CREATE INDEX "idx_anime_relations_related_anime_id" ON "public"."anime_relations" USING "btree" ("related_anime_id");



CREATE INDEX "idx_anime_relations_type" ON "public"."anime_relations" USING "btree" ("relation_type");



CREATE INDEX "idx_anime_status" ON "public"."anime" USING "btree" ("status");



CREATE INDEX "idx_anime_studio_relations_anime_id" ON "public"."anime_studio_relations" USING "btree" ("anime_id");



CREATE INDEX "idx_anime_studio_relations_studio_id" ON "public"."anime_studio_relations" USING "btree" ("studio_id");



CREATE INDEX "idx_anime_studios_gin" ON "public"."anime" USING "gin" ("studios");



CREATE INDEX "idx_anime_title_search" ON "public"."anime" USING "gin" ("to_tsvector"('"english"'::"regconfig", ("title")::"text"));



CREATE INDEX "idx_anime_type" ON "public"."anime" USING "btree" ("type");



CREATE INDEX "idx_anime_year" ON "public"."anime" USING "btree" ("year");



CREATE INDEX "idx_anime_year_type" ON "public"."anime" USING "btree" ("year", "type") WHERE ("year" IS NOT NULL);



CREATE INDEX "idx_content_reports_content_id" ON "public"."content_reports" USING "btree" ("content_id");



CREATE INDEX "idx_content_reports_content_type" ON "public"."content_reports" USING "btree" ("content_type");



CREATE INDEX "idx_content_reports_reported_by" ON "public"."content_reports" USING "btree" ("reported_by");



CREATE INDEX "idx_content_reports_status" ON "public"."content_reports" USING "btree" ("status");



CREATE INDEX "idx_episode_scraping_log_progress" ON "public"."episode_scraping_log" USING "btree" ("scraping_progress_id", "status");



CREATE INDEX "idx_episode_scraping_schedules_active" ON "public"."episode_scraping_schedules" USING "btree" ("is_active", "next_run_at");



CREATE INDEX "idx_episode_scraping_schedules_anime_id" ON "public"."episode_scraping_schedules" USING "btree" ("anime_id");



CREATE INDEX "idx_episode_scraping_schedules_next_run" ON "public"."episode_scraping_schedules" USING "btree" ("next_run_at") WHERE ("is_active" = true);



CREATE INDEX "idx_episodes_anime_episode_composite" ON "public"."episodes" USING "btree" ("anime_id", "episode_number", "is_premium");



CREATE INDEX "idx_episodes_anime_id" ON "public"."episodes" USING "btree" ("anime_id");



CREATE INDEX "idx_episodes_number" ON "public"."episodes" USING "btree" ("anime_id", "episode_number");



CREATE INDEX "idx_episodes_premium" ON "public"."episodes" USING "btree" ("anime_id", "episode_number") WHERE ("is_premium" = true);



CREATE INDEX "idx_episodes_video_servers" ON "public"."episodes" USING "gin" ("video_servers");



CREATE INDEX "idx_image_cache_created" ON "public"."image_cache" USING "btree" ("created_at");



CREATE INDEX "idx_image_cache_expires" ON "public"."image_cache" USING "btree" ("expires_at");



CREATE INDEX "idx_image_cache_key" ON "public"."image_cache" USING "btree" ("cache_key");



CREATE INDEX "idx_import_analytics_created_at" ON "public"."import_analytics" USING "btree" ("created_at");



CREATE INDEX "idx_import_analytics_event_type" ON "public"."import_analytics" USING "btree" ("event_type");



CREATE INDEX "idx_import_analytics_source" ON "public"."import_analytics" USING "btree" ("source");



CREATE INDEX "idx_import_logs_config_id" ON "public"."import_logs" USING "btree" ("config_id");



CREATE INDEX "idx_import_logs_started_at" ON "public"."import_logs" USING "btree" ("started_at");



CREATE INDEX "idx_import_reports_generated_at" ON "public"."import_reports" USING "btree" ("generated_at");



CREATE INDEX "idx_import_reports_type" ON "public"."import_reports" USING "btree" ("report_type");



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_notifications_user_read" ON "public"."notifications" USING "btree" ("user_id", "read");



CREATE INDEX "idx_popular_anime_recent" ON "public"."popular_anime" USING "btree" ("recent_activity" DESC);



CREATE INDEX "idx_popular_anime_score" ON "public"."popular_anime" USING "btree" ("popularity_score" DESC);



CREATE INDEX "idx_reviews_anime_id" ON "public"."reviews" USING "btree" ("anime_id");



CREATE INDEX "idx_reviews_anime_rating" ON "public"."reviews" USING "btree" ("anime_id", "rating" DESC, "created_at" DESC);



CREATE INDEX "idx_reviews_rating" ON "public"."reviews" USING "btree" ("rating");



CREATE INDEX "idx_scheduled_imports_status" ON "public"."scheduled_imports" USING "btree" ("status", "scheduled_at");



CREATE INDEX "idx_scheduled_imports_type" ON "public"."scheduled_imports" USING "btree" ("import_type", "status");



CREATE INDEX "idx_scraping_progress_status" ON "public"."scraping_progress" USING "btree" ("status");



CREATE INDEX "idx_system_health_created_at" ON "public"."system_health_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_system_health_metric" ON "public"."system_health_log" USING "btree" ("metric_name");



CREATE INDEX "idx_trending_anime_score" ON "public"."trending_anime" USING "btree" ("trending_score" DESC);



CREATE INDEX "idx_user_activity_created_at" ON "public"."user_activity_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_user_activity_type" ON "public"."user_activity_log" USING "btree" ("activity_type");



CREATE INDEX "idx_user_activity_user_id" ON "public"."user_activity_log" USING "btree" ("user_id");



CREATE INDEX "idx_user_favorites_composite" ON "public"."user_favorites" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_user_favorites_user_id" ON "public"."user_favorites" USING "btree" ("user_id");



CREATE INDEX "idx_user_preferences_user_id" ON "public"."user_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_user_progress_composite" ON "public"."user_progress" USING "btree" ("user_id", "episode_id", "last_watched" DESC);



CREATE INDEX "idx_user_progress_last_watched" ON "public"."user_progress" USING "btree" ("last_watched");



CREATE INDEX "idx_user_progress_user_id" ON "public"."user_progress" USING "btree" ("user_id");



CREATE INDEX "idx_user_push_tokens_token" ON "public"."user_push_tokens" USING "btree" ("token");



CREATE INDEX "idx_user_push_tokens_user_id" ON "public"."user_push_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_user_watchlist_composite" ON "public"."user_watchlist" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_user_watchlist_user_id" ON "public"."user_watchlist" USING "btree" ("user_id");



CREATE OR REPLACE VIEW "public"."anime_with_stats" AS
 SELECT "a"."id",
    "a"."title",
    "a"."title_japanese",
    "a"."description",
    "a"."poster_url",
    "a"."banner_url",
    "a"."trailer_url",
    "a"."rating",
    "a"."year",
    "a"."status",
    "a"."type",
    "a"."genres",
    "a"."studios",
    "a"."total_episodes",
    "a"."duration",
    "a"."age_rating",
    "a"."created_at",
    "a"."updated_at",
    "count"("e"."id") AS "actual_episode_count",
    "count"(
        CASE
            WHEN ("e"."is_premium" = false) THEN 1
            ELSE NULL::integer
        END) AS "free_episode_count",
    "count"(
        CASE
            WHEN ("e"."is_premium" = true) THEN 1
            ELSE NULL::integer
        END) AS "premium_episode_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_favorites" "uf"
          WHERE ("uf"."anime_id" = "a"."id")) AS "favorite_count",
    ( SELECT "count"(*) AS "count"
           FROM "public"."user_watchlist" "uw"
          WHERE ("uw"."anime_id" = "a"."id")) AS "watchlist_count",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e_1" ON (("up"."episode_id" = "e_1"."id")))
          WHERE ("e_1"."anime_id" = "a"."id")) AS "total_watches",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e_1" ON (("up"."episode_id" = "e_1"."id")))
          WHERE (("e_1"."anime_id" = "a"."id") AND ("up"."is_completed" = true))) AS "completed_watches",
    ( SELECT "count"(*) AS "count"
           FROM "public"."reviews" "r"
          WHERE ("r"."anime_id" = "a"."id")) AS "review_count",
    ( SELECT "avg"("r"."rating") AS "avg"
           FROM "public"."reviews" "r"
          WHERE ("r"."anime_id" = "a"."id")) AS "user_rating_avg",
    ( SELECT "count"(*) AS "count"
           FROM ("public"."user_progress" "up"
             JOIN "public"."episodes" "e_1" ON (("up"."episode_id" = "e_1"."id")))
          WHERE (("e_1"."anime_id" = "a"."id") AND ("up"."last_watched" > ("now"() - '7 days'::interval)))) AS "recent_activity"
   FROM ("public"."anime" "a"
     LEFT JOIN "public"."episodes" "e" ON (("a"."id" = "e"."anime_id")))
  GROUP BY "a"."id";



CREATE OR REPLACE TRIGGER "anime_requests_updated_at" BEFORE UPDATE ON "public"."anime_requests" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "on_new_anime_added" AFTER INSERT ON "public"."anime" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_anime_notification"();



CREATE OR REPLACE TRIGGER "on_new_episode_added" AFTER INSERT ON "public"."episodes" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_episode_notification"();



CREATE OR REPLACE TRIGGER "tr_user_progress_change" AFTER INSERT OR UPDATE ON "public"."user_progress" FOR EACH ROW EXECUTE FUNCTION "public"."handle_user_progress_change"();



CREATE OR REPLACE TRIGGER "trg_subscription_plans_updated_at" BEFORE UPDATE ON "public"."subscription_plans" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "update_admin_settings_updated_at" BEFORE UPDATE ON "public"."admin_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_anime_characters_updated_at" BEFORE UPDATE ON "public"."anime_characters" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_anime_relations_updated_at" BEFORE UPDATE ON "public"."anime_relations" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_anime_studios_updated_at" BEFORE UPDATE ON "public"."anime_studios" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_anime_updated_at" BEFORE UPDATE ON "public"."anime" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_episode_scraping_schedules_updated_at" BEFORE UPDATE ON "public"."episode_scraping_schedules" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_reviews_updated_at" BEFORE UPDATE ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_scheduled_imports_updated_at" BEFORE UPDATE ON "public"."scheduled_imports" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_user_preferences_updated_at" BEFORE UPDATE ON "public"."user_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_characters"
    ADD CONSTRAINT "anime_characters_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_relations"
    ADD CONSTRAINT "anime_relations_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_request_votes"
    ADD CONSTRAINT "anime_request_votes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."anime_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_request_votes"
    ADD CONSTRAINT "anime_request_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_requests"
    ADD CONSTRAINT "anime_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."anime_studio_relations"
    ADD CONSTRAINT "anime_studio_relations_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."anime_studio_relations"
    ADD CONSTRAINT "anime_studio_relations_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "public"."anime_studios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_reports"
    ADD CONSTRAINT "content_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."episode_scraping_log"
    ADD CONSTRAINT "episode_scraping_log_scraping_progress_id_fkey" FOREIGN KEY ("scraping_progress_id") REFERENCES "public"."scraping_progress"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episode_scraping_schedules"
    ADD CONSTRAINT "episode_scraping_schedules_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."episodes"
    ADD CONSTRAINT "episodes_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_activity_log"
    ADD CONSTRAINT "user_activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_badges"
    ADD CONSTRAINT "user_badges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_preferences"
    ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_progress"
    ADD CONSTRAINT "user_progress_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_progress"
    ADD CONSTRAINT "user_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_push_tokens"
    ADD CONSTRAINT "user_push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_stats"
    ADD CONSTRAINT "user_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_watchlist"
    ADD CONSTRAINT "user_watchlist_anime_id_fkey" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_watchlist"
    ADD CONSTRAINT "user_watchlist_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admin can select all users" ON "public"."users" FOR SELECT USING (("is_admin" = true));



CREATE POLICY "Admins can delete content reports" ON "public"."content_reports" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Admins can update content reports" ON "public"."content_reports" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Admins can view all activity" ON "public"."user_activity_log" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."is_admin" = true) OR (("users"."role")::"text" = 'admin'::"text"))))));



CREATE POLICY "Admins can view all content reports" ON "public"."content_reports" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."role")::"text" = 'admin'::"text")))));



CREATE POLICY "Admins can view analytics" ON "public"."analytics_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."is_admin" = true) OR (("users"."role")::"text" = 'admin'::"text"))))));



CREATE POLICY "Admins can view import logs" ON "public"."import_logs" USING (true);



CREATE POLICY "Allow authenticated users to manage anime_characters" ON "public"."anime_characters" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated users to manage anime_relations" ON "public"."anime_relations" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated users to manage anime_studio_relations" ON "public"."anime_studio_relations" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated users to manage anime_studios" ON "public"."anime_studios" USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Allow public read access" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "Allow public read access on anime_relations" ON "public"."anime_relations" FOR SELECT USING (true);



CREATE POLICY "Allow users to insert their own profile" ON "public"."users" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Allow users to update their own profile" ON "public"."users" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Anyone can manage episode_scraping_log" ON "public"."episode_scraping_log" USING (true);



CREATE POLICY "Anyone can manage episode_scraping_schedules" ON "public"."episode_scraping_schedules" USING (true);



CREATE POLICY "Anyone can manage scheduled_imports" ON "public"."scheduled_imports" USING (true);



CREATE POLICY "Anyone can manage scraping_progress" ON "public"."scraping_progress" USING (true);



CREATE POLICY "Anyone can read requests" ON "public"."anime_requests" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Anyone can view anime" ON "public"."anime" FOR SELECT USING (true);



CREATE POLICY "Anyone can view cached images" ON "public"."image_cache" FOR SELECT USING (true);



CREATE POLICY "Anyone can view episode_scraping_log" ON "public"."episode_scraping_log" FOR SELECT USING (true);



CREATE POLICY "Anyone can view episode_scraping_schedules" ON "public"."episode_scraping_schedules" FOR SELECT USING (true);



CREATE POLICY "Anyone can view episodes" ON "public"."episodes" FOR SELECT USING (true);



CREATE POLICY "Anyone can view reviews" ON "public"."reviews" FOR SELECT USING (true);



CREATE POLICY "Anyone can view scheduled_imports" ON "public"."scheduled_imports" FOR SELECT USING (true);



CREATE POLICY "Anyone can view scraping_progress" ON "public"."scraping_progress" FOR SELECT USING (true);



CREATE POLICY "Authenticated users can delete anime" ON "public"."anime" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can delete episodes" ON "public"."episodes" FOR DELETE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert anime" ON "public"."anime" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert episodes" ON "public"."episodes" FOR INSERT WITH CHECK (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can insert users" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage analytics" ON "public"."import_analytics" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage anime" ON "public"."anime" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage cache" ON "public"."image_cache" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage episodes" ON "public"."episodes" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can manage reports" ON "public"."import_reports" USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can update all users" ON "public"."users" FOR UPDATE USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can update anime" ON "public"."anime" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can update episodes" ON "public"."episodes" FOR UPDATE USING (("auth"."role"() = 'authenticated'::"text"));



CREATE POLICY "Authenticated users can view all users" ON "public"."users" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Only admins can access settings" ON "public"."admin_settings" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."is_admin" = true) OR (("users"."role")::"text" = 'admin'::"text"))))));



CREATE POLICY "Only admins can access system health" ON "public"."system_health_log" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND (("users"."is_admin" = true) OR (("users"."role")::"text" = 'admin'::"text"))))));



CREATE POLICY "Service can insert notifications" ON "public"."notifications" FOR INSERT WITH CHECK (true);



CREATE POLICY "Users can create content reports" ON "public"."content_reports" FOR INSERT WITH CHECK (("auth"."uid"() = "reported_by"));



CREATE POLICY "Users can delete own notifications" ON "public"."notifications" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own preferences" ON "public"."user_preferences" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own activity" ON "public"."user_activity_log" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own analytics" ON "public"."analytics_events" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own badges" ON "public"."user_badges" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own progress" ON "public"."user_progress" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own requests" ON "public"."anime_requests" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own preferences" ON "public"."user_preferences" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert/update own stats" ON "public"."user_stats" TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own favorites" ON "public"."user_favorites" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own preferences" ON "public"."user_preferences" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own progress" ON "public"."user_progress" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own reviews" ON "public"."reviews" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own watchlist" ON "public"."user_watchlist" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own push tokens" ON "public"."user_push_tokens" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own badges" ON "public"."user_badges" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own stats" ON "public"."user_stats" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can select own progress" ON "public"."user_progress" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can update own progress" ON "public"."user_progress" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own preferences" ON "public"."user_preferences" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can upvote or edit own requests" ON "public"."anime_requests" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "user_id") OR ("status" = 'pending'::"text"))) WITH CHECK ((("auth"."uid"() = "user_id") OR ("status" = 'pending'::"text")));



CREATE POLICY "Users can view own activity" ON "public"."user_activity_log" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own favorites" ON "public"."user_favorites" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own preferences" ON "public"."user_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own progress" ON "public"."user_progress" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own watchlist" ON "public"."user_watchlist" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own preferences" ON "public"."user_preferences" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own reports" ON "public"."content_reports" FOR SELECT USING (("auth"."uid"() = "reported_by"));



ALTER TABLE "public"."admin_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_characters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_request_votes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_studio_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."anime_studios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_scraping_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episode_scraping_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."episodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."image_cache" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_read_features" ON "public"."plan_features" FOR SELECT USING (("is_active" = true));



CREATE POLICY "public_read_plans" ON "public"."subscription_plans" FOR SELECT USING (("is_active" = true));



ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scheduled_imports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scraper_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scraping_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_health_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_badges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_push_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_watchlist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."anime";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."episodes";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."calculate_episode_scraping_next_run"() TO "anon";
GRANT ALL ON FUNCTION "public"."calculate_episode_scraping_next_run"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_episode_scraping_next_run"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_image_cache"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_image_cache"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_image_cache"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_analytics"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_analytics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_analytics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_old_progress"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_progress"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_image_cache_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_image_cache_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_image_cache_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_import_analytics_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_import_analytics_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_import_analytics_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_import_logs_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_import_logs_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_import_logs_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_import_reports_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_import_reports_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_import_reports_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_scheduled_imports_table"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_scheduled_imports_table"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_scheduled_imports_table"() TO "service_role";



GRANT ALL ON FUNCTION "public"."create_user_preferences"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_user_preferences"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_preferences"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_anime_recommendations"("user_uuid" "uuid", "limit_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_anime_recommendations"("user_uuid" "uuid", "limit_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_anime_recommendations"("user_uuid" "uuid", "limit_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_daily_import_trends"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_daily_import_trends"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_daily_import_trends"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_distinct_genres"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_distinct_genres"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_distinct_genres"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_due_episode_scraping_imports"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_due_episode_scraping_imports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_due_episode_scraping_imports"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_due_imports"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_due_imports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_due_imports"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_genre_statistics"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_genre_statistics"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_genre_statistics"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_image_cache_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_image_cache_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_image_cache_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_import_analytics_summary"("days_back" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_import_analytics_summary"("days_back" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_import_analytics_summary"("days_back" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_related_anime"("anime_uuid" "uuid", "relation_types" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_related_anime"("anime_uuid" "uuid", "relation_types" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_related_anime"("anime_uuid" "uuid", "relation_types" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_progress_with_anime"("user_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_progress_with_anime"("user_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_progress_with_anime"("user_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_anime_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_anime_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_anime_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_episode_notification"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_episode_notification"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_episode_notification"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_user_progress_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_user_progress_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_user_progress_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin_user"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin_user"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin_user"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_admin"("user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_admin"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_admin"("user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_materialized_views"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_materialized_views"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_materialized_views"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_anime_optimized"("search_term" "text", "genre_filter" "text", "year_filter" integer, "status_filter" "text", "type_filter" "text", "rating_min" numeric, "limit_count" integer, "offset_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_anime_optimized"("search_term" "text", "genre_filter" "text", "year_filter" integer, "status_filter" "text", "type_filter" "text", "rating_min" numeric, "limit_count" integer, "offset_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_anime_optimized"("search_term" "text", "genre_filter" "text", "year_filter" integer, "status_filter" "text", "type_filter" "text", "rating_min" numeric, "limit_count" integer, "offset_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_episode_scraping_next_run"("schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_episode_scraping_next_run"("schedule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_episode_scraping_next_run"("schedule_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_episode_scraping_schedules_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_episode_scraping_schedules_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_episode_scraping_schedules_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_next_run"("import_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_next_run"("import_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_next_run"("import_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_scraping_progress_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_scraping_progress_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_scraping_progress_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON FUNCTION "public"."upvote_anime_request"("request_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."upvote_anime_request"("request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."upvote_anime_request"("request_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."anime" TO "anon";
GRANT ALL ON TABLE "public"."anime" TO "authenticated";
GRANT ALL ON TABLE "public"."anime" TO "service_role";



GRANT ALL ON TABLE "public"."episodes" TO "anon";
GRANT ALL ON TABLE "public"."episodes" TO "authenticated";
GRANT ALL ON TABLE "public"."episodes" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."user_progress" TO "anon";
GRANT ALL ON TABLE "public"."user_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."user_progress" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."admin_dashboard_stats" TO "anon";
GRANT ALL ON TABLE "public"."admin_dashboard_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_dashboard_stats" TO "service_role";



GRANT ALL ON TABLE "public"."admin_settings" TO "anon";
GRANT ALL ON TABLE "public"."admin_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_settings" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."anime_characters" TO "anon";
GRANT ALL ON TABLE "public"."anime_characters" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_characters" TO "service_role";



GRANT ALL ON TABLE "public"."anime_relations" TO "anon";
GRANT ALL ON TABLE "public"."anime_relations" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_relations" TO "service_role";



GRANT ALL ON TABLE "public"."anime_request_votes" TO "anon";
GRANT ALL ON TABLE "public"."anime_request_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_request_votes" TO "service_role";



GRANT ALL ON TABLE "public"."anime_requests" TO "anon";
GRANT ALL ON TABLE "public"."anime_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_requests" TO "service_role";



GRANT ALL ON TABLE "public"."anime_studio_relations" TO "anon";
GRANT ALL ON TABLE "public"."anime_studio_relations" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_studio_relations" TO "service_role";



GRANT ALL ON TABLE "public"."anime_studios" TO "anon";
GRANT ALL ON TABLE "public"."anime_studios" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_studios" TO "service_role";



GRANT ALL ON TABLE "public"."anime_with_stats" TO "anon";
GRANT ALL ON TABLE "public"."anime_with_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."anime_with_stats" TO "service_role";



GRANT ALL ON TABLE "public"."content_reports" TO "anon";
GRANT ALL ON TABLE "public"."content_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."content_reports" TO "service_role";



GRANT ALL ON TABLE "public"."episode_scraping_log" TO "anon";
GRANT ALL ON TABLE "public"."episode_scraping_log" TO "authenticated";
GRANT ALL ON TABLE "public"."episode_scraping_log" TO "service_role";



GRANT ALL ON TABLE "public"."episode_scraping_schedules" TO "anon";
GRANT ALL ON TABLE "public"."episode_scraping_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."episode_scraping_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."genre_stats" TO "anon";
GRANT ALL ON TABLE "public"."genre_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."genre_stats" TO "service_role";



GRANT ALL ON TABLE "public"."image_cache" TO "anon";
GRANT ALL ON TABLE "public"."image_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."image_cache" TO "service_role";



GRANT ALL ON TABLE "public"."import_analytics" TO "anon";
GRANT ALL ON TABLE "public"."import_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."import_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."import_logs" TO "anon";
GRANT ALL ON TABLE "public"."import_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_logs" TO "service_role";



GRANT ALL ON TABLE "public"."import_reports" TO "anon";
GRANT ALL ON TABLE "public"."import_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."import_reports" TO "service_role";



GRANT ALL ON TABLE "public"."index_usage_stats" TO "anon";
GRANT ALL ON TABLE "public"."index_usage_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."index_usage_stats" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."plan_features" TO "anon";
GRANT ALL ON TABLE "public"."plan_features" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_features" TO "service_role";



GRANT ALL ON TABLE "public"."user_favorites" TO "anon";
GRANT ALL ON TABLE "public"."user_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."user_watchlist" TO "anon";
GRANT ALL ON TABLE "public"."user_watchlist" TO "authenticated";
GRANT ALL ON TABLE "public"."user_watchlist" TO "service_role";



GRANT ALL ON TABLE "public"."popular_anime" TO "anon";
GRANT ALL ON TABLE "public"."popular_anime" TO "authenticated";
GRANT ALL ON TABLE "public"."popular_anime" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_imports" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_imports" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_imports" TO "service_role";



GRANT ALL ON TABLE "public"."scraper_config" TO "anon";
GRANT ALL ON TABLE "public"."scraper_config" TO "authenticated";
GRANT ALL ON TABLE "public"."scraper_config" TO "service_role";



GRANT ALL ON TABLE "public"."scraping_progress" TO "anon";
GRANT ALL ON TABLE "public"."scraping_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."scraping_progress" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON TABLE "public"."system_health_log" TO "anon";
GRANT ALL ON TABLE "public"."system_health_log" TO "authenticated";
GRANT ALL ON TABLE "public"."system_health_log" TO "service_role";



GRANT ALL ON TABLE "public"."trending_anime" TO "anon";
GRANT ALL ON TABLE "public"."trending_anime" TO "authenticated";
GRANT ALL ON TABLE "public"."trending_anime" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity_summary" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_summary" TO "service_role";



GRANT ALL ON TABLE "public"."user_badges" TO "anon";
GRANT ALL ON TABLE "public"."user_badges" TO "authenticated";
GRANT ALL ON TABLE "public"."user_badges" TO "service_role";



GRANT ALL ON TABLE "public"."user_preferences" TO "anon";
GRANT ALL ON TABLE "public"."user_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."user_preferences" TO "service_role";



GRANT ALL ON TABLE "public"."user_push_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_push_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_stats" TO "anon";
GRANT ALL ON TABLE "public"."user_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."user_stats" TO "service_role";



GRANT ALL ON TABLE "public"."user_watch_progress_detailed" TO "anon";
GRANT ALL ON TABLE "public"."user_watch_progress_detailed" TO "authenticated";
GRANT ALL ON TABLE "public"."user_watch_progress_detailed" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































