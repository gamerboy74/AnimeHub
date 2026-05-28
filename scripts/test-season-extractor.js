import { extractSeasonNumber } from '../server/utils/seasonExtractor.js';

const testCases = [
  { title: "Overlord", expected: 1 },
  { title: "Overlord II", expected: 2 },
  { title: "Overlord III", expected: 3 },
  { title: "Overlord IV", expected: 4 },
  { title: "Overlord Season 2", expected: 2 },
  { title: "Overlord 2nd Season", expected: 2 },
  { title: "Wistoria: Wand and Sword Season 2", expected: 2 },
  { title: "K-On! 2", expected: 2 },
  { title: "My Hero Academia Season 7", expected: 7 },
  { title: "Attack on Titan Season 3 Part 2", expected: 3 },
];

console.log("🧪 Testing Season Extractor Utility...");
console.log("=====================================");
let passed = 0;

for (const tc of testCases) {
  const result = extractSeasonNumber(tc.title);
  const ok = result === tc.expected;
  if (ok) {
    passed++;
    console.log(`✅ PASS: "${tc.title}" -> ${result}`);
  } else {
    console.log(`❌ FAIL: "${tc.title}" -> expected ${tc.expected}, got ${result}`);
  }
}

console.log("=====================================");
console.log(`📊 Result: ${passed}/${testCases.length} tests passed.`);
