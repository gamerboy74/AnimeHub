import { supabase } from '../../lib/database/supabase'
import type { Tables } from '../../lib/database/supabase'

type Anime = Tables<'anime'>

// External API Types
interface JikanAnime {
  mal_id: number
  title: string
  title_english?: string
  title_japanese?: string
  title_synonyms?: string[]
  images?: {
    jpg?: {
      image_url?: string
      small_image_url?: string
      large_image_url?: string
    }
    webp?: {
      image_url?: string
      small_image_url?: string
      large_image_url?: string
    }
  }
  trailer?: {
    youtube_id?: string
    url?: string
    embed_url?: string
  }
  type?: string
  source?: string
  episodes?: number
  status?: string
  airing?: boolean
  aired?: {
    from?: string
    to?: string
    prop?: {
      from?: { year?: number; month?: number; day?: number }
      to?: { year?: number; month?: number; day?: number }
    }
  }
  duration?: string
  rating?: string
  score?: number
  scored_by?: number
  rank?: number
  popularity?: number
  members?: number
  favorites?: number
  synopsis?: string
  background?: string
  season?: string
  year?: number
  broadcast?: {
    day?: string
    time?: string
    timezone?: string
    string?: string
  }
  producers?: Array<{ mal_id: number; type: string; name: string; url: string }>
  licensors?: Array<{ mal_id: number; type: string; name: string; url: string }>
  studios?: Array<{ mal_id: number; type: string; name: string; url: string }>
  genres?: Array<{ mal_id: number; type: string; name: string; url: string }>
  explicit_genres?: Array<{ mal_id: number; type: string; name: string; url: string }>
  themes?: Array<{ mal_id: number; type: string; name: string; url: string }>
  demographics?: Array<{ mal_id: number; type: string; name: string; url: string }>
}

interface AniListAnime {
  id: number
  title: {
    romaji?: string
    english?: string
    native?: string
    userPreferred?: string
  }
  description?: string
  format?: string
  status?: string
  startDate?: {
    year?: number
    month?: number
    day?: number
  }
  endDate?: {
    year?: number
    month?: number
    day?: number
  }
  season?: string
  seasonYear?: number
  seasonInt?: number
  episodes?: number
  duration?: number
  source?: string
  trailer?: {
    id?: string
    site?: string
    thumbnail?: string
  }
  coverImage?: {
    extraLarge?: string
    large?: string
    medium?: string
    color?: string
  }
  bannerImage?: string
  genres?: string[]
  synonyms?: string[]
  averageScore?: number
  meanScore?: number
  popularity?: number
  trending?: number
  favourites?: number
  studios?: {
    nodes: Array<{
      id: number
      name: string
    }>
  }
  externalLinks?: Array<{
    id: number
    url: string
    site: string
    type?: string
    language?: string
  }>
}

interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  errors: string[]
  duplicates: string[]
}

export class AnimeImporterService {
  private static readonly JIKAN_BASE_URL = 'https://api.jikan.moe/v4'
  private static readonly ANILIST_BASE_URL = 'https://graphql.anilist.co'
  
  // Search anime from Jikan API
  static async searchJikanAnime(query: string, limit: number = 20): Promise<JikanAnime[]> {
    try {
      // Jikan API has a maximum limit of 25 for search requests
      const safeLimit = Math.min(limit, 25)
      const response = await fetch(`${this.JIKAN_BASE_URL}/anime?q=${encodeURIComponent(query)}&limit=${safeLimit}`)
      
      if (!response.ok) {
        if (response.status === 400) {
          throw new Error(`Jikan API error: Invalid request parameters. Please check your search query and try again.`)
        }
        throw new Error(`Jikan API error: ${response.status}`)
      }
      
      const data = await response.json()
      return data.data || []
    } catch (error) {
      console.error('Error searching Jikan anime:', error)
      throw new Error(`Failed to search anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Search anime from AniList API
  static async searchAniListAnime(query: string, limit: number = 20): Promise<AniListAnime[]> {
    try {
      const graphqlQuery = `
        query ($search: String, $perPage: Int) {
          Page(perPage: $perPage) {
            media(search: $search, type: ANIME) {
              id
              idMal
              title {
                romaji
                english
                native
                userPreferred
              }
              description
              format
              status
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
              season
              seasonYear
              seasonInt
              episodes
              duration
              source
              trailer {
                id
                site
                thumbnail
              }
              coverImage {
                extraLarge
                large
                medium
                color
              }
              bannerImage
              trailer {
                id
                site
                thumbnail
              }
              genres
              synonyms
              averageScore
              meanScore
              popularity
              trending
              favourites
              studios {
                nodes {
                  id
                  name
                }
              }
              relations {
                edges {
                  id
                  relationType
                  node {
                    id
                    idMal
                    title {
                      romaji
                      english
                      native
                    }
                    format
                    status
                    episodes
                    startDate {
                      year
                    }
                    coverImage {
                      large
                      medium
                    }
                  }
                }
              }
              characters(sort: [ROLE, RELEVANCE], perPage: 20) {
                edges {
                  id
                  role
                  voiceActors(language: JAPANESE) {
                    id
                    name {
                      full
                      native
                    }
                  }
                  voiceActorRoles {
                    voiceActor {
                      id
                      name {
                        full
                        native
                      }
                      language
                    }
                  }
                  node {
                    id
                    name {
                      full
                      native
                      alternative
                    }
                    image {
                      large
                      medium
                    }
                    description
                  }
                }
              }
              externalLinks {
                id
                url
                site
                type
                language
              }
            }
          }
        }
      `

      const response = await fetch(this.ANILIST_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: {
            search: query,
            perPage: limit
          }
        })
      })

      if (!response.ok) {
        throw new Error(`AniList API error: ${response.status}`)
      }

      const data = await response.json()
      return data.data?.Page?.media || []
    } catch (error) {
      console.error('Error searching AniList anime:', error)
      throw new Error(`Failed to search anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Convert Jikan anime data to our database format
  static mapJikanToDatabase(jikanAnime: JikanAnime): Partial<Anime> {
    const duration = jikanAnime.duration ? this.parseDuration(jikanAnime.duration) : null
    
    // Debug trailer data
    console.log('🎬 Jikan trailer debug:', {
      title: jikanAnime.title,
      trailer: jikanAnime.trailer,
      hasEmbedUrl: !!jikanAnime.trailer?.embed_url,
      hasYoutubeId: !!jikanAnime.trailer?.youtube_id,
      embedUrl: jikanAnime.trailer?.embed_url,
      youtubeId: jikanAnime.trailer?.youtube_id
    })
    
    // Fallback image for poster if not available
    const fallbackPoster = '/assets/images/default-anime-poster.jpg'
    const posterUrl = jikanAnime.images?.jpg?.large_image_url || jikanAnime.images?.webp?.large_image_url || fallbackPoster
    
    return {
      title: jikanAnime.title_english || jikanAnime.title,
      title_english: jikanAnime.title_english || null,
      title_romaji: jikanAnime.title,
      title_japanese: jikanAnime.title_japanese || null,
      title_synonyms: jikanAnime.title_synonyms || [],
      mal_id: jikanAnime.mal_id || null,
      description: jikanAnime.synopsis || null,
      poster_url: posterUrl,
      banner_url: null, // Jikan doesn't provide banner images
      trailer_url: jikanAnime.trailer?.embed_url || (jikanAnime.trailer?.youtube_id ? `https://www.youtube.com/embed/${jikanAnime.trailer.youtube_id}` : null),
      rating: jikanAnime.score || null,
      year: jikanAnime.year || jikanAnime.aired?.prop?.from?.year || null,
      status: this.mapJikanStatus(jikanAnime.status),
      type: this.mapJikanType(jikanAnime.type),
      genres: jikanAnime.genres?.map(g => g.name) || [],
      studios: jikanAnime.studios?.map(s => s.name) || [],
      total_episodes: jikanAnime.episodes || null,
      duration: duration,
      age_rating: this.mapJikanRating(jikanAnime.rating),
      // Stash full studio objects for importJikanStudios (not persisted to DB)
      __jikan_studios: jikanAnime.studios || [],
    } as any
  }

  // Convert AniList anime data to our database format
  static mapAniListToDatabase(aniListAnime: AniListAnime): Partial<Anime> {
    const title = aniListAnime.title?.english || aniListAnime.title?.romaji || aniListAnime.title?.native || ''
    const year = aniListAnime.startDate?.year || aniListAnime.seasonYear || null
    
    // Debug trailer data
    console.log('🎬 AniList trailer debug:', {
      title: title,
      trailer: aniListAnime.trailer,
      hasTrailer: !!aniListAnime.trailer?.id,
      trailerId: aniListAnime.trailer?.id,
      trailerSite: aniListAnime.trailer?.site
    })
    
    const trailerUrl = aniListAnime.trailer?.id ? this.formatTrailerUrl(aniListAnime.trailer.id, aniListAnime.trailer.site) : null
    
    // Fallback image for poster if not available
    const fallbackPoster = '/assets/images/default-anime-poster.jpg'
    const posterUrl = aniListAnime.coverImage?.large || aniListAnime.coverImage?.medium || fallbackPoster
    
    return {
      title: title,
      title_english: aniListAnime.title?.english || null,
      title_romaji: aniListAnime.title?.romaji || null,
      title_japanese: aniListAnime.title?.native || null,
      title_synonyms: aniListAnime.synonyms || [],
      mal_id: (aniListAnime as any).idMal || null,
      description: aniListAnime.description ? this.stripHtmlTags(aniListAnime.description) : null,
      poster_url: posterUrl,
      banner_url: aniListAnime.bannerImage || null,
      trailer_url: trailerUrl,
      rating: aniListAnime.averageScore ? aniListAnime.averageScore / 10 : null, // AniList uses 0-100 scale
      year: year,
      status: this.mapAniListStatus(aniListAnime.status),
      type: this.mapAniListType(aniListAnime.format),
      genres: aniListAnime.genres || [],
      studios: aniListAnime.studios?.nodes?.map(s => s.name) || [],
      total_episodes: aniListAnime.episodes || null,
      duration: aniListAnime.duration || null,
      age_rating: null // AniList doesn't provide age rating in this query
    }
  }

  // Import anime from external API
  static async importAnime(animeData: Partial<Anime>, options?: { skipAutoScrape?: boolean }): Promise<Anime | null> {
    try {
      // Check for duplicates by title (use maybeSingle to handle no results gracefully)
      const { data: existingAnime, error: duplicateError } = await supabase
        .from('anime')
        .select('id, title')
        .ilike('title', animeData.title || '')
        .maybeSingle()

      // If there's an error checking for duplicates, log it but continue
      if (duplicateError) {
        console.warn('Error checking for duplicates:', duplicateError.message)
      }

      if (existingAnime) {
        console.log(`Anime "${animeData.title}" already exists, skipping import`)
        return existingAnime as Anime
      }

      // Insert new anime (strip internal fields before sending to DB)
      const { __jikan_studios, ...dbData } = animeData as any
      const { data, error } = await supabase
        .from('anime')
        .insert({
          ...dbData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) {
        console.error('Error importing anime:', error)
        throw new Error(`Failed to import anime: ${error.message}`)
      }

      console.log(`Successfully imported anime: ${animeData.title}`)

      // Auto-create episode stubs from Jikan if mal_id is available
      if (data && (animeData as any).mal_id) {
        try {
          const episodeResult = await this.autoCreateEpisodeStubs(data.id, (animeData as any).mal_id, animeData.title || '')
          console.log(`📺 Episode stubs: ${episodeResult.created} created, ${episodeResult.skipped} skipped`)

          // If Jikan returned zero episodes, we used to delete the anime here.
          // However, we should keep it because it might just not be aired yet or Jikan is missing data.
          if (episodeResult.total === 0) {
            console.log(`⚠️ No episode stubs found for "${animeData.title}" on Jikan, but keeping the anime record.`)
          }

          // Auto-scrape stream URLs in the background (unless caller will do it)
          if (!(options as any)?.skipAutoScrape) {
            this.triggerBatchScrape(data.id, animeData.title || '', episodeResult.total)
          }
        } catch (epErr) {
          console.warn('⚠️ Auto episode stub creation failed (non-fatal):', epErr)
        }

        // Import characters, relations, and studios from Jikan
        try {
          const [charResult, relResult, studioResult] = await Promise.all([
            this.fetchAndImportJikanCharacters(data.id, (animeData as any).mal_id),
            this.fetchAndImportJikanRelations(data.id, (animeData as any).mal_id, animeData.title || ''),
            this.importJikanStudios(data.id, (animeData as any).__jikan_studios || []),
          ])
          console.log(`👥 Jikan characters: ${charResult.success} imported, ${charResult.errors} errors`)
          console.log(`🔗 Jikan relations: ${relResult.success} imported, ${relResult.errors} errors`)
          console.log(`🏢 Jikan studios: ${studioResult.success} imported, ${studioResult.errors} errors`)
        } catch (importErr) {
          console.warn('⚠️ Jikan characters/relations/studios import failed (non-fatal):', importErr)
        }
      }

      return data
    } catch (error) {
      console.error('Import anime error:', error)
      throw error
    }
  }

  /**
   * Fetch episode metadata from Jikan API and create episode stubs in the DB.
   * Episodes are created with title + air_date but NO video_url — that comes from scraping.
   */
  static async autoCreateEpisodeStubs(
    animeId: string,
    malId: number,
    animeTitle: string,
  ): Promise<{ created: number; skipped: number; total: number }> {
    let created = 0
    let skipped = 0
    let total = 0

    // ── Step 1: Figure out how many episodes we need ─────────────
    let expectedTotal = 0

    // Check DB first
    const { data: animeRow } = await supabase
      .from('anime')
      .select('total_episodes')
      .eq('id', animeId)
      .single()
    expectedTotal = animeRow?.total_episodes || 0

    // If DB doesn't know, ask Jikan
    if (expectedTotal === 0) {
      try {
        const infoResp = await fetch(`${this.JIKAN_BASE_URL}/anime/${malId}`)
        if (infoResp.ok) {
          const infoJson = await infoResp.json()
          expectedTotal = infoJson.data?.episodes || 0
          if (expectedTotal > 0) {
            await supabase.from('anime').update({ total_episodes: expectedTotal }).eq('id', animeId)
            console.log(`📺 ${animeTitle}: set total_episodes=${expectedTotal} from Jikan`)
          }
        }
      } catch { /* ignore */ }
    }

    if (expectedTotal <= 0) {
      console.warn(`📺 ${animeTitle}: total_episodes is unknown, cannot create stubs`)
      return { created: 0, skipped: 0, total: 0 }
    }

    // ── Step 2: Find missing episode numbers ─────────────────────
    // Fetch ALL existing episode numbers (handle Supabase 1000-row limit)
    const existingSet = new Set<number>()
    let from = 0
    const PAGE_SIZE = 1000
    while (true) {
      const { data: batch } = await supabase
        .from('episodes')
        .select('episode_number')
        .eq('anime_id', animeId)
        .range(from, from + PAGE_SIZE - 1)
      if (!batch || batch.length === 0) break
      batch.forEach(e => existingSet.add(e.episode_number))
      if (batch.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const missingNums: number[] = []
    for (let n = 1; n <= expectedTotal; n++) {
      if (!existingSet.has(n)) missingNums.push(n)
    }

    if (missingNums.length === 0) {
      console.log(`📺 ${animeTitle}: all ${expectedTotal} episodes already exist`)
      return { created: 0, skipped: expectedTotal, total: expectedTotal }
    }

    // ── Step 3: Create synthetic stubs for ALL missing episodes ──
    console.log(`📺 ${animeTitle}: creating ${missingNums.length} episode stubs (${existingSet.size} already exist, ${expectedTotal} total)`)

    for (let i = 0; i < missingNums.length; i += 100) {
      const batch = missingNums.slice(i, i + 100).map(n => ({
        anime_id: animeId,
        episode_number: n,
        title: `Episode ${n}`,
        description: null,
        air_date: null,
        video_url: null,
        thumbnail_url: null,
        duration: null,
        is_premium: false,
        created_at: new Date().toISOString(),
      }))

      const { error: batchErr } = await supabase
        .from('episodes')
        .upsert(batch, { onConflict: 'anime_id,episode_number', ignoreDuplicates: true })

      if (batchErr) console.warn(`Stub batch error:`, batchErr.message)
    }

    created = missingNums.length
    total = expectedTotal
    skipped = existingSet.size
    console.log(`✅ ${animeTitle}: created ${created} stubs (episodes ${missingNums[0]}-${missingNums[missingNums.length - 1]})`)

    // ── Step 4 (optional): Enrich titles from Jikan ──────────────
    // Only try first page — if it works, update stub titles
    try {
      await new Promise(r => setTimeout(r, 1500))
      const resp = await fetch(`${this.JIKAN_BASE_URL}/anime/${malId}/episodes?page=1`)
      if (resp.ok) {
        const json = await resp.json()
        const episodes = json.data || []
        for (const ep of episodes) {
          if (ep.title && ep.title !== `Episode ${ep.mal_id}`) {
            await supabase
              .from('episodes')
              .update({
                title: ep.title,
                air_date: ep.aired ? ep.aired.split('T')[0] : null,
              })
              .eq('anime_id', animeId)
              .eq('episode_number', ep.mal_id)
              .is('video_url', null) // Only update stubs, not scraped episodes
          }
        }
        console.log(`📺 ${animeTitle}: enriched titles for first ${episodes.length} episodes`)
      }
    } catch { /* Jikan enrichment is optional */ }

    return { created, skipped, total }
  }

  /**
   * Fetch episode stubs for an already-imported anime.
   * Call this when the anime already exists in the DB but has no episodes.
   */
  static async fetchEpisodesForExistingAnime(
    animeId: string,
  ): Promise<{ created: number; skipped: number; total: number }> {
    // Look up the mal_id from our DB
    const { data: anime, error } = await supabase
      .from('anime')
      .select('mal_id, title')
      .eq('id', animeId)
      .single()

    if (error || !anime?.mal_id) {
      throw new Error(anime ? 'Anime has no MAL ID — cannot fetch episodes' : 'Anime not found')
    }

    return this.autoCreateEpisodeStubs(animeId, anime.mal_id, anime.title)
  }

  /**
   * Trigger batch scraping for all episodes of an anime.
   * Fires in the background (non-blocking) so the import can finish immediately.
   * The backend server handles the actual Playwright scraping.
   */
  static triggerBatchScrape(animeId: string, title: string, episodeCount: number): void {
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'
    const episodes = Array.from({ length: episodeCount }, (_, i) => i + 1)

    console.log(`🚀 Triggering background scrape for "${title}" (${episodeCount} episodes)...`)

    // Fire-and-forget: POST to the batch scrape endpoint
    fetch(`${BACKEND_URL}/api/batch-scrape-episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ animeTitle: title, animeId, episodeNumbers: episodes }),
    })
      .then(resp => resp.json())
      .then(result => {
        if (result.success) {
          const s = result.summary || {}
          console.log(`✅ Background scrape done for "${title}": ${s.successCount || 0}/${s.totalEpisodes || episodeCount} episodes`)
        } else {
          console.warn(`⚠️ Background scrape returned error for "${title}":`, result.error)
        }
      })
      .catch(err => {
        console.warn(`⚠️ Background scrape failed for "${title}":`, err.message)
      })
  }

  // Bulk import anime from search results
  static async bulkImportAnime(
    searchQuery: string, 
    source: 'jikan' | 'anilist' = 'jikan',
    limit: number = 10
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: true,
      imported: 0,
      skipped: 0,
      errors: [],
      duplicates: []
    }

    try {
      let searchResults: any[] = []
      
      if (source === 'jikan') {
        searchResults = await this.searchJikanAnime(searchQuery, limit)
      } else {
        searchResults = await this.searchAniListAnime(searchQuery, limit)
      }

      // Optimize with batch processing
      const batchSize = 3 // Smaller batches for better performance
      for (let i = 0; i < searchResults.length; i += batchSize) {
        const batch = searchResults.slice(i, i + batchSize)
        
        // Process batch in parallel for better performance
        const batchPromises = batch.map(async (anime) => {
          try {
            // For AniList, use importAnimeWithRelations to get characters, relations, and studios
            if (source === 'anilist') {
              // Check for duplicates first
              const title = anime.title?.english || anime.title?.romaji || anime.title?.native || ''
              const { data: existingAnime } = await supabase
                .from('anime')
                .select('id')
                .ilike('title', title)
                .maybeSingle()

              if (existingAnime) {
                return { type: 'duplicate', title: title || 'Unknown' }
              }

              // Use importAnimeWithRelations to get full data including characters
              const result = await this.importAnimeWithRelations(anime)
              if (result.success) {
                return { type: 'success', title: title }
              } else {
                return { type: 'error', title: title || 'Unknown', error: 'Import failed' }
              }
            } else {
              // For Jikan, use the old flow
              const mappedData = this.mapJikanToDatabase(anime)

              // Enhance trailer data by checking both sources
              await this.enhanceTrailerData(mappedData)

              // Quick duplicate check (optimized - only check ID)
              const { data: existingAnime } = await supabase
                .from('anime')
                .select('id')
                .ilike('title', mappedData.title || '')
                .maybeSingle()

              if (existingAnime) {
                return { type: 'duplicate', title: mappedData.title || 'Unknown' }
              }

              // Import the anime
              const importedAnime = await this.importAnime(mappedData)
              if (importedAnime) {
                return { type: 'success', title: mappedData.title }
              } else {
                return { type: 'duplicate', title: mappedData.title || 'Unknown' }
              }
            }
          } catch (error) {
            return { type: 'error', title: anime.title?.english || anime.title?.romaji || 'Unknown', error: error instanceof Error ? error.message : 'Unknown error' }
          }
        })

        // Wait for batch to complete
        const batchResults = await Promise.all(batchPromises)
        
        // Process results
        batchResults.forEach(batchResult => {
          switch (batchResult.type) {
            case 'success':
              result.imported++
              break
            case 'duplicate':
              result.skipped++
              result.duplicates.push(batchResult.title)
              break
            case 'error':
              result.errors.push(`${batchResult.title}: ${batchResult.error}`)
              break
          }
        })

        // Small delay between batches to prevent overwhelming the API
        if (i + batchSize < searchResults.length) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }

      return result
    } catch (error) {
      result.success = false
      result.errors.push(`Bulk import failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      return result
    }
  }

  // Helper methods for data mapping
  private static mapJikanStatus(status?: string): 'ongoing' | 'completed' | 'upcoming' | null {
    if (!status) return null
    
    switch (status.toLowerCase()) {
      case 'currently airing':
      case 'airing':
        return 'ongoing'
      case 'finished airing':
      case 'finished':
        return 'completed'
      case 'not yet aired':
      case 'upcoming':
        return 'upcoming'
      default:
        return null
    }
  }

  private static mapJikanType(type?: string): 'tv' | 'movie' | 'ova' | 'special' | null {
    if (!type) return null
    
    switch (type.toLowerCase()) {
      case 'tv':
        return 'tv'
      case 'movie':
        return 'movie'
      case 'ova':
        return 'ova'
      case 'special':
        return 'special'
      default:
        return 'tv' // Default to TV
    }
  }

  private static mapJikanRating(rating?: string): string | null {
    if (!rating) return null
    
    switch (rating.toLowerCase()) {
      case 'g - all ages':
        return 'G'
      case 'pg - children':
        return 'PG'
      case 'pg-13 - teens 13 or older':
        return 'PG-13'
      case 'r - 17+ (violence & profanity)':
      case 'r+ - mild nudity':
        return 'R'
      case 'rx - hentai':
        return '18+'
      default:
        return null
    }
  }

  private static mapAniListStatus(status?: string): 'ongoing' | 'completed' | 'upcoming' | null {
    if (!status) return null
    
    switch (status.toLowerCase()) {
      case 'releasing':
        return 'ongoing'
      case 'finished':
        return 'completed'
      case 'not yet released':
        return 'upcoming'
      default:
        return null
    }
  }

  private static mapAniListType(format?: string): 'tv' | 'movie' | 'ova' | 'special' | null {
    if (!format) return null
    
    switch (format.toLowerCase()) {
      case 'tv':
        return 'tv'
      case 'movie':
        return 'movie'
      case 'ova':
        return 'ova'
      case 'special':
        return 'special'
      default:
        return 'tv' // Default to TV
    }
  }

  private static parseDuration(duration: string): number | null {
    // Parse duration like "24 min per ep" or "1 hr 30 min"
    const match = duration.match(/(\d+)\s*min/)
    return match ? parseInt(match[1]) : null
  }

  private static stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim()
  }

  // Helper function to format trailer URLs for embedding
  private static formatTrailerUrl(id: string, site?: string): string {
    switch (site?.toLowerCase()) {
      case 'youtube':
        return `https://www.youtube.com/embed/${id}`
      case 'dailymotion':
        return `https://www.dailymotion.com/embed/video/${id}`
      case 'vimeo':
        return `https://player.vimeo.com/video/${id}`
      default:
        // Default to YouTube embed if site is not specified
        return `https://www.youtube.com/embed/${id}`
    }
  }

  // Helper function to get watch URL (for external links)
  private static formatTrailerWatchUrl(id: string, site?: string): string {
    switch (site?.toLowerCase()) {
      case 'youtube':
        return `https://www.youtube.com/watch?v=${id}`
      case 'dailymotion':
        return `https://www.dailymotion.com/video/${id}`
      case 'vimeo':
        return `https://vimeo.com/${id}`
      default:
        return `https://www.youtube.com/watch?v=${id}`
    }
  }

  // Test function to debug trailer data
  static async testTrailerData(query: string = "Attack on Titan"): Promise<void> {
    try {
      console.log('🔍 Testing trailer data for:', query)
      
      // Test Jikan
      console.log('📡 Testing Jikan API...')
      const jikanResults = await this.searchJikanAnime(query, 1)
      if (jikanResults.length > 0) {
        const jikanAnime = jikanResults[0]
        console.log('🎬 Jikan trailer data:', {
          title: jikanAnime.title,
          trailer: jikanAnime.trailer,
          mappedTrailerUrl: jikanAnime.trailer?.embed_url || (jikanAnime.trailer?.youtube_id ? `https://www.youtube.com/embed/${jikanAnime.trailer.youtube_id}` : null)
        })
      }
      
      // Test AniList
      console.log('📡 Testing AniList API...')
      const anilistResults = await this.searchAniListAnime(query, 1)
      if (anilistResults.length > 0) {
        const anilistAnime = anilistResults[0]
        console.log('🎬 AniList trailer data:', {
          title: anilistAnime.title?.english || anilistAnime.title?.romaji,
          trailer: anilistAnime.trailer,
          mappedTrailerUrl: anilistAnime.trailer?.id ? this.formatTrailerUrl(anilistAnime.trailer.id, anilistAnime.trailer.site) : null
        })
      }
    } catch (error) {
      console.error('❌ Error testing trailer data:', error)
    }
  }

  // Get trending anime from Jikan
  static async getTrendingJikanAnime(limit: number = 10): Promise<JikanAnime[]> {
    try {
      const response = await fetch(`${this.JIKAN_BASE_URL}/top/anime?limit=${limit}`)
      
      if (!response.ok) {
        throw new Error(`Jikan API error: ${response.status}`)
      }
      
      const data = await response.json()
      return data.data || []
    } catch (error) {
      console.error('Error fetching trending anime:', error)
      throw new Error(`Failed to fetch trending anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Get seasonal anime from Jikan
  static async getSeasonalJikanAnime(year: number, season: string, limit: number = 20): Promise<JikanAnime[]> {
    try {
      const response = await fetch(`${this.JIKAN_BASE_URL}/seasons/${year}/${season}?limit=${limit}`)
      
      if (!response.ok) {
        throw new Error(`Jikan API error: ${response.status}`)
      }
      
      const data = await response.json()
      return data.data || []
    } catch (error) {
      console.error('Error fetching seasonal anime:', error)
      throw new Error(`Failed to fetch seasonal anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Get trending anime from AniList
  static async getTrendingAniListAnime(limit: number = 10): Promise<AniListAnime[]> {
    try {
      const query = `
        query GetTrendingAnime($perPage: Int) {
          Page(perPage: $perPage) {
            media(sort: TRENDING_DESC, type: ANIME, status_in: [RELEASING, FINISHED]) {
              id
              idMal
              title {
                romaji
                english
                native
              }
              description
              format
              status
              episodes
              duration
              genres
              tags {
                name
                rank
              }
              averageScore
              meanScore
              popularity
              trending
              favourites
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
              coverImage {
                large
                medium
              }
              bannerImage
              trailer {
                id
                site
                thumbnail
              }
              studios {
                nodes {
                  id
                  name
                }
              }
              relations {
                edges {
                  id
                  relationType
                  node {
                    id
                    idMal
                    title {
                      romaji
                      english
                    }
                    format
                    status
                    episodes
                    startDate {
                      year
                    }
                    coverImage {
                      large
                    }
                  }
                }
              }
              characters(sort: [ROLE, RELEVANCE], perPage: 20) {
                edges {
                  id
                  role
                  voiceActors(language: JAPANESE) {
                    id
                    name {
                      full
                      native
                    }
                  }
                  voiceActorRoles {
                    voiceActor {
                      id
                      name {
                        full
                        native
                      }
                      language
                    }
                  }
                  node {
                    id
                    name {
                      full
                      native
                      alternative
                    }
                    image {
                      large
                      medium
                    }
                    description
                  }
                }
              }
            }
          }
        }
      `

      const response = await fetch(this.ANILIST_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { perPage: limit }
        })
      })

      if (!response.ok) {
        throw new Error(`AniList API error: ${response.status}`)
      }

      const data = await response.json()
      return data.data?.Page?.media || []
    } catch (error) {
      console.error('Error fetching trending anime from AniList:', error)
      throw new Error(`Failed to fetch trending anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Get seasonal anime from AniList
  static async getSeasonalAniListAnime(year: number, season: string, limit: number = 20): Promise<AniListAnime[]> {
    try {
      const seasonMap: { [key: string]: number } = {
        'winter': 1,
        'spring': 2,
        'summer': 3,
        'fall': 4
      }

      const seasonNumber = seasonMap[season.toLowerCase()] || 1

      const query = `
        query GetSeasonalAnime($year: Int, $season: MediaSeason, $perPage: Int) {
          Page(perPage: $perPage) {
            media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
              id
              idMal
              title {
                romaji
                english
                native
              }
              description
              format
              status
              episodes
              duration
              genres
              tags {
                name
                rank
              }
              averageScore
              meanScore
              popularity
              trending
              favourites
              startDate {
                year
                month
                day
              }
              endDate {
                year
                month
                day
              }
              coverImage {
                large
                medium
              }
              bannerImage
              trailer {
                id
                site
                thumbnail
              }
              studios {
                nodes {
                  id
                  name
                }
              }
              relations {
                edges {
                  id
                  relationType
                  node {
                    id
                    idMal
                    title {
                      romaji
                      english
                    }
                    format
                    status
                    episodes
                    startDate {
                      year
                    }
                    coverImage {
                      large
                    }
                  }
                }
              }
              characters(sort: [ROLE, RELEVANCE], perPage: 20) {
                edges {
                  id
                  role
                  voiceActors(language: JAPANESE) {
                    id
                    name {
                      full
                      native
                    }
                  }
                  voiceActorRoles {
                    voiceActor {
                      id
                      name {
                        full
                        native
                      }
                      language
                    }
                  }
                  node {
                    id
                    name {
                      full
                      native
                      alternative
                    }
                    image {
                      large
                      medium
                    }
                    description
                  }
                }
              }
            }
          }
        }
      `

      const response = await fetch(this.ANILIST_BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { 
            year,
            season: season.toUpperCase(),
            perPage: limit 
          }
        })
      })

      if (!response.ok) {
        throw new Error(`AniList API error: ${response.status}`)
      }

      const data = await response.json()
      return data.data?.Page?.media || []
    } catch (error) {
      console.error('Error fetching seasonal anime from AniList:', error)
      throw new Error(`Failed to fetch seasonal anime: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  // Import anime relations from AniList data
  static async importAnimeRelations(animeId: string, anilistData: any): Promise<{ success: number, errors: number }> {
    try {
      if (!anilistData.relations?.edges || anilistData.relations.edges.length === 0) {
        console.log(`No relations found for anime ${animeId}`)
        return { success: 0, errors: 0 }
      }

      let successCount = 0
      let errorCount = 0

      for (const relation of anilistData.relations.edges) {
        try {
          const relatedTitle = relation.node.title?.romaji || relation.node.title?.english || relation.node.title?.native
          
          // Skip obviously wrong relations (basic validation)
          if (!relatedTitle || !relation.relationType) {
            console.log(`⚠️ Skipping invalid relation: ${relatedTitle} (${relation.relationType})`)
            continue
          }
          
          // Skip relations that are too different (basic genre/title similarity check)
          const currentAnimeTitle = anilistData.title?.romaji || anilistData.title?.english || anilistData.title?.native || ''
          if (currentAnimeTitle && relatedTitle) {
            // Skip if titles are completely different (no common words)
            const currentWords = currentAnimeTitle.toLowerCase().split(/\s+/)
            const relatedWords = relatedTitle.toLowerCase().split(/\s+/)
            const hasCommonWords = currentWords.some(word => 
              word.length > 2 && relatedWords.some(rWord => rWord.includes(word) || word.includes(rWord))
            )
            
            // For SEQUEL/PREQUEL relations, require some similarity
            if (['SEQUEL', 'PREQUEL'].includes(relation.relationType) && !hasCommonWords) {
              console.log(`⚠️ Skipping unlikely ${relation.relationType}: ${currentAnimeTitle} -> ${relatedTitle}`)
              continue
            }
          }

          const relationData = {
            anime_id: animeId,
            related_anime_id: relation.node.idMal?.toString() || relation.node.id?.toString(),
            relation_type: relation.relationType,
            anilist_id: relation.node.id,
            mal_id: relation.node.idMal,
            title: relatedTitle,
            format: relation.node.format,
            status: relation.node.status,
            episodes: relation.node.episodes,
            year: relation.node.startDate?.year,
            poster_url: relation.node.coverImage?.large || relation.node.coverImage?.medium
          }

          const { error } = await supabase
            .from('anime_relations')
            .upsert(relationData, { 
              onConflict: 'anime_id,related_anime_id,relation_type',
              ignoreDuplicates: true 
            })

          if (error) {
            console.error(`Error importing relation for anime ${animeId}:`, error)
            errorCount++
          } else {
            successCount++
            console.log(`✅ Imported relation: ${relationData.title} (${relationData.relation_type})`)
          }
        } catch (error) {
          console.error(`Error processing relation for anime ${animeId}:`, error)
          errorCount++
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error importing anime relations:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Fetch and import relations from Jikan API for a given anime
  static async fetchAndImportJikanRelations(animeId: string, malId: number, animeTitle: string): Promise<{ success: number, errors: number }> {
    try {
      console.log(`🔗 Fetching Jikan relations for MAL ID ${malId}`)

      // Respect Jikan rate limit
      await new Promise(r => setTimeout(r, 400))

      const resp = await fetch(`${this.JIKAN_BASE_URL}/anime/${malId}/relations`)
      if (!resp.ok) {
        console.warn(`Jikan relations API returned ${resp.status} for MAL ${malId}`)
        return { success: 0, errors: 1 }
      }

      const json = await resp.json()
      const relations: Array<{
        relation: string
        entry: Array<{ mal_id: number; type: string; name: string; url: string }>
      }> = json.data || []

      if (relations.length === 0) {
        console.log(`⚠️ No relations found for MAL ${malId}`)
        return { success: 0, errors: 0 }
      }

      let successCount = 0
      let errorCount = 0

      for (const rel of relations) {
        for (const entry of rel.entry) {
          // Only import Anime-type relations
          if (entry.type !== 'anime') continue

          try {
            // Map Jikan relation types to match AniList format used in DB
            const typeMap: Record<string, string> = {
              Sequel: 'SEQUEL',
              Prequel: 'PREQUEL',
              'Alternative setting': 'ALTERNATIVE',
              'Alternative version': 'ALTERNATIVE',
              'Side story': 'SIDE_STORY',
              'Parent story': 'PARENT',
              Summary: 'SUMMARY',
              'Full story': 'PARENT',
              'Spin-off': 'SPIN_OFF',
              Other: 'OTHER',
              Character: 'CHARACTER',
              Adaptation: 'ADAPTATION',
            }

            const relationType = typeMap[rel.relation] || 'OTHER'

            // For SEQUEL/PREQUEL, do basic title similarity check
            if (['SEQUEL', 'PREQUEL'].includes(relationType)) {
              const currentWords = animeTitle.toLowerCase().split(/\s+/)
              const relatedWords = entry.name.toLowerCase().split(/\s+/)
              const hasCommon = currentWords.some(w =>
                w.length > 2 && relatedWords.some(rw => rw.includes(w) || w.includes(rw))
              )
              if (!hasCommon) {
                console.log(`⚠️ Skipping unlikely ${relationType}: ${animeTitle} -> ${entry.name}`)
                continue
              }
            }

            const relationData = {
              anime_id: animeId,
              related_anime_id: entry.mal_id.toString(),
              relation_type: relationType,
              mal_id: entry.mal_id,
              title: entry.name,
            }

            const { error } = await supabase
              .from('anime_relations')
              .upsert(relationData, { onConflict: 'anime_id,related_anime_id,relation_type', ignoreDuplicates: true })

            if (error) {
              console.error(`Error importing Jikan relation "${entry.name}":`, error)
              errorCount++
            } else {
              successCount++
              console.log(`✅ Imported relation: ${entry.name} (${relationType})`)
            }
          } catch (err) {
            console.error(`Error processing Jikan relation:`, err)
            errorCount++
          }
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error fetching Jikan relations:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Fetch and import studios from Jikan anime data into the studios + studio_relations tables
  static async importJikanStudios(animeId: string, jikanStudios: Array<{ mal_id: number; name: string }>): Promise<{ success: number, errors: number }> {
    try {
      if (!jikanStudios || jikanStudios.length === 0) {
        console.log(`No studios to import for anime ${animeId}`)
        return { success: 0, errors: 0 }
      }

      let successCount = 0
      let errorCount = 0

      for (const studio of jikanStudios.slice(0, 2)) {
        try {
          // Upsert studio by name (Jikan doesn't have anilist_id)
          const { data: studioResult, error: studioError } = await supabase
            .from('anime_studios')
            .upsert({ name: studio.name }, { onConflict: 'name' })
            .select('id')
            .single()

          if (studioError) {
            console.error(`Error upserting studio "${studio.name}":`, studioError)
            errorCount++
            continue
          }

          if (!studioResult?.id) {
            console.error(`Failed to get UUID for studio: ${studio.name}`)
            errorCount++
            continue
          }

          // Create the anime-studio relation
          const { error: relError } = await supabase
            .from('anime_studio_relations')
            .upsert(
              { anime_id: animeId, studio_id: studioResult.id, role: 'animation' },
              { onConflict: 'anime_id,studio_id,role', ignoreDuplicates: true }
            )

          if (relError) {
            console.error(`Error creating studio relation for "${studio.name}":`, relError)
            errorCount++
          } else {
            successCount++
            console.log(`✅ Imported studio: ${studio.name}`)
          }
        } catch (err) {
          console.error(`Error processing Jikan studio:`, err)
          errorCount++
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error importing Jikan studios:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Fetch and import characters from Jikan API for a given anime
  static async fetchAndImportJikanCharacters(animeId: string, malId: number): Promise<{ success: number, errors: number }> {
    try {
      console.log(`🎭 Fetching Jikan characters for MAL ID ${malId}`)

      // Respect Jikan rate limit
      await new Promise(r => setTimeout(r, 400))

      const resp = await fetch(`${this.JIKAN_BASE_URL}/anime/${malId}/characters`)
      if (!resp.ok) {
        console.warn(`Jikan characters API returned ${resp.status} for MAL ${malId}`)
        return { success: 0, errors: 1 }
      }

      const json = await resp.json()
      const characters: Array<{
        character: { mal_id: number; name: string; images?: { jpg?: { image_url?: string } } }
        role: string
        voice_actors?: Array<{ person: { mal_id: number; name: string }; language: string }>
      }> = json.data || []

      if (characters.length === 0) {
        console.log(`⚠️ No characters found for MAL ${malId}`)
        return { success: 0, errors: 0 }
      }

      // Filter to Main characters first; fall back to top 10 Supporting
      let filtered = characters.filter(c => c.role === 'Main')
      if (filtered.length === 0) {
        filtered = characters.filter(c => c.role === 'Supporting').slice(0, 10)
      }

      console.log(`✅ Found ${characters.length} total characters, importing ${filtered.length}`)

      let successCount = 0
      let errorCount = 0

      // Fetch existing characters to detect name-format duplicates
      const { data: existingChars } = await supabase
        .from('anime_characters')
        .select('id, name, role')
        .eq('anime_id', animeId)

      const normalizeName = (name: string) => {
        return name.toLowerCase().replace(/[.,\-'"""'']/g, '').split(/[\s,]+/).filter(w => w.length > 1).sort().join(' ')
      }
      const existingByNorm = new Map<string, { id: string; name: string }>()
      for (const ec of existingChars || []) {
        existingByNorm.set(normalizeName(ec.name), { id: ec.id, name: ec.name })
      }

      for (const entry of filtered) {
        try {
          const japaneseVA = entry.voice_actors?.find(va => va.language === 'Japanese')
          const englishVA = entry.voice_actors?.find(va => va.language === 'English')

          const roleMap: Record<string, string> = { Main: 'main', Supporting: 'supporting' }

          const characterData = {
            anime_id: animeId,
            name: entry.character.name,
            image_url: entry.character.images?.jpg?.image_url || null,
            role: roleMap[entry.role] || 'supporting',
            voice_actor: englishVA?.person?.name || japaneseVA?.person?.name || null,
            voice_actor_japanese: japaneseVA?.person?.name || null,
          }

          // Check for fuzzy duplicate (e.g. AniList already inserted "Monkey D. Luffy", Jikan has "Luffy, Monkey D.")
          const normalizedNew = normalizeName(characterData.name)
          const existingMatch = existingByNorm.get(normalizedNew)

          if (existingMatch && existingMatch.name !== characterData.name) {
            // Existing char has better name — just update voice actors if missing
            const { error } = await supabase
              .from('anime_characters')
              .update({
                voice_actor: characterData.voice_actor,
                voice_actor_japanese: characterData.voice_actor_japanese,
                image_url: characterData.image_url,
              })
              .eq('id', existingMatch.id)
              .is('voice_actor', null) // Only update if voice_actor is currently null

            if (error) {
              // Try without the .is() filter
              await supabase
                .from('anime_characters')
                .update({
                  voice_actor: characterData.voice_actor,
                  voice_actor_japanese: characterData.voice_actor_japanese,
                })
                .eq('id', existingMatch.id)
            }
            successCount++
            console.log(`🔄 Merged Jikan data into existing character "${existingMatch.name}"`)
          } else {
            const { error } = await supabase
              .from('anime_characters')
              .upsert(characterData, { onConflict: 'anime_id,name', ignoreDuplicates: false })

            if (error) {
              console.error(`Error importing Jikan character "${entry.character.name}":`, error)
              errorCount++
            } else {
              successCount++
              existingByNorm.set(normalizedNew, { id: '', name: characterData.name })
              console.log(`✅ Imported character: ${entry.character.name} (${characterData.role})`)
            }
          }
        } catch (err) {
          console.error(`Error processing Jikan character:`, err)
          errorCount++
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error fetching Jikan characters:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Import anime characters from AniList data
  static async importAnimeCharacters(animeId: string, anilistData: any): Promise<{ success: number, errors: number }> {
    try {
      console.log(`🎭 Importing characters for anime ${animeId}`)
      console.log('Characters data:', JSON.stringify(anilistData.characters, null, 2))
      
      if (!anilistData.characters?.edges || anilistData.characters.edges.length === 0) {
        console.warn(`⚠️ No characters found for anime ${animeId}. Characters data structure:`, anilistData.characters)
        return { success: 0, errors: 0 }
      }

      console.log(`✅ Found ${anilistData.characters.edges.length} characters to import`)
      
      // Log character roles for debugging
      const roleCounts = anilistData.characters.edges.reduce((acc: any, char: any) => {
        acc[char.role] = (acc[char.role] || 0) + 1
        return acc
      }, {})
      console.log('Character role distribution:', roleCounts)

      let successCount = 0
      let errorCount = 0

      // Only import main characters (MAIN role) - but also try SUPPORTING if no MAIN
      let mainCharacters = anilistData.characters.edges.filter((char: any) => char.role === 'MAIN')
      
      // If no MAIN characters, import SUPPORTING characters too (limit to top 10)
      if (mainCharacters.length === 0) {
        console.log('No MAIN characters found, importing top 10 SUPPORTING characters instead')
        mainCharacters = anilistData.characters.edges
          .filter((char: any) => char.role === 'SUPPORTING')
          .slice(0, 10)
      }
      
      console.log(`Filtering to ${mainCharacters.length} characters (MAIN or SUPPORTING)`)
      
      // Fetch existing characters for this anime to detect duplicates with different name formats
      const { data: existingChars } = await supabase
        .from('anime_characters')
        .select('id, name, role')
        .eq('anime_id', animeId)

      // Helper: normalize name for fuzzy matching (handles "Luffy, Monkey D." vs "Monkey D. Luffy")
      const normalizeName = (name: string) => {
        return name
          .toLowerCase()
          .replace(/[.,\-'"""'']/g, '')  // strip punctuation
          .split(/[\s,]+/)               // split into words
          .filter(w => w.length > 1)     // drop single chars
          .sort()                        // sort alphabetically
          .join(' ')
      }

      // Build lookup of existing characters by normalized name
      const existingByNorm = new Map<string, { id: string; name: string }>()
      for (const ec of existingChars || []) {
        existingByNorm.set(normalizeName(ec.name), { id: ec.id, name: ec.name })
      }

      for (const character of mainCharacters) {
        try {
          console.log('Processing character:', character.node.name?.full, 'Role:', character.role)
          
          // Extract voice actors from AniList data
          const japaneseVA = character.voiceActors?.[0] // Already filtered to JAPANESE in query
          // Find English VA from voiceActorRoles
          const englishVARole = character.voiceActorRoles?.find(
            (r: any) => r.voiceActor?.language === 'ENGLISH'
          )
          const englishVA = englishVARole?.voiceActor

          // name.alternative is an array of aliases — join for storage, use full as romaji
          const altNames = Array.isArray(character.node.name?.alternative)
            ? character.node.name.alternative.filter(Boolean).join(', ')
            : character.node.name?.alternative || null

          const characterData = {
            anime_id: animeId,
            name: character.node.name?.full || character.node.name?.native,
            name_japanese: character.node.name?.native,
            name_romaji: altNames,
            role: character.role?.toLowerCase() || 'supporting',
            image_url: character.node.image?.large || character.node.image?.medium,
            description: character.node.description,
            voice_actor: englishVA?.name?.full || japaneseVA?.name?.full || null,
            voice_actor_japanese: japaneseVA?.name?.native || japaneseVA?.name?.full || null
          }
          
          console.log('Character data to insert:', characterData)

          // Check if a character with a different name format already exists (e.g. Jikan "Luffy, Monkey D." vs AniList "Monkey D. Luffy")
          const normalizedNew = normalizeName(characterData.name)
          const existingMatch = existingByNorm.get(normalizedNew)

          if (existingMatch && existingMatch.name !== characterData.name) {
            // Update the existing row with the better data instead of creating a duplicate
            console.log(`🔄 Updating existing character "${existingMatch.name}" → "${characterData.name}"`)
            const { error } = await supabase
              .from('anime_characters')
              .update({
                name: characterData.name,
                name_japanese: characterData.name_japanese,
                name_romaji: characterData.name_romaji,
                image_url: characterData.image_url,
                description: characterData.description,
                voice_actor: characterData.voice_actor,
                voice_actor_japanese: characterData.voice_actor_japanese,
              })
              .eq('id', existingMatch.id)

            if (error) {
              console.error(`Error updating character "${existingMatch.name}":`, error)
              errorCount++
            } else {
              successCount++
              // Update the lookup so future checks use the new name
              existingByNorm.delete(normalizedNew)
              existingByNorm.set(normalizedNew, { id: existingMatch.id, name: characterData.name })
            }
          } else {
            // Normal upsert (no fuzzy duplicate found)
            const { error } = await supabase
              .from('anime_characters')
              .upsert(characterData, { 
                onConflict: 'anime_id,name',
                ignoreDuplicates: false 
              })

            if (error) {
              console.error(`Error importing character for anime ${animeId}:`, error)
              errorCount++
            } else {
              successCount++
              console.log(`✅ Imported character: ${characterData.name} (${characterData.role})`)
            }
          }
        } catch (error) {
          console.error(`Error processing character for anime ${animeId}:`, error)
          errorCount++
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error importing anime characters:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Import anime studios from AniList data
  static async importAnimeStudios(animeId: string, anilistData: any): Promise<{ success: number, errors: number }> {
    try {
      if (!anilistData.studios?.nodes || anilistData.studios.nodes.length === 0) {
        console.log(`No studios found for anime ${animeId}`)
        return { success: 0, errors: 0 }
      }

      let successCount = 0
      let errorCount = 0

      // Only import first 2 main studios
      const mainStudios = anilistData.studios.nodes.slice(0, 2)
      for (const studio of mainStudios) {
        try {
          // First, upsert the studio
          const studioData = {
            anilist_id: studio.id,
            name: studio.name
          }

          const { data: studioResult, error: studioError } = await supabase
            .from('anime_studios')
            .upsert(studioData, { 
              onConflict: 'anilist_id'
            })
            .select('id')
            .single()

          if (studioError) {
            console.error(`Error importing studio:`, studioError)
            errorCount++
            continue
          }

          // Get the studio UUID from the database
          const studioUuid = studioResult?.id
          if (!studioUuid) {
            console.error(`Failed to get studio UUID for studio: ${studio.name}`)
            errorCount++
            continue
          }

          // Then, create the relation
          const relationData = {
            anime_id: animeId,
            studio_id: studioUuid,
            role: 'animation' // Default role for animation studios
          }

          const { error: relationError } = await supabase
            .from('anime_studio_relations')
            .upsert(relationData, { 
              onConflict: 'anime_id,studio_id,role',
              ignoreDuplicates: true 
            })

          if (relationError) {
            console.error(`Error creating studio relation for anime ${animeId}:`, relationError)
            errorCount++
          } else {
            successCount++
            console.log(`✅ Imported studio: ${studioData.name}`)
          }
        } catch (error) {
          console.error(`Error processing studio for anime ${animeId}:`, error)
          errorCount++
        }
      }

      return { success: successCount, errors: errorCount }
    } catch (error) {
      console.error('Error importing anime studios:', error)
      return { success: 0, errors: 1 }
    }
  }

  // Update existing anime with better trailer data from both sources
  static async updateAnimeTrailers(): Promise<{ updated: number, errors: number }> {
    try {
      console.log('🔄 Starting trailer update process...')
      
      // Get all anime without trailer URLs
      const { data: animeWithoutTrailers, error: fetchError } = await supabase
        .from('anime')
        .select('id, title, trailer_url')
        .or('trailer_url.is.null,trailer_url.eq.')
        .limit(50) // Process in batches
      
      if (fetchError) {
        console.error('Error fetching anime:', fetchError)
        return { updated: 0, errors: 1 }
      }

      if (!animeWithoutTrailers || animeWithoutTrailers.length === 0) {
        console.log('✅ All anime already have trailer URLs')
        return { updated: 0, errors: 0 }
      }

      console.log(`🔍 Found ${animeWithoutTrailers.length} anime without trailers`)
      
      let updated = 0
      let errors = 0

      // Process each anime
      for (const anime of animeWithoutTrailers) {
        try {
          console.log(`🔍 Searching trailer for: ${anime.title}`)
          
          // Create anime data object for enhancement
          const animeData: Partial<Anime> = {
            id: anime.id,
            title: anime.title,
            trailer_url: anime.trailer_url
          }

          // Enhance trailer data
          await this.enhanceTrailerData(animeData)

          // Update if we found a trailer
          if (animeData.trailer_url && animeData.trailer_url !== anime.trailer_url) {
            const { error: updateError } = await supabase
              .from('anime')
              .update({ trailer_url: animeData.trailer_url })
              .eq('id', anime.id)

            if (updateError) {
              console.error(`Error updating trailer for ${anime.title}:`, updateError)
              errors++
            } else {
              console.log(`✅ Updated trailer for: ${anime.title}`)
              updated++
            }
          } else {
            console.log(`❌ No trailer found for: ${anime.title}`)
          }

          // Add delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000))
          
        } catch (error) {
          console.error(`Error processing ${anime.title}:`, error)
          errors++
        }
      }

      console.log(`🎬 Trailer update complete: ${updated} updated, ${errors} errors`)
      return { updated, errors }
      
    } catch (error) {
      console.error('Error in updateAnimeTrailers:', error)
      return { updated: 0, errors: 1 }
    }
  }

  // Enhanced import anime with relations
  // Enhance trailer data by checking both Jikan and AniList sources
  static async enhanceTrailerData(animeData: Partial<Anime>): Promise<void> {
    try {
      // If we already have a trailer URL, keep it
      if (animeData.trailer_url) {
        console.log('🎬 Trailer already exists:', animeData.trailer_url)
        return
      }

      console.log('🔍 Searching for trailer data for:', animeData.title)
      
      // Try to find trailer from Jikan
      try {
        const jikanResults = await this.searchJikanAnime(animeData.title!, 1)
        if (jikanResults.length > 0) {
          const jikanAnime = jikanResults[0]
          if (jikanAnime.trailer?.embed_url || jikanAnime.trailer?.youtube_id) {
            const jikanTrailerUrl = jikanAnime.trailer.embed_url || 
              (jikanAnime.trailer.youtube_id ? `https://www.youtube.com/embed/${jikanAnime.trailer.youtube_id}` : null)
            
            if (jikanTrailerUrl) {
              console.log('🎬 Found trailer from Jikan:', jikanTrailerUrl)
              animeData.trailer_url = jikanTrailerUrl
              return
            }
          }
        }
      } catch (error) {
        console.log('⚠️ Jikan trailer search failed:', error)
      }

      // Try to find trailer from AniList
      try {
        const anilistResults = await this.searchAniListAnime(animeData.title!, 1)
        if (anilistResults.length > 0) {
          const anilistAnime = anilistResults[0]
          if (anilistAnime.trailer?.id) {
            const anilistTrailerUrl = this.formatTrailerUrl(anilistAnime.trailer.id, anilistAnime.trailer.site)
            console.log('🎬 Found trailer from AniList:', anilistTrailerUrl)
            animeData.trailer_url = anilistTrailerUrl
            return
          }
        }
      } catch (error) {
        console.log('⚠️ AniList trailer search failed:', error)
      }

      console.log('❌ No trailer found from any source')
    } catch (error) {
      console.error('Error enhancing trailer data:', error)
    }
  }

  static async importAnimeWithRelations(anilistData: any, options?: { skipAutoScrape?: boolean }): Promise<{ success: boolean, animeId?: string, relations?: any, characters?: any, studios?: any }> {
    try {
      // First import the main anime data
      const animeData = this.mapAniListToDatabase(anilistData)
      
      // Check for duplicates first
      const { data: existingAnime } = await supabase
        .from('anime')
        .select('id')
        .ilike('title', animeData.title || '')
        .maybeSingle()

      let animeId: string
      
      if (existingAnime) {
        console.log(`Anime "${animeData.title}" already exists, importing characters/relations for existing anime`)
        animeId = existingAnime.id
      } else {
        // Enhance trailer data by checking both sources
        await this.enhanceTrailerData(animeData)
        
        const { data: insertedAnime, error: insertError } = await supabase
          .from('anime')
          .insert(animeData)
          .select()
          .single()

        if (insertError) {
          console.error('Error inserting anime:', insertError)
          throw insertError
        }

        animeId = insertedAnime.id
        console.log(`✅ Imported anime: ${animeData.title}`)

        // Auto-create episode stubs from Jikan if we have a MAL ID
        const malId = (animeData as any).mal_id || (anilistData as any).idMal
        if (malId) {
          try {
            const episodeResult = await this.autoCreateEpisodeStubs(animeId, malId, animeData.title || '')
            console.log(`📺 Episode stubs: ${episodeResult.created} created, ${episodeResult.skipped} skipped`)

            // If Jikan returned zero episodes, we used to delete the anime here.
            // However, we should keep it because it might just not be aired yet or Jikan is missing data.
            if (episodeResult.total === 0) {
              console.log(`⚠️ No episode stubs found for "${animeData.title}" on Jikan, but keeping the anime record.`)
            }

            // Auto-scrape stream URLs in the background (unless caller will do it)
            if (!(options as any)?.skipAutoScrape) {
              this.triggerBatchScrape(animeId, animeData.title || '', episodeResult.total)
            }
          } catch (epErr) {
            console.warn('⚠️ Auto episode stub creation failed (non-fatal):', epErr)
          }
        }
      }

      // Import relations, characters, and studios in parallel (even for existing anime)
      const [relationsResult, charactersResult, studiosResult] = await Promise.all([
        this.importAnimeRelations(animeId, anilistData),
        this.importAnimeCharacters(animeId, anilistData),
        this.importAnimeStudios(animeId, anilistData)
      ])

      return {
        success: true,
        animeId,
        relations: relationsResult,
        characters: charactersResult,
        studios: studiosResult
      }
    } catch (error) {
      console.error('Error importing anime with relations:', error)
      return { success: false }
    }
  }

  // Import anime from AniList data (enhanced with relations)
  static async importAnimeFromAniList(anilistData: any, options?: { skipAutoScrape?: boolean }): Promise<boolean> {
    try {
      console.log('🎬 Starting import for anime:', anilistData.title?.english || anilistData.title?.romaji)
      console.log('📊 AniList data structure:', {
        hasRelations: !!anilistData.relations?.edges,
        relationsCount: anilistData.relations?.edges?.length || 0,
        hasCharacters: !!anilistData.characters?.edges,
        charactersCount: anilistData.characters?.edges?.length || 0,
        hasStudios: !!anilistData.studios?.nodes,
        studiosCount: anilistData.studios?.nodes?.length || 0
      })
      
      const result = await this.importAnimeWithRelations(anilistData, options)
      
      if (result.success) {
        console.log(`✅ Imported anime with relations: ${anilistData.title?.english || anilistData.title?.romaji}`)
        if (result.relations) {
          console.log(`📊 Relations: ${result.relations.success} imported, ${result.relations.errors} errors`)
        }
        if (result.characters) {
          console.log(`👥 Characters: ${result.characters.success} imported, ${result.characters.errors} errors`)
        }
        if (result.studios) {
          console.log(`🏢 Studios: ${result.studios.success} imported, ${result.studios.errors} errors`)
        }
        return true
      }
      
      return false
    } catch (error) {
      console.error('Error importing anime from AniList:', error)
      return false
    }
  }
}
