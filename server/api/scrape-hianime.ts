import { NextRequest, NextResponse } from 'next/server';
import { HybridHiAnimeScraperService } from '../../src/services/scrapers/hybrid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { animeTitle, animeId, episodeNumber, options } = body;

    if (!animeTitle || !animeId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: animeTitle and animeId' },
        { status: 400 }
      );
    }

    console.log(`🎬 API: Scraping episode ${episodeNumber || 1} for "${animeTitle}"`);

    const result = await HybridHiAnimeScraperService.scrapeAndSaveEpisode(
      animeTitle,
      animeId,
      episodeNumber || 1,
      options || {}
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown server error' 
      },
      { status: 500 }
    );
  }
}
