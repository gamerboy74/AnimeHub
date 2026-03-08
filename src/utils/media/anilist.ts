/**
 * Utility to fetch high-resolution anime banners from the free AniList GraphQL API.
 * This is used as a fallback when our Supabase database lacks a banner URL, 
 * preventing the UI from stretching low-resolution vertical posters.
 */

// Simple in-memory cache to prevent duplicate network requests across component remounts
const bannerCache = new Map<string, string | null>();

// Queue for throttled requests to avoid 429 rate limiting from AniList
let requestQueue: Array<{ title: string; resolve: (url: string | null) => void }> = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  while (requestQueue.length > 0) {
    const item = requestQueue.shift()!;
    const result = await _fetchAnilistBanner(item.title);
    item.resolve(result);
    // 1-second delay between requests to stay under AniList rate limit
    if (requestQueue.length > 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  isProcessing = false;
}

export function fetchAnilistBanner(title: string): Promise<string | null> {
  if (!title) return Promise.resolve(null);

  const cleanTitle = title.trim();
  if (bannerCache.has(cleanTitle)) {
    return Promise.resolve(bannerCache.get(cleanTitle) || null);
  }

  return new Promise(resolve => {
    requestQueue.push({ title: cleanTitle, resolve });
    processQueue();
  });
}

async function _fetchAnilistBanner(title: string): Promise<string | null> {
  // Double-check cache in case another queued request already resolved this
  if (bannerCache.has(title)) {
    return bannerCache.get(title) || null;
  }

  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME, sort: SEARCH_MATCH) {
        bannerImage
      }
    }
  `;

  try {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { search: title }
      })
    });

    if (!response.ok) {
      throw new Error(`AniList API responded with status: ${response.status}`);
    }

    const json = await response.json();
    const bannerUrl = json.data?.Media?.bannerImage || null;
    
    // Cache the result (even if null, so we don't retry failed searches)
    bannerCache.set(title, bannerUrl);
    
    return bannerUrl;

  } catch (error) {
    console.warn(`Failed to fetch high-res banner for "${title}" from AniList:`, error);
    // Cache the failure so we don't spam the API
    bannerCache.set(title, null);
    return null;
  }
}
