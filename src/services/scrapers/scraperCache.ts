const API_BASE = import.meta.env.VITE_SCRAPER_API_URL || 'http://localhost:3001';

export interface ScraperUrls {
  reanime_sub?: string;
  reanime_dub?: string;
  nineanime?: string;
  [key: string]: string | undefined;
}

export const ScraperCacheService = {
  async getCache(animeId: string): Promise<ScraperUrls> {
    const res = await fetch(`${API_BASE}/api/scraper-cache/${animeId}`);
    const data = await res.json();
    return data.scraper_urls || {};
  },

  async saveCache(animeId: string, scraper: string, url: string): Promise<ScraperUrls> {
    const res = await fetch(`${API_BASE}/api/scraper-cache`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ animeId, scraper, url }),
    });
    const data = await res.json();
    return data.scraper_urls || {};
  },

  async clearCache(animeId: string, scraper?: string): Promise<ScraperUrls> {
    const url = `${API_BASE}/api/scraper-cache/${animeId}${scraper ? `?scraper=${encodeURIComponent(scraper)}` : ''}`;
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    return data.scraper_urls || {};
  },
};
