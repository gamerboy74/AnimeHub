import { supabase } from "../config/supabase.js";

const PROVIDER_NAMES = {
  cinevo: "Cinevo",
  animesuge: "AnimeSuge",
  reanime: "Re:ANIME",
  sanjianime: "SanjiAnime",
  nineanime: "NineAnime"
};

const DEFAULT_CONFIGS = [
  {
    id: "cinevo",
    name: "Cinevo",
    enabled: true,
    priority: 1,
    timeout: 45000,
    delay: 2000
  },
  {
    id: "animesuge",
    name: "AnimeSuge",
    enabled: true,
    priority: 2,
    timeout: 45000,
    delay: 2000
  },
  {
    id: "reanime",
    name: "Re:ANIME",
    enabled: true,
    priority: 3,
    timeout: 40000,
    delay: 2000
  },
  {
    id: "sanjianime",
    name: "SanjiAnime",
    enabled: true,
    priority: 4,
    timeout: 40000,
    delay: 2000
  },
  {
    id: "nineanime",
    name: "NineAnime",
    enabled: true,
    priority: 5,
    timeout: 45000,
    delay: 2000
  }
];

export async function getScraperConfigs() {
  try {
    const { data, error } = await supabase
      .from("scraper_config")
      .select("*")
      .order("priority_weight", { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      // Seed default configs if table is empty
      return await saveScraperConfigs(DEFAULT_CONFIGS);
    }

    // Map DB schema to UI schema
    const mapped = data.map(row => ({
      id: row.provider_name,
      name: PROVIDER_NAMES[row.provider_name] || row.provider_name,
      enabled: row.is_enabled,
      priority: row.priority_weight,
      timeout: row.request_timeout_ms,
      delay: row.cooldown_delay_ms
    }));

    return mapped;
  } catch (err) {
    console.error("⚠️ Failed to load scraper configs from database, using defaults:", err.message);
    return DEFAULT_CONFIGS;
  }
}

export async function saveScraperConfigs(configs) {
  try {
    if (!Array.isArray(configs)) {
      throw new Error("Invalid configs: must be an array");
    }

    // Map UI schema to DB schema
    const dbConfigs = configs.map(c => ({
      provider_name: c.id,
      is_enabled: typeof c.enabled === "boolean" ? c.enabled : true,
      priority_weight: parseInt(c.priority) || 1,
      request_timeout_ms: parseInt(c.timeout) || 45000,
      cooldown_delay_ms: parseInt(c.delay) || 2000,
      updated_at: new Date().toISOString()
    }));

    const { data, error } = await supabase
      .from("scraper_config")
      .upsert(dbConfigs, { onConflict: "provider_name" })
      .select()
      .order("priority_weight", { ascending: true });

    if (error) throw error;

    // Map returned DB data back to UI schema
    const mapped = data.map(row => ({
      id: row.provider_name,
      name: PROVIDER_NAMES[row.provider_name] || row.provider_name,
      enabled: row.is_enabled,
      priority: row.priority_weight,
      timeout: row.request_timeout_ms,
      delay: row.cooldown_delay_ms
    }));

    return mapped;
  } catch (err) {
    console.error("❌ Failed to save scraper configs to database:", err.message);
    throw err;
  }
}
