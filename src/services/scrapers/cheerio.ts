import * as cheerio from 'cheerio';
import axios from 'axios';
import { supabase } from '../../lib/database/supabase';
import { v4 as uuidv4 } from 'uuid';

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

export class CheerioHiAnimeScraperService {
  private static readonly BASE_URL = 'https://hianime.do';
  private static readonly USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  /**
   * Scrape HiAnime.do using Cheerio (faster, lighter approach)
   */
  static async scrapeAnimeEpisode(
    animeTitle: string, 
    episodeNumber: number = 1,
    options: {
      timeout?: number;
      retries?: number;
    } = {}
  ): Promise<ScrapeResult> {
    const { timeout = 10000, retries = 3 } = options;
    
    console.log(`🎬 Scraping HiAnime.do with Cheerio for "${animeTitle}", Episode ${episodeNumber}...`);
    
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Step 1: Search anime
        const searchUrl = `${this.BASE_URL}/search?keyword=${encodeURIComponent(animeTitle)}`;
        console.log(`Search URL: ${searchUrl}`);
        
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
          timeout
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
        let searchSuccess = false;

        for (const selector of selectors) {
          const link = $(selector).first();
          if (link.length > 0) {
            animeLink = link.attr('href') || '';
            if (animeLink) {
              // Make sure it's a full URL
              if (!animeLink.startsWith('http')) {
                animeLink = this.BASE_URL + animeLink;
              }
              console.log(`Found anime link with selector ${selector}:`, animeLink);
              searchSuccess = true;
              break;
            }
          }
        }

        if (!searchSuccess) {
          // Debug: Log page content to understand structure
          console.log('Page title:', $('title').text());
          console.log('Available links:', $('a[href*="/watch/"]').map((i, el) => $(el).attr('href')).get().slice(0, 5));
          throw new Error('Could not find anime in search results. Site structure may have changed.');
        }

        // Step 2: Get episode ID
        const animeId = animeLink.match(/watch\/[^?]+-(\d+)/)?.[1];
        if (!animeId) {
          throw new Error('Anime ID not found in URL');
        }

        // Step 3: Get episode servers
        const epApiUrl = `${this.BASE_URL}/ajax/v2/episode/servers?episodeId=${animeId}`;
        console.log(`Episode API URL: ${epApiUrl}`);
        
        const epResponse = await axios.get(epApiUrl, {
          headers: {
            'User-Agent': this.USER_AGENT,
            'Referer': animeLink,
          },
          timeout
        });

        const epData = epResponse.data;
        
        // Extract server link ID - try both old and new formats
        let serverLink = epData.html?.match(/data-link-id="(\d+)"/)?.[1];
        if (!serverLink) {
          serverLink = epData.html?.match(/data-id="(\d+)"/)?.[1];
        }
        if (!serverLink) {
          throw new Error('Server link not found');
        }

        // Step 4: Try different approaches to get stream (inspired by Anipaca)
        let iframeSrc = '';
        
        // Try the original API first
        try {
          const streamApiUrl = `${this.BASE_URL}/ajax/server/${serverLink}`;
          console.log(`Stream API URL: ${streamApiUrl}`);
          
          const streamResponse = await axios.get(streamApiUrl, {
            headers: {
              'User-Agent': this.USER_AGENT,
              'Referer': animeLink,
            },
            timeout
          });

          const streamData = streamResponse.data;
          iframeSrc = streamData.url;
          console.log('Iframe URL from API:', iframeSrc);
        } catch (apiError) {
          console.log('API approach failed, trying alternative endpoints...');
          
          // Try alternative API endpoints (inspired by Anipaca's approach)
          const alternativeEndpoints = [
            `${this.BASE_URL}/ajax/v2/episode/sources?episodeId=${animeId}`,
            `${this.BASE_URL}/ajax/episode/servers?episodeId=${animeId}`,
            `${this.BASE_URL}/ajax/v2/episode/servers?episodeId=${animeId}&server=${serverLink}`
          ];
          
          for (const endpoint of alternativeEndpoints) {
            try {
              console.log(`Trying alternative endpoint: ${endpoint}`);
              const altResponse = await axios.get(endpoint, {
                headers: {
                  'User-Agent': this.USER_AGENT,
                  'Referer': animeLink,
                },
                timeout: 10000
              });
              
              const altData = altResponse.data;
              if (altData.url || altData.link) {
                iframeSrc = altData.url || altData.link;
                console.log('Found stream URL from alternative endpoint:', iframeSrc);
                break;
              }
            } catch (altError) {
              console.log(`Alternative endpoint ${endpoint} failed`);
            }
          }
          
          // If still no success, try direct page approach
          if (!iframeSrc) {
            try {
              console.log('Trying direct page approach...');
              const animePageResponse = await axios.get(animeLink, {
                headers: {
                  'User-Agent': this.USER_AGENT,
                  'Referer': searchUrl,
                },
                timeout
              });

              const animePage$ = cheerio.load(animePageResponse.data);
              
              // Look for iframe or video elements
              const iframe = animePage$('iframe[src*="embed"]').first();
              if (iframe.length > 0) {
                iframeSrc = iframe.attr('src') || '';
                console.log('Iframe URL from page:', iframeSrc);
              } else {
                // Look for video elements or other streaming sources
                const video = animePage$('video source').first();
                if (video.length > 0) {
                  iframeSrc = video.attr('src') || '';
                  console.log('Video URL from page:', iframeSrc);
                }
              }
            } catch (pageError) {
              console.log('Direct page approach also failed');
            }
          }
        }
        
        if (!iframeSrc) {
          throw new Error('Could not find stream URL from any method');
        }

        // Step 5: Extract .m3u8 from iframe (if possible with Cheerio)
        let m3u8Url = null;
        try {
          const iframeResponse = await axios.get(iframeSrc, {
            headers: {
              'User-Agent': this.USER_AGENT,
              'Referer': streamApiUrl,
            },
            timeout
          });

          const iframe$ = cheerio.load(iframeResponse.data);
          const iframeHtml = iframeResponse.data;
          
          // Look for m3u8 URLs in the HTML
          const m3u8Match = iframeHtml.match(/"(https:\/\/.*\.m3u8[^"]*)"/);
          if (m3u8Match) {
            m3u8Url = m3u8Match[1];
          }
        } catch (e) {
          console.log('Could not extract m3u8 from iframe, using iframe fallback');
        }
        
        console.log('Stream URL:', m3u8Url || 'Not found, using iframe fallback');

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
   * Batch scrape multiple episodes
   */
  static async batchScrapeEpisodes(
    animeTitle: string,
    animeId: string,
    episodeNumbers: number[],
    options: {
      timeout?: number;
      retries?: number;
      delayBetweenEpisodes?: number;
    } = {}
  ): Promise<{ 
    success: boolean; 
    results: ScrapeResult[]; 
    summary: {
      totalEpisodes: number;
      successCount: number;
      errorCount: number;
      successRate: number;
    };
    error?: string;
  }> {
    const { delayBetweenEpisodes = 2000 } = options;
    const results: ScrapeResult[] = [];
    const summary = {
      totalEpisodes: episodeNumbers.length,
      successCount: 0,
      errorCount: 0,
      successRate: 0
    };

    console.log(`🎬 Starting batch scrape for ${episodeNumbers.length} episodes of "${animeTitle}"`);

    for (const episodeNumber of episodeNumbers) {
      console.log(`📺 Processing episode ${episodeNumber}...`);
      
      try {
        const result = await this.scrapeAndSaveEpisode(
          animeTitle,
          animeId,
          episodeNumber,
          options
        );

        results.push(result);

        if (result.success) {
          summary.successCount++;
          console.log(`✅ Episode ${episodeNumber} completed successfully`);
        } else {
          summary.errorCount++;
          console.log(`❌ Episode ${episodeNumber} failed: ${result.error}`);
        }

        // Delay between episodes to avoid overwhelming the server
        if (episodeNumber < episodeNumbers[episodeNumbers.length - 1]) {
          await new Promise(resolve => setTimeout(resolve, delayBetweenEpisodes));
        }

      } catch (error) {
        const errorResult: ScrapeResult = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        
        results.push(errorResult);
        summary.errorCount++;
        console.log(`❌ Episode ${episodeNumber} failed with exception: ${errorResult.error}`);
      }
    }

    summary.successRate = summary.totalEpisodes > 0 
      ? (summary.successCount / summary.totalEpisodes) * 100 
      : 0;

    console.log(`📊 Batch scrape completed: ${summary.successCount}/${summary.totalEpisodes} episodes successful (${summary.successRate.toFixed(1)}%)`);

    return {
      success: summary.errorCount === 0,
      results,
      summary
    };
  }

  /**
   * Test the Cheerio scraper
   */
  static async testScraper(): Promise<void> {
    console.log('🧪 Testing Cheerio HiAnime Scraper...');
    
    const testAnime = 'One Piece';
    
    try {
      const result = await this.scrapeAnimeEpisode(testAnime, 1, {
        timeout: 15000,
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
