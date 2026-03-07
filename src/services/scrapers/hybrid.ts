import * as cheerio from 'cheerio';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

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

export class HybridHiAnimeScraperService {
  private static readonly BASE_URL = 'https://hianime.do';
  private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * Hybrid scraper: Cheerio for search + Puppeteer for video extraction
   */
  static async scrapeAnimeEpisode(
    animeTitle: string,
    episodeNumber: number = 1,
    options: {
      headless?: boolean;
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<ScrapeResult> {
    const { headless = true, timeout = 30000, retries = 3 } = options;

    console.log(`🎬 Hybrid scraping HiAnime.do for "${animeTitle}", Episode ${episodeNumber}...`);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Step 1: Use Cheerio for fast search and initial data extraction
        const searchResult = await this.searchAnimeWithCheerio(animeTitle);
        
        if (!searchResult.success) {
          throw new Error(searchResult.error || 'Search failed');
        }

        const { animeLink, animeId } = searchResult;

        // Step 2: Use Puppeteer for dynamic video extraction
        const videoResult = await this.extractVideoWithPuppeteer(animeLink, animeId, episodeNumber, {
          headless,
          timeout
        });

        if (!videoResult.success) {
          throw new Error(videoResult.error || 'Video extraction failed');
        }

        return {
          success: true,
          streamUrl: videoResult.streamUrl,
          episodeData: {
            animeTitle,
            episodeNumber,
            animeId,
            animeLink,
            ...videoResult.episodeData
          }
        };

      } catch (error: any) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);

        if (attempt < retries) {
          console.log(`⏳ Retrying in 2 seconds... (${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error occurred'
    };
  }

  /**
   * Fast search using Cheerio (no browser needed)
   */
  private static async searchAnimeWithCheerio(animeTitle: string): Promise<{
    success: boolean;
    animeLink?: string;
    animeId?: string;
    error?: string;
  }> {
    try {
      console.log('🔍 Searching with Cheerio...');
      
      const searchUrl = `${this.BASE_URL}/search?keyword=${encodeURIComponent(animeTitle)}`;
      
      const searchResponse = await axios.get(searchUrl, {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout: 15000
      });

      const $ = cheerio.load(searchResponse.data);
      
      // Try multiple selectors for anime links
      const selectors = [
        '.film_list-wrap .flw-item a[href*="/watch/"]',
        '.film_list .flw-item a[href*="/watch/"]',
        '.anime-item a[href*="/watch/"]',
        'a[href*="/watch/"]'
      ];

      let animeLink = '';
      for (const selector of selectors) {
        const link = $(selector).first();
        if (link.length > 0) {
          animeLink = link.attr('href') || '';
          if (animeLink) {
            if (!animeLink.startsWith('http')) {
              animeLink = this.BASE_URL + animeLink;
            }
            break;
          }
        }
      }

      if (!animeLink) {
        return { success: false, error: 'No anime links found in search results' };
      }

      // Extract anime ID
      const animeId = animeLink.match(/watch\/[^?]+-(\d+)/)?.[1];
      if (!animeId) {
        return { success: false, error: 'Anime ID not found in URL' };
      }

      console.log('✅ Cheerio search successful:', { animeLink, animeId });
      return { success: true, animeLink, animeId };

    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Dynamic video extraction using Puppeteer
   */
  private static async extractVideoWithPuppeteer(
    animeLink: string,
    animeId: string,
    episodeNumber: number,
    options: {
      headless?: boolean;
      timeout?: number;
    }
  ): Promise<{
    success: boolean;
    streamUrl?: string;
    episodeData?: any;
    error?: string;
  }> {
    let browser;
    
    try {
      console.log('🎥 Extracting video with Puppeteer...');
      
      browser = await chromium.launch({
        headless: options.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
      });

      const context = await browser.newContext({
        userAgent: this.USER_AGENT,
        viewport: { width: 1280, height: 720 },
        bypassCSP: true,
        javaScriptEnabled: true,
        extraHTTPHeaders: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      });

      const page = await context.newPage();

      // Navigate to the anime page
      await page.goto(animeLink, { waitUntil: 'networkidle', timeout: options.timeout });
      
      // Wait for the page to load completely
      await page.waitForTimeout(3000);

      // Try to find video elements
      let streamUrl = '';
      
      // Method 1: Look for iframe elements
      try {
        await page.waitForSelector('iframe', { timeout: 10000 });
        const iframeSrc = await page.$eval('iframe', (el: HTMLIFrameElement) => el.src);
        if (iframeSrc) {
          streamUrl = iframeSrc;
          console.log('✅ Found iframe source:', streamUrl);
        }
      } catch (e) {
        console.log('No iframe found, trying other methods...');
      }

      // Method 2: Look for video elements
      if (!streamUrl) {
        try {
          await page.waitForSelector('video', { timeout: 10000 });
          const videoSrc = await page.$eval('video', (el: HTMLVideoElement) => el.src);
          if (videoSrc) {
            streamUrl = videoSrc;
            console.log('✅ Found video source:', streamUrl);
          }
        } catch (e) {
          console.log('No video element found...');
        }
      }

      // Method 3: Look for video source elements
      if (!streamUrl) {
        try {
          await page.waitForSelector('video source', { timeout: 10000 });
          const sourceSrc = await page.$eval('video source', (el: HTMLSourceElement) => el.src);
          if (sourceSrc) {
            streamUrl = sourceSrc;
            console.log('✅ Found video source element:', streamUrl);
          }
        } catch (e) {
          console.log('No video source element found...');
        }
      }

      // Method 4: Extract from page content (for dynamically loaded content)
      if (!streamUrl) {
        const pageContent = await page.content();
        const urlPatterns = [
          /"(https?:\/\/[^"]*\.m3u8[^"]*)"/g,
          /"(https?:\/\/[^"]*embed[^"]*)"/g,
          /"(https?:\/\/[^"]*player[^"]*)"/g,
          /src\s*:\s*["']([^"']*embed[^"']*)["']/g,
          /url\s*:\s*["']([^"']*\.m3u8[^"']*)["']/g
        ];
        
        for (const pattern of urlPatterns) {
          const matches = pageContent.match(pattern);
          if (matches && matches.length > 0) {
            for (const match of matches) {
              const url = match.replace(/["']/g, '').replace(/src\s*:\s*/, '').replace(/url\s*:\s*/, '');
              if (url && (url.includes('embed') || url.includes('player') || url.includes('.m3u8'))) {
                streamUrl = url;
                console.log('✅ Found video URL in page content:', streamUrl);
                break;
              }
            }
            if (streamUrl) break;
          }
        }
      }

      if (!streamUrl) {
        return { success: false, error: 'Could not find video stream URL' };
      }

      await browser.close();

      return {
        success: true,
        streamUrl,
        episodeData: {
          animeId,
          episodeNumber,
          extractedAt: new Date()
        }
      };

    } catch (error: any) {
      if (browser) {
        await browser.close();
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * Save episode to database
   */
  static async saveEpisodeToDatabase(episodeData: EpisodeScrapeData): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase.from('episodes').upsert(
        {
          anime_id: episodeData.animeId,
          episode_number: episodeData.episodeNumber,
          title: episodeData.title,
          video_url: episodeData.videoUrl,
          thumbnail_url: episodeData.thumbnailUrl,
          duration: episodeData.duration,
          description: episodeData.description,
          created_at: episodeData.createdAt.toISOString(),
        },
        { onConflict: ['anime_id', 'episode_number'] }
      );

      if (error) {
        console.error('DB Error:', error.message);
        return { success: false, error: error.message };
      }
      console.log('🎉 Stream saved to Supabase!');
      return { success: true };
    } catch (error: any) {
      console.error('❌ Save Error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scrape and save episode in one call
   */
  static async scrapeAndSaveEpisode(
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
      const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, options);

      if (scrapeResult.success && scrapeResult.streamUrl) {
        const episodeData: EpisodeScrapeData = {
          animeId: animeId,
          episodeNumber: episodeNumber,
          title: `${animeTitle} - Episode ${episodeNumber}`,
          videoUrl: scrapeResult.streamUrl,
          thumbnailUrl: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bd${animeId}-5n5yZ6K1J1oH.jpg`,
          duration: 1440, // Default to 24 mins
          description: `Episode ${episodeNumber} of ${animeTitle}`,
          createdAt: new Date(),
        };

        const saveResult = await this.saveEpisodeToDatabase(episodeData);
        
        if (saveResult.success) {
          return {
            success: true,
            streamUrl: scrapeResult.streamUrl,
            episodeData: episodeData
          };
        } else {
          return {
            success: false,
            error: saveResult.error
          };
        }
      } else {
        return scrapeResult;
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message
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
  ): Promise<{ success: boolean; summary: { total: number; successCount: number; errorCount: number; errors: string[] } }> {
    const { delayBetweenEpisodes = 5000 } = options; // Longer delay for Puppeteer
    const summary = {
      total: episodeNumbers.length,
      successCount: 0,
      errorCount: 0,
      errors: [] as string[],
    };

    console.log(`🎬 Starting batch scrape for ${episodeNumbers.length} episodes of "${animeTitle}"`);

    for (const episodeNumber of episodeNumbers) {
      console.log(`Starting batch scrape for episode ${episodeNumber} of "${animeTitle}"`);
      try {
        const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, options);

        if (scrapeResult.success && scrapeResult.episodeData) {
          const episodeToSave: EpisodeScrapeData = {
            animeId: animeId,
            episodeNumber: episodeNumber,
            title: `${animeTitle} - Episode ${episodeNumber}`,
            videoUrl: scrapeResult.streamUrl!,
            thumbnailUrl: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bd${animeId}-5n5yZ6K1J1oH.jpg`,
            duration: 1440, // Default to 24 mins
            description: `Episode ${episodeNumber} of ${animeTitle}`,
            createdAt: new Date(),
          };
          const saveResult = await this.saveEpisodeToDatabase(episodeToSave);
          if (saveResult.success) {
            summary.successCount++;
            console.log(`✅ Episode ${episodeNumber} saved successfully`);
          } else {
            summary.errorCount++;
            summary.errors.push(`Episode ${episodeNumber}: ${saveResult.error}`);
            console.log(`❌ Episode ${episodeNumber} save failed: ${saveResult.error}`);
          }
        } else {
          summary.errorCount++;
          summary.errors.push(`Episode ${episodeNumber}: ${scrapeResult.error}`);
          console.log(`❌ Episode ${episodeNumber} scrape failed: ${scrapeResult.error}`);
        }
      } catch (error: any) {
        summary.errorCount++;
        summary.errors.push(`Episode ${episodeNumber}: ${error.message}`);
        console.log(`❌ Episode ${episodeNumber} error: ${error.message}`);
      }
      
      // Delay between episodes to avoid overwhelming the server
      if (episodeNumber < episodeNumbers[episodeNumbers.length - 1]) {
        console.log(`⏳ Waiting ${delayBetweenEpisodes}ms before next episode...`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenEpisodes));
      }
    }

    console.log(`🎉 Batch scrape completed: ${summary.successCount}/${summary.total} episodes successful`);
    return { success: summary.errorCount === 0, summary };
  }

  /**
   * Test the hybrid scraper
   */
  static async testScraper(): Promise<void> {
    console.log('🧪 Testing Hybrid HiAnime Scraper...');
    
    const testAnime = 'One Piece';
    
    try {
      const result = await this.scrapeAnimeEpisode(testAnime, 1, {
        headless: true,
        timeout: 30000,
        retries: 2
      });

      if (result.success) {
        console.log('✅ Test successful!');
        console.log('Stream URL:', result.streamUrl);
        console.log('Episode Data:', result.episodeData);
      } else {
        console.log('❌ Test failed:', result.error);
      }

    } catch (error) {
      console.error('❌ Test error:', error);
    }
  }
}
