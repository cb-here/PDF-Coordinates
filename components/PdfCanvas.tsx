import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Page, pdfjs } from 'react-pdf';
import { Check, X, Circle } from 'lucide-react';
import {
  AnnotationPoint,
  ElementType,
  PageDimensions,
  DEFAULT_SIZES,
  DEFAULT_COLORS,
} from '../types';

// Configure worker for react-pdf
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfCanvasProps {
  pageNumber: number;
  scale: number;
  annotations: AnnotationPoint[];
  pageDimensions: PageDimensions | null;
  selectedId: string | null;
  hoveredId: string | null;
  isPanning: boolean;
  activeTool: ElementType;
  onAddAnnotation: (ann: AnnotationPoint) => void;
  onSelectAnnotation: (id: string) => void;
  onHoverAnnotation: (id: string | null) => void;
  onBeginGesture: () => void;
  onUpdateAnnotationPosition: (id: string, x: number, y: number) => void;
  onUpdateAnnotationSize: (id: string, size: number) => void;
  onUpdateAnnotationText: (id: string, text: string) => void;
  onPageLoadSuccess: (page: any) => void;
}

export const PdfCanvas: React.FC<PdfCanvasProps> = ({
  pageNumber,
  scale,
  annotations,
  pageDimensions,
  selectedId,
  hoveredId,
  isPanning,
  activeTool,
  onAddAnnotation,
  onSelectAnnotation,
  onHoverAnnotation,
  onBeginGesture,
  onUpdateAnnotationPosition,
  onUpdateAnnotationSize,
  onUpdateAnnotationText,
  onPageLoadSuccess,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const lastDragEndTime = useRef<number>(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Dragging State
  const [dragState, setDragState] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialPdfX: number;
    initialPdfY: number;
    moved: boolean;
  } | null>(null);

  // Resizing State (drag a corner handle to change element size)
  const [resizeState, setResizeState] = useState<{
    id: string;
    startX: number;
    startY: number;
    initialSize: number;
    committed: boolean;
  } | null>(null);

  const MIN_SIZE = 6;
  const MAX_SIZE = 200;

  // Filter annotations for this page
  const pageAnnotations = annotations.filter((a) => a.pageIndex === pageNumber);

  // Handle dragging logic via window listeners to ensure smooth drag even if mouse leaves element
  useEffect(() => {
    if (!dragState) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragState.startX;
      const deltaY = e.clientY - dragState.startY;

      const pdfDeltaX = deltaX / scale;
      const pdfDeltaY = -(deltaY / scale); // Screen Y is inverted vs PDF Y

      let newX = dragState.initialPdfX + pdfDeltaX;
      let newY = dragState.initialPdfY + pdfDeltaY;

      if (pageDimensions) {
        newX = Math.max(0, Math.min(newX, pageDimensions.width));
        newY = Math.max(0, Math.min(newY, pageDimensions.height));
      }

      // Track that a real movement happened so we can distinguish drag from click.
      // Commit history exactly once, on the first real move of the gesture.
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        if (!dragState.moved) onBeginGesture();
        dragState.moved = true;
      }

      onUpdateAnnotationPosition(dragState.id, newX, newY);
    };

    const handleWindowMouseUp = () => {
      if (dragState.moved) {
        lastDragEndTime.current = Date.now();
      }
      setDragState(null);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragState, scale, pageDimensions, onUpdateAnnotationPosition, onBeginGesture]);

  // Handle resizing via window listeners.
  useEffect(() => {
    if (!resizeState) return;

    const handleResizeMove = (e: MouseEvent) => {
      // Grow when dragging down-right, shrink up-left. Use the larger axis delta.
      const dx = e.clientX - resizeState.startX;
      const dy = e.clientY - resizeState.startY;
      const delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) / scale;

      let newSize = resizeState.initialSize + delta;
      newSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, newSize));

      if (!resizeState.committed && Math.abs(delta) > 1) {
        onBeginGesture(); // one undo entry for the whole resize
        resizeState.committed = true;
      }

      onUpdateAnnotationSize(resizeState.id, Math.round(newSize));
    };

    const handleResizeUp = () => {
      if (resizeState.committed) lastDragEndTime.current = Date.now();
      setResizeState(null);
    };

    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeUp);

    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeUp);
    };
  }, [resizeState, scale, onUpdateAnnotationSize, onBeginGesture]);

  const handleResizeMouseDown = (e: React.MouseEvent, ann: AnnotationPoint) => {
    e.stopPropagation();
    e.preventDefault();
    if (isPanning) return;
    setResizeState({
      id: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      initialSize: ann.size,
      committed: false,
    });
  };

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Prevent adding element if we are panning or just finished a drag
      if (isPanning) return;
      if (Date.now() - lastDragEndTime.current < 150) return;
      if (editingId) return;

      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;

      const unscaledX = offsetX / scale;
      const unscaledY = offsetY / scale;

      const pageHeightPoints = rect.height / scale;

      // Standard PDF: Bottom-Left origin
      const pdfX = unscaledX;
      const pdfY = pageHeightPoints - unscaledY;

      const newId = Math.random().toString(36).slice(2) + Date.now().toString(36);

      const newAnnotation: AnnotationPoint = {
        id: newId,
        type: activeTool,
        pageIndex: pageNumber,
        x: pdfX,
        y: pdfY,
        displayX: unscaledX,
        displayY: unscaledY,
        size: DEFAULT_SIZES[activeTool],
        color: DEFAULT_COLORS[activeTool],
        text: activeTool === ElementType.TEXT ? 'Text' : undefined,
      };

      onAddAnnotation(newAnnotation);

      // Immediately enter edit mode for text elements
      if (activeTool === ElementType.TEXT) {
        setEditingId(newId);
      }
    },
    [pageNumber, scale, onAddAnnotation, isPanning, activeTool, editingId]
  );

  const handleAnnotationMouseDown = (e: React.MouseEvent, ann: AnnotationPoint) => {
    e.stopPropagation();
    if (isPanning) return;
    if (editingId === ann.id) return; // Don't drag while editing text

    onSelectAnnotation(ann.id);

    setDragState({
      id: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      initialPdfX: ann.x,
      initialPdfY: ann.y,
      moved: false,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning || dragState) {
      setHoverPos(null);
      return;
    }
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHoverPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  const handleMouseLeave = () => {
    setHoverPos(null);
  };

  // Determine cursor style
  let cursorStyle = 'cursor-crosshair';
  if (dragState) cursorStyle = 'cursor-grabbing';
  else if (isPanning) cursorStyle = 'cursor-grab';

  const toolHint =
    activeTool === ElementType.TICK
      ? 'Click to place tick'
      : activeTool === ElementType.CROSS
      ? 'Click to place cross'
      : activeTool === ElementType.CIRCLE
      ? 'Click to place circle'
      : 'Click to add text';

  return (
    <div
      ref={containerRef}
      className={`relative inline-block shadow-xl group select-none leading-none ${cursorStyle}`}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <Page
        pageNumber={pageNumber}
        scale={scale}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        onLoadSuccess={onPageLoadSuccess}
        className="pdf-page-container block"
      />

      {/* Hover Cursor Guide */}
      {hoverPos && !dragState && !isPanning && !editingId && (
        <div
          className="pointer-events-none absolute z-50 flex flex-col items-start"
          style={{ left: hoverPos.x, top: hoverPos.y }}
        >
          <div className="ml-4 mt-4 bg-slate-800/90 text-white text-[10px] px-2 py-1 rounded shadow border border-slate-600 backdrop-blur-sm whitespace-nowrap">
            {toolHint}
          </div>
        </div>
      )}

      {/* Render Existing Annotations */}
      {pageAnnotations.map((ann) => {
        const isSelected = selectedId === ann.id;
        const isHovered = hoveredId === ann.id;
        const isDragging = dragState?.id === ann.id;
        const isEditing = editingId === ann.id;

        // Screen-space (scaled) size for glyphs / text
        const scaledSize = ann.size * scale;

        // Transparent grab area so small glyphs are easy to click & drag.
        const hitSize = Math.max(scaledSize + 12, 22);

        return (
          <div
            key={ann.id}
            className={`absolute z-10
                ${isDragging ? 'z-50' : ''}
                ${isHovered && !isDragging && !isPanning ? 'z-20' : ''}
            `}
            style={{
              left: ann.displayX * scale,
              top: ann.displayY * scale,
            }}
          >
            {/* Grab / hit area (only for glyphs; TEXT handles its own hits) */}
            {ann.type !== ElementType.TEXT && (
              <div
                onMouseDown={(e) => handleAnnotationMouseDown(e, ann)}
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => onHoverAnnotation(ann.id)}
                onMouseLeave={() => onHoverAnnotation(null)}
                className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                  isDragging ? 'cursor-grabbing' : isPanning ? 'cursor-grab' : 'cursor-move'
                }`}
                style={{ width: hitSize, height: hitSize }}
              />
            )}

            {/* Selection / hover ring for glyph elements */}
            {ann.type !== ElementType.TEXT && (isSelected || isHovered || isDragging) && (
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded border-2 border-indigo-400/70 bg-indigo-400/10 pointer-events-none"
                style={{
                  width: Math.max(scaledSize + 12, 20),
                  height: Math.max(scaledSize + 12, 20),
                }}
              />
            )}

            {/* Resize handle (bottom-right corner of the selection box) for glyphs */}
            {ann.type !== ElementType.TEXT && isSelected && !isDragging && (
              <div
                onMouseDown={(e) => handleResizeMouseDown(e, ann)}
                onClick={(e) => e.stopPropagation()}
                className="absolute w-2.5 h-2.5 -translate-y-1/2 rounded-sm bg-white border-2 border-indigo-500 shadow cursor-nwse-resize"
                style={{
                  left: Math.max(scaledSize + 12, 20) / 2 - 1,
                  top: Math.max(scaledSize + 12, 20) / 2 - 1,
                }}
              />
            )}

            {/* ---- TICK ---- */}
            {ann.type === ElementType.TICK && (
              <Check
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ width: scaledSize, height: scaledSize, color: ann.color }}
                strokeWidth={3}
              />
            )}

            {/* ---- CROSS ---- */}
            {ann.type === ElementType.CROSS && (
              <X
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ width: scaledSize, height: scaledSize, color: ann.color }}
                strokeWidth={3}
              />
            )}

            {/* ---- CIRCLE ---- */}
            {ann.type === ElementType.CIRCLE && (
              <Circle
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ width: scaledSize, height: scaledSize, color: ann.color }}
                strokeWidth={2}
              />
            )}

            {/* ---- TEXT ---- */}
            {ann.type === ElementType.TEXT &&
              (isEditing ? (
                <textarea
                  autoFocus
                  value={ann.text ?? ''}
                  onChange={(e) => onUpdateAnnotationText(ann.id, e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="absolute outline-none border border-indigo-400 rounded bg-white/95 resize-none overflow-hidden shadow-lg"
                  style={{
                    left: 0,
                    top: 0,
                    fontSize: scaledSize,
                    lineHeight: 1.15,
                    color: ann.color,
                    minWidth: 40 * scale,
                    padding: `${2 * scale}px ${3 * scale}px`,
                    height: 'auto',
                    fontFamily: 'Helvetica, Arial, sans-serif',
                  }}
                  rows={Math.max(1, (ann.text ?? '').split('\n').length)}
                />
              ) : (
                <div
                  onMouseDown={(e) => handleAnnotationMouseDown(e, ann)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(ann.id);
                  }}
                  onMouseEnter={() => onHoverAnnotation(ann.id)}
                  onMouseLeave={() => onHoverAnnotation(null)}
                  className={`absolute whitespace-pre leading-tight font-sans rounded ${
                    isDragging ? 'cursor-grabbing' : isPanning ? 'cursor-grab' : 'cursor-move'
                  } ${isSelected || isHovered ? 'ring-2 ring-indigo-400/70 bg-indigo-400/5' : ''}`}
                  style={{
                    left: 0,
                    top: 0,
                    fontSize: scaledSize,
                    lineHeight: 1.15,
                    color: ann.color,
                    padding: `${2 * scale}px ${3 * scale}px`,
                    fontFamily: 'Helvetica, Arial, sans-serif',
                  }}
                >
                  {ann.text || ' '}
                  {/* Resize handle at the text's bottom-right corner */}
                  {isSelected && !isDragging && (
                    <div
                      onMouseDown={(e) => handleResizeMouseDown(e, ann)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute w-2.5 h-2.5 rounded-sm bg-white border-2 border-indigo-500 shadow cursor-nwse-resize"
                      style={{ right: -5, bottom: -5 }}
                    />
                  )}
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
};
