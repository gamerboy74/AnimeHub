import React, { useState } from 'react'
import { AnimeImporterService } from '../../services/anime/importer'
import Button from '../base/Button'
import Input from '../base/Input'
import LoadingSpinner from '../base/LoadingSpinner'

export const TrailerDebugger: React.FC = () => {
  const [query, setQuery] = useState('Attack on Titan')
  const [isLoading, setIsLoading] = useState(false)
  const [results, setResults] = useState<any[]>([])

  const testTrailers = async () => {
    setIsLoading(true)
    setResults([])
    
    try {
      // Test both APIs
      console.log('🧪 Starting trailer debug test...')
      
      const [jikanResults, anilistResults] = await Promise.all([
        AnimeImporterService.searchJikanAnime(query, 3),
        AnimeImporterService.searchAniListAnime(query, 3)
      ])

      const mappedJikan = jikanResults.map(anime => ({
        source: 'Jikan',
        title: anime.title,
        originalTrailer: anime.trailer,
        mappedTrailer: AnimeImporterService.mapJikanToDatabase(anime).trailer_url
      }))

      const mappedAnilist = anilistResults.map(anime => ({
        source: 'AniList',
        title: anime.title?.english || anime.title?.romaji,
        originalTrailer: anime.trailer,
        mappedTrailer: AnimeImporterService.mapAniListToDatabase(anime).trailer_url
      }))

      setResults([...mappedJikan, ...mappedAnilist])
      
      // Also run the built-in test function
      await AnimeImporterService.testTrailerData(query)
      
    } catch (error) {
      console.error('❌ Trailer test failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">🎬 Trailer Debugger</h2>
      
      <div className="mb-4">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search query (e.g., Attack on Titan)"
          className="mb-2"
        />
        <Button
          onClick={testTrailers}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? <LoadingSpinner size="sm" /> : '🧪 Test Trailer Data'}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">📊 Results:</h3>
          {results.map((result, index) => (
            <div key={index} className="p-4 border rounded-lg">
              <div className="font-semibold text-blue-600">{result.source}: {result.title}</div>
              <div className="mt-2">
                <div className="text-sm text-gray-600">
                  <strong>Original Trailer:</strong>
                  <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-auto">
                    {JSON.stringify(result.originalTrailer, null, 2)}
                  </pre>
                </div>
                <div className="text-sm text-gray-600 mt-2">
                  <strong>Mapped Trailer URL:</strong>
                  <div className="mt-1 p-2 bg-green-100 rounded text-xs break-all">
                    {result.mappedTrailer || 'No trailer URL'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="font-semibold text-blue-800 mb-2">🔍 Debug Instructions:</h4>
        <ol className="text-sm text-blue-700 space-y-1">
          <li>1. Enter an anime name (e.g., "Attack on Titan", "Demon Slayer")</li>
          <li>2. Click "Test Trailer Data"</li>
          <li>3. Check console logs for detailed debug info</li>
          <li>4. Look at the results above to see trailer data</li>
          <li>5. Check if "Mapped Trailer URL" shows embed URLs</li>
        </ol>
      </div>
    </div>
  )
}
