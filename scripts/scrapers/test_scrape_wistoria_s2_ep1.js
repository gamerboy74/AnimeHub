import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Load server module with the scraper service
(async () => {
  try {
    const { dirname } = await import('path');
  } catch (e) {
    // noop
  }
})();
