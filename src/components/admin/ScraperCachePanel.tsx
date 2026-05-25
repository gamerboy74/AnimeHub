import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScraperCacheService } from '../../services/scrapers/scraperCache';
import type { ScraperUrls } from '../../services/scrapers/scraperCache';

interface ScraperCachePanelProps {
  animeId: string | null;
  animeTitle: string;
  /** Which cache keys this scraper manages — e.g. ['reanime_sub','reanime_dub'] or ['nineanime'] */
  scraperKeys: string[];
  /** Display labels for each key — same order as scraperKeys */
  scraperLabels: string[];
  /** Accent colour class for borders/highlights, e.g. 'rose' or 'indigo' */
  accent: 'rose' | 'indigo';
}

const ACCENT = {
  rose: {
    border: 'border-rose-500/30',
    glow: 'shadow-rose-500/10',
    badge: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    badgeMiss: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    btn: 'bg-rose-600 hover:bg-rose-500 text-white',
    btnGhost: 'hover:bg-rose-500/10 text-rose-400 border-rose-500/20 hover:border-rose-500/40',
    icon: '🔴',
  },
  indigo: {
    border: 'border-indigo-500/30',
    glow: 'shadow-indigo-500/10',
    badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    badgeMiss: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    btn: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    btnGhost: 'hover:bg-indigo-500/10 text-indigo-400 border-indigo-500/20 hover:border-indigo-500/40',
    icon: '🔵',
  },
};

export const ScraperCachePanel: React.FC<ScraperCachePanelProps> = ({
  animeId,
  animeTitle,
  scraperKeys,
  scraperLabels,
  accent,
}) => {
  const c = ACCENT[accent];
  const [cache, setCache] = useState<ScraperUrls>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    if (!animeId) return;
    setLoading(true);
    try {
      const data = await ScraperCacheService.getCache(animeId);
      setCache(data);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, [animeId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (key: string) => {
    if (!animeId || !editVal.trim()) return;
    setSaving(true);
    try {
      const updated = await ScraperCacheService.saveCache(animeId, key, editVal.trim());
      setCache(updated);
      setEditing(null);
      flash('ok', 'URL cached ✓');
    } catch {
      flash('err', 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (key?: string) => {
    if (!animeId) return;
    setSaving(true);
    try {
      const updated = await ScraperCacheService.clearCache(animeId, key);
      setCache(updated);
      flash('ok', key ? `${key} cleared` : 'All cache cleared');
    } catch {
      flash('err', 'Clear failed');
    } finally {
      setSaving(false);
    }
  };

  if (!animeId) return null;

  const hasSome = scraperKeys.some(k => cache[k]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border ${c.border} bg-zinc-900/60 backdrop-blur-sm shadow-lg ${c.glow} p-4 space-y-3`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">⚡</span>
          <span className="text-sm font-semibold text-white">URL Cache</span>
          <span className="text-xs text-zinc-500">— {animeTitle}</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs text-zinc-500 animate-pulse">loading…</span>
          )}
          <button
            onClick={load}
            disabled={loading}
            title="Refresh cache"
            className={`text-xs border rounded-md px-2 py-0.5 transition-all ${c.btnGhost}`}
          >
            ↺ Refresh
          </button>
          {hasSome && (
            <button
              onClick={() => handleClear()}
              disabled={saving}
              title="Clear all cached URLs for this anime"
              className="text-xs border rounded-md px-2 py-0.5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition-all"
            >
              🗑 Clear All
            </button>
          )}
        </div>
      </div>

      {/* Flash message */}
      <AnimatePresence>
        {msg && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`text-xs px-3 py-1.5 rounded-lg ${msg.type === 'ok' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}
          >
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cache rows */}
      <div className="space-y-2">
        {scraperKeys.map((key, idx) => {
          const cached = cache[key];
          const label = scraperLabels[idx] || key;
          const isEditing = editing === key;

          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center gap-2">
                {/* Status badge */}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cached ? c.badge : c.badgeMiss}`}>
                  {cached ? '✓ HIT' : '✗ MISS'}
                </span>
                <span className="text-xs text-zinc-300 font-medium">{label}</span>
                <div className="flex-1" />
                {cached && !isEditing && (
                  <>
                    <button
                      onClick={() => { setEditing(key); setEditVal(cached); }}
                      className={`text-[10px] border rounded px-1.5 py-0.5 transition-all ${c.btnGhost}`}
                    >
                      ✏ Edit
                    </button>
                    <button
                      onClick={() => handleClear(key)}
                      disabled={saving}
                      className="text-[10px] border rounded px-1.5 py-0.5 border-red-500/20 text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition-all"
                    >
                      ✕ Clear
                    </button>
                  </>
                )}
                {!cached && !isEditing && (
                  <button
                    onClick={() => { setEditing(key); setEditVal(''); }}
                    className={`text-[10px] border rounded px-1.5 py-0.5 transition-all ${c.btnGhost}`}
                  >
                    + Set URL
                  </button>
                )}
              </div>

              {/* Cached URL display */}
              {cached && !isEditing && (
                <div className="ml-1 text-[11px] font-mono text-zinc-400 bg-zinc-800/60 rounded px-2 py-1 truncate" title={cached}>
                  {cached}
                </div>
              )}

              {/* Edit input */}
              <AnimatePresence>
                {isEditing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="flex gap-2 ml-1"
                  >
                    <input
                      value={editVal}
                      onChange={e => setEditVal(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSave(key)}
                      placeholder={`Paste URL for ${label}…`}
                      autoFocus
                      className="flex-1 text-xs bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400"
                    />
                    <button
                      onClick={() => handleSave(key)}
                      disabled={saving || !editVal.trim()}
                      className={`text-xs rounded-lg px-3 py-1.5 font-semibold transition-all ${c.btn} disabled:opacity-40`}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditing(null)}
                      className="text-xs rounded-lg px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-all"
                    >
                      Cancel
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <p className="text-[10px] text-zinc-600 leading-relaxed">
        Cached URLs are reused on the next batch scrape — skipping the search step entirely.
        The cache auto-fills when you first scrape a new anime.
      </p>
    </motion.div>
  );
};
