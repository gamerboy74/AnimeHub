import axios from "axios";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing Supabase configuration!");
  process.exit(1);
}

async function main() {
  const restUrl = `${supabaseUrl}/rest/v1/`;
  console.log("Fetching schema from:", restUrl);
  try {
    const res = await axios.get(restUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Accept': 'application/openapi+json'
      }
    });

    const openapi = res.data;
    const paths = openapi.paths;
    
    // Find path for /episode_scraping_schedules
    const tablePath = '/episode_scraping_schedules';
    if (paths && paths[tablePath]) {
      console.log(`\n🎉 Found schema info for ${tablePath}!`);
      
      // Look at the post parameter definition or get response definition
      const getParameters = paths[tablePath].get?.parameters || [];
      const columns = getParameters
        .filter(p => p.in === 'query' && !['select', 'order', 'limit', 'offset'].includes(p.name))
        .map(p => ({ name: p.name, type: p.type, description: p.description }));
      
      console.log("Columns list (query parameters):");
      console.table(columns);

      // Check schema definition in definitions if present
      const definitionName = 'episode_scraping_schedules';
      const definition = openapi.definitions?.[definitionName];
      if (definition) {
        console.log(`\nProperties in definitions.${definitionName}:`);
        console.log(JSON.stringify(definition.properties, null, 2));
      }
    } else {
      console.log(`Could not find ${tablePath} in OpenAPI paths. Paths found:`, Object.keys(paths || {}));
    }
  } catch (err) {
    console.error("Failed to fetch schema:", err.message);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

main();
