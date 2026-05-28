const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Helper to parse .env file
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ Error: .env file not found at project root:', envPath);
    process.exit(1);
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim().replace(/(^["']|["']$)/g, ''); // strip quotes
      env[key] = val;
    }
  });
  return env;
}

const env = loadEnv();
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectTable() {
  try {
    const { data, error } = await supabase.from('episodes').select('*').limit(1);
    if (error) throw error;
    
    if (data && data.length > 0) {
      console.log('✅ Connected successfully!');
      console.log('📋 Columns in the "episodes" table:');
      console.log(JSON.stringify(Object.keys(data[0]), null, 2));
      console.log('\n🔍 Single record data preview:');
      console.log(JSON.stringify(data[0], null, 2));
    } else {
      console.log('⚠️ Episodes table is empty. Let\'s try to read table info using RPC or schema metadata...');
    }
  } catch (error) {
    console.error('❌ Error inspecting table:', error.message);
  }
}

inspectTable();
