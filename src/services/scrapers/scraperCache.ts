import { apiClient } from '../../utils/api/client';

export interface ScraperUrls {
  reanime_sub?: string;
  reanime_dub?: string;
  nineanime?: string;
  [key: string]: string | undefined;
}

export const ScraperCacheService = {
  async getCache(animeId: string): Promise<ScraperUrls> {
    try {
      const data = await apiClient.get(`/api/scraper-cache/${animeId}`);
      return data?.scraper_urls || {};
    } catch (error) {
      console.error('Failed to get scraper cache:', error);
      return {};
    }
  },

  async saveCache(animeId: string, scraper: string, url: string): Promise<ScraperUrls> {
    try {
      const data = await apiClient.post('/api/scraper-cache', { animeId, scraper, url });
      return data?.scraper_urls || {};
    } catch (error) {
      console.error('Failed to save scraper cache:', error);
      return {};
    }
  },

  async clearCache(animeId: string, scraper?: string): Promise<ScraperUrls> {
    try {
      const data = await apiClient.delete(`/api/scraper-cache/${animeId}`, {
        params: scraper ? { scraper } : undefined
      });
      return data?.scraper_urls || {};
    } catch (error) {
      console.error('Failed to clear scraper cache:', error);
      return {};
    }
  },
};

