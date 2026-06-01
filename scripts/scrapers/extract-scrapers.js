import fs from 'fs';
import path from 'path';

const serverIndexPath = path.resolve('server/index.js');
console.log('Reading server/index.js...');
const content = fs.readFileSync(serverIndexPath, 'utf-8');
const lines = content.split('\n');

// ReAnimeScraperService is lines 314 to 613 (inclusive, 1-indexed)
// 0-indexed line range: [313, 613) -> lines 313 to 612
const reAnimeLines = lines.slice(313, 613);
const reAnimeContent = `import { getBrowser } from "../index.js";

export ${reAnimeLines.join('\n')}
`;

// NineAnimeScraperService is lines 615 to 2758 (inclusive, 1-indexed)
// 0-indexed line range: [614, 2758) -> lines 614 to 2757
const nineAnimeLines = lines.slice(614, 2758);
const nineAnimeContent = `import * as cheerio from "cheerio";
import axios from "axios";
import { getBrowser, enqueue, supabase } from "../index.js";

export ${nineAnimeLines.join('\n')}
`;

// Create output dir if not exists
fs.mkdirSync(path.resolve('server/scrapers'), { recursive: true });

console.log('Writing server/scrapers/reanime.js...');
fs.writeFileSync(path.resolve('server/scrapers/reanime.js'), reAnimeContent, 'utf-8');

console.log('Writing server/scrapers/nineanime.js...');
fs.writeFileSync(path.resolve('server/scrapers/nineanime.js'), nineAnimeContent, 'utf-8');

// Now, edit server/index.js:
// Replace lines 314 to 2758 (inclusive, 1-indexed) with the imports.
// 0-indexed range: [313, 2758) -> lines 313 to 2757
const beforeLines = lines.slice(0, 313);
const afterLines = lines.slice(2758);

const importLines = [
  'import { ReAnimeScraperService } from "./scrapers/reanime.js";',
  'import { NineAnimeScraperService } from "./scrapers/nineanime.js";'
];

const newContent = [...beforeLines, ...importLines, ...afterLines].join('\n');

console.log('Updating server/index.js...');
fs.writeFileSync(serverIndexPath, newContent, 'utf-8');

console.log('Done!');
