import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

import { NineAnimeScraperService } from '../../server/index.js';

(async () => {
  try {
    const title = 'Wistoria: Wand and Sword Season 2';
    console.log('Resolving slug for:', title);
    const res = await NineAnimeScraperService.searchAnimeWithCheerio(title, 1, 'f8022b36-927c-4a70-869e-23d8eca4a72c');
    console.log('Result:', JSON.stringify(res, null, 2));
  } catch (e) {
    console.error('Test failed:', e);
    process.exit(1);
  }
})();
