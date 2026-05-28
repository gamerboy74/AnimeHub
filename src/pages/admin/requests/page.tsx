import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AdminService, type AnimeRequest } from '../../../services/admin'
import { AnimeImporterService } from '../../../services/anime/importer'
import { SparkleLoadingSpinner } from '../../../components/base/LoadingSpinner'

const PAGE_SIZE = 20

interface AnimeMatchCandidate {
  source: 'jikan'
  title: string
  posterUrl: string | null
  bannerUrl: string | null
  description: string | null
  year: number | null
  status: string | null
  type: string | null
  rating: number | null
  genres: string[]
  malId: number | null
  sourceUrl: string
  score: number
  rawData: any
  mappedData: any
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

function getStatusStyles(status: AnimeRequest['status']) {
  switch (status) {
    case 'approved':
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
    case 'rejected':
      return 'bg-rose-500/10 text-rose-700 border-rose-500/20'
    default:
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20'
  }
}

function buildCandidate(
  source: AnimeMatchCandidate['source'],
  rawData: any,
  mappedData: any,
  requestTitle: string,
): AnimeMatchCandidate {
  const title = mappedData.title || rawData?.title?.english || rawData?.title?.romaji || rawData?.title || requestTitle
  const sourceUrl = source === 'jikan'
    ? rawData?.url || (rawData?.mal_id ? `https://myanimelist.net/anime/${rawData.mal_id}` : '#')
    : rawData?.id ? `https://anilist.co/anime/${rawData.id}` : '#'

  const requestNorm = normalizeText(requestTitle)
  const titleCandidates = [
    title,
    mappedData.title_english,
    mappedData.title_romaji,
    mappedData.title_japanese,
  ].filter((value): value is string => Boolean(value))

  const isExactMatch = titleCandidates.some(candidate => normalizeText(candidate) === requestNorm)
  const isPartialMatch = titleCandidates.some(candidate => {
    const normalized = normalizeText(candidate)
    return normalized.includes(requestNorm) || requestNorm.includes(normalized)
  })

  const scoreBase = source === 'jikan' && mappedData.mal_id ? 70 : 60
  const score = scoreBase + (isExactMatch ? 30 : isPartialMatch ? 15 : 0)

  return {
    source,
    title,
    posterUrl: mappedData.poster_url || null,
    bannerUrl: mappedData.banner_url || null,
    description: mappedData.description || null,
    year: mappedData.year || null,
    status: mappedData.status || null,
    type: mappedData.type || null,
    rating: mappedData.rating || null,
    genres: mappedData.genres || [],
    malId: mappedData.mal_id || null,
    sourceUrl,
    score: source === 'jikan' && mappedData.mal_id && rawData?.mal_id === mappedData.mal_id ? 100 : score,
    rawData,
    mappedData,
  }
}

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<AnimeRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRequests, setTotalRequests] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [matchCandidates, setMatchCandidates] = useState<AnimeMatchCandidate[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)
  const [importingKey, setImportingKey] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const matchCacheRef = useRef<Map<string, AnimeMatchCandidate[]>>(new Map())

  const fetchRequests = async () => {
    try {
      setLoading(true)
      setError(null)

      const result = await AdminService.getAnimeRequests(currentPage, PAGE_SIZE, {
        search: searchTerm,
        status: statusFilter,
      })

      setRequests(result.requests)
      setTotalRequests(result.total)
    } catch (err) {
      console.error('Failed to fetch anime requests:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch anime requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchTerm(searchInput)
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [searchInput])

  useEffect(() => {
    void fetchRequests()
  }, [currentPage, searchTerm, statusFilter])

  useEffect(() => {
    if (requests.length === 0) {
      setSelectedRequestId(null)
      return
    }

    const stillVisible = selectedRequestId ? requests.some(request => request.id === selectedRequestId) : false
    if (!stillVisible) {
      setSelectedRequestId(requests[0].id)
    }
  }, [requests, selectedRequestId])

  const selectedRequest = useMemo(
    () => requests.find(request => request.id === selectedRequestId) || null,
    [requests, selectedRequestId]
  )

  useEffect(() => {
    if (!selectedRequest) {
      setMatchCandidates([])
      return
    }

    const cacheKey = `${selectedRequest.id}:${normalizeText(selectedRequest.title)}:${selectedRequest.mal_id ?? 'no-mal'}`
    const cached = matchCacheRef.current.get(cacheKey)
    if (cached) {
      setMatchCandidates(cached)
      setMatchError(null)
      setMatchLoading(false)
      return
    }

    let cancelled = false

    const loadMatches = async () => {
      try {
        setMatchLoading(true)
        setMatchError(null)

        const candidates: AnimeMatchCandidate[] = []
        const jikanSource = selectedRequest.mal_id
          ? await AnimeImporterService.getJikanAnimeByMalId(selectedRequest.mal_id)
          : (await AnimeImporterService.searchJikanAnime(selectedRequest.title, 1, 1))[0] || null

        if (jikanSource) {
          candidates.push(buildCandidate('jikan', jikanSource, AnimeImporterService.mapJikanToDatabase(jikanSource), selectedRequest.title))
        }

        const uniqueCandidates = Array.from(
          new Map(candidates.map(candidate => [candidate.source + ':' + candidate.title, candidate])).values()
        ).sort((a, b) => b.score - a.score)

        if (!cancelled) {
          matchCacheRef.current.set(cacheKey, uniqueCandidates)
          setMatchCandidates(uniqueCandidates)
        }
      } catch (err) {
        if (!cancelled) {
          setMatchError(err instanceof Error ? err.message : 'Failed to fetch anime matches')
          setMatchCandidates([])
        }
      } finally {
        if (!cancelled) {
          setMatchLoading(false)
        }
      }
    }

    void loadMatches()

    return () => {
      cancelled = true
    }
  }, [selectedRequest])

  const totalPages = Math.max(1, Math.ceil(totalRequests / PAGE_SIZE))

  const handleRefresh = () => {
    void fetchRequests()
  }

  const handleImportCandidate = async (request: AnimeRequest, candidate: AnimeMatchCandidate) => {
    const key = `${request.id}:${candidate.source}`
    try {
      setImportingKey(key)
      setActionMessage(null)

      const imported = await AnimeImporterService.importAnime(candidate.mappedData, { skipAutoScrape: true })

      if (!imported) {
        throw new Error('Import did not return a saved anime record')
      }

      await AdminService.updateAnimeRequestStatus(request.id, 'approved')

      setRequests(prev => prev.map(item => (
        item.id === request.id
          ? { ...item, status: 'approved', updated_at: new Date().toISOString() }
          : item
      )))

      setActionMessage(`Imported "${candidate.title}" and marked "${request.title}" as added.`)
      setSelectedRequestId(request.id)
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to import anime')
    } finally {
      setImportingKey(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50/20 to-indigo-50/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="bg-white/80 backdrop-blur-md rounded-2xl border border-white/20 shadow-xl p-6 sm:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-tr from-teal-500 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-teal-500/20">
                <i className="ri-inbox-archive-line text-white text-2xl"></i>
              </div>
              <div>
                <h1 className="text-3xl font-extrabold bg-gradient-to-r from-teal-800 to-indigo-900 bg-clip-text text-transparent">
                  Request Hub
                </h1>
                <p className="text-slate-500 mt-1 font-medium">
                  Review, match, and import user-submitted anime requests ({totalRequests} total)
                </p>
              </div>
            </div>

            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 shadow-md hover:shadow-lg text-slate-700 font-semibold transition-all duration-200"
            >
              <i className="ri-refresh-line text-lg"></i>
              Sync Requests
            </button>
          </div>
        </motion.div>

        {/* Global Toast Alert */}
        <AnimatePresence>
          {actionMessage && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.95 }}
              className="mb-6 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 text-emerald-800 p-4 rounded-xl shadow-md flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-600">
                  <i className="ri-checkbox-circle-line text-lg"></i>
                </div>
                <span className="font-semibold text-slate-800">{actionMessage}</span>
              </div>
              <button 
                onClick={() => setActionMessage(null)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <i className="ri-close-line text-xl"></i>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filters and Search Workspace */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white/20 p-5 mb-6"
        >
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl mb-4 flex items-center gap-2">
              <i className="ri-error-warning-line text-lg"></i>
              <span className="font-medium">{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="request-search" className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                <i className="ri-search-line"></i>
                Filter by Keywords
              </label>
              <input
                id="request-search"
                type="text"
                value={searchInput}
                onChange={(event) => {
                  setCurrentPage(1)
                  setSearchInput(event.target.value)
                }}
                placeholder="Search by title, notes, or requester name..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/90 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-medium"
              />
            </div>

            <div>
              <label htmlFor="request-status" className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">
                <i className="ri-filter-3-line"></i>
                Request Status
              </label>
              <select
                id="request-status"
                value={statusFilter}
                onChange={(event) => {
                  setCurrentPage(1)
                  setStatusFilter(event.target.value)
                }}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white/90 text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all font-semibold"
              >
                <option value="all">All Submissions</option>
                <option value="pending">⏳ Pending Reviews</option>
                <option value="approved">✅ Approved</option>
                <option value="rejected">❌ Rejected</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* Master-Detail Layout */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,400px),minmax(0,1fr)] items-start">
          {/* Left Master List */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white/20 overflow-hidden"
          >
            {loading ? (
              <div className="min-h-[460px] flex items-center justify-center">
                <SparkleLoadingSpinner size="lg" text="Loading submissions..." />
              </div>
            ) : requests.length === 0 ? (
              <div className="min-h-[460px] flex items-center justify-center p-8 text-center">
                <div>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-500 shadow-inner">
                    <i className="ri-inbox-line text-3xl"></i>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 mb-2">No Requests Found</h2>
                  <p className="text-slate-500 max-w-xs mx-auto text-sm">
                    No community submissions match your current filters.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col max-h-[calc(100vh-270px)] min-h-[500px]">
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                  {requests.map((request) => {
                    const isSelected = request.id === selectedRequestId
                    const isAdded = request.status === 'approved'

                    return (
                      <button
                        key={request.id}
                        onClick={() => setSelectedRequestId(request.id)}
                        className={`group w-full text-left rounded-xl border p-4 transition-all duration-200 shadow-sm ${
                          isSelected
                            ? 'border-teal-500 bg-teal-50/50 shadow-md ring-2 ring-teal-500/10'
                            : 'border-slate-100 bg-white hover:border-slate-200 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase ${getStatusStyles(request.status)}`}>
                            {request.status}
                          </span>
                          <div className="flex items-center gap-1 text-[11px] font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100 group-hover:scale-105 transition-transform duration-200">
                            <i className="ri-thumb-up-line"></i>
                            {request.vote_count} votes
                          </div>
                        </div>

                        <h3 className={`font-bold text-slate-800 line-clamp-1 group-hover:text-teal-700 transition-colors ${isSelected ? 'text-teal-800' : ''}`}>
                          {request.title}
                        </h3>

                        {request.notes && (
                          <p className="text-xs text-slate-500 line-clamp-1 mt-1 font-medium">
                            {request.notes}
                          </p>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-3 pt-2.5 border-t border-slate-100">
                          <span className="font-semibold text-slate-500">By {request.requester?.username || 'Deleted User'}</span>
                          <span>{new Intl.DateTimeFormat('en', { dateStyle: 'short' }).format(new Date(request.created_at))}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3.5 border-t border-slate-200 bg-slate-50/60">
                    <span className="text-xs font-semibold text-slate-500">
                      Page {currentPage} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>

          {/* Right Detail comparison */}
          <div className="min-h-[500px]">
            {selectedRequest ? (
              <motion.div
                key={selectedRequest.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="bg-white/80 backdrop-blur-md rounded-2xl shadow-xl border border-white/20 overflow-hidden xl:sticky xl:top-8"
              >
                {/* Request Header */}
                <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-teal-50/30 to-indigo-50/30">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border tracking-wider uppercase ${getStatusStyles(selectedRequest.status)}`}>
                      {selectedRequest.status}
                    </span>
                    {selectedRequest.mal_id && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-700 border border-blue-500/20">
                        MAL ID: {selectedRequest.mal_id}
                      </span>
                    )}
                  </div>

                  <h2 className="text-2xl font-extrabold text-slate-800 leading-tight">
                    {selectedRequest.title}
                  </h2>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 text-xs font-medium text-slate-500">
                    <div className="flex items-center gap-1">
                      <i className="ri-user-follow-line text-slate-400"></i>
                      <span>Requested by <strong className="text-slate-700">{selectedRequest.requester?.username || 'Deleted User'}</strong></span>
                      {selectedRequest.requester?.email && <span className="text-slate-400">({selectedRequest.requester.email})</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <i className="ri-calendar-event-line text-slate-400"></i>
                      <span>Submitted {formatDate(selectedRequest.created_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Main comparison grid */}
                <div className="p-6 space-y-6">
                  {selectedRequest.notes && (
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 relative">
                      <div className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1">Requester Notes</div>
                      <p className="text-sm text-slate-600 italic">
                        "{selectedRequest.notes}"
                      </p>
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs uppercase tracking-wider font-extrabold text-slate-400 mb-4 flex items-center gap-1.5">
                      <i className="ri-bubble-chart-line text-teal-500"></i>
                      Jikan / MAL Matching Comparison
                    </h3>

                    {matchLoading ? (
                      <div className="min-h-[300px] flex flex-col items-center justify-center rounded-xl border border-slate-100 bg-slate-50/50">
                        <SparkleLoadingSpinner size="lg" text="Searching API matches..." />
                      </div>
                    ) : matchError ? (
                      <div className="min-h-[200px] flex items-center justify-center rounded-xl border border-rose-100 bg-rose-50/50 p-6 text-center text-rose-700">
                        <div>
                          <i className="ri-error-warning-line text-3xl mb-2"></i>
                          <h4 className="font-bold mb-1">Failed to query candidate matches</h4>
                          <p className="text-xs text-rose-600">{matchError}</p>
                        </div>
                      </div>
                    ) : matchCandidates.length === 0 ? (
                      <div className="min-h-[200px] flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                        <div>
                          <i className="ri-search-eye-line text-3xl text-slate-300 mb-2"></i>
                          <h4 className="font-bold text-slate-700 mb-1">No API Match Discovered</h4>
                          <p className="text-xs text-slate-500 max-w-xs">
                            We couldn't find a corresponding anime on MyAnimeList. Double check the title or add an explicit MAL ID.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {matchCandidates.map((candidate) => {
                          const candidateKey = `${selectedRequest.id}:${candidate.source}`
                          const isImporting = importingKey === candidateKey

                          return (
                            <div key={candidateKey} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md flex flex-col">
                              {/* Hero cover image */}
                              <div className="relative h-44 bg-slate-800">
                                <img
                                  src={candidate.bannerUrl || candidate.posterUrl || "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800"}
                                  alt={candidate.title}
                                  className="h-full w-full object-cover opacity-85"
                                  loading="lazy"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent" />
                                
                                <div className="absolute top-3 left-3 flex gap-2">
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-500 text-white shadow-sm tracking-wider uppercase">
                                    Jikan / MAL
                                  </span>
                                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-white/95 text-slate-800 shadow-sm border border-slate-200 flex items-center gap-1">
                                    <i className="ri-heart-pulse-line text-rose-500"></i>
                                    Match Score: {candidate.score}%
                                  </span>
                                </div>

                                <div className="absolute bottom-3 left-4 right-4 text-white">
                                  <h4 className="text-xl font-extrabold leading-tight line-clamp-1">
                                    {candidate.title}
                                  </h4>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/80 font-medium">
                                    {candidate.year && <span>{candidate.year}</span>}
                                    {candidate.type && <span className="capitalize border-l border-white/20 pl-2">{candidate.type}</span>}
                                    {candidate.status && <span className="capitalize border-l border-white/20 pl-2">{candidate.status}</span>}
                                    {candidate.rating && <span className="border-l border-white/20 pl-2 flex items-center gap-0.5"><i className="ri-star-fill text-yellow-400"></i>{candidate.rating.toFixed(1)}</span>}
                                  </div>
                                </div>
                              </div>

                              {/* Candidate Info Body */}
                              <div className="p-5 flex flex-col flex-1 gap-4">
                                <div className="flex flex-wrap gap-1.5">
                                  {candidate.genres.slice(0, 4).map((genre) => (
                                    <span key={genre} className="px-2.5 py-1 rounded-full bg-slate-100 border border-slate-150 text-slate-600 text-xs font-semibold">
                                      {genre}
                                    </span>
                                  ))}
                                </div>

                                <p className="text-xs text-slate-500 leading-relaxed line-clamp-3 min-h-[3.25rem]">
                                  {candidate.description || 'No summary is available for this match candidate.'}
                                </p>

                                <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-slate-100">
                                  <button
                                    onClick={() => handleImportCandidate(selectedRequest, candidate)}
                                    disabled={isImporting || selectedRequest.status === 'approved'}
                                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-teal-500 to-indigo-600 hover:from-teal-600 hover:to-indigo-700 text-white text-sm font-bold shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isImporting ? (
                                      <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Importing...
                                      </>
                                    ) : (
                                      <>
                                        <i className="ri-download-cloud-2-line text-base"></i>
                                        {selectedRequest.status === 'approved' ? 'Already Imported' : 'Import Anime to DB'}
                                      </>
                                    )}
                                  </button>

                                  <a
                                    href={candidate.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-bold transition-colors"
                                  >
                                    <i className="ri-external-link-line"></i>
                                    MAL Profile
                                  </a>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="min-h-[500px] flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center sticky top-8">
                <div>
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-teal-50/50 flex items-center justify-center text-teal-400">
                    <i className="ri-cursor-line text-3xl"></i>
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-1">Select an Anime Request</h3>
                  <p className="text-xs text-slate-400 max-w-xs mx-auto">
                    Click a request from the list on the left to activate comparison, verification, and API sync.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}