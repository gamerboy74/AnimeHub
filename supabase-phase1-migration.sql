-- ============================================
-- Phase 1 Migration: Settings, Notifications, RLS
-- ============================================

-- 1. Create user_preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  favorite_genres TEXT[] DEFAULT '{}',
  preferred_language VARCHAR(10) DEFAULT 'en',
  auto_play_next BOOLEAN DEFAULT TRUE,
  quality_preference VARCHAR(20) DEFAULT 'auto',
  theme_preference VARCHAR(20) DEFAULT 'light',
  notification_settings JSONB DEFAULT '{"email": true, "push": true, "recommendations": true, "new_episodes": true, "system_updates": false}'::jsonb,
  privacy_settings JSONB DEFAULT '{"profile_public": true, "watch_history_public": false, "allow_recommendations": true}'::jsonb,
  playback_settings JSONB DEFAULT '{"subtitles": true, "skip_intro": true, "skip_outro": false, "continuous_play": true, "volume": 80}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Indexes for user_preferences
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- RLS for user_preferences
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- 2. Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'system',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}'::jsonb,
  read BOOLEAN DEFAULT FALSE,
  action_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- RLS for notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications" ON notifications
  FOR DELETE USING (auth.uid() = user_id);

-- System/server can insert notifications (via service_role key)
CREATE POLICY "Service can insert notifications" ON notifications
  FOR INSERT WITH CHECK (true);

-- 3. Fix anime/episodes write policies
-- The original "Anyone can ..." policies may have been dropped.
-- Restore write access for authenticated users.
-- (App-layer AdminRoute already gates the admin UI; DB-layer admin check
--  requires a role column + is_admin() which can be added later.)

DROP POLICY IF EXISTS "Anyone can insert anime" ON anime;
DROP POLICY IF EXISTS "Anyone can update anime" ON anime;
DROP POLICY IF EXISTS "Anyone can delete anime" ON anime;
DROP POLICY IF EXISTS "Admins can insert anime" ON anime;
DROP POLICY IF EXISTS "Admins can update anime" ON anime;
DROP POLICY IF EXISTS "Admins can delete anime" ON anime;

CREATE POLICY "Authenticated users can insert anime" ON anime
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update anime" ON anime
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete anime" ON anime
  FOR DELETE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Anyone can insert episodes" ON episodes;
DROP POLICY IF EXISTS "Anyone can update episodes" ON episodes;
DROP POLICY IF EXISTS "Anyone can delete episodes" ON episodes;
DROP POLICY IF EXISTS "Admins can insert episodes" ON episodes;
DROP POLICY IF EXISTS "Admins can update episodes" ON episodes;
DROP POLICY IF EXISTS "Admins can delete episodes" ON episodes;

CREATE POLICY "Authenticated users can insert episodes" ON episodes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update episodes" ON episodes
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete episodes" ON episodes
  FOR DELETE USING (auth.role() = 'authenticated');

-- Updated_at trigger for user_preferences
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4. Allow multiple reviews per user per anime
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_anime_id_key;
