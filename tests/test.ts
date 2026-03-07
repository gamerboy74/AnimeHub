import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();
chromium.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3001;
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);
const redis = new Redis(process.env.REDIS_URL!);

// Middleware
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Utility function
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Scraper Service
class NineAnimeScraperService {
  static BASE_URL = 'https://9anime.org.lv';
  static USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  static async scrapeAnimeEpisode(animeTitle: string, episodeNumber: number = 1, options: any = {}): Promise<any> {
    const cacheKey = `episode:${animeTitle}:${episodeNumber}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit for ${cacheKey}`);
      return JSON.parse(cached);
    }

    const { timeout = 45000, retries = 3 } = options;
    console.log(`🎬 Scraping 9anime.org.lv for "${animeTitle}", Episode ${episodeNumber}...`);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const searchResult = await this.searchAnimeWithCheerio(animeTitle, episodeNumber);
        if (!searchResult.success) {
          throw new Error(searchResult.error || 'Search failed');
        }

        const { animeLink, animeId } = searchResult;
        console.log(`🔍 DEBUG: animeLink = ${animeLink}, episodeNumber = ${episodeNumber}`);

        const videoResult = await this.extractVideoWithPuppeteer(animeLink, animeId, episodeNumber, { timeout });
        if (!videoResult.success) {
          throw new Error(videoResult.error || 'Video extraction failed');
        }

        const embeddingCheck = await this.checkEmbeddingProtection(videoResult.streamUrl);

        const finalEpisodeData = {
          animeTitle,
          animeId,
          animeLink,
          ...videoResult.episodeData,
          episodeNumber
        };

        console.log(`🔍 DEBUG: Final episodeData = ${JSON.stringify(finalEpisodeData)}`);

        const result = {
          success: true,
          streamUrl: videoResult.streamUrl,
          embeddingProtected: embeddingCheck.protected,
          embeddingReason: embeddingCheck.reason,
          episodeData: finalEpisodeData
        };

        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400); // Cache for 24 hours
        return result;
      } catch (error) {
        lastError = error as Error;
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

  static async scrapeAllEpisodes(animeTitle: string, options: any = {}): Promise<any> {
    const { maxEpisodes = 50, timeout = 45000, retries = 2 } = options;
    console.log(`🎬 Scraping all episodes for "${animeTitle}" (max ${maxEpisodes})...`);

    try {
      const searchResult = await this.searchAnimeWithCheerio(animeTitle, 1);
      if (!searchResult.success) {
        return { success: false, error: searchResult.error || 'Search failed' };
      }

      const { animeLink, animeId } = searchResult;

      const episodesResult = await this.getAvailableEpisodes(animeLink, animeId, maxEpisodes);
      if (!episodesResult.success) {
        return { success: false, error: episodesResult.error || 'Failed to get episodes' };
      }

      const { episodes, totalEpisodes } = episodesResult;
      console.log(`📺 Found ${totalEpisodes} total episodes, checking first ${episodes.length}...`);

      const scrapedEpisodes: any[] = [];
      const failedEpisodes: any[] = [];

      for (const episode of episodes) {
        try {
          console.log(`🎬 Scraping Episode ${episode.number}: "${episode.title}"`);
          const episodeResult = await this.scrapeAnimeEpisode(animeTitle, episode.number, {
            timeout: timeout / episodes.length,
            retries
          });

          if (episodeResult.success) {
            scrapedEpisodes.push({
              ...episode,
              streamUrl: episodeResult.streamUrl,
              embeddingProtected: episodeResult.embeddingProtected,
              embeddingReason: episodeResult.embeddingReason,
              scrapedAt: new Date().toISOString()
            });
            console.log(`✅ Episode ${episode.number} scraped successfully`);
          } else {
            failedEpisodes.push({
              ...episode,
              error: episodeResult.error
            });
            console.log(`❌ Episode ${episode.number} failed: ${episodeResult.error}`);
          }

          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          failedEpisodes.push({
            ...episode,
            error: (error as Error).message
          });
          console.log(`❌ Episode ${episode.number} error: ${(error as Error).message}`);
        }
      }

      return {
        success: true,
        animeTitle,
        animeId,
        totalEpisodes,
        scrapedEpisodes,
        failedEpisodes,
        summary: {
          total: episodes.length,
          successful: scrapedEpisodes.length,
          failed: failedEpisodes.length,
          embeddingProtected: scrapedEpisodes.filter(ep => ep.embeddingProtected).length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  static async getAvailableEpisodes(animeLink: string, animeId: string, maxEpisodes: number = 50): Promise<any> {
    try {
      console.log('📺 Getting available episodes...');

      const response = await axios.get(animeLink, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 15000
      });

      const $ = cheerio.load(response.data);

      const animeSlug = animeLink.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
                        animeLink.match(/anime\/([^\/]+)/)?.[1] ||
                        animeId;

      console.log(`🔍 Looking for episodes with anime slug: ${animeSlug}`);

      const episodes: any[] = [];
      const episodeContainers = $('.episode-list, .episodes, .episode-item, [class*="episode"]');

      episodeContainers.each((i, container) => {
        const episodeItems = $(container).find('a, .episode, [class*="episode"]');

        episodeItems.each((j, item) => {
          const text = $(item).text().trim();
          const href = $(item).attr('href');

          if (text && href) {
            const isSameAnime = href.includes(animeSlug) ||
                                href.includes(animeId) ||
                                href.includes(animeLink.split('/').pop()?.split('-episode')[0]);

            if (isSameAnime) {
              const episodeMatch = href.match(/-episode-(\d+)/) ||
                                   href.match(/\/episode\/(\d+)/) ||
                                   href.match(/\/watch\/.*?(\d+)/) ||
                                   text.match(/episode\s*(\d+)/i) ||
                                   text.match(/ep\s*(\d+)/i);

              if (episodeMatch) {
                const episodeNumber = parseInt(episodeMatch[1]);
                if (episodeNumber && episodeNumber <= maxEpisodes) {
                  episodes.push({
                    number: episodeNumber,
                    title: text,
                    url: href.startsWith('http') ? href : this.BASE_URL + href
                  });
                }
              } else if (text.match(/\d+/)) {
                const episodeNumber = parseInt(text.match(/\d+/)[0]);
                if (episodeNumber && episodeNumber <= maxEpisodes) {
                  episodes.push({
                    number: episodeNumber,
                    title: text,
                    url: href.startsWith('http') ? href : this.BASE_URL + href
                  });
                }
              }
            }
          }
        });
      });

      let filteredEpisodes = episodes.filter((ep, index, self) =>
        index === self.findIndex(e => e.number === ep.number)
      ).sort((a, b) => a.number - b.number);

      if (filteredEpisodes.length === 0) {
        console.log('⚠️ No episodes found, constructing episode URLs...');

        if (animeSlug.toLowerCase().includes('film') || animeSlug.toLowerCase().includes('movie')) {
          filteredEpisodes.push({
            number: 1,
            title: 'Movie',
            url: animeLink
          });
        } else {
          for (let i = 1; i <= Math.min(12, maxEpisodes); i++) {
            const episodeUrl = animeLink.replace(/-episode-\d+/, `-episode-${i}`);
            filteredEpisodes.push({
              number: i,
              title: `Episode ${i}`,
              url: episodeUrl
            });
          }
        }
      }

      filteredEpisodes = filteredEpisodes.filter(episode => {
        if (animeSlug.toLowerCase().includes('film') || animeSlug.toLowerCase().includes('movie')) {
          return episode.number === 1;
        }
        return true;
      });

      console.log(`✅ Found ${filteredEpisodes.length} episodes for ${animeSlug}`);
      console.log('Episodes:', filteredEpisodes.map(ep => `Ep ${ep.number}: ${ep.title}`));

      return {
        success: true,
        episodes: filteredEpisodes,
        totalEpisodes: filteredEpisodes.length
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  static async checkEmbeddingProtection(videoUrl: string): Promise<any> {
    try {
      console.log('🔍 Checking for anti-embedding protection...');

      const response = await axios.get(videoUrl, {
        headers: { 'User-Agent': this.USER_AGENT },
        timeout: 10000,
        validateStatus: (status) => status < 500
      });

      const html = response.data;

      const antiEmbeddingPatterns = [
        /if\s*\(\s*window\s*==\s*window\.top\s*\)/i,
        /window\.location\.replace/i,
        /window\.top\.location/i,
        /parent\.location/i,
        /top\.location/i,
        /frameElement/i,
        /anti-embed/i,
        /embedding.*block/i,
        /no.*embed/i
      ];

      const protectionReasons: string[] = [];

      for (const pattern of antiEmbeddingPatterns) {
        if (pattern.test(html)) {
          protectionReasons.push(pattern.toString());
        }
      }

      if (html.includes('cloudflare') || html.includes('challenge-platform')) {
        if (videoUrl.includes('megaplay.buzz')) {
          console.log('🎯 Megaplay.buzz detected - Cloudflare protection is usually embeddable');
        } else {
          protectionReasons.push('Cloudflare protection detected');
        }
      }

      if (html.includes('data-src') && !html.includes('src=')) {
        protectionReasons.push('Dynamic iframe loading detected');
      }

      const isProtected = protectionReasons.length > 0 && !videoUrl.includes('megaplay.buzz');

      console.log(`${isProtected ? '⚠️' : '✅'} Embedding protection: ${isProtected ? 'DETECTED' : 'NONE'}`);
      if (isProtected) {
        console.log('Reasons:', protectionReasons);
      }

      return {
        protected: isProtected,
        reason: isProtected ? protectionReasons.join(', ') : null
      };
    } catch (error) {
      console.log('⚠️ Could not check embedding protection:', (error as Error).message);
      return {
        protected: true,
        reason: `Check failed: ${(error as Error).message}`
      };
    }
  }

  static async searchAnimeWithCheerio(animeTitle: string, episodeNumber: number = 1): Promise<any> {
    const cacheKey = `search:${animeTitle}:${episodeNumber}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`📦 Cache hit for ${cacheKey}`);
      return JSON.parse(cached);
    }

    try {
      const titleSlug = animeTitle.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .trim();

      const directUrl = `${this.BASE_URL}/${titleSlug}-episode-${episodeNumber}/`;
      console.log(`🔗 Testing direct URL construction first: ${directUrl}`);
      console.log(`📝 Episode number requested: ${episodeNumber}`);

      try {
        const testResponse = await axios.get(directUrl, {
          headers: { 'User-Agent': this.USER_AGENT },
          timeout: 5000,
          validateStatus: (status) => status < 500
        });

        if (testResponse.status === 200) {
          const animeLink = directUrl;
          const animeId = titleSlug;
          console.log(`✅ Direct URL exists: ${animeLink}`);
          const result = { success: true, animeLink, animeId };
          await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
          return result;
        } else {
          console.log(`❌ Direct URL returned status ${testResponse.status}: ${directUrl}`);
        }
      } catch (error) {
        console.log(`❌ Direct URL test failed: ${(error as Error).message}`);
      }

      console.log('🔍 Direct URL failed, searching 9anime with Cheerio...');

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

      const selectors = [
        `a[href*="/${titleSlug}-episode-"]`,
        `a[href*="/${titleSlug}-film-"]`,
        `a[href*="/${titleSlug}-movie-"]`,
        'a[href*="/category/"]',
        'a[href*="/anime/"]',
        'a[href*="/v/"]',
        'a[href*="/watch/"]'
      ];

      let animeLink = '';

      const exactSelectors = [
        `a[href*="/${titleSlug}-episode-"]`,
        `a[href*="/${titleSlug}-film-"]`,
        `a[href*="/${titleSlug}-movie-"]`,
        `a[href*="/anime/${titleSlug}/"]`,
        `a[href*="/${titleSlug}/"]`
      ];

      for (const selector of exactSelectors) {
        const link = $(selector).first();
        if (link.length > 0) {
          animeLink = link.attr('href') || '';
          if (animeLink) {
            if (!animeLink.startsWith('http')) {
              animeLink = this.BASE_URL + animeLink;
            }

            if (animeLink.includes('-episode-') && episodeNumber !== 1) {
              const episodeMatch = animeLink.match(/-episode-(\d+)/);
              if (episodeMatch) {
                const foundEpisode = parseInt(episodeMatch[1]);
                if (foundEpisode !== episodeNumber) {
                  animeLink = animeLink.replace(`-episode-${foundEpisode}`, `-episode-${episodeNumber}`);
                  console.log(`🔄 Constructed correct episode URL: ${animeLink}`);
                }
              }
            } else if (!animeLink.includes('-episode-') && episodeNumber !== 1) {
              if (animeLink.includes('/anime/') || animeLink.includes('/category/')) {
                const slugMatch = animeLink.match(/\/([^\/]+)\/?$/);
                if (slugMatch) {
                  const animeSlug = slugMatch[1];
                  animeLink = `${this.BASE_URL}/${animeSlug}-episode-${episodeNumber}/`;
                  console.log(`🔄 Constructed episode URL from anime page: ${animeLink}`);
                }
              }
            }

            console.log(`✅ Found exact match with selector: ${selector}`);
            break;
          }
        }
      }

      if (!animeLink) {
        const allLinks = $('a[href*="/category/"], a[href*="/anime/"], a[href*="/v/"], a[href*="/watch/"]');
        console.log(`🔍 Searching through ${allLinks.length} links for "${animeTitle}"`);

        for (let i = 0; i < allLinks.length; i++) {
          const link = $(allLinks[i]);
          const linkText = link.text().toLowerCase().trim();
          const href = link.attr('href') || '';

          const titleWords = animeTitle.toLowerCase().split(' ').filter(word => word.length > 2);
          const linkWords = linkText.split(' ').filter(word => word.length > 2);

          const hasSignificantMatch = titleWords.some(titleWord =>
            linkWords.some(linkWord =>
              linkWord.includes(titleWord) || titleWord.includes(linkWord)
            )
          );

          const hasKeyWords = titleWords.some(word =>
            linkText.includes(word) && word.length > 3
          );

          if (hasSignificantMatch || hasKeyWords) {
            animeLink = href;
            if (!animeLink.startsWith('http')) {
              animeLink = this.BASE_URL + animeLink;
            }
            console.log(`✅ Found by text match: "${linkText}" for "${animeTitle}"`);
            console.log(`   Match details: hasSignificantMatch=${hasSignificantMatch}, hasKeyWords=${hasKeyWords}`);
            break;
          }
        }
      }

      if (!animeLink) {
        console.log('🔍 Direct URL failed, trying search-based approach...');

        for (const selector of selectors) {
          const link = $(selector).first();
          if (link.length > 0) {
            animeLink = link.attr('href') || '';
            if (animeLink) {
              if (!animeLink.startsWith('http')) {
                animeLink = this.BASE_URL + animeLink;
              }
              console.log(`⚠️ Using fallback selector: ${selector}`);
              break;
            }
          }
        }
      }

      if (!animeLink) {
        return { success: false, error: 'No anime links found in 9anime search results' };
      }

      let animeId = animeLink.match(/\/([^\/]+)-episode-\d+/)?.[1] ||
                    animeLink.match(/\/([^\/]+)-film-/)?.[1] ||
                    animeLink.match(/\/([^\/]+)-movie-/)?.[1] ||
                    animeLink.match(/category\/([^?\/]+)/)?.[1] ||
                    animeLink.match(/anime\/([^?\/]+)/)?.[1] ||
                    animeLink.match(/v\/([^?\/]+)/)?.[1] ||
                    animeLink.match(/watch\/([^?\/]+)/)?.[1] ||
                    '9anime-' + Date.now();

      if (animeLink.includes('/anime/') && !animeLink.includes('-episode-')) {
        animeLink = `${this.BASE_URL}/${animeId}-episode-1/`;
        console.log('🔄 Converted anime page to episode URL:', animeLink);
      }

      console.log('✅ 9anime search successful:', { animeLink, animeId });
      const result = { success: true, animeLink, animeId };
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);
      return result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  static async extractVideoWithPuppeteer(animeLink: string, animeId: string, episodeNumber: number, options: any): Promise<any> {
    let browser;

    try {
      console.log('🎥 Extracting video with Puppeteer from 9anime...');

      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
      });

      const context = await browser.newContext({
        userAgent: this.USER_AGENT,
        viewport: { width: 1280, height: 720 },
        bypassCSP: true,
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
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

      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (['image', 'stylesheet', 'font'].includes(resourceType)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      try {
        await page.goto(animeLink, { waitUntil: 'domcontentloaded', timeout: options.timeout || 10000 });
        console.log('✅ Page loaded successfully');
      } catch (gotoError) {
        console.log('⚠️ Page goto failed, trying with load event...');
        try {
          await page.goto(animeLink, { waitUntil: 'load', timeout: 5000 });
          console.log('✅ Page loaded with load event');
        } catch (loadError) {
          console.log('⚠️ Page load also failed, continuing anyway...');
        }
      }

      await page.waitForTimeout(2000);

      let streamUrl = '';

      try {
        const videoContainers = [
          '.player-embed iframe',
          '.player iframe',
          '.video-player iframe',
          '#player iframe',
          '.anime-video iframe',
          'iframe[src*="embed"]',
          'iframe[src*="player"]',
          'iframe'
        ];

        for (const selector of videoContainers) {
          try {
            const iframe = await page.$(selector);
            if (iframe) {
              const src = await iframe.getAttribute('src');
              if (src && src.includes('http')) {
                streamUrl = src;
                console.log('✅ Found 9anime iframe:', streamUrl);

                if (src.includes('gogoanime.me.uk')) {
                  console.log('🔍 Found gogoanime URL, extracting actual video source...');
                  try {
                    const gogoResponse = await axios.get(src, {
                      headers: { 'User-Agent': this.USER_AGENT },
                      timeout: 10000
                    });

                    const gogoHtml = gogoResponse.data;

                    const megaplayMatch = gogoHtml.match(/<iframe[^>]+src=["']([^"']*megaplay[^"']*)["'][^>]*>/i);
                    if (megaplayMatch && megaplayMatch[1]) {
                      streamUrl = megaplayMatch[1];
                      console.log('🎯 Found MEGAPLAY source (PREFERRED):', streamUrl);
                    } else {
                      const otherVideoMatch = gogoHtml.match(/<iframe[^>]+src=["']([^"']*(?:stream|video|player)[^"']*)["'][^>]*>/i);
                      if (otherVideoMatch && otherVideoMatch[1]) {
                        streamUrl = otherVideoMatch[1];
                        console.log('✅ Found other video source:', streamUrl);
                      }
                    }
                  } catch (e) {
                    console.log('⚠️ Could not extract video source from gogoanime:', (e as Error).message);
                  }
                }

                if (src.includes('2anime.xyz')) {
                  console.log('🔍 Found 2anime URL, extracting actual video source...');
                  try {
                    const animeResponse = await axios.get(src, {
                      headers: { 'User-Agent': this.USER_AGENT },
                      timeout: 10000
                    });

                    const animeHtml = animeResponse.data;

                    const videoPatterns = [
                      /<iframe[^>]+data-src=["']([^"']+)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*megaplay[^"']*)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*stream[^"']*)["'][^>]*>/i,
                      /<iframe[^>]+src=["']([^"']*2m\.2anime[^"']*)["'][^>]*>/i,
                      /<video[^>]+src=["']([^"']*)["'][^>]*>/i,
                      /"file":"([^"]+)"/i,
                      /"url":"([^"]+)"/i
                    ];

                    for (const pattern of videoPatterns) {
                      const match = animeHtml.match(pattern);
                      if (match && match[1] && match[1].includes('http')) {
                        streamUrl = match[1];
                        console.log('✅ Found actual video source from 2anime:', streamUrl);
                        break;
                      }
                    }
                  } catch (e) {
                    console.log('⚠️ Could not extract video source from 2anime:', (e as Error).message);
                  }
                }

                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      } catch (e) {
        console.log('No 9anime iframe found, trying other methods...');
      }

      if (!streamUrl) {
        try {
          await page.waitForSelector('video', { timeout: 15000 });
          const videoSrc = await page.$eval('video', (el) => el.src);
          if (videoSrc) {
            streamUrl = videoSrc;
            console.log('✅ Found video source:', streamUrl);
          }
        } catch (e) {
          console.log('No video element found...');
        }
      }

      if (!streamUrl) {
        const pageContent = await page.content();
        console.log('🔍 Searching 9anime page content for video URLs...');

        const patterns = [
          /<iframe[^>]+src=["']([^"']*embed[^"']*)["'][^>]*>/gi,
          /<iframe[^>]+src=["']([^"']*player[^"']*)["'][^>]*>/gi,
          /iframe\.src\s*=\s*["']([^"']+)["']/gi,
          /data-src=["']([^"']*embed[^"']*)["']/gi,
          /src\s*:\s*["']([^"']*embed[^"']*)["']/gi,
          /"url"\s*:\s*"([^"]*embed[^"]*)"/gi,
          /"src"\s*:\s*"([^"]*embed[^"]*)"/gi
        ];

        for (const pattern of patterns) {
          const matches = pageContent.match(pattern);
          if (matches && matches.length > 0) {
            console.log(`Found ${matches.length} matches with 9anime pattern`);
            for (const match of matches) {
              const url = match.replace(/<iframe[^>]+src=["']/, '').replace(/["'][^>]*>/, '')
                              .replace(/iframe\.src\s*=\s*["']/, '').replace(/["']/, '')
                              .replace(/data-src=["']/, '').replace(/["']/, '')
                              .replace(/src\s*:\s*["']/, '').replace(/["']/, '')
                              .replace(/"url"\s*:\s*"/, '').replace(/"/, '')
                              .replace(/"src"\s*:\s*"/, '').replace(/"/, '');

              if (url && url.includes('http') && (url.includes('embed') || url.includes('player'))) {
                streamUrl = url;
                console.log('✅ Found 9anime video URL in page content:', streamUrl);
                break;
              }
            }
            if (streamUrl) break;
          }
        }
      }

      if (!streamUrl) {
        streamUrl = animeLink;
        console.log('⚠️ Using anime page URL as iframe source:', streamUrl);
      }

      console.log('🎉 Final 9anime URL:', streamUrl);

      await browser.close();

      return {
        success: true,
        streamUrl,
        episodeData: {
          animeId,
          extractedAt: new Date()
        }
      };
    } catch (error) {
      if (browser) await browser.close();
      return { success: false, error: (error as Error).message };
    }
  }

  static async saveEpisodeToDatabase(episodeData: any): Promise<any> {
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
    } catch (error) {
      console.error('❌ Save Error:', (error as Error).message);
      return { success: false, error: (error as Error).message };
    }
  }

  static async scrapeAndSaveEpisode(animeTitle: string, animeId: string, episodeNumber: number = 1, options: any = {}): Promise<any> {
    try {
      const scrapeResult = await this.scrapeAnimeEpisode(animeTitle, episodeNumber, options);

      if (scrapeResult.success && scrapeResult.streamUrl) {
        const episodeData = {
          animeId: animeId,
          episodeNumber: episodeNumber,
          title: `${animeTitle} - Episode ${episodeNumber}`,
          videoUrl: scrapeResult.streamUrl,
          thumbnailUrl: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bd${animeId}-5n5yZ6K1J1oH.jpg`,
          duration: 1440,
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
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }
}

// Database Functions
async function getEpisodes(animeId: string): Promise<any[]> {
  const { data: episodes, error } = await supabase
    .from('episodes')
    .select('episode_number, title, video_url, created_at')
    .eq('anime_id', animeId)
    .order('episode_number');
  
  if (error) throw new Error(error.message);
  return episodes || [];
}

async function addScrapedEpisode(animeId: string, episodeData: any): Promise<any> {
  const { data: existingEpisode, error: checkError } = await supabase
    .from('episodes')
    .select('id')
    .eq('anime_id', animeId)
    .eq('episode_number', episodeData.number)
    .maybeSingle();

  if (checkError) throw new Error(checkError.message);

  let data, error;
  if (existingEpisode) {
    console.log(`📝 Updating existing episode ${episodeData.number} for anime ${animeId}`);
    const updateResult = await supabase
      .from('episodes')
      .update({
        title: episodeData.title,
        video_url: episodeData.streamUrl,
        description: `Scraped from 9anime.org.lv - ${episodeData.embeddingProtected ? 'May have embedding protection' : 'Embedding friendly'}`
      })
      .eq('anime_id', animeId)
      .eq('episode_number', episodeData.number)
      .select()
      .single();
    
    data = updateResult.data;
    error = updateResult.error;
  } else {
    console.log(`➕ Inserting new episode ${episodeData.number} for anime ${animeId}`);
    const insertResult = await supabase
      .from('episodes')
      .insert({
        anime_id: animeId,
        episode_number: episodeData.number,
        title: episodeData.title,
        video_url: episodeData.streamUrl,
        duration: null,
        thumbnail_url: null,
        description: `Scraped from 9anime.org.lv - ${episodeData.embeddingProtected ? 'May have embedding protection' : 'Embedding friendly'}`,
        is_premium: false
      })
      .select()
      .single();
    
    data = insertResult.data;
    error = insertResult.error;
  }

  if (error) throw new Error(`Database error: ${error.message}`);
  return data;
}

async function startScrapingProgress(animeId: string, animeTitle: string, totalEpisodes: number, chunkSize: number): Promise<any> {
  const totalChunks = Math.ceil(totalEpisodes / chunkSize);
  const { data: progressData, error: progressError } = await supabase
    .from('scraping_progress')
    .upsert({
      anime_id: animeId,
      anime_title: animeTitle,
      total_episodes: totalEpisodes,
      completed_episodes: 0,
      failed_episodes: 0,
      current_chunk: 1,
      total_chunks: totalChunks,
      chunk_size: chunkSize,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'anime_id'
    })
    .select()
    .single();

  if (progressError) throw new Error(`Database error: ${progressError.message}`);

  const episodeLogs: any[] = [];
  for (let episode = 1; episode <= totalEpisodes; episode++) {
    const chunkNumber = Math.ceil(episode / chunkSize);
    episodeLogs.push({
      scraping_progress_id: progressData.id,
      episode_number: episode,
      chunk_number: chunkNumber,
      status: 'pending',
      created_at: new Date().toISOString()
    });
  }

  const { error: logError } = await supabase
    .from('episode_scraping_log')
    .upsert(episodeLogs, {
      onConflict: 'scraping_progress_id,episode_number'
    });

  if (logError) console.warn('Warning: Could not create episode logs:', logError.message);

  return progressData;
}

async function getScrapingProgress(animeId: string): Promise<any> {
  const { data: progress, error } = await supabase
    .from('scraping_progress')
    .select(`
      *,
      episode_scraping_log (
        episode_number,
        status,
        error_message,
        scraped_at
      )
    `)
    .eq('anime_id', animeId)
    .single();

  if (error) throw new Error('Scraping progress not found');
  return progress;
}

async function updateEpisodeLog(progressId: string, episodeNumber: number, status: string, videoUrl?: string, errorMessage?: string): Promise<void> {
  const updateData: any = {
    status,
    scraped_at: status === 'success' ? new Date().toISOString() : null
  };
  if (videoUrl) updateData.video_url = videoUrl;
  if (errorMessage) updateData.error_message = errorMessage;

  await supabase
    .from('episode_scraping_log')
    .update(updateData)
    .eq('scraping_progress_id', progressId)
    .eq('episode_number', episodeNumber);
}

async function getEpisodesToScrape(progressId: string, chunkNumber: number): Promise<any[]> {
  const { data, error } = await supabase
    .from('episode_scraping_log')
    .select('episode_number')
    .eq('scraping_progress_id', progressId)
    .eq('chunk_number', chunkNumber)
    .in('status', ['pending', 'failed']);

  if (error) throw new Error(`Database error: ${error.message}`);
  return data;
}

async function updateScrapingProgress(animeId: string, successCount: number, errorCount: number, chunkNumber: number): Promise<void> {
  const { error } = await supabase
    .from('scraping_progress')
    .update({
      completed_episodes: supabase.raw('completed_episodes + ?', [successCount]),
      failed_episodes: supabase.raw('failed_episodes + ?', [errorCount]),
      current_chunk: chunkNumber + 1,
      updated_at: new Date().toISOString()
    })
    .eq('anime_id', animeId);

  if (error) console.warn('Warning: Could not update progress:', error.message);
}

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: '9anime Scraper API'
  });
});

app.post('/api/scrape-episode', async (req, res) => {
  try {
    const { animeTitle, animeId, episodeNumber = 1, options = {} } = req.body;

    if (!animeTitle || !animeId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: animeTitle and animeId'
      });
    }

    console.log(`🎬 API: Scraping episode ${episodeNumber} for "${animeTitle}" (ID: ${animeId})`);

    const result = await NineAnimeScraperService.scrapeAndSaveEpisode(
      animeTitle,
      animeId,
      episodeNumber,
      { timeout: 45000, retries: 3, ...options }
    );

    if (result.success) {
      res.json({
        success: true,
        streamUrl: result.streamUrl,
        episodeData: result.episodeData,
        message: `Episode ${episodeNumber} scraped and saved successfully!`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Scraping failed'
      });
    }
  } catch (error) {
    console.error('❌ API Error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message || 'Internal server error'
    });
  }
});

app.post('/api/test-scraper', async (req, res) => {
  try {
    console.log('🧪 API: Testing scraper...');

    const { animeTitle = 'One Piece', episodeNumber = 1 } = req.body;
    console.log(`🎬 Testing with anime: "${animeTitle}", Episode ${episodeNumber}`);

    const result = await NineAnimeScraperService.scrapeAnimeEpisode(animeTitle, episodeNumber, {
      timeout: 30000,
      retries: 2
    });

    res.json({
      success: result.success,
      message: result.success ? 'Scraper test successful!' : 'Scraper test failed',
      details: result
    });
  } catch (error) {
    console.error('❌ Test Error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message || 'Test failed'
    });
  }
});

app.post('/api/scrape-all-episodes', async (req, res) => {
  try {
    console.log('🎬 API: Scraping all episodes...');

    const { animeTitle, animeId, maxEpisodes = 20 } = req.body;

    if (!animeTitle) {
      return res.status(400).json({
        success: false,
        error: 'Anime title is required'
      });
    }

    if (!animeId) {
      return res.status(400).json({
        success: false,
        error: 'Anime ID is required'
      });
    }

    console.log(`🎬 Scraping all episodes for: "${animeTitle}" (max ${maxEpisodes})`);

    const result = await NineAnimeScraperService.scrapeAllEpisodes(animeTitle, {
      animeId,
      maxEpisodes,
      timeout: 60000,
      retries: 2
    });

    res.json({
      success: result.success,
      message: result.success ? 'All episodes scraped successfully!' : 'Failed to scrape episodes',
      data: result
    });
  } catch (error) {
    console.error('❌ Scrape all episodes error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.post('/api/batch-scrape-episodes', async (req, res) => {
  try {
    console.log('🎬 API: Batch scraping episodes...');

    const { animeTitle, animeId, episodeNumbers, options = {} } = req.body;

    if (!animeTitle || !animeId || !episodeNumbers) {
      return res.status(400).json({
        success: false,
        error: 'Anime title, ID, and episode numbers are required'
      });
    }

    console.log(`🎬 Batch scraping ${episodeNumbers.length} episodes for: "${animeTitle}"`);

    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const episodeNumber of episodeNumbers) {
      try {
        console.log(`📺 Scraping episode ${episodeNumber}...`);

        const scrapeResult = await NineAnimeScraperService.scrapeAnimeEpisode(
          animeTitle,
          episodeNumber,
          { timeout: options.timeout || 30000, retries: options.retries || 2 }
        );

        if (scrapeResult.success && scrapeResult.streamUrl) {
          successCount++;
          results.push({
            episode: episodeNumber,
            status: 'success',
            url: scrapeResult.streamUrl,
            title: scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
            embeddingProtected: scrapeResult.embeddingProtected || false,
            embeddingReason: scrapeResult.embeddingReason || null,
            scrapedAt: new Date().toISOString()
          });
        } else {
          throw new Error(scrapeResult.error || 'Scraping failed');
        }
      } catch (error) {
        console.error(`❌ Episode ${episodeNumber} failed:`, (error as Error).message);
        errorCount++;
        results.push({
          episode: episodeNumber,
          status: 'failed',
          error: (error as Error).message
        });
      }

      if (episodeNumber < episodeNumbers[episodeNumbers.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, options.delayBetweenEpisodes || 2000));
      }
    }

    const successRate = episodeNumbers.length > 0 ? (successCount / episodeNumbers.length) * 100 : 0;

    console.log(`✅ Batch scraping completed: ${successCount}/${episodeNumbers.length} episodes successful`);

    res.json({
      success: true,
      message: `Batch scraping completed: ${successCount}/${episodeNumbers.length} episodes successful`,
      results,
      summary: {
        totalEpisodes: episodeNumbers.length,
        successCount,
        errorCount,
        successRate: Math.round(successRate * 10) / 10
      }
    });
  } catch (error) {
    console.error('❌ Batch scrape error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.get('/api/anime/:animeId/episodes', async (req, res) => {
  try {
    const { animeId } = req.params;
    console.log('🔍 API: Getting episodes for anime ID:', animeId);

    const episodes = await getEpisodes(animeId);

    console.log('✅ Found episodes:', episodes.length);
    res.json({
      success: true,
      episodes
    });
  } catch (error) {
    console.error('❌ Error getting episodes:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.post('/api/add-scraped-episode', async (req, res) => {
  try {
    console.log('💾 API: Adding scraped episode to database...');

    const { animeId, episodeData } = req.body;

    if (!animeId || !episodeData) {
      return res.status(400).json({
        success: false,
        error: 'Anime ID and episode data are required'
      });
    }

    const data = await addScrapedEpisode(animeId, episodeData);

    console.log(`✅ Episode ${episodeData.number} ${data.id ? 'updated' : 'added'} to database`);

    res.json({
      success: true,
      message: `Episode ${episodeData.number} ${data.id ? 'updated' : 'added'} successfully!`,
      episode: data
    });
  } catch (error) {
    console.error('❌ Add episode error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.post('/api/start-large-scrape', async (req, res) => {
  try {
    console.log('🎬 API: Starting large anime scraping job...');

    const { animeId, animeTitle, totalEpisodes, chunkSize = 50 } = req.body;

    if (!animeId || !animeTitle || !totalEpisodes) {
      return res.status(400).json({
        success: false,
        error: 'Anime ID, title, and total episodes are required'
      });
    }

    const progressData = await startScrapingProgress(animeId, animeTitle, totalEpisodes, chunkSize);

    console.log(`✅ Large scraping job started: ${animeTitle} (${totalEpisodes} episodes, ${progressData.total_chunks} chunks)`);

    res.json({
      success: true,
      message: `Large scraping job started for ${animeTitle}`,
      jobId: progressData.id,
      totalEpisodes,
      totalChunks: progressData.total_chunks,
      chunkSize
    });
  } catch (error) {
    console.error('❌ Start large scrape error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.get('/api/scraping-progress/:animeId', async (req, res) => {
  try {
    const { animeId } = req.params;

    const progress = await getScrapingProgress(animeId);

    const progressPercentage = progress.total_episodes > 0 
      ? Math.round((progress.completed_episodes / progress.total_episodes) * 100)
      : 0;

    const startedAt = new Date(progress.started_at);
    const now = new Date();
    const elapsedMs = now.getTime() - startedAt.getTime();
    const episodesPerMs = progress.completed_episodes / elapsedMs;
    const remainingEpisodes = progress.total_episodes - progress.completed_episodes;
    const estimatedMsRemaining = episodesPerMs > 0 ? remainingEpisodes / episodesPerMs : 0;

    const estimatedTimeRemaining = estimatedMsRemaining > 0 
      ? formatDuration(estimatedMsRemaining)
      : 'Calculating...';

    res.json({
      success: true,
      progress: {
        ...progress,
        progressPercentage,
        estimatedTimeRemaining,
        episodesPerMs: episodesPerMs * 1000
      }
    });
  } catch (error) {
    console.error('❌ Get progress error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.post('/api/scrape-chunk', async (req, res) => {
  try {
    console.log('🎬 API: Scraping chunk...');

    const { animeId, animeTitle, chunkNumber, chunkSize = 50, progressId } = req.body;

    if (!animeId || !animeTitle || chunkNumber === undefined || !progressId) {
      return res.status(400).json({
        success: false,
        error: 'Anime ID, title, chunk number, and progress ID are required'
      });
    }

    const episodesToScrape = await getEpisodesToScrape(progressId, chunkNumber);

    const results: any[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const episodeLog of episodesToScrape) {
      const episodeNumber = episodeLog.episode_number;

      try {
        await updateEpisodeLog(progressId, episodeNumber, 'scraping');

        const scrapeResult = await NineAnimeScraperService.scrapeAnimeEpisode(
          animeTitle,
          episodeNumber,
          { timeout: 30000, retries: 2 }
        );

        if (scrapeResult.success && scrapeResult.streamUrl) {
          await supabase
            .from('episodes')
            .upsert({
              anime_id: animeId,
              episode_number: episodeNumber,
              title: scrapeResult.episodeData?.title || `Episode ${episodeNumber}`,
              video_url: scrapeResult.streamUrl,
              description: `Scraped from 9anime - Chunk ${chunkNumber}`,
              is_premium: false
            }, {
              onConflict: 'anime_id,episode_number'
            });

          await updateEpisodeLog(progressId, episodeNumber, 'success', scrapeResult.streamUrl);

          successCount++;
          results.push({ episode: episodeNumber, status: 'success', url: scrapeResult.streamUrl });
        } else {
          throw new Error(scrapeResult.error || 'Scraping failed');
        }
      } catch (error) {
        console.error(`❌ Episode ${episodeNumber} failed:`, (error as Error).message);
        await updateEpisodeLog(progressId, episodeNumber, 'failed', undefined, (error as Error).message);
        errorCount++;
        results.push({ episode: episodeNumber, status: 'failed', error: (error as Error).message });
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    await updateScrapingProgress(animeId, successCount, errorCount, chunkNumber);

    console.log(`✅ Chunk ${chunkNumber} completed: ${successCount} success, ${errorCount} failed`);

    res.json({
      success: true,
      message: `Chunk ${chunkNumber} completed`,
      results,
      summary: {
        totalEpisodes: episodesToScrape.length,
        successCount,
        errorCount,
        successRate: episodesToScrape.length > 0 ? (successCount / episodesToScrape.length) * 100 : 0
      }
    });
  } catch (error) {
    console.error('❌ Scrape chunk error:', (error as Error).message);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 9anime Scraper API running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🎬 Scraper endpoints:`);
  console.log(`   POST /api/scrape-episode`);
  console.log(`   POST /api/test-scraper`);
  console.log(`   POST /api/scrape-all-episodes`);
  console.log(`   POST /api/batch-scrape-episodes`);
  console.log(`   POST /api/start-large-scrape`);
  console.log(`   POST /api/scrape-chunk`);
  console.log(`   GET  /api/scraping-progress/:animeId`);
});

/*
 * Unit Tests (Place in tests/scraper.test.ts for actual use)
 * Install vitest: npm install vitest --save-dev
 * Create tests/scraper.test.ts:
import { describe, it, expect } from 'vitest';
import { NineAnimeScraperService } from './index';

describe('NineAnimeScraperService', () => {
  it('constructs valid episode URL', () => {
    const title = 'One Piece';
    const episode = 1;
    const expected = 'https://9anime.org.lv/one-piece-episode-1/';
    const titleSlug = title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .trim();
    const constructedUrl = `${NineAnimeScraperService.BASE_URL}/${titleSlug}-episode-${episode}/`;
    expect(constructedUrl).toBe(expected);
  });

  it('handles invalid anime title gracefully', async () => {
    const result = await NineAnimeScraperService.scrapeAnimeEpisode('', 1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No anime links found');
  });
});
 * Update package.json: "test": "vitest run"
 * Run: npm test
 */