/**
 * Season Extractor Utility
 * 
 * Programmatically extracts season numbers from anime titles.
 * Supports explicit text ("Season X", "Xnd Season"), Roman numerals ("IV", "II"), and final Arabic numbers.
 */

export function extractSeasonNumber(title) {
  if (!title) return 1;
  
  // 1. Normalize and clean the title by removing common trailing metadata / suffixes
  let clean = title.toLowerCase()
    .replace(/\b(?:dub|sub|uncensored|uncut|tv|dual[- ]audio|uncut)\b/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 2. Match patterns: "season 2", "s2", "season: 2", "2nd season", "2nd sseason", "2nd-season"
  // Forgiving season spelling: s+e*a*s*o*n*s* (matches season, sseason, seaon, seson, seasons, etc.)
  const seasonMatch = clean.match(/(?:s+e*a*s*o*n*s*[\s\-_:]+|s\s*)(\d+)|(\d+)(?:nd|rd|th|st)?[\s\-_]+s+e*a*s*o*n*s*/i);
  if (seasonMatch) {
    return parseInt(seasonMatch[1] || seasonMatch[2], 10);
  }

  // 3. Match standard Roman numerals at the end of the cleaned title
  const romanMatch = clean.match(/\b(I|II|III|IV|V|VI|VII|VIII|IX|X)\b\s*$/i);
  if (romanMatch) {
    const roman = romanMatch[1].toUpperCase();
    const romanMap = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    return romanMap[roman] || 1;
  }

  // 4. Match arabic numbers at the end of the cleaned title (e.g., "K-On! 2")
  const arabicMatch = clean.match(/\b([2-9])\b\s*$/i);
  if (arabicMatch) {
    return parseInt(arabicMatch[1], 10);
  }

  // Default to Season 1
  return 1;
}

export default extractSeasonNumber;
