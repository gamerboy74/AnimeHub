import React, { memo, useMemo, useCallback } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { Grid } from 'react-window';
import type { CellComponentProps } from 'react-window';

interface VirtualizedGridProps<T> {
  items: T[];
  columnWidth: number | ((containerWidth: number) => number);
  rowHeight: number | ((containerWidth: number) => number);
  gap?: number;
  overscan?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

interface CellData {
  items: any[];
  columns: number;
  renderItem: (item: any, index: number) => React.ReactNode;
  gap: number;
}

const Cell = memo(({ columnIndex, rowIndex, style, ...props }: CellComponentProps<CellData>) => {
  const { items, columns, renderItem, gap } = props as CellData;
  const index = rowIndex * columns + columnIndex;
  if (index >= items.length) return null;
  
  const item = items[index];
  if (!item) return null;
  
  const adjusted = {
    ...style,
    left: ((style.left as number) ?? 0) + gap * columnIndex,
    top: ((style.top as number) ?? 0) + gap * rowIndex,
    width: ((style.width as number) ?? 0) - gap,
    height: ((style.height as number) ?? 0) - gap,
  } as React.CSSProperties;
  
  return <div style={adjusted}>{renderItem(item, index)}</div>;
});

Cell.displayName = 'VirtualizedGridCell';

export default function VirtualizedGrid<T>({ items, columnWidth, rowHeight, gap = 16, overscan = 2, renderItem }: VirtualizedGridProps<T>) {
  const dataItems = useMemo(() => items ?? [], [items]);
  
  // Memoize renderItem to prevent recreating on every render
  const memoizedRenderItem = useCallback(renderItem, [renderItem]);

  // If no items, render empty state
  if (dataItems.length === 0) {
    return (
      <div className="w-full flex items-center justify-center py-12">
        <p className="text-gray-500">No items to display</p>
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height: '100%', minHeight: 400 }}>
      <AutoSizer>
        {({ width, height }) => {
          if (!width || !height || width === 0 || height === 0) {
            return <div style={{ width, height: 400 }}>Loading...</div>;
          }

          const colWidth = typeof columnWidth === 'function' ? columnWidth(width) : columnWidth;
          const rowH = typeof rowHeight === 'function' ? rowHeight(width) : rowHeight;
          const columns = Math.max(1, Math.floor((width + gap) / (colWidth + gap)));
          const rows = Math.ceil(dataItems.length / columns);
          
          // Ensure we have at least 1 row
          if (rows === 0) return <div style={{ width, height }}>No rows to render</div>;
          
          // Create cellProps object (will be recreated on resize, which is fine)
          const cellProps: CellData = { 
            items: dataItems, 
            columns, 
            renderItem: memoizedRenderItem, 
            gap 
          };
          
          return (
            <Grid
              width={width}
              height={height}
              columnCount={columns}
              rowCount={rows}
              columnWidth={colWidth + gap}
              rowHeight={rowH + gap}
              overscanCount={overscan}
              cellComponent={Cell}
              cellProps={cellProps}
            />
          );
        }}
      </AutoSizer>
    </div>
  );
}


