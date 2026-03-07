// Large Anime Scraper Service
// Handles chunked scraping for anime with many episodes (like One Piece with 1146 episodes)

export interface LargeScrapeProgress {
  id: string;
  animeId: string;
  animeTitle: string;
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  currentChunk: number;
  totalChunks: number;
  chunkSize: number;
  status: 'in_progress' | 'paused' | 'completed' | 'failed';
  progressPercentage: number;
  estimatedTimeRemaining: string;
  episodesPerMs: number;
  startedAt: string;
  updatedAt: string;
}

export interface ChunkScrapeResult {
  success: boolean;
  message: string;
  results: Array<{
    episode: number;
    status: 'success' | 'failed';
    url?: string;
    error?: string;
  }>;
  summary: {
    totalEpisodes: number;
    successCount: number;
    errorCount: number;
    successRate: number;
  };
}

export class LargeAnimeScraperService {
  private static readonly API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

  /**
   * Start a large anime scraping job
   */
  static async startLargeScrape(
    animeId: string,
    animeTitle: string,
    totalEpisodes: number,
    chunkSize: number = 50
  ): Promise<{
    success: boolean;
    message?: string;
    jobId?: string;
    totalEpisodes?: number;
    totalChunks?: number;
    chunkSize?: number;
    error?: string;
  }> {
    try {
      console.log(`🎬 Starting large scrape: ${animeTitle} (${totalEpisodes} episodes)`);

      const response = await fetch(`${this.API_BASE_URL}/api/start-large-scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeId,
          animeTitle,
          totalEpisodes,
          chunkSize
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error starting large scrape:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get scraping progress for an anime
   */
  static async getScrapingProgress(animeId: string): Promise<{
    success: boolean;
    progress?: LargeScrapeProgress;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.API_BASE_URL}/api/scraping-progress/${animeId}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        progress: data.progress
      };
    } catch (error) {
      console.error('Error getting scraping progress:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Scrape a single chunk of episodes
   */
  static async scrapeChunk(
    animeId: string,
    animeTitle: string,
    chunkNumber: number,
    progressId: string,
    totalEpisodes: number,
    chunkSize: number = 50
  ): Promise<ChunkScrapeResult> {
    try {
      console.log(`📺 Scraping chunk ${chunkNumber} for ${animeTitle}`);

      const response = await fetch(`${this.API_BASE_URL}/api/scrape-chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          animeId,
          animeTitle,
          chunkNumber,
          progressId,
          totalEpisodes,
          chunkSize
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error scraping chunk:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        results: [],
        summary: {
          totalEpisodes: 0,
          successCount: 0,
          errorCount: 0,
          successRate: 0
        }
      };
    }
  }

  /**
   * Scrape all chunks automatically (for background processing)
   */
  static async scrapeAllChunks(
    animeId: string,
    animeTitle: string,
    totalEpisodes: number,
    chunkSize: number = 50,
    onProgress?: (progress: LargeScrapeProgress) => void,
    onChunkComplete?: (chunkNumber: number, result: ChunkScrapeResult) => void
  ): Promise<{
    success: boolean;
    message: string;
    totalChunks: number;
    completedChunks: number;
    error?: string;
  }> {
    try {
      // Start the large scrape job
      const startResult = await this.startLargeScrape(animeId, animeTitle, totalEpisodes, chunkSize);
      
      if (!startResult.success) {
        throw new Error(startResult.error || 'Failed to start large scrape');
      }

      const totalChunks = Math.ceil(totalEpisodes / chunkSize);
      let completedChunks = 0;

      console.log(`🚀 Starting automatic scraping of ${totalChunks} chunks`);

      // Scrape each chunk
      for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
        try {
          // Get current progress
          const progressResult = await this.getScrapingProgress(animeId);
          if (progressResult.success && onProgress) {
            onProgress(progressResult.progress!);
          }

          // Scrape the chunk
          const chunkResult = await this.scrapeChunk(
            animeId,
            animeTitle,
            chunkNumber,
            startResult.jobId!,
            totalEpisodes,
            chunkSize
          );

          completedChunks++;
          
          if (onChunkComplete) {
            onChunkComplete(chunkNumber, chunkResult);
          }

          console.log(`✅ Chunk ${chunkNumber}/${totalChunks} completed: ${chunkResult.summary.successCount} success, ${chunkResult.summary.errorCount} failed`);

          // Add delay between chunks to avoid being blocked
          if (chunkNumber < totalChunks) {
            console.log(`⏳ Waiting 10 seconds before next chunk...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
          }

        } catch (error) {
          console.error(`❌ Chunk ${chunkNumber} failed:`, error);
          // Continue with next chunk even if one fails
        }
      }

      console.log(`🎉 All chunks completed! ${completedChunks}/${totalChunks} chunks processed`);

      return {
        success: true,
        message: `Scraping completed: ${completedChunks}/${totalChunks} chunks processed`,
        totalChunks,
        completedChunks
      };

    } catch (error) {
      console.error('Error in scrapeAllChunks:', error);
      return {
        success: false,
        message: 'Scraping failed',
        totalChunks: 0,
        completedChunks: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Calculate estimated time for large scraping
   */
  static calculateEstimatedTime(totalEpisodes: number, chunkSize: number = 50): {
    totalChunks: number;
    estimatedHours: number;
    estimatedDays: number;
  } {
    const totalChunks = Math.ceil(totalEpisodes / chunkSize);
    
    // Estimate: 2 seconds per episode + 10 seconds between chunks
    const secondsPerEpisode = 2;
    const secondsBetweenChunks = 10;
    
    const totalSeconds = (totalEpisodes * secondsPerEpisode) + ((totalChunks - 1) * secondsBetweenChunks);
    const estimatedHours = totalSeconds / 3600;
    const estimatedDays = estimatedHours / 24;

    return {
      totalChunks,
      estimatedHours: Math.round(estimatedHours * 10) / 10,
      estimatedDays: Math.round(estimatedDays * 10) / 10
    };
  }
}
