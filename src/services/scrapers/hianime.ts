// Browser-compatible interfaces and types for HiAnime scraper
// The actual scraping logic is in the server-side script

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
  private static readonly API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

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

      const response = await fetch(`${this.API_BASE_URL}/api/scrape-episode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeTitle,
          animeId,
          episodeNumber,
          options
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const result = await response.json();
      return result;
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

      const response = await fetch(`${this.API_BASE_URL}/api/scrape-all-episodes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeTitle,
          animeId: options.animeId,
          maxEpisodes: options.maxEpisodes || 20,
          timeout: options.timeout || 60000,
          retries: options.retries || 2
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      return await response.json();
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

      const response = await fetch(`${this.API_BASE_URL}/api/add-scraped-episode`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeId,
          episodeData
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      return await response.json();
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
    } = {}
  ): Promise<BatchScrapeResult> {
    try {
      console.log(`🎬 Batch scraping ${episodeNumbers.length} episodes for "${animeTitle}"`);

      const response = await fetch(`${this.API_BASE_URL}/api/batch-scrape-episodes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeTitle,
          animeId,
          episodeNumbers,
          options
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      return data;
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
    } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.API_BASE_URL}/api/batch-scrape-episodes-stream`;
      
      console.log('🌐 Fetching:', url);
      console.log('📦 Request body:', { animeTitle, animeId, episodeNumbers, options });
      
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeTitle,
          animeId,
          episodeNumbers,
          options
        })
      }).then(response => {
        console.log('📡 Response status:', response.status, response.statusText);
        
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
            console.log('📦 Received chunk:', chunk);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  console.log('✨ Parsed SSE data:', data);
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
      const response = await fetch(`${this.API_BASE_URL}/api/resolve-slug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeTitle, animeId }),
      });

      return await response.json();
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
      const response = await fetch(`${this.API_BASE_URL}/api/batch-resolve-slugs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ animeList }),
      });

      return await response.json();
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