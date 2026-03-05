import React, { useState, useCallback, useRef, useEffect, CSSProperties } from 'react';

export function useColumnResize(initialWidths: number[]) {
  const [widths, setWidths] = useState<number[]>(initialWidths);
  const dragging = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - dragging.current.startX;
    const newWidth = Math.max(40, dragging.current.startWidth + delta);
    setWidths(prev => {
      const next = [...prev];
      next[dragging.current!.colIndex] = newWidth;
      return next;
    });
  }, []);

  const onMouseUp = useCallback(() => {
    dragging.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startResize = useCallback((colIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { colIndex, startX: e.clientX, startWidth: widths[colIndex] };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [widths]);

  const getHeaderStyle = useCallback((colIndex: number): CSSProperties => ({
    width: widths[colIndex],
    position: 'relative',
  }), [widths]);

  const getCellStyle = useCallback((colIndex: number): CSSProperties => ({
    width: widths[colIndex],
    maxWidth: widths[colIndex],
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }), [widths]);

  const getTableStyle = useCallback((): CSSProperties => ({
    tableLayout: 'fixed' as const,
    minWidth: widths.reduce((a, b) => a + b, 0),
  }), [widths]);

  return { widths, startResize, getHeaderStyle, getCellStyle, getTableStyle };
}
