import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useAnimeRelations, useAnimeByTitleSimilarity } from '../../hooks/anime/relations'

interface RelatedAnimeItem {
  id: string
  title: string
  title_japanese?: string
  poster_url?: string
  year: number
  type: string
  status: string
  total_episodes?: number
  rating?: number
  genres: string[]
  relation_type?: string
}

interface RelatedAnimeProps {
  animeId: string
  currentTitle: string
  currentGenres: string[]
}

export default function RelatedAnime({ animeId, currentTitle, currentGenres }: RelatedAnimeProps) {
  const [activeTab, setActiveTab] = useState<'similar' | 'sequels' | 'prequels' | 'ovas'>('similar')
  
  // Use the real backend services
  const { relatedAnime, similarAnime, loading, error } = useAnimeRelations(animeId)
  const { anime: titleSimilarAnime, loading: titleLoading } = useAnimeByTitleSimilarity(currentTitle, animeId, 8)


  const getFilteredAnime = () => {
    switch (activeTab) {
      case 'sequels':
        // Get sequels from related anime and title similar anime
        const sequelRelations = relatedAnime.filter(rel => rel.relation_type === 'sequel')
        const sequelAnime = sequelRelations.map(rel => rel.related_anime).filter(Boolean)
        return [...sequelAnime, ...titleSimilarAnime.filter(anime => 
          anime.year > new Date().getFullYear() - 5
        )].slice(0, 8)
      
      case 'prequels':
        // Get prequels from related anime
        const prequelRelations = relatedAnime.filter(rel => rel.relation_type === 'prequel')
        const prequelAnime = prequelRelations.map(rel => rel.related_anime).filter(Boolean)
        return [...prequelAnime, ...titleSimilarAnime.filter(anime => 
          anime.year < new Date().getFullYear() - 5
        )].slice(0, 8)
      
      case 'ovas':
        // Get OVAs and movies from similar anime
        return similarAnime.filter(anime => 
          ['ova', 'movie', 'special'].includes(anime.type)
        ).slice(0, 8)
      
      default:
        // Return similar anime by genres
        return similarAnime.slice(0, 8)
    }
  }

  if (loading || titleLoading) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
            <i className="ri-links-line mr-3 text-purple-500"></i>
            Related Content
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...Array(8)].map((_, index) => (
            <div key={index} className="animate-pulse">
              <div className="aspect-[3/4] bg-teal-200 rounded-lg"></div>
              <div className="mt-2 h-4 bg-teal-200 rounded"></div>
            </div>
          ))}
        </div>
      </motion.section>
    )
  }

  if (similarAnime.length === 0 && titleSimilarAnime.length === 0) {
    return null
  }

  const filteredAnime = getFilteredAnime()

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="mb-12"
    >
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
          <i className="ri-links-line mr-3 text-purple-500"></i>
          Related Content
        </h2>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6">
        {[
          { key: 'similar', label: 'Similar', icon: 'ri-compass-3-line' },
          { key: 'sequels', label: 'Sequels', icon: 'ri-arrow-right-line' },
          { key: 'prequels', label: 'Prequels', icon: 'ri-arrow-left-line' },
          { key: 'ovas', label: 'OVAs & Movies', icon: 'ri-movie-line' }
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center px-4 py-2 rounded-full font-medium transition-all duration-300 ${
              activeTab === tab.key
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg'
                : 'bg-teal-50 text-teal-600 hover:bg-teal-100'
            }`}
          >
            <i className={`${tab.icon} mr-2`}></i>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-6">
        <AnimatePresence>
          {filteredAnime.map((anime, index) => (
            <motion.div
              key={anime.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ delay: index * 0.1 }}
              className="group"
            >
              <Link to={`/anime/${anime.id}`}>
                <div className="relative overflow-hidden rounded-xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105">
                  <div className="aspect-[3/4] bg-gradient-to-br from-gray-200 to-gray-300">
                    {anime.poster_url ? (
                      <img
                        src={anime.poster_url}
                        alt={anime.title}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        width={300}
                        height={400}
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-teal-500">
                        <i className="ri-image-line text-4xl"></i>
                      </div>
                    )}
                  </div>
                  
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h3 className="text-white font-semibold text-sm mb-1 line-clamp-2">
                        {anime.title}
                      </h3>
                      <div className="flex items-center justify-between text-xs text-white/70">
                        <span className="bg-blue-600 px-2 py-1 rounded">
                          {anime.year}
                        </span>
                        <span className="bg-purple-600 px-2 py-1 rounded">
                          {anime.type?.toUpperCase()}
                        </span>
                      </div>
                      {anime.rating && (
                        <div className="mt-2 flex items-center text-yellow-400">
                          <i className="ri-star-fill text-xs mr-1"></i>
                          <span className="text-xs font-medium">{anime.rating}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Type Badge */}
                  <div className="absolute top-2 left-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      anime.type === 'movie' ? 'bg-red-600 text-white' :
                      anime.type === 'ova' ? 'bg-orange-600 text-white' :
                      anime.type === 'special' ? 'bg-green-600 text-white' :
                      'bg-blue-600 text-white'
                    }`}>
                      {anime.type?.toUpperCase()}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div className="absolute top-2 right-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      anime.status === 'completed' ? 'bg-green-600 text-white' :
                      anime.status === 'ongoing' ? 'bg-blue-600 text-white' :
                      'bg-yellow-600 text-white'
                    }`}>
                      {anime.status?.charAt(0).toUpperCase() + anime.status?.slice(1)}
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {filteredAnime.length === 0 && (
        <div className="text-center py-12">
          <i className="ri-search-line text-6xl text-teal-300 mb-4"></i>
          <p className="text-teal-500 text-lg">No {activeTab} found</p>
        </div>
      )}
    </motion.section>
  )
}
