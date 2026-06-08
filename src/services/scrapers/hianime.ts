import { apiClient, apiFetchRaw } from '../../utils/api/client';

export interface ScrapeResult {
  success: boolean;
  streamUrl?: string;
  episodeData?: any;
  error?: string;
}

export interface EpisodeScrapeData {
  animeId: string;
  episodeNumber: number;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
  description?: string;
  createdAt: Date;
}

export interface BatchScrapeResult {
  success: boolean;
  results: ScrapeResult[];
  summary: {
    totalEpisodes: number;
    successCount: number;
    errorCount: number;
    successRate: number;
  };
  error?: string;
}

// Browser-compatible service that calls the server-side scraper
export class HiAnimeScraperService {
  /**
   * Scrape a single episode from HiAnime.do via backend API
   */
  static async scrapeAnimeEpisode(
    animeTitle: string,
    animeId: string,
    episodeNumber: number = 1,
    options: {
      headless?: boolean;
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<ScrapeResult> {
    try {
      console.log(`🎬 Scraping episode ${episodeNumber} for "${animeTitle}" (ID: ${animeId})`);

      return await apiClient.post('/api/scrape-episode', {
        animeTitle,
        animeId,
        episodeNumber,
        options
      });
    } catch (error) {
      console.error('Error calling scraper API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Scrape all available episodes for an anime
   */
  static async scrapeAllEpisodes(
    animeTitle: string,
    options: {
      animeId?: string;
      maxEpisodes?: number;
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<{
    success: boolean;
    data?: {
      animeTitle: string;
      animeId: string;
      totalEpisodes: number;
      scrapedEpisodes: Array<{
        number: number;
        title: string;
        streamUrl: string;
        embeddingProtected: boolean;
        embeddingReason?: string;
        scrapedAt: string;
      }>;
      failedEpisodes: Array<{
        number: number;
        title: string;
        error: string;
      }>;
      summary: {
        total: number;
        successful: number;
        failed: number;
        embeddingProtected: number;
      };
    };
    error?: string;
  }> {
    try {
      console.log(`🎬 Scraping all episodes for "${animeTitle}"`);

      return await apiClient.post('/api/scrape-all-episodes', {
        animeTitle,
        animeId: options.animeId,
        maxEpisodes: options.maxEpisodes || 20,
        timeout: options.timeout || 60000,
        retries: options.retries || 2
      });
    } catch (error) {
      console.error('Error calling scrape all episodes API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Add a scraped episode to the database
   */
  static async addScrapedEpisode(
    animeId: string,
    episodeData: {
      number: number;
      title: string;
      streamUrl: string;
      embeddingProtected: boolean;
      embeddingReason?: string;
    }
  ): Promise<{
    success: boolean;
    message?: string;
    episode?: any;
    error?: string;
  }> {
    try {
      console.log(`💾 Adding episode ${episodeData.number} to database for anime ${animeId}`);

      return await apiClient.post('/api/add-scraped-episode', {
        animeId,
        episodeData
      });
    } catch (error) {
      console.error('Error adding scraped episode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Batch scrape multiple episodes
   */
  static async batchScrapeEpisodes(
    animeTitle: string,
    animeId: string,
    episodeNumbers: number[],
    options: {
      headless?: boolean;
      timeout?: number;
      retries?: number;
      delayBetweenEpisodes?: number;
      overwrite?: boolean;
    } = {}
  ): Promise<BatchScrapeResult> {
    try {
      console.log(`🎬 Batch scraping ${episodeNumbers.length} episodes for "${animeTitle}"`);

      return await apiClient.post('/api/batch-scrape-episodes', {
        animeTitle,
        animeId,
        episodeNumbers,
        options
      });
    } catch (error) {
      console.error('Error in batch scraping:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        results: [],
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount: 0,
          errorCount: episodeNumbers.length,
          successRate: 0
        }
      };
    }
  }

  /**
   * Batch scrape with real-time progress updates using Server-Sent Events
   */
  static async batchScrapeEpisodesWithProgress(
    animeTitle: string,
    animeId: string,
    episodeNumbers: number[],
    onProgress: (event: {
      type: 'start' | 'progress' | 'success' | 'error' | 'complete';
      episode?: number;
      current?: number;
      total?: number;
      status?: string;
      url?: string;
      title?: string;
      error?: string;
      successCount?: number;
      errorCount?: number;
      successRate?: number;
    }) => void,
    options: {
      headless?: boolean;
      timeout?: number;
      retries?: number;
      delayBetweenEpisodes?: number;
      overwrite?: boolean;
    } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🌐 Fetching batch scrape progress stream...');
      
      apiFetchRaw('/api/batch-scrape-episodes-stream', {
        method: 'POST',
        body: JSON.stringify({
          animeTitle,
          animeId,
          episodeNumbers,
          options
        })
      }).then(response => {
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('Response body is not readable');
        }

        console.log('📖 Starting to read SSE stream...');

        function readStream(): void {
          reader!.read().then(({ done, value }) => {
            if (done) {
              console.log('✅ Stream complete');
              resolve();
              return;
            }

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  onProgress(data);
                  
                  if (data.type === 'complete') {
                    resolve();
                    return;
                  }
                } catch (e) {
                  console.error('❌ Error parsing SSE data:', e, 'Raw line:', line);
                }
              }
            }

            readStream();
          }).catch(error => {
            console.error('❌ Stream read error:', error);
            reject(error);
          });
        }

        readStream();
      }).catch(error => {
        console.error('❌ Fetch error:', error);
        reject(error);
      });
    });
  }

  /**
   * Test the scraper (browser-compatible version)
   */
  static async testScraper(): Promise<void> {
    console.log('🧪 Testing HiAnime Scraper (Browser Mode)...');
    console.log('Note: Actual scraping requires server-side execution');
    console.log('Use the command line script: npm run scrape-hianime -- --test');
  }

  /**
   * Resolve the 9anime slug for an anime without scraping episodes.
   * This finds and caches the correct URL slug so future scraping is reliable.
   */
  static async resolveSlug(
    animeTitle: string,
    animeId?: string
  ): Promise<{ success: boolean; slug?: string; episodeUrl?: string; error?: string }> {
    try {
      return await apiClient.post('/api/resolve-slug', { animeTitle, animeId });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Batch resolve 9anime slugs for multiple anime.
   * Useful for pre-resolving slugs after bulk import.
   */
  static async batchResolveSlugs(
    animeList: Array<{ title: string; id?: string }>
  ): Promise<{
    success: boolean;
    resolved: number;
    failed: number;
    total: number;
    results: Array<{
      title: string;
      id?: string;
      success: boolean;
      slug: string | null;
      error: string | null;
    }>;
  }> {
    try {
      return await apiClient.post('/api/batch-resolve-slugs', { animeList });
    } catch (error) {
      return {
        success: false,
        resolved: 0,
        failed: animeList.length,
        total: animeList.length,
        results: [],
      };
    }
  }
}