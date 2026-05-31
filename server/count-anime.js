import { supabase } from "./index.js";

async function count() {
  const { count, error } = await supabase
    .from("anime")
    .select("*", { count: "exact", head: true });
    
  if (error) {
    console.error("Error fetching count:", error);
  } else {
    console.log(`Total anime in database: ${count}`);
  }
}

count().then(() => process.exit(0)).catch(console.error);
