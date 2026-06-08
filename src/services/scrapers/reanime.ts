import { apiClient, apiFetchRaw } from '../../utils/api/client';

export interface ReAnimeServerSource {
  label: string;
  occurrence: number;
  iframeUrl: string;
}

export interface ReAnimeScrapeResult {
  success: boolean;
  watchUrl?: string;
  streamUrl?: string;
  episodeData?: {
    inputUrl: string;
    watchUrl: string;
    currentIframeUrl?: string | null;
    sources: ReAnimeServerSource[];
    sourceCount: number;
    episodeNumber: number;
  };
  error?: string;
}

export class ReAnimeScraperService {
  /**
   * Resolve a Re:ANIME anime/watch URL to the active player iframe + all server variants.
   */
  static async scrapeAnimeEpisode(
    url: string,
    episodeNumber: number = 1,
    options: {
      timeout?: number;
      retries?: number;
      lang?: string;
      animeId?: string;
    } = {}
  ): Promise<ReAnimeScrapeResult> {
    try {
      console.log(`🎬 Scraping Re:ANIME for "${url}" (episode ${episodeNumber})`);

      return await apiClient.post('/api/scrape-reanime-episode', {
        url,
        episodeNumber,
        options,
      });
    } catch (error) {
      console.error('Error calling Re:ANIME scraper API:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Resolve a Re:ANIME page and return the primary player URL.
   */
  static async resolvePlayerUrl(
    url: string,
    episodeNumber: number = 1,
    options: {
      timeout?: number;
      retries?: number;
      lang?: string;
    } = {}
  ): Promise<ReAnimeScrapeResult> {
    return this.scrapeAnimeEpisode(url, episodeNumber, options);
  }

  /**
   * Batch scrape multiple episodes from Re:ANIME
   */
  static async batchScrapeEpisodes(
    animeTitle: string,
    animeId: string,
    episodeNumbers: number[],
    options: {
      timeout?: number;
      retries?: number;
      lang?: string;
      overwrite?: boolean;
    } = {}
  ): Promise<{
    success: boolean;
    results: ReAnimeScrapeResult[];
    summary: {
      totalEpisodes: number;
      successCount: number;
      errorCount: number;
      successRate: number;
    };
    error?: string;
  }> {
    try {
      console.log(`🎬 Batch scraping ${episodeNumbers.length} episodes for "${animeTitle}"`);
      const results: ReAnimeScrapeResult[] = [];
      let successCount = 0;
      let errorCount = 0;

      await this.batchScrapeEpisodesWithProgress(
        animeTitle,
        animeId,
        episodeNumbers,
        (event) => {
          if (event.type === 'success' && event.episode) {
            successCount++;
            results.push({
              success: true,
              streamUrl: event.url,
              episodeData: {
                inputUrl: animeTitle,
                watchUrl: event.url || '',
                sources: [],
                sourceCount: 1,
                episodeNumber: event.episode,
              },
            });
          } else if (event.type === 'error' && event.episode) {
            errorCount++;
            results.push({
              success: false,
              error: event.error,
            });
          }
        },
        options
      );

      return {
        success: true,
        results,
        summary: {
          totalEpisodes: episodeNumbers.length,
          successCount,
          errorCount,
          successRate: Math.round((successCount / episodeNumbers.length) * 100),
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
    } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🌐 Fetching Re:ANIME batch stream...');

      apiFetchRaw('/api/batch-scrape-reanime-episodes-stream', {
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
}

