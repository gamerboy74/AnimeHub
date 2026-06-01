import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Define tables and their schemas in dependency order
const tablesConfig = [
  {
    name: "users",
    columns: [
      { name: "id", type: "uuid" },
      { name: "email", type: "string" },
      { name: "username", type: "string" },
      { name: "avatar_url", type: "string" },
      { name: "subscription_type", type: "string" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "anime_studios",
    columns: [
      { name: "id", type: "uuid" },
      { name: "anilist_id", type: "number" },
      { name: "name", type: "string" },
      { name: "name_japanese", type: "string" },
      { name: "description", type: "string" },
      { name: "website", type: "string" },
      { name: "logo_url", type: "string" },
      { name: "founded_year", type: "number" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "anime",
    columns: [
      { name: "id", type: "uuid" },
      { name: "title", type: "string" },
      { name: "title_english", type: "string" },
      { name: "title_romaji", type: "string" },
      { name: "title_japanese", type: "string" },
      { name: "title_synonyms", type: "array" },
      { name: "mal_id", type: "number" },
      { name: "nine_anime_slug", type: "string" },
      { name: "description", type: "string" },
      { name: "poster_url", type: "string" },
      { name: "banner_url", type: "string" },
      { name: "trailer_url", type: "string" },
      { name: "rating", type: "number" },
      { name: "year", type: "number" },
      { name: "status", type: "string" },
      { name: "type", type: "string" },
      { name: "genres", type: "array" },
      { name: "studios", type: "array" },
      { name: "total_episodes", type: "number" },
      { name: "duration", type: "number" },
      { name: "age_rating", type: "string" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "episodes",
    columns: [
      { name: "id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "episode_number", type: "number" },
      { name: "title", type: "string" },
      { name: "description", type: "string" },
      { name: "thumbnail_url", type: "string" },
      { name: "video_url", type: "string" },
      { name: "duration", type: "number" },
      { name: "is_premium", type: "boolean" },
      { name: "air_date", type: "string" },
      { name: "created_at", type: "timestamptz" }
    ]
  },
  {
    name: "user_progress",
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "episode_id", type: "uuid" },
      { name: "progress_seconds", type: "number" },
      { name: "is_completed", type: "boolean" },
      { name: "last_watched", type: "timestamptz" },
      { name: "created_at", type: "timestamptz" }
    ]
  },
  {
    name: "user_favorites",
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "created_at", type: "timestamptz" }
    ]
  },
  {
    name: "user_watchlist",
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "created_at", type: "timestamptz" }
    ]
  },
  {
    name: "reviews",
    columns: [
      { name: "id", type: "uuid" },
      { name: "user_id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "rating", type: "number" },
      { name: "review_text", type: "string" },
      { name: "is_spoiler", type: "boolean" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "anime_relations",
    columns: [
      { name: "id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "related_anime_id", type: "string" },
      { name: "relation_type", type: "string" },
      { name: "anilist_id", type: "number" },
      { name: "mal_id", type: "number" },
      { name: "title", type: "string" },
      { name: "format", type: "string" },
      { name: "status", type: "string" },
      { name: "episodes", type: "number" },
      { name: "year", type: "number" },
      { name: "poster_url", type: "string" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "anime_characters",
    columns: [
      { name: "id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "name", type: "string" },
      { name: "name_japanese", type: "string" },
      { name: "name_romaji", type: "string" },
      { name: "image_url", type: "string" },
      { name: "role", type: "string" },
      { name: "description", type: "string" },
      { name: "voice_actor", type: "string" },
      { name: "voice_actor_japanese", type: "string" },
      { name: "created_at", type: "timestamptz" },
      { name: "updated_at", type: "timestamptz" }
    ]
  },
  {
    name: "anime_studio_relations",
    columns: [
      { name: "id", type: "uuid" },
      { name: "anime_id", type: "uuid" },
      { name: "studio_id", type: "uuid" },
      { name: "role", type: "string" },
      { name: "created_at", type: "timestamptz" }
    ]
  }
];

function formatSqlValue(value, type) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  switch (type) {
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "number":
      return isNaN(value) ? "NULL" : String(value);
    case "array":
      if (!Array.isArray(value)) return "NULL";
      if (value.length === 0) return "ARRAY[]::TEXT[]";
      const escapedItems = value.map(item => {
        if (item === null || item === undefined) return "NULL";
        const escaped = String(item).replace(/'/g, "''");
        return `'${escaped}'`;
      });
      return `ARRAY[${escapedItems.join(", ")}]`;
    case "uuid":
    case "string":
    case "timestamptz":
    default:
      const escaped = String(value).replace(/'/g, "''");
      return `'${escaped}'`;
  }
}

async function fetchAllRows(tableName) {
  let allRows = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) {
      throw error;
    }

    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

async function dumpData() {
  const outputPath = path.resolve(process.cwd(), "migrations", "supabase-data-seed.sql");
  console.log(`Starting data dump from Supabase to: ${outputPath}...`);

  const sqlStatements = [];
  sqlStatements.push("-- ============================================================================");
  sqlStatements.push("-- AnimeHub Seed Data Export");
  sqlStatements.push(`-- Exported on: ${new Date().toISOString()}`);
  sqlStatements.push("-- ============================================================================");
  sqlStatements.push("BEGIN;");
  sqlStatements.push("");

  // Disable triggers to prevent foreign key errors and custom functions during batch inserts
  sqlStatements.push("-- Disable all triggers temporarily");
  for (const tableConfig of [...tablesConfig].reverse()) {
    sqlStatements.push(`ALTER TABLE IF EXISTS "${tableConfig.name}" DISABLE TRIGGER ALL;`);
  }
  sqlStatements.push("");

  // Truncate tables in reverse order to start with a clean slate
  sqlStatements.push("-- Truncate all tables");
  for (const tableConfig of [...tablesConfig].reverse()) {
    sqlStatements.push(`TRUNCATE TABLE "${tableConfig.name}" CASCADE;`);
  }
  sqlStatements.push("");

  for (const tableConfig of tablesConfig) {
    console.log(`Fetching data for [${tableConfig.name}]...`);
    try {
      const rows = await fetchAllRows(tableConfig.name);
      console.log(`- Fetched ${rows.length} rows for [${tableConfig.name}]`);

      if (rows.length > 0) {
        sqlStatements.push(`-- Seed data for [${tableConfig.name}]`);
        const colNames = tableConfig.columns.map(c => `"${c.name}"`).join(", ");

        // Split inserts into batches of 100 rows to keep statements readable and performant
        const batchSize = 100;
        for (let i = 0; i < rows.length; i += batchSize) {
          const batchRows = rows.slice(i, i + batchSize);
          sqlStatements.push(`INSERT INTO "${tableConfig.name}" (${colNames}) VALUES`);

          const valueStrings = batchRows.map((row, rowIndex) => {
            const values = tableConfig.columns.map(col => {
              // Standardize database field name mapping (Supabase uses exact schema case)
              return formatSqlValue(row[col.name], col.type);
            });
            return `  (${values.join(", ")})${rowIndex === batchRows.length - 1 ? ";" : ","}`;
          });

          sqlStatements.push(...valueStrings);
        }
        sqlStatements.push("");
      }
    } catch (error) {
      console.error(`Error dumping table [${tableConfig.name}]:`, error);
      throw error;
    }
  }

  // Re-enable triggers
  sqlStatements.push("-- Re-enable triggers");
  for (const tableConfig of tablesConfig) {
    sqlStatements.push(`ALTER TABLE IF EXISTS "${tableConfig.name}" ENABLE TRIGGER ALL;`);
  }
  sqlStatements.push("");

  sqlStatements.push("COMMIT;");
  sqlStatements.push("");

  fs.writeFileSync(outputPath, sqlStatements.join("\n"), "utf-8");
  console.log(`Data seed file successfully generated at ${outputPath}`);
}

dumpData()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Data dump failed:", err);
    process.exit(1);
  });
