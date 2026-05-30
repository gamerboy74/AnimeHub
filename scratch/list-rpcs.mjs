import axios from "axios";
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const restUrl = `${supabaseUrl}/rest/v1/`;
  try {
    const res = await axios.get(restUrl, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Accept': 'application/openapi+json'
      }
    });

    const openapi = res.data;
    const paths = Object.keys(openapi.paths || {});
    const rpcs = paths.filter(p => p.startsWith('/rpc/'));
    console.log("Found RPC endpoints:");
    console.log(rpcs);
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

main();
