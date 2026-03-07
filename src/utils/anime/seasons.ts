/**
 * Utility functions for extracting and grouping anime seasons.
 *
 * Anime seasons are stored as separate DB records with titles like:
 *   "Spy x Family Season 3"
 *   "MF Ghost 3rd Season"
 *   "Solo Leveling Season 2: Arise from the Shadow"
 *   "Fumetsu no Anata e Season 3" / title_english "To Your Eternity Season 3"
 *
 * This module provides helpers to normalise those into a base title + a
 * season number so we can group them in the UI.
 */

// Ordered from most specific to least specific so the first match wins.
const SEASON_PATTERNS: { regex: RegExp; group: number }[] = [
  // "Season 3 - subtitle", "Season 3: subtitle", "Season 3 Part 2"
  { regex: /^(.+?)\s+Season\s+(\d+)\b/i, group: 2 },
  // "3rd Season", "2nd Season", "1st Season"
  { regex: /^(.+?)\s+(\d+)(?:st|nd|rd|th)\s+Season\b/i, group: 2 },
  // Word ordinals: "Third Season", "Second Season"
  { regex: /^(.+?)\s+(Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\s+Season\b/i, group: 2 },
  // "Part 2", "Part 3" (used by some entries)
  { regex: /^(.+?)\s+Part\s+(\d+)\b/i, group: 2 },
  // Roman-numeral seasons: "Title II", "Title III" at end of string
  { regex: /^(.+?)\s+(II|III|IV|V|VI|VII|VIII|IX|X)$/i, group: 2 },
]

const WORD_TO_NUM: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
}

const ROMAN_TO_NUM: Record<string, number> = {
  II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
}

export interface SeasonInfo {
  /** The base title with the season suffix stripped. */
  baseTitle: string
  /** 1 for the first season (or when no season indicator is found). */
  seasonNumber: number
}

/**
 * Parse a title and extract the base title + season number.
 *
 * If no season indicator is found the entire title is returned as `baseTitle`
 * and `seasonNumber` defaults to 1.
 */
export function extractSeasonInfo(title: string): SeasonInfo {
  if (!title) return { baseTitle: '', seasonNumber: 1 }

  for (const { regex, group } of SEASON_PATTERNS) {
    const match = title.match(regex)
    if (match) {
      const raw = match[group].toLowerCase()
      let num = parseInt(raw, 10)
      if (isNaN(num)) {
        num = WORD_TO_NUM[raw] ?? ROMAN_TO_NUM[match[group]] ?? 1
      }
      return {
        baseTitle: match[1].trim(),
        seasonNumber: num,
      }
    }
  }

  return { baseTitle: title.trim(), seasonNumber: 1 }
}

export type EntryKind = 'season' | 'movie' | 'ova' | 'ona' | 'special'

export interface SeasonEntry {
  id: string
  title: string
  titleEnglish: string | null
  seasonNumber: number
  /** Display label — e.g. "Season 3" or "Movie: CODE White" */
  label: string
  kind: EntryKind
  posterUrl: string | null
  episodeCount: number | null
}

const NON_SEASON_TYPES = new Set(['movie', 'ova', 'ona', 'special'])

/**
 * Given a list of candidate anime records, group them by season relative to
 * a reference base title.  Returns seasons sorted first, then movies/OVAs/specials.
 */
export function buildSeasonList(
  candidates: Array<{
    id: string
    title: string
    title_english: string | null
    poster_url: string | null
    total_episodes: number | null
    type?: string | null
  }>,
  referenceBase: string,
): SeasonEntry[] {
  const normRef = referenceBase.toLowerCase().trim()

  const seasonEntries: SeasonEntry[] = []
  const extraEntries: SeasonEntry[] = []
  const matchedIds = new Set<string>()

  // --- Pass 1: Find proper seasons (Season N, 2nd Season, etc.) ---
  for (const c of candidates) {
    const infoEng = c.title_english ? extractSeasonInfo(c.title_english) : null
    const infoRaw = extractSeasonInfo(c.title)

    const info =
      infoEng && infoEng.baseTitle.toLowerCase().trim() === normRef
        ? infoEng
        : infoRaw.baseTitle.toLowerCase().trim() === normRef
        ? infoRaw
        : infoEng && fuzzyBaseMatch(infoEng.baseTitle, referenceBase)
        ? infoEng
        : fuzzyBaseMatch(infoRaw.baseTitle, referenceBase)
        ? infoRaw
        : null

    if (!info) continue

    matchedIds.add(c.id)
    seasonEntries.push({
      id: c.id,
      title: c.title,
      titleEnglish: c.title_english,
      seasonNumber: info.seasonNumber,
      label: `Season ${info.seasonNumber}`,
      kind: 'season',
      posterUrl: c.poster_url,
      episodeCount: c.total_episodes,
    })
  }

  // --- Pass 2: Pick up franchise extras (movies, OVAs, specials) ---
  // These are entries whose title starts with the base title but didn't
  // match a season pattern — e.g. "SPY x FAMILY CODE: White" (movie)
  for (const c of candidates) {
    if (matchedIds.has(c.id)) continue

    const titleToCheck = (c.title_english || c.title).toLowerCase().trim()
    const rawTitle = c.title.toLowerCase().trim()

    // Must start with the base franchise name
    const startsWithBase =
      titleToCheck.startsWith(normRef) ||
      rawTitle.startsWith(normRef) ||
      fuzzyStartsWith(titleToCheck, normRef) ||
      fuzzyStartsWith(rawTitle, normRef)

    if (!startsWithBase) continue

    const dbType = (c.type || '').toLowerCase() as EntryKind
    const kind: EntryKind = NON_SEASON_TYPES.has(dbType) ? dbType : 'special'

    // Build a short label from the part of the title after the base name
    const displayTitle = c.title_english || c.title
    const suffix = stripPrefix(displayTitle, referenceBase)
    const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1) // "Movie", "Ova" etc.
    const label = suffix ? `${kindLabel}: ${suffix}` : kindLabel

    matchedIds.add(c.id)
    extraEntries.push({
      id: c.id,
      title: c.title,
      titleEnglish: c.title_english,
      seasonNumber: 9000 + extraEntries.length, // Sort after all seasons
      label,
      kind,
      posterUrl: c.poster_url,
      episodeCount: c.total_episodes,
    })
  }

  // De-duplicate seasons by season number (keep the first / most relevant)
  const seen = new Set<number>()
  const uniqueSeasons: SeasonEntry[] = []
  for (const e of seasonEntries) {
    if (!seen.has(e.seasonNumber)) {
      seen.add(e.seasonNumber)
      uniqueSeasons.push(e)
    }
  }

  uniqueSeasons.sort((a, b) => a.seasonNumber - b.seasonNumber)

  return [...uniqueSeasons, ...extraEntries]
}

/** Loose match — case-insensitive, ignoring punctuation. */
function fuzzyBaseMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b)
}

/** Check if `text` starts with `prefix` after normalising punctuation. */
function fuzzyStartsWith(text: string, prefix: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  return norm(text).startsWith(norm(prefix))
}

/** Strip the base-title prefix from a full title, returning the rest. */
function stripPrefix(fullTitle: string, base: string): string {
  // Try exact prefix first
  const lower = fullTitle.toLowerCase()
  const baseLower = base.toLowerCase()
  if (lower.startsWith(baseLower)) {
    return fullTitle.slice(base.length).replace(/^[:\s\-–—]+/, '').trim()
  }
  // Fuzzy: strip normalised prefix
  const norm = (s: string) =>
    s.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
  const normFull = norm(fullTitle)
  const normBase = norm(base)
  if (normFull.toLowerCase().startsWith(normBase.toLowerCase())) {
    return normFull.slice(normBase.length).trim()
  }
  return fullTitle
}
