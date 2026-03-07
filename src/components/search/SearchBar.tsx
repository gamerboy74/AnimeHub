import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useLiveSearch } from '../../hooks/utils/search';
import { SparkleLoadingSpinner } from '../base/LoadingSpinner';

interface SearchBarProps {
  placeholder?: string;
  className?: string;
}

export default function SearchBar({ 
  placeholder = "Search anime...", 
  className = "" 
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  
  const { results, loading, error } = useLiveSearch(query, 2);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  const handleResultClick = () => {
    setQuery('');
    setIsFocused(false);
  };

  const showResults = isFocused && query.length >= 2;

  return (
    <div className={`relative ${className}`}>
      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          className="w-full px-4 py-3 pr-12 text-sm bg-white/90 border border-teal-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all duration-200 shadow-sm"
        />
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          <i className="ri-search-line text-teal-600"></i>
        </div>
      </div>

      {/* Live Search Results */}
      <AnimatePresence>
        {showResults && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-teal-200 z-50 max-h-96 overflow-y-auto"
          >
            <div className="p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <SparkleLoadingSpinner size="sm" text="Searching..." />
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <i className="ri-error-warning-line text-2xl text-red-400 mb-2"></i>
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              ) : results.length > 0 ? (
                <div className="space-y-1">
                  <div className="text-xs text-teal-600 font-semibold mb-2 px-2">
                    <i className="ri-search-line mr-1"></i>
                    Anime Results
                  </div>
                  {results.map((anime) => (
                    <Link
                      key={anime.id}
                      to={`/anime/${anime.id}`}
                      onClick={handleResultClick}
                      className="block p-3 hover:bg-teal-50 rounded-lg transition-colors duration-200 group"
                    >
                      <div className="flex items-center gap-3">
                        {/* Anime Poster */}
                        <div className="flex-shrink-0">
                          <img
                            src={anime.poster_url || "https://readdy.ai/api/search-image?query=Anime%20poster%20default&width=60&height=80&seq=search-bar&orientation=portrait"}
                            alt={anime.title}
                            className="w-12 h-16 object-cover object-top rounded-lg"
                            width={48}
                            height={64}
                            loading="lazy"
                          />
                        </div>
                        
                        {/* Anime Info */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-teal-800 truncate group-hover:text-teal-900">
                            {anime.title}
                          </h3>
                          
                          <div className="flex items-center gap-2 mt-1">
                            {anime.year && (
                              <span className="text-xs text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">
                                {anime.year}
                              </span>
                            )}
                            {anime.rating && (
                              <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                <i className="ri-star-fill text-xs"></i>
                                {anime.rating}
                              </span>
                            )}
                            {anime.status && (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                anime.status === 'completed' ? 'bg-green-100 text-green-600' :
                                anime.status === 'ongoing' ? 'bg-blue-100 text-blue-600' :
                                'bg-yellow-100 text-yellow-600'
                              }`}>
                                {anime.status}
                              </span>
                            )}
                          </div>
                          
                          {anime.genres && anime.genres.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {anime.genres.slice(0, 2).map((genre, index) => (
                                <span key={index} className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                  {genre}
                                </span>
                              ))}
                              {anime.genres.length > 2 && (
                                <span className="text-xs text-gray-400">+{anime.genres.length - 2}</span>
                              )}
                            </div>
                          )}
                        </div>
                        
                        {/* Arrow Icon */}
                        <div className="flex-shrink-0">
                          <i className="ri-arrow-right-s-line text-teal-400 group-hover:text-teal-600 transition-colors duration-200"></i>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <i className="ri-search-line text-2xl text-teal-300 mb-2"></i>
                  <p className="text-sm text-teal-600">No anime found</p>
                  <p className="text-xs text-teal-500 mt-1">Try a different search term</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
