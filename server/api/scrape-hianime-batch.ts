import { NextRequest, NextResponse } from 'next/server';
import { HybridHiAnimeScraperService } from '../../src/services/scrapers/hybrid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { animeTitle, animeId, episodeNumbers, options } = body;

    if (!animeTitle || !animeId || !episodeNumbers || !Array.isArray(episodeNumbers)) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: animeTitle, animeId, and episodeNumbers array' },
        { status: 400 }
      );
    }

    console.log(`🎬 API: Batch scraping ${episodeNumbers.length} episodes for "${animeTitle}"`);

    const result = await HybridHiAnimeScraperService.batchScrapeEpisodes(
      animeTitle,
      animeId,
      episodeNumbers,
      options || {}
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        results: [],
        summary: {
          totalEpisodes: 0,
          successCount: 0,
          errorCount: 0,
          successRate: 0
        },
        error: error instanceof Error ? error.message : 'Unknown server error' 
      },
      { status: 500 }
    );
  }
}
