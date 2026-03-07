import { memo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import type { SeasonEntry } from '../../utils/anime/seasons'

interface SeasonTabsProps {
  seasons: SeasonEntry[]
  currentAnimeId: string
}

const KIND_ICON: Record<string, string> = {
  movie: 'ri-film-line',
  ova: 'ri-vidicon-line',
  ona: 'ri-live-line',
  special: 'ri-star-smile-line',
}

/**
 * Horizontal season / franchise tabs rendered above the episodes list.
 * Each tab links to the corresponding entry's detail page.
 * Only rendered when there are 2+ entries.
 */
function SeasonTabsInner({ seasons, currentAnimeId }: SeasonTabsProps) {
  if (seasons.length < 2) return null

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-teal-600 uppercase tracking-wider mb-3 flex items-center gap-2">
        <i className="ri-stack-line" aria-hidden="true" />
        Seasons &amp; Related
      </h3>
      <div
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-teal-300 scrollbar-track-transparent"
        role="tablist"
        aria-label="Anime seasons and related entries"
      >
        {seasons.map((season) => {
          const isActive = season.id === currentAnimeId
          const label = season.label
          const icon = season.kind !== 'season' ? KIND_ICON[season.kind] : undefined

          return isActive ? (
            <motion.button
              key={season.id}
              layoutId="active-season-tab"
              className={`relative flex-shrink-0 px-5 py-2.5 rounded-xl text-sm font-bold
                shadow-lg border cursor-default outline-none
                ${
                  season.kind === 'season'
                    ? 'bg-gradient-to-r from-teal-500 to-emerald-500 text-white shadow-teal-500/25 border-teal-400/50'
                    : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white shadow-purple-500/25 border-purple-400/50'
                }`}
              role="tab"
              aria-selected={true}
              aria-label={`${label} (current)`}
              tabIndex={0}
            >
              {icon && <i className={`${icon} mr-1.5`} aria-hidden="true" />}
              {label}
              {season.kind === 'season' && season.episodeCount != null && (
                <span className="ml-1.5 text-xs opacity-80">
                  ({season.episodeCount} ep)
                </span>
              )}
            </motion.button>
          ) : (
            <Link
              key={season.id}
              to={`/anime/${season.id}`}
              role="tab"
              aria-selected={false}
              aria-label={`Go to ${label}`}
              className={`flex-shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold
                transition-all duration-200 outline-none
                focus:ring-2 focus:ring-teal-500 focus:ring-offset-1
                ${
                  season.kind === 'season'
                    ? 'bg-white/70 text-teal-700 border border-teal-200 hover:bg-teal-50 hover:border-teal-400 hover:shadow-md'
                    : 'bg-purple-50/70 text-purple-700 border border-purple-200 hover:bg-purple-100 hover:border-purple-400 hover:shadow-md'
                }`}
            >
              {icon && <i className={`${icon} mr-1.5`} aria-hidden="true" />}
              {label}
              {season.kind === 'season' && season.episodeCount != null && (
                <span className="ml-1.5 text-xs text-teal-500/70">
                  ({season.episodeCount} ep)
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

const SeasonTabs = memo(SeasonTabsInner)
export default SeasonTabs
