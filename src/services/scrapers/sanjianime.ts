import { apiClient, apiFetchRaw } from '../../utils/api/client';

export interface SanjiAnimeServerSource {
  label: string;
  lang: 'sub' | 'dub' | 'unknown';
  iframeUrl: string | null;
  playableUrl: string | null;
  embedId?: string;
  frameTitle?: string;
  sourceUrls?: string[];
  directM3u8?: string[];
  active?: boolean;
}

export interface SanjiAnimeScrapeResult {
  success: boolean;
  watchUrl?: string;
  streamUrl?: string | null;
  episodeData?: {
    title: string;
    animeTitle: string;
    episodeNumber: number;
    lang: 'sub' | 'dub' | 'unknown';
    sources: SanjiAnimeServerSource[];
    sourceCount: number;
    watchUrl: string;
  };
  error?: string;
}

export class SanjiAnimeScraperService {
  private static inferLang(label: string): 'sub' | 'dub' | 'unknown' {
    const normalized = (label || '').toLowerCase();
    if (normalized.includes('dub')) return 'dub';
    if (normalized.includes('sub')) return 'sub';
    return 'unknown';
  }

  /**
   * Scrape a single Sanji Anime episode or watch page via backend API.
   */
  static async scrapeAnimeEpisode(
    inputUrl: string,
    episodeNumber: number = 1,
    options: {
      timeout?: number;
      retries?: number;
      lang?: 'sub' | 'dub';
      animeId?: string;
    } = {}
  ): Promise<SanjiAnimeScrapeResult> {
    try {
      console.log(`🎬 Scraping Sanji Anime for "${inputUrl}" (episode ${episodeNumber})`);

      return await apiClient.post('/api/scrape-sanjianime-episode', {
        url: inputUrl,
        episodeNumber,
        options,
      });
    } catch (error) {
      console.error('Error calling Sanji Anime scraper API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Resolve a Sanji Anime watch page or play URL and return the active playable source.
   */
  static async resolvePlayerUrl(
    inputUrl: string,
    episodeNumber: number = 1,
    options: {
      timeout?: number;
      retries?: number;
      lang?: 'sub' | 'dub';
      animeId?: string;
    } = {}
  ): Promise<SanjiAnimeScrapeResult> {
    return this.scrapeAnimeEpisode(inputUrl, episodeNumber, options);
  }

  /**
   * Batch scrape multiple episodes by looping the single-episode API.
   */
  static async batchScrapeEpisodes(
    animeTitle: string,
    animeId: string,
    episodeNumbers: number[],
    options: {
      timeout?: number;
      retries?: number;
      lang?: 'sub' | 'dub';
      overwrite?: boolean;
      inputUrl?: string;
    } = {}
  ): Promise<{
    success: boolean;
    results: SanjiAnimeScrapeResult[];
    summary: {
      totalEpisodes: number;
      successCount: number;
      errorCount: number;
      successRate: number;
    };
    error?: string;
  }> {
    try {
      const results: SanjiAnimeScrapeResult[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (const episodeNumber of episodeNumbers) {
        const result = await this.scrapeAnimeEpisode(options.inputUrl || animeTitle, episodeNumber, {
          timeout: options.timeout,
          retries: options.retries,
          lang: options.lang,
          animeId,
        });

        results.push(result);

        if (result.success) {
          successCount++;
        } else {
          errorCount++;
        }
      }

      return {
        success: errorCount === 0,
        results,
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount,
          errorCount,
          successRate: episodeNumbers.length > 0 ? Math.round((successCount / episodeNumbers.length) * 100) : 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        results: [],
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount: 0,
          errorCount: episodeNumbers.length,
          successRate: 0,
        },
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
      sources?: { name: string; url: string; lang?: string }[];
    }) => void,
    options: {
      timeout?: number;
      retries?: number;
      lang?: string;
      overwrite?: boolean;
      inputUrl?: string;
    } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🌐 Fetching Sanji Anime batch stream...');

      apiFetchRaw('/api/batch-scrape-sanjianime-episodes-stream', {
        method: 'POST',
        body: JSON.stringify({
          animeTitle,
          animeId,
          episodeNumbers,
          options,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
          }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();

          if (!reader) {
            throw new Error('Response body is not readable');
          }

          function readStream(): void {
            reader!
              .read()
              .then(({ done, value }) => {
                if (done) {
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
                      console.error('Error parsing SSE data:', e);
                    }
                  }
                }

                readStream();
              })
              .catch((error) => {
                reject(error);
              });
          }

          readStream();
        })
        .catch((error) => {
          reject(error);
        });
    });
  }

  /**
   * Helper for code that stores server sources alongside the main scrape result.
   */
  static getPrimarySource(result: SanjiAnimeScrapeResult): SanjiAnimeServerSource | null {
    return result.episodeData?.sources?.find((source) => source.active && source.playableUrl)
      || result.episodeData?.sources?.find((source) => source.playableUrl)
      || null;
  }

  static inferSourceLang = this.inferLang;
}

export default SanjiAnimeScraperService;