import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Pencil, Type as TypeIcon, Trash2, X, Check } from 'lucide-react';
import { SavedSignature } from '../types';

interface SignatureModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (sig: SavedSignature) => void;
}

type Point = { x: number; y: number };
type Mode = 'draw' | 'type';

// Cursive fonts offered for typed signatures (loaded in index.html).
const TYPE_FONTS = [
  { label: 'Homemade Apple', css: '"Homemade Apple", cursive' },
  { label: 'Dancing Script', css: '"Dancing Script", cursive' },
  { label: 'Caveat', css: '"Caveat", cursive' },
];

// Canvas fillText does not trigger font downloads, so a font that hasn't loaded
// yet silently falls back to serif. Await this before any fillText.
const ensureFontLoaded = async (fontCss: string, fontSize: number) => {
  try {
    await document.fonts.load(`${fontSize}px ${fontCss}`);
  } catch (err) {
    console.error('Signature font load failed:', err);
  }
};

// Smooth a point list into an SVG path using quadratic curves through midpoints.
const pointsToPath = (points: Point[]): string => {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    d += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
};

export const SignatureModal: React.FC<SignatureModalProps> = ({ open, onClose, onSave }) => {
  const [mode, setMode] = useState<Mode>('draw');

  // --- Draw state ---
  const svgRef = useRef<SVGSVGElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [paths, setPaths] = useState<Point[][]>([]);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [strokeWidth, setStrokeWidth] = useState(2.5);

  // --- Type state ---
  const [typedName, setTypedName] = useState('');
  const [fontCss, setFontCss] = useState(TYPE_FONTS[0].css);
  const typePreviewRef = useRef<HTMLDivElement>(null);

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (open) {
      setPaths([]);
      setCurrentPath([]);
      setIsDrawing(false);
      setTypedName('');
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent): Point => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDrawing(true);
    setCurrentPath([getCoords(e)]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    setCurrentPath((prev) => [...prev, getCoords(e)]);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentPath.length > 1) {
      setPaths((prev) => [...prev, currentPath]);
    }
    setCurrentPath([]);
  };

  const clearDraw = () => {
    setPaths([]);
    setCurrentPath([]);
  };

  const hasDrawing = paths.length > 0;
  const hasTyped = typedName.trim().length > 0;
  const canSave = mode === 'draw' ? hasDrawing : hasTyped;

  // Rasterise the drawn paths, tightly cropped to the ink bounds so the placed
  // element has a true aspect ratio and no dead transparent padding.
  const exportDrawn = useCallback((): Promise<SavedSignature | null> => {
    return new Promise((resolve) => {
      if (paths.length === 0) return resolve(null);

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      paths.forEach((p) =>
        p.forEach((pt) => {
          minX = Math.min(minX, pt.x);
          maxX = Math.max(maxX, pt.x);
          minY = Math.min(minY, pt.y);
          maxY = Math.max(maxY, pt.y);
        })
      );

      const RESOLUTION = 3; // export at 3x for crisp PDF embedding
      const pad = strokeWidth + 4;
      const cropW = Math.max(maxX - minX + pad * 2, 1);
      const cropH = Math.max(maxY - minY + pad * 2, 1);
      const outW = Math.round(cropW * RESOLUTION);
      const outH = Math.round(cropH * RESOLUTION);

      const svgNS = 'http://www.w3.org/2000/svg';
      const exportSvg = document.createElementNS(svgNS, 'svg');
      exportSvg.setAttribute('width', String(outW));
      exportSvg.setAttribute('height', String(outH));
      exportSvg.setAttribute('viewBox', `0 0 ${outW} ${outH}`);

      paths.forEach((pathPoints) => {
        // Shift into crop space, then scale up to export resolution.
        const scaled = pathPoints.map((p) => ({
          x: (p.x - minX + pad) * RESOLUTION,
          y: (p.y - minY + pad) * RESOLUTION,
        }));
        const el = document.createElementNS(svgNS, 'path');
        el.setAttribute('d', pointsToPath(scaled));
        el.setAttribute('stroke', '#000000');
        el.setAttribute('stroke-width', String(strokeWidth * RESOLUTION));
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke-linecap', 'round');
        el.setAttribute('stroke-linejoin', 'round');
        exportSvg.appendChild(el);
      });

      const svgData = new XMLSerializer().serializeToString(exportSvg);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: canvas.toDataURL('image/png'), aspectRatio: outW / outH });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }, [paths, strokeWidth]);

  // Render the typed name in a cursive font, cropped to the drawn text bounds.
  const exportTyped = useCallback(async (): Promise<SavedSignature | null> => {
    const name = typedName.trim();
    if (!name) return null;

    const FONT_SIZE = 96; // render large, scale down on the page
    await ensureFontLoaded(fontCss, FONT_SIZE);

    const measureCanvas = document.createElement('canvas');
    const mctx = measureCanvas.getContext('2d')!;
    mctx.font = `${FONT_SIZE}px ${fontCss}`;
    const metrics = mctx.measureText(name);

    // actualBoundingBox gives the real ink extents (cursive fonts overshoot a lot).
    const left = metrics.actualBoundingBoxLeft ?? 0;
    const right = metrics.actualBoundingBoxRight ?? metrics.width;
    const ascent = metrics.actualBoundingBoxAscent ?? FONT_SIZE * 0.8;
    const descent = metrics.actualBoundingBoxDescent ?? FONT_SIZE * 0.2;

    const pad = Math.round(FONT_SIZE * 0.12);
    const w = Math.max(Math.ceil(left + right) + pad * 2, 1);
    const h = Math.max(Math.ceil(ascent + descent) + pad * 2, 1);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${FONT_SIZE}px ${fontCss}`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(name, pad + left, pad + ascent);

    return { dataUrl: canvas.toDataURL('image/png'), aspectRatio: w / h };
  }, [typedName, fontCss]);

  const handleSave = async () => {
    const sig = mode === 'draw' ? await exportDrawn() : await exportTyped();
    if (sig) {
      onSave(sig);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas/80 backdrop-blur-sm p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface border border-line-strong rounded-xl shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-sm font-bold text-strong">Create signature</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-strong hover:bg-elevated rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 px-5 pt-4">
          <button
            onClick={() => setMode('draw')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              mode === 'draw'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-elevated border-line-strong text-muted hover:text-strong hover:bg-raised'
            }`}
          >
            <Pencil className="w-3.5 h-3.5" />
            Draw
          </button>
          <button
            onClick={() => setMode('type')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              mode === 'type'
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-elevated border-line-strong text-muted hover:text-strong hover:bg-raised'
            }`}
          >
            <TypeIcon className="w-3.5 h-3.5" />
            Type
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {mode === 'draw' ? (
            <>
              <div className="relative">
                <svg
                  ref={svgRef}
                  className="w-full h-44 rounded-lg border-2 border-dashed border-line-strong bg-white touch-none cursor-crosshair"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                >
                  {paths.map((p, i) => (
                    <path
                      key={i}
                      d={pointsToPath(p)}
                      stroke="#000000"
                      strokeWidth={strokeWidth}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {currentPath.length > 1 && (
                    <path
                      d={pointsToPath(currentPath)}
                      stroke="#000000"
                      strokeWidth={strokeWidth}
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                </svg>
                {!hasDrawing && currentPath.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted text-sm">
                    Sign here
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-faint">Pen</label>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={0.5}
                    value={strokeWidth}
                    onChange={(e) => setStrokeWidth(parseFloat(e.target.value))}
                    className="w-24 accent-indigo-500"
                  />
                </div>
                <button
                  onClick={clearDraw}
                  disabled={!hasDrawing}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="text-[10px] text-faint">Your name</label>
              <input
                autoFocus
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full mt-1 bg-canvas/60 border border-line-strong rounded px-3 py-2 text-sm text-strong focus:outline-none focus:border-indigo-500"
              />

              <div className="flex gap-2 mt-3">
                {TYPE_FONTS.map((f) => (
                  <button
                    key={f.css}
                    onClick={() => setFontCss(f.css)}
                    className={`flex-1 px-2 py-1.5 rounded border text-xs transition-all ${
                      fontCss === f.css
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-elevated border-line-strong text-muted hover:bg-raised'
                    }`}
                    style={{ fontFamily: f.css }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div
                ref={typePreviewRef}
                className="mt-3 h-44 rounded-lg border-2 border-dashed border-line-strong bg-white flex items-center justify-center overflow-hidden px-4"
              >
                {hasTyped ? (
                  <span
                    className="text-black text-4xl whitespace-nowrap overflow-hidden text-ellipsis"
                    style={{ fontFamily: fontCss, lineHeight: 1.4 }}
                  >
                    {typedName}
                  </span>
                ) : (
                  <span className="text-muted text-sm">Preview</span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-line bg-surface">
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs font-medium text-muted hover:text-strong rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
              canSave
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                : 'bg-elevated text-faint cursor-not-allowed'
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            Use signature
          </button>
        </div>
      </div>
    </div>
  );
};
