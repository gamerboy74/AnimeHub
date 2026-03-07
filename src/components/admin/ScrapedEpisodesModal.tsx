import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { HiAnimeScraperService } from '../../services/scrapers/hianime';

interface ScrapedEpisode {
  number: number;
  title: string;
  streamUrl: string;
  embeddingProtected: boolean;
  embeddingReason?: string;
  scrapedAt: string;
}

interface ScrapedEpisodesModalProps {
  isOpen: boolean;
  onClose: () => void;
  animeId: string;
  animeTitle: string;
  scrapedEpisodes: ScrapedEpisode[];
  failedEpisodes: Array<{
    number: number;
    title: string;
    error: string;
  }>;
  summary: {
    total: number;
    successful: number;
    failed: number;
    embeddingProtected: number;
  };
  onEpisodesAdded: () => void;
}

export const ScrapedEpisodesModal: React.FC<ScrapedEpisodesModalProps> = ({
  isOpen,
  onClose,
  animeId,
  animeTitle,
  scrapedEpisodes,
  failedEpisodes,
  summary,
  onEpisodesAdded
}) => {
  const [addingEpisodes, setAddingEpisodes] = useState<Set<number>>(new Set());
  const [addedEpisodes, setAddedEpisodes] = useState<Set<number>>(new Set());
  const [failedSaveEpisodes, setFailedSaveEpisodes] = useState<Map<number, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const addAllCancelledRef = useRef(false);

  // Check existing episodes in database when modal opens
  useEffect(() => {
    if (isOpen && animeId) {
      checkExistingEpisodes();
    }
  }, [isOpen, animeId]);

  const checkExistingEpisodes = async () => {
    try {
      setCheckingExisting(true);
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      
      const response = await fetch(`${API_BASE_URL}/api/anime/${animeId}/episodes`);
      
      if (!response.ok) {
        console.warn('Failed to check existing episodes');
        setCheckingExisting(false);
        return;
      }

      const data = await response.json();
      
      if (data.success && data.episodes) {
        // Mark episodes that already exist in database
        const existingEpisodeNumbers = new Set(
          data.episodes.map((ep: any) => ep.episode_number)
        );
        
        // Set episodes as already added
        setAddedEpisodes(existingEpisodeNumbers);
        
        console.log(`✅ Found ${existingEpisodeNumbers.size} existing episodes in database`);
      }
    } catch (error) {
      console.error('Error checking existing episodes:', error);
    } finally {
      setCheckingExisting(false);
    }
  };

  const handleAddEpisode = async (episode: ScrapedEpisode) => {
    try {
      setAddingEpisodes(prev => new Set(prev).add(episode.number));
      setError(null);

      const result = await HiAnimeScraperService.addScrapedEpisode(animeId, {
        number: episode.number,
        title: episode.title,
        streamUrl: episode.streamUrl,
        embeddingProtected: episode.embeddingProtected,
        embeddingReason: episode.embeddingReason
      });

      if (result.success) {
        setAddedEpisodes(prev => new Set(prev).add(episode.number));
        // Remove from failed save episodes if it was there
        setFailedSaveEpisodes(prev => {
          const newMap = new Map(prev);
          newMap.delete(episode.number);
          return newMap;
        });
        // Don't show success message for individual episodes when adding all
        // Only show for manual single episode additions
        if (!isAddingAll) {
          setSuccess(result.message || `Episode ${episode.number} added successfully!`);
          setTimeout(() => setSuccess(null), 3000);
        }
        onEpisodesAdded();
      } else {
        const errorMsg = result.error || 'Failed to add episode';
        setFailedSaveEpisodes(prev => new Map(prev).set(episode.number, errorMsg));
        setError(`Episode ${episode.number}: ${errorMsg}`);
        setTimeout(() => setError(null), 5000);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setFailedSaveEpisodes(prev => new Map(prev).set(episode.number, errorMsg));
      setError(`Episode ${episode.number}: ${errorMsg}`);
      setTimeout(() => setError(null), 5000);
    } finally {
      setAddingEpisodes(prev => {
        const newSet = new Set(prev);
        newSet.delete(episode.number);
        return newSet;
      });
    }
  };

  const handleAddAllEpisodes = async () => {
    // Only add episodes that don't already exist in database
    const episodesToAdd = scrapedEpisodes.filter(ep => !addedEpisodes.has(ep.number));
    
    if (episodesToAdd.length === 0) {
      setSuccess('✅ All episodes are already in the database!');
      setTimeout(() => setSuccess(null), 5000);
      return;
    }
    
    const failedCount = new Map<number, string>();
    
    setError(null);
    setSuccess(null);
    setIsAddingAll(true);
    addAllCancelledRef.current = false;
    
    for (const episode of episodesToAdd) {
      // Check if cancelled
      if (addAllCancelledRef.current) {
        console.log('Add all cancelled by user');
        setError('Adding episodes was cancelled.');
        setTimeout(() => setError(null), 5000);
        break;
      }
      
      try {
        setAddingEpisodes(prev => new Set(prev).add(episode.number));
        
        const result = await HiAnimeScraperService.addScrapedEpisode(animeId, {
          number: episode.number,
          title: episode.title,
          streamUrl: episode.streamUrl,
          embeddingProtected: episode.embeddingProtected,
          embeddingReason: episode.embeddingReason
        });

        if (result.success) {
          setAddedEpisodes(prev => new Set(prev).add(episode.number));
          // Remove from failed save episodes if it was there
          setFailedSaveEpisodes(prev => {
            const newMap = new Map(prev);
            newMap.delete(episode.number);
            return newMap;
          });
        } else {
          const errorMsg = result.error || 'Failed to add episode';
          failedCount.set(episode.number, errorMsg);
          setFailedSaveEpisodes(prev => new Map(prev).set(episode.number, errorMsg));
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        failedCount.set(episode.number, errorMsg);
        setFailedSaveEpisodes(prev => new Map(prev).set(episode.number, errorMsg));
      } finally {
        setAddingEpisodes(prev => {
          const newSet = new Set(prev);
          newSet.delete(episode.number);
          return newSet;
        });
      }
      
      // Small delay between additions
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    setIsAddingAll(false);
    
    // Show summary - only show success if ALL episodes were added
    if (!addAllCancelledRef.current) {
      const successCount = episodesToAdd.length - failedCount.size;
      const totalCount = episodesToAdd.length;
      
      if (failedCount.size > 0) {
        // Some episodes failed - show error/warning message
        setError(`⚠️ Only ${successCount} out of ${totalCount} episodes added successfully. ${failedCount.size} episode(s) failed. Check the list below and retry failed episodes.`);
        setTimeout(() => setError(null), 10000);
      } else if (successCount === totalCount && totalCount > 0) {
        // ALL episodes added successfully
        setSuccess(`✅ All ${totalCount} episodes added successfully!`);
        setTimeout(() => setSuccess(null), 5000);
      } else if (successCount === 0) {
        // All episodes failed
        setError(`❌ Failed to add all ${totalCount} episodes. Check the list below for error details.`);
        setTimeout(() => setError(null), 10000);
      }
    }
    
    onEpisodesAdded();
  };

  const handleCancelAddAll = () => {
    addAllCancelledRef.current = true;
    setIsAddingAll(false);
    setAddingEpisodes(new Set());
    setError('Adding episodes was cancelled. You can continue adding individually.');
    setTimeout(() => setError(null), 5000);
  };

  const handleClose = () => {
    if (isAddingAll || addingEpisodes.size > 0) {
      setShowCloseWarning(true);
    } else {
      onClose();
    }
  };

  const handleConfirmClose = () => {
    if (isAddingAll) {
      handleCancelAddAll();
    }
    setShowCloseWarning(false);
    onClose();
  };

  const getEmbeddingStatusColor = (isProtected: boolean) => {
    return isProtected ? 'text-red-600 bg-red-100' : 'text-green-600 bg-green-100';
  };

  const getEmbeddingStatusIcon = (isProtected: boolean) => {
    return isProtected ? '⚠️' : '✅';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Scraped Episodes</h2>
            <p className="text-gray-600 mt-1">{animeTitle}</p>
          </div>
          <button
            onClick={handleClose}
            disabled={isAddingAll}
            className={`text-gray-400 hover:text-gray-600 transition-colors p-2 rounded-full hover:bg-gray-100 ${
              isAddingAll ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            title={isAddingAll ? 'Cannot close while adding episodes' : 'Close'}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary Stats */}
        <div className="p-6 border-b border-gray-200">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{summary.total}</div>
              <div className="text-sm text-blue-600">Total Scraped</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{summary.successful}</div>
              <div className="text-sm text-green-600">Successfully Scraped</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{addedEpisodes.size}</div>
              <div className="text-sm text-purple-600">Already in DB</div>
            </div>
            <div className="bg-red-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
              <div className="text-sm text-red-600">Failed to Scrape</div>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">{summary.embeddingProtected}</div>
              <div className="text-sm text-yellow-600">Embedding Protected</div>
            </div>
          </div>
          {checkingExisting && (
            <div className="mt-4 text-center text-sm text-gray-600">
              <div className="inline-flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span>Checking existing episodes in database...</span>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-6 mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="mx-6 mt-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Actions */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Episodes</h3>
              {addedEpisodes.size > 0 && (
                <p className="text-sm text-gray-600 mt-1">
                  {addedEpisodes.size} episode(s) already exist in database - will be skipped
                </p>
              )}
            </div>
            <div className="flex space-x-2 items-center">
              {isAddingAll ? (
                <button
                  onClick={handleCancelAddAll}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Cancel Adding ({addingEpisodes.size} in progress)
                </button>
              ) : (
                <button
                  onClick={handleAddAllEpisodes}
                  disabled={
                    scrapedEpisodes.every(ep => addedEpisodes.has(ep.number)) || 
                    addingEpisodes.size > 0 ||
                    checkingExisting
                  }
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {checkingExisting 
                    ? 'Checking...'
                    : addingEpisodes.size > 0 
                    ? `Adding... (${addingEpisodes.size} remaining)` 
                    : `Add All Episodes (${scrapedEpisodes.filter(ep => !addedEpisodes.has(ep.number)).length} remaining)`}
                </button>
              )}
              {failedSaveEpisodes.size > 0 && (
                <span className="text-sm text-red-600 ml-2">
                  ⚠️ {failedSaveEpisodes.size} failed
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Episodes List */}
        <div className="p-6">
          <div className="space-y-4">
            {scrapedEpisodes.map((episode) => (
              <motion.div
                key={episode.number}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-lg p-4 border ${
                  failedSaveEpisodes.has(episode.number)
                    ? 'bg-red-50 border-red-200'
                    : addedEpisodes.has(episode.number)
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-sm">
                        {episode.number}
                      </span>
                      <h4 className="text-lg font-semibold text-gray-900">{episode.title}</h4>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getEmbeddingStatusColor(episode.embeddingProtected)}`}>
                        {getEmbeddingStatusIcon(episode.embeddingProtected)} {episode.embeddingProtected ? 'Protected' : 'Embeddable'}
                      </span>
                    </div>
                    
                    <div className="text-sm text-gray-600 mb-2">
                      <div className="break-all">
                        <strong>URL:</strong> {episode.streamUrl}
                      </div>
                      {episode.embeddingReason && (
                        <div className="mt-1">
                          <strong>Protection Reason:</strong> {episode.embeddingReason}
                        </div>
                      )}
                      <div className="mt-1">
                        <strong>Scraped:</strong> {new Date(episode.scrapedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {addedEpisodes.has(episode.number) ? (
                      <div className="flex flex-col items-end">
                        <span className="px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                          ✅ Already in DB
                        </span>
                        {!checkingExisting && (
                          <span className="text-xs text-gray-500 mt-1">No action needed</span>
                        )}
                      </div>
                    ) : failedSaveEpisodes.has(episode.number) ? (
                      <div className="flex flex-col items-end space-y-1">
                        <button
                          onClick={() => handleAddEpisode(episode)}
                          disabled={addingEpisodes.has(episode.number)}
                          className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                        >
                          {addingEpisodes.has(episode.number) ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Retrying...</span>
                            </>
                          ) : (
                            <>
                              <span>🔄</span>
                              <span>Retry</span>
                            </>
                          )}
                        </button>
                        <span className="text-xs text-red-600 max-w-[200px] text-right">
                          ❌ {failedSaveEpisodes.get(episode.number)}
                        </span>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleAddEpisode(episode)}
                        disabled={addingEpisodes.has(episode.number)}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                      >
                        {addingEpisodes.has(episode.number) ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Adding...</span>
                          </>
                        ) : (
                          <>
                            <span>➕</span>
                            <span>Add Episode</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
            
            {scrapedEpisodes.length === 0 && (
              <div className="text-center py-8">
                <div className="text-gray-400 text-4xl mb-2">📺</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Episodes Scraped</h3>
                <p className="text-gray-500">Try scraping again or check if the anime exists on 9anime.org.lv</p>
              </div>
            )}
          </div>

          {/* Failed Episodes */}
          {failedEpisodes.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Failed Episodes</h3>
              <div className="space-y-2">
                {failedEpisodes.map((episode) => (
                  <div key={episode.number} className="bg-red-50 rounded-lg p-3 border border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-red-900">Episode {episode.number}: {episode.title}</span>
                        <div className="text-sm text-red-600 mt-1">{episode.error}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-end space-x-3">
            {isAddingAll && (
              <div className="flex items-center text-sm text-orange-600 mr-auto">
                <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin mr-2"></div>
                Adding episodes in progress... Please wait
              </div>
            )}
            <button
              onClick={handleClose}
              disabled={isAddingAll}
              className={`px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors ${
                isAddingAll ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isAddingAll ? 'Adding...' : 'Close'}
            </button>
          </div>
        </div>

        {/* Close Warning Dialog */}
        {showCloseWarning && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            >
              <h3 className="text-xl font-bold text-gray-900 mb-4">⚠️ Episodes Are Being Added</h3>
              <p className="text-gray-600 mb-6">
                {isAddingAll 
                  ? `You are currently adding ${addingEpisodes.size} episodes. If you close now, the process will be cancelled and remaining episodes won't be saved.`
                  : `You have ${addingEpisodes.size} episode(s) being added. Closing now may interrupt the process.`}
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowCloseWarning(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Continue Adding
                </button>
                <button
                  onClick={handleConfirmClose}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Cancel & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
