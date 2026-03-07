import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { supabase } from '../../lib/database/supabase';
import { v4 as uuidv4 } from 'uuid';

// Apply stealth plugin to avoid detection
chromium.use(StealthPlugin());

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

export class ServerHiAnimeScraperService {
  private static readonly BASE_URL = 'https://hianime.do';
  private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * Scrape HiAnime.do for anime episodes (Server-side only)
   * Updated to handle current site structure
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
    
    console.log(`🎬 Scraping HiAnime.do for "${animeTitle}", Episode ${episodeNumber}...`);
    
    let browser;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        browser = await chromium.launch({ 
          headless,
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

        // Step 1: Try different search approaches
        const searchUrls = [
          `https://hianime.do/search?q=${encodeURIComponent(animeTitle)}`,
          `https://hianime.do/search?keyword=${encodeURIComponent(animeTitle)}`,
          `https://hianime.do/search?search=${encodeURIComponent(animeTitle)}`
        ];

        let searchSuccess = false;
        let animeLink = '';

        for (const searchUrl of searchUrls) {
          try {
            console.log(`Trying search URL: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'networkidle', timeout });
            
            // Wait a bit for dynamic content
            await page.waitForTimeout(2000);
            
            // Try multiple selectors for anime links
            const selectors = [
              '.film_list-wrap .flw-item a[href*="/watch/"]',
              '.film_list .flw-item a[href*="/watch/"]',
              '.anime-item a[href*="/watch/"]',
              'a[href*="/watch/"]'
            ];

            for (const selector of selectors) {
              try {
                await page.waitForSelector(selector, { timeout: 5000 });
                animeLink = await page.$eval(selector, el => el.href);
                console.log(`Found anime link with selector ${selector}:`, animeLink);
                searchSuccess = true;
                break;
              } catch (e) {
                console.log(`Selector ${selector} not found, trying next...`);
              }
            }

            if (searchSuccess) break;
          } catch (e) {
            console.log(`Search URL ${searchUrl} failed:`, e.message);
          }
        }

        if (!searchSuccess) {
          throw new Error('Could not find anime in search results. Site structure may have changed.');
        }

        // Step 2: Get episode ID
        const animeId = animeLink.match(/watch\/[^?]+-(\d+)/)?.[1];
        if (!animeId) {
          throw new Error('Anime ID not found in URL');
        }

        // Step 3: Get episode servers
        const epApiUrl = `https://hianime.do/ajax/v2/episode/servers?episodeId=${animeId}`;
        await page.goto(epApiUrl, { waitUntil: 'networkidle', timeout: 10000 });
        
        const epResponse = await page.evaluate(() => document.body.innerText);
        const epData = JSON.parse(epResponse);
        
        // Extract server link ID
        const serverLink = epData.html.match(/data-link-id="(\d+)"/)?.[1];
        if (!serverLink) {
          throw new Error('Server link not found');
        }

        // Step 4: Get stream iframe
        const streamApiUrl = `https://hianime.do/ajax/server/${serverLink}`;
        await page.goto(streamApiUrl, { waitUntil: 'networkidle', timeout: 10000 });
        
        const streamResponse = await page.evaluate(() => document.body.innerText);
        const streamData = JSON.parse(streamResponse);
        const iframeSrc = streamData.url;
        
        console.log('Iframe URL:', iframeSrc);

        // Step 5: Extract .m3u8 from iframe
        await page.goto(iframeSrc, { waitUntil: 'networkidle', timeout });
        
        const m3u8Url = await page.evaluate(() => {
          const match = document.body.innerHTML.match(/"(https:\/\/.*\.m3u8[^"]*)"/);
          return match ? match[1] : null;
        });
        
        console.log('Stream URL:', m3u8Url || 'Not found, using iframe fallback');

        await browser.close();
        
        return {
          success: true,
          streamUrl: m3u8Url || iframeSrc,
          episodeData: {
            iframeUrl: iframeSrc,
            m3u8Url: m3u8Url,
            animeTitle,
            episodeNumber
          }
        };

      } catch (error) {
        lastError = error as Error;
        console.error(`❌ Attempt ${attempt} failed:`, error);
        
        if (browser) {
          await browser.close();
        }
        
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
   * Save scraped episode data to Supabase
   */
  static async saveEpisodeToDatabase(
    episodeData: EpisodeScrapeData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('💾 Saving episode to database...', episodeData);

      // Check if episode already exists
      const { data: existingEpisode } = await supabase
        .from('episodes')
        .select('id')
        .eq('anime_id', episodeData.animeId)
        .eq('episode_number', episodeData.episodeNumber)
        .maybeSingle();

      if (existingEpisode) {
        console.log('⚠️ Episode already exists, updating...');
        
        const { error: updateError } = await supabase
          .from('episodes')
          .update({
            title: episodeData.title,
            video_url: episodeData.videoUrl,
            thumbnail_url: episodeData.thumbnailUrl,
            duration: episodeData.duration,
            description: episodeData.description
          })
          .eq('id', existingEpisode.id);

        if (updateError) {
          console.error('❌ Update error:', updateError);
          return { success: false, error: updateError.message };
        }
      } else {
        console.log('➕ Creating new episode...');
        
        const { error: insertError } = await supabase
          .from('episodes')
          .insert({
            id: uuidv4(),
            anime_id: episodeData.animeId,
            episode_number: episodeData.episodeNumber,
            title: episodeData.title,
            video_url: episodeData.videoUrl,
            thumbnail_url: episodeData.thumbnailUrl,
            duration: episodeData.duration,
            description: episodeData.description,
            created_at: episodeData.createdAt.toISOString()
          });

        if (insertError) {
          console.error('❌ Insert error:', insertError);
          return { success: false, error: insertError.message };
        }
      }

      console.log('✅ Episode saved successfully!');
      return { success: true };

    } catch (error) {
      console.error('❌ Database save error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown database error' 
      };
    }
  }

  /**
   * Complete scraping workflow: scrape and save to database
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
      // Step 1: Scrape the episode
      const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, options);
      
      if (!scrapeResult.success || !scrapeResult.streamUrl) {
        return scrapeResult;
      }

      // Step 2: Prepare episode data
      const episodeData: EpisodeScrapeData = {
        animeId,
        episodeNumber,
        title: `${animeTitle} - Episode ${episodeNumber}`,
        videoUrl: scrapeResult.streamUrl,
        thumbnailUrl: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bd${animeId}-5n5yZ6K1J1oH.jpg`,
        duration: animeTitle.includes('Film') ? 5400 : 1440, // 90 mins for movies, 24 mins for episodes
        description: `Episode ${episodeNumber} of ${animeTitle}`,
        createdAt: new Date()
      };

      // Step 3: Save to database
      const saveResult = await this.saveEpisodeToDatabase(episodeData);
      
      if (!saveResult.success) {
        return {
          success: false,
          error: `Scraping succeeded but database save failed: ${saveResult.error}`
        };
      }

      return {
        success: true,
        streamUrl: scrapeResult.streamUrl,
        episodeData: {
          ...episodeData,
          databaseSaveSuccess: true
        }
      };

    } catch (error) {
      console.error('❌ Complete scrape workflow error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error in complete workflow'
      };
    }
  }

  /**
   * Batch scrape multiple episodes for an anime
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
  ): Promise<{ success: boolean; results: ScrapeResult[]; summary: any }> {
    const { delayBetweenEpisodes = 3000 } = options;
    const results: ScrapeResult[] = [];
    let successCount = 0;
    let errorCount = 0;

    console.log(`🎬 Starting batch scrape for "${animeTitle}" - ${episodeNumbers.length} episodes`);

    for (let i = 0; i < episodeNumbers.length; i++) {
      const episodeNumber = episodeNumbers[i];
      console.log(`\n📺 Processing Episode ${episodeNumber} (${i + 1}/${episodeNumbers.length})`);

      try {
        const result = await this.scrapeAndSaveEpisode(animeTitle, animeId, episodeNumber, options);
        results.push(result);

        if (result.success) {
          successCount++;
          console.log(`✅ Episode ${episodeNumber} completed successfully`);
        } else {
          errorCount++;
          console.log(`❌ Episode ${episodeNumber} failed: ${result.error}`);
        }

        // Add delay between episodes to avoid rate limiting
        if (i < episodeNumbers.length - 1) {
          console.log(`⏳ Waiting ${delayBetweenEpisodes}ms before next episode...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenEpisodes));
        }

      } catch (error) {
        errorCount++;
        const errorResult: ScrapeResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        results.push(errorResult);
        console.log(`❌ Episode ${episodeNumber} failed with exception: ${errorResult.error}`);
      }
    }

    const summary = {
      totalEpisodes: episodeNumbers.length,
      successCount,
      errorCount,
      successRate: (successCount / episodeNumbers.length) * 100
    };

    console.log(`\n📊 Batch scrape completed:`);
    console.log(`   Total Episodes: ${summary.totalEpisodes}`);
    console.log(`   Successful: ${summary.successCount}`);
    console.log(`   Failed: ${summary.errorCount}`);
    console.log(`   Success Rate: ${summary.successRate.toFixed(1)}%`);

    return {
      success: errorCount === 0,
      results,
      summary
    };
  }
}
