#!/usr/bin/env node

/**
 * 🎬 HIANIME.DO SCRAPER SCRIPT
 * 
 * This script scrapes anime episodes from HiAnime.do and saves them to Supabase.
 * It can be run standalone or integrated into the admin system.
 * 
 * Usage:
 *   node scripts/hianimeScraper.js
 *   npm run scrape-hianime
 * 
 * Environment Variables Required:
 *   VITE_SUPABASE_URL - Your Supabase project URL
 *   VITE_SUPABASE_ANON_KEY - Your Supabase anonymous key
 */

import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Apply stealth plugin
chromium.use(StealthPlugin());

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

class HiAnimeScraper {
  private static readonly BASE_URL = 'https://hianime.do';
  private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  constructor() {
    this.startTime = Date.now();
    this.results = [];
  }

  async scrapeAnimeEpisode(animeTitle, episodeNumber = 1, options = {}) {
    const { headless = true, timeout = 30000, retries = 3 } = options;
    
    console.log(`🎬 Scraping HiAnime.do for "${animeTitle}", Episode ${episodeNumber}...`);
    
    let browser;
    let lastError = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        browser = await chromium.launch({ 
          headless,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const context = await browser.newContext({
          userAgent: HiAnimeScraper.USER_AGENT,
          viewport: { width: 1280, height: 720 },
          bypassCSP: true,
          javaScriptEnabled: true
        });
        
        const page = await context.newPage();

        // Step 1: Search anime
        const searchUrl = `${HiAnimeScraper.BASE_URL}/search?q=${encodeURIComponent(animeTitle)}`;
        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout });
        
        // Wait for search results
        await page.waitForSelector('.film_list-wrap .flw-item a[href*="/watch/"]', { timeout: 10000 });
        
        // Get the first anime link
        const animeLink = await page.$eval('.film_list-wrap .flw-item a[href*="/watch/"]', el => el.href);
        console.log('Anime Link:', animeLink);

        // Step 2: Get episode ID
        const animeId = animeLink.match(/watch\/[^?]+-(\d+)/)?.[1];
        if (!animeId) {
          throw new Error('Anime ID not found in URL');
        }

        // Get episode servers
        const epApiUrl = `${HiAnimeScraper.BASE_URL}/ajax/v2/episode/servers?episodeId=${animeId}`;
        await page.goto(epApiUrl, { waitUntil: 'networkidle', timeout: 10000 });
        
        const epResponse = await page.evaluate(() => document.body.innerText);
        const epData = JSON.parse(epResponse);
        
        // Extract server link ID
        const serverLink = epData.html.match(/data-link-id="(\d+)"/)?.[1];
        if (!serverLink) {
          throw new Error('Server link not found');
        }

        // Step 3: Get stream iframe
        const streamApiUrl = `${HiAnimeScraper.BASE_URL}/ajax/server/${serverLink}`;
        await page.goto(streamApiUrl, { waitUntil: 'networkidle', timeout: 10000 });
        
        const streamResponse = await page.evaluate(() => document.body.innerText);
        const streamData = JSON.parse(streamResponse);
        const iframeSrc = streamData.url;
        
        console.log('Iframe URL:', iframeSrc);

        // Step 4: Extract .m3u8 from iframe
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
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        
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

  async saveEpisodeToDatabase(episodeData) {
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
            created_at: new Date().toISOString()
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
        error: error.message || 'Unknown database error' 
      };
    }
  }

  async scrapeAndSaveEpisode(animeTitle, animeId, episodeNumber = 1, options = {}) {
    try {
      // Step 1: Scrape the episode
      const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, options);
      
      if (!scrapeResult.success || !scrapeResult.streamUrl) {
        return scrapeResult;
      }

      // Step 2: Prepare episode data
      const episodeData = {
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
        error: error.message || 'Unknown error in complete workflow'
      };
    }
  }

  async batchScrapeEpisodes(animeTitle, animeId, episodeNumbers, options = {}) {
    const { delayBetweenEpisodes = 3000 } = options;
    const results = [];
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
        const errorResult = {
          success: false,
          error: error.message || 'Unknown error'
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

  async testScraper() {
    console.log('🧪 Testing HiAnime Scraper...');
    
    const testAnime = 'One Piece Film: Red';
    const testAnimeId = '141902'; // AniList ID for One Piece Film: Red
    
    try {
      const result = await this.scrapeAndSaveEpisode(testAnime, testAnimeId, 1, {
        headless: false, // Show browser for testing
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

  async runInteractiveMode() {
    console.log('🎬 HiAnime Scraper - Interactive Mode');
    console.log('=====================================');
    
    // For now, run a test with One Piece Film: Red
    const animeTitle = 'One Piece Film: Red';
    const animeId = '141902';
    
    console.log(`\n🎯 Scraping: ${animeTitle}`);
    console.log('This will scrape episode 1 and save it to your database.\n');
    
    const result = await this.scrapeAndSaveEpisode(animeTitle, animeId, 1, {
      headless: true,
      timeout: 30000,
      retries: 3
    });

    if (result.success) {
      console.log('\n🎉 Scraping completed successfully!');
      console.log('📺 Stream URL:', result.streamUrl);
      console.log('💾 Episode saved to database');
    } else {
      console.log('\n❌ Scraping failed:', result.error);
    }

    return result;
  }
}

// Main execution
async function main() {
  try {
    console.log('🎬 HiAnime.do Scraper Started');
    console.log('=' .repeat(50));
    console.log(`⏰ Time: ${new Date().toLocaleString()}`);
    
    // Check environment variables
    if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
      console.error('❌ Missing required environment variables:');
      console.error('   VITE_SUPABASE_URL');
      console.error('   VITE_SUPABASE_ANON_KEY');
      console.error('\nPlease set these in your .env.local file');
      process.exit(1);
    }

    const scraper = new HiAnimeScraper();
    
    // Check command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--test')) {
      await scraper.testScraper();
    } else if (args.includes('--batch')) {
      // Batch mode - scrape multiple episodes
      const animeTitle = args[args.indexOf('--title') + 1] || 'One Piece Film: Red';
      const animeId = args[args.indexOf('--anime-id') + 1] || '141902';
      const episodeCount = parseInt(args[args.indexOf('--episodes') + 1]) || 1;
      
      const episodeNumbers = Array.from({ length: episodeCount }, (_, i) => i + 1);
      
      console.log(`\n🎯 Batch Mode: ${animeTitle}`);
      console.log(`📺 Episodes: ${episodeNumbers.join(', ')}`);
      
      const result = await scraper.batchScrapeEpisodes(animeTitle, animeId, episodeNumbers, {
        headless: true,
        timeout: 30000,
        retries: 2,
        delayBetweenEpisodes: 3000
      });
      
      console.log('\n📊 Batch Results:', result.summary);
    } else {
      // Interactive mode
      await scraper.runInteractiveMode();
    }
    
  } catch (error) {
    console.error('❌ Scraper failed:', error);
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default HiAnimeScraper;
