import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const outputPath = path.resolve(process.cwd(), "migrations", "supabase-database-backup.sql");

const checklistHeader = `-- ============================================================================
-- AnimeHub Complete Database Schema
-- Last Updated: ${new Date().getFullYear()}
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

`;

async function dumpSchema() {
  console.log("Dumping remote database schema using Supabase CLI...");
  try {
    // Run the Supabase CLI schema dump command
    execSync("npx supabase db dump", {
      stdio: "pipe",
      env: process.env // Inherit current environment variables
    });
    
    // The default output of `npx supabase db dump` might go to stdout if no file parameter is passed,
    // so we can execute it directly to output to stdout and capture the result in JS.
    const schemaSql = execSync("npx supabase db dump", { encoding: "utf8" });
    
    // Prepend checklist header to the DDL SQL
    const finalSql = checklistHeader + schemaSql;
    
    fs.writeFileSync(outputPath, finalSql, "utf-8");
    console.log(`Schema file successfully updated at: ${outputPath}`);
  } catch (error) {
    console.error("Failed to dump schema:", error.message);
    if (error.stderr) {
      console.error(error.stderr.toString());
    }
    process.exit(1);
  }
}

dumpSchema();
