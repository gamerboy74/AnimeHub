import React, { memo, useMemo } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { List, RowComponentProps } from 'react-window';

export interface EpisodeItem {
  episode_number: number;
  title?: string;
  video_url?: string;
  created_at?: string;
}

interface VirtualizedEpisodeListProps {
  episodes: EpisodeItem[];
  rowHeight?: number;
  overscan?: number;
  onSelect?: (episode: EpisodeItem) => void;
}

interface RowData {
  items: EpisodeItem[];
  onSelect?: (episode: EpisodeItem) => void;
}

const Row = memo(({ index, style, ...props }: RowComponentProps<RowData>) => {
  const { items, onSelect } = props;
  const episode: EpisodeItem = items[index];
  
  return (
    <div style={style} className="px-3">
      <button
        onClick={() => onSelect && onSelect(episode)}
        className="w-full text-left bg-white/95 hover:bg-teal-50 border border-green-200 rounded-lg p-3 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded bg-teal-100 text-teal-700 flex items-center justify-center font-semibold">
              {episode.episode_number}
            </span>
            <div>
              <div className="text-teal-800 font-medium truncate">
                {episode.title || `Episode ${episode.episode_number}`}
              </div>
              {episode.created_at && (
                <div className="text-xs text-teal-600">{new Date(episode.created_at).toLocaleString()}</div>
              )}
            </div>
          </div>
          <i className="ri-play-line text-teal-500"></i>
        </div>
      </button>
    </div>
  );
});

export default function VirtualizedEpisodeList({ episodes, rowHeight = 64, overscan = 6, onSelect }: VirtualizedEpisodeListProps) {
  const items = useMemo(() => episodes ?? [], [episodes]);

  return (
    <div className="w-full h-full" style={{ minHeight: 300 }}>
      <AutoSizer>
        {({ width, height }) => {
          const rowProps: RowData = { items, onSelect };
          
          return (
            <List
              width={width}
              height={height}
              rowCount={items.length}
              rowHeight={rowHeight}
              overscanCount={overscan}
              rowComponent={Row}
              rowProps={rowProps}
            />
          );
        }}
      </AutoSizer>
    </div>
  );
}


