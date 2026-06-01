import { supabase } from '../server/config/supabase.js';

async function test() {
  console.log('🔍 Fetching RLS policies for scraper_config table...');
  try {
    const { data: policies, error } = await supabase
      .rpc('get_policies_for_table', { table_name: 'scraper_config' });

    if (error) {
      // Fallback: run query using pg_policies directly
      const { data: directData, error: directError } = await supabase
        .from('pg_policies')
        .select('*')
        .eq('tablename', 'scraper_config');

      if (directError) {
        // Try raw SQL via RPC or general query
        const { data: rawData, error: rawError } = await supabase
          .from('anime')
          .select('id')
          .limit(1); // just to confirm connection
        
        console.log('Could not query pg_policies directly (standard user has no read access). Let\'s check RLS status on scraper_config:');
      } else {
        console.log('✅ Policies on scraper_config:', directData);
      }
    } else {
      console.log('✅ Policies on scraper_config:', policies);
    }

    // Let's check if the table has RLS enabled
    const { data: rlsStatus, error: rlsError } = await supabase
      .rpc('get_rls_status', { table_name: 'scraper_config' });
    
    console.log('RLS Status:', rlsStatus || 'Cannot check via RPC, checking by attempting anonymized insert...');

  } catch (err) {
    console.error('🔥 Unexpected error:', err);
  }
}

test();
