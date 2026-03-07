import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserService } from '../../services/user'
import { supabase } from '../../lib/database/supabase'
import { useCurrentUser } from '../../hooks/auth/selectors'

interface ReviewSectionProps {
  animeId: string
}

interface Review {
  id: string
  user_id: string
  anime_id: string
  rating: number
  review_text: string | null
  is_spoiler: boolean
  created_at: string
  updated_at: string
  user?: { id: string; username: string; avatar_url: string | null }
}

async function getAnimeReviews(animeId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select(`
      *,
      user:user_id (
        id,
        username,
        avatar_url
      )
    `)
    .eq('anime_id', animeId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to fetch anime reviews:', error)
    return []
  }
  return (data as Review[]) || []
}

type SortOption = 'newest' | 'highest' | 'lowest'

export default function ReviewSection({ animeId }: ReviewSectionProps) {
  const user = useCurrentUser()
  const queryClient = useQueryClient()
  const [rating, setRating] = useState(0)
  const [hoverRating, setHoverRating] = useState(0)
  const [reviewText, setReviewText] = useState('')
  const [isSpoiler, setIsSpoiler] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOption>('newest')
  const [revealedSpoilers, setRevealedSpoilers] = useState<Set<string>>(new Set())

  const reviewsKey = ['reviews', animeId]

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: reviewsKey,
    queryFn: () => getAnimeReviews(animeId),
    staleTime: 2 * 60 * 1000,
  })

  const addMutation = useMutation({
    mutationFn: () => UserService.addReview(user!.id, animeId, rating, reviewText || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewsKey })
      resetForm()
    },
  })

  const updateMutation = useMutation({
    mutationFn: () => UserService.updateReview(editingId!, rating, reviewText || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewsKey })
      resetForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (reviewId: string) => UserService.deleteReview(reviewId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: reviewsKey })
      resetForm()
    },
  })

  const resetForm = () => {
    setRating(0)
    setHoverRating(0)
    setReviewText('')
    setIsSpoiler(false)
    setEditingId(null)
  }

  const startEdit = (review: Review) => {
    setEditingId(review.id)
    setRating(review.rating)
    setReviewText(review.review_text || '')
    setIsSpoiler(review.is_spoiler)
  }

  const handleSubmit = () => {
    if (rating === 0) return
    if (editingId) {
      updateMutation.mutate()
    } else {
      addMutation.mutate()
    }
  }

  const sortedReviews = [...reviews].sort((a, b) => {
    if (sort === 'highest') return b.rating - a.rating
    if (sort === 'lowest') return a.rating - b.rating
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  const avgRating =
    reviews.length > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0

  const isSaving = addMutation.isPending || updateMutation.isPending

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = Date.now()
    const diffMs = now - d.getTime()
    const days = Math.floor(diffMs / 86400000)
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 30) return `${days}d ago`
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.7 }}
      className="mt-10 mb-16"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-teal-800 flex items-center">
          <i className="ri-chat-quote-line mr-3 text-yellow-500" />
          Reviews
          {reviews.length > 0 && (
            <span className="ml-3 text-base font-normal text-teal-600">
              ({reviews.length})
            </span>
          )}
        </h2>

        {reviews.length > 0 && (
          <div className="flex items-center gap-4">
            {/* Average rating */}
            <div className="flex items-center gap-1 text-yellow-500">
              <i className="ri-star-fill" />
              <span className="font-semibold text-teal-800">{avgRating.toFixed(1)}</span>
              <span className="text-sm text-teal-600">/10</span>
            </div>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="text-sm px-3 py-1.5 bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="newest">Newest</option>
              <option value="highest">Highest</option>
              <option value="lowest">Lowest</option>
            </select>
          </div>
        )}
      </div>

      {/* Write Review Form */}
      {user && !editingId && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-teal-200 p-6 mb-8">
          <h3 className="text-lg font-semibold text-teal-800 mb-4">Write a Review</h3>

          {/* Star Rating */}
          <div className="flex items-center gap-1 mb-4">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                className="transition-transform hover:scale-110"
              >
                <i
                  className={`ri-star-${
                    star <= (hoverRating || rating) ? 'fill' : 'line'
                  } text-2xl ${
                    star <= (hoverRating || rating) ? 'text-yellow-400' : 'text-teal-300'
                  }`}
                />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm text-teal-600 font-medium">{rating}/10</span>
            )}
          </div>

          {/* Text */}
          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Share your thoughts about this anime... (optional)"
            className="w-full p-3 bg-teal-50/50 border border-teal-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[100px]"
            maxLength={2000}
          />

          <div className="flex items-center justify-between mt-3">
            <label className="flex items-center gap-2 text-sm text-teal-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isSpoiler}
                onChange={(e) => setIsSpoiler(e.target.checked)}
                className="rounded border-teal-300 text-teal-600 focus:ring-teal-500"
              />
              Contains spoilers
            </label>

            <div className="flex gap-2">
              {editingId && (
                <button
                  onClick={resetForm}
                  className="px-4 py-2 text-sm text-teal-700 bg-teal-100 rounded-lg hover:bg-teal-200 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={rating === 0 || isSaving}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : editingId ? 'Update Review' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit form when user already has a review */}
      {user && editingId && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-teal-200 p-6 mb-8">
          <h3 className="text-lg font-semibold text-teal-800 mb-4">Edit Your Review</h3>

          <div className="flex items-center gap-1 mb-4">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
              <button
                key={star}
                type="button"
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(0)}
                onClick={() => setRating(star)}
                className="transition-transform hover:scale-110"
              >
                <i
                  className={`ri-star-${
                    star <= (hoverRating || rating) ? 'fill' : 'line'
                  } text-2xl ${
                    star <= (hoverRating || rating) ? 'text-yellow-400' : 'text-teal-300'
                  }`}
                />
              </button>
            ))}
            {rating > 0 && (
              <span className="ml-2 text-sm text-teal-600 font-medium">{rating}/10</span>
            )}
          </div>

          <textarea
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            placeholder="Share your thoughts about this anime... (optional)"
            className="w-full p-3 bg-teal-50/50 border border-teal-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[100px]"
            maxLength={2000}
          />

          <div className="flex items-center justify-between mt-3">
            <label className="flex items-center gap-2 text-sm text-teal-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isSpoiler}
                onChange={(e) => setIsSpoiler(e.target.checked)}
                className="rounded border-teal-300 text-teal-600 focus:ring-teal-500"
              />
              Contains spoilers
            </label>

            <div className="flex gap-2">
              <button
                onClick={resetForm}
                className="px-4 py-2 text-sm text-teal-700 bg-teal-100 rounded-lg hover:bg-teal-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={rating === 0 || isSaving}
                className="px-5 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : 'Update Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reviews List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-3 border-teal-300 border-t-teal-600 rounded-full animate-spin" />
        </div>
      ) : sortedReviews.length === 0 ? (
        <div className="text-center py-12 bg-white/60 rounded-2xl border border-teal-100">
          <i className="ri-chat-quote-line text-4xl text-teal-300 mb-3 block" />
          <p className="text-teal-600">No reviews yet. Be the first to share your thoughts!</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {sortedReviews.map((review) => {
              const isOwn = review.user_id === user?.id
              const spoilerHidden = review.is_spoiler && !revealedSpoilers.has(review.id)

              return (
                <motion.div
                  key={review.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`bg-white/80 backdrop-blur-sm rounded-xl border p-5 ${
                    isOwn ? 'border-teal-300 bg-teal-50/30' : 'border-teal-100'
                  }`}
                >
                  {/* Review header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-green-400 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                        {review.user?.avatar_url ? (
                          <img
                            src={review.user.avatar_url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          (review.user?.username?.[0] || '?').toUpperCase()
                        )}
                      </div>
                      <div>
                        <span className="font-medium text-teal-800 text-sm">
                          {review.user?.username || 'Anonymous'}
                          {isOwn && (
                            <span className="ml-2 text-xs font-normal text-teal-500">(you)</span>
                          )}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          {Array.from({ length: 10 }, (_, i) => (
                            <i
                              key={i}
                              className={`ri-star-${
                                i < review.rating ? 'fill' : 'line'
                              } text-xs ${
                                i < review.rating ? 'text-yellow-400' : 'text-teal-200'
                              }`}
                            />
                          ))}
                          <span className="ml-1 text-xs text-teal-500">{review.rating}/10</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-teal-400">{formatDate(review.created_at)}</span>
                      {isOwn && !editingId && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => startEdit(review)}
                            className="w-7 h-7 flex items-center justify-center text-teal-500 hover:text-teal-700 hover:bg-teal-100 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <i className="ri-edit-line text-sm" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(review.id)}
                            className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Review body */}
                  {review.review_text && (
                    <div className="relative">
                      {spoilerHidden ? (
                        <div
                          onClick={() =>
                            setRevealedSpoilers((s) => new Set(s).add(review.id))
                          }
                          className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg cursor-pointer hover:bg-red-100 transition-colors"
                        >
                          <div className="flex items-center gap-2 text-red-600 text-sm">
                            <i className="ri-eye-off-line" />
                            <span className="font-medium">Spoiler — click to reveal</span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-teal-700 leading-relaxed whitespace-pre-line">
                          {review.is_spoiler && (
                            <span className="inline-block px-2 py-0.5 text-xs bg-red-100 text-red-600 rounded mr-2 mb-1">
                              Spoiler
                            </span>
                          )}
                          {review.review_text}
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  )
}
