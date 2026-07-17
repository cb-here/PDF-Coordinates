import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Document } from 'react-pdf';
import { PDFDocument } from 'pdf-lib';
import {
  Upload,
  Download,
  ZoomIn,
  ZoomOut,
  Trash2,
  ChevronLeft,
  ChevronRight,
  FileText,
  MousePointerClick,
  AlertCircle,
  RotateCcw,
  Check,
  X,
  Type,
  Circle,
  Copy,
  Undo2,
  Redo2,
  PenTool,
  Hand,
  Sun,
  Moon
} from 'lucide-react';
import { PdfCanvas } from './components/PdfCanvas';
import { SignatureModal } from './components/SignatureModal';
import {
  AnnotationPoint,
  PageDimensions,
  ElementType,
  SavedSignature,
  Tool,
  HAND_TOOL,
} from './types';
import { saveAnnotatedPdf } from './services/pdfModifier';

const TOOLS: { type: Tool; label: string; icon: React.ReactNode; hint: string; key: string }[] = [
  { type: HAND_TOOL, label: 'Hand', icon: <Hand className="w-4 h-4" />, hint: 'Pan / view only — place nothing (H)', key: 'h' },
  { type: ElementType.TICK, label: 'Tick', icon: <Check className="w-4 h-4" />, hint: 'Place a checkmark (1)', key: '1' },
  { type: ElementType.CROSS, label: 'Cross', icon: <X className="w-4 h-4" />, hint: 'Place a cross (2)', key: '2' },
  { type: ElementType.CIRCLE, label: 'Circle', icon: <Circle className="w-4 h-4" />, hint: 'Place a circle (3)', key: '3' },
  { type: ElementType.TEXT, label: 'Text', icon: <Type className="w-4 h-4" />, hint: 'Add editable text (4)', key: '4' },
  { type: ElementType.SIGNATURE, label: 'Sign', icon: <PenTool className="w-4 h-4" />, hint: 'Place your signature (5)', key: '5' },
];

const SWATCHES = ['#000000', '#dc2626', '#16a34a', '#2563eb', '#f59e0b', '#7c3aed'];

// Prefill the download name from the source file, minus its .pdf extension.
const defaultExportName = (sourceName: string) =>
  `annotated_${sourceName.replace(/\.pdf$/i, '')}`;

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<ArrayBuffer | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [annotations, setAnnotations] = useState<AnnotationPoint[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pageDimensions, setPageDimensions] = useState<Record<number, PageDimensions>>({});
  const [activeTool, setActiveTool] = useState<Tool>(ElementType.TICK);
  const isHandTool = activeTool === HAND_TOOL;

  // Name used for the downloaded file (without the .pdf extension).
  const [exportName, setExportName] = useState('');

  // Theme. The initial class is applied pre-paint by the inline script in index.html,
  // so read back from the DOM rather than re-deriving it here.
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle('dark', next);
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
      } catch {
        /* storage unavailable (private mode) — theme still applies for this session */
      }
      return next;
    });
  };

  // Signature: the user's saved signature, reused for every placement.
  const [savedSignature, setSavedSignature] = useState<SavedSignature | null>(null);
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState(false);

  // Undo / Redo history (snapshots of the annotations array)
  const undoStack = useRef<AnnotationPoint[][]>([]);
  const redoStack = useRef<AnnotationPoint[][]>([]);
  const annotationsRef = useRef<AnnotationPoint[]>(annotations);
  annotationsRef.current = annotations; // always mirror latest state
  const lastCoalesceKey = useRef<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Snapshot the CURRENT annotations before a change so it can be undone.
  // Call this right before any mutation (discrete action, or start of a drag/resize gesture).
  const commitHistory = () => {
    lastCoalesceKey.current = null; // discrete commits break any coalescing run
    undoStack.current.push(annotationsRef.current.map((a) => ({ ...a })));
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  // Coalesce a rapid run of continuous edits (typing text, dragging a slider) into a
  // single undo entry: only the first change in a run for a given (id, kind) commits.
  const commitCoalesced = (key: string) => {
    if (lastCoalesceKey.current === key) return; // already committed this run
    lastCoalesceKey.current = key;
    undoStack.current.push(annotationsRef.current.map((a) => ({ ...a })));
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const undo = () => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(annotationsRef.current.map((a) => ({ ...a })));
    setAnnotations(prev);
    // Keep selection valid
    setSelectedId((id) => (id && prev.some((a) => a.id === id) ? id : null));
    setCanUndo(undoStack.current.length > 0);
    setCanRedo(true);
  };

  const redo = () => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(annotationsRef.current.map((a) => ({ ...a })));
    setAnnotations(next);
    setSelectedId((id) => (id && next.some((a) => a.id === id) ? id : null));
    setCanRedo(redoStack.current.length > 0);
    setCanUndo(true);
  };

  const resetHistory = () => {
    undoStack.current = [];
    redoStack.current = [];
    lastCoalesceKey.current = null;
    setCanUndo(false);
    setCanRedo(false);
  };

  // Canvas Viewport State
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const dragStartRef = useRef<{ x: number, y: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Keyboard shortcuts for deletion and tool toggling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the user is interacting with an input element
      const target = e.target as HTMLElement;
      const isInputActive = target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      if (isInputActive) {
        return; // Let default behavior handle inputs (e.g. backspace deletes text)
      }

      // The signature modal owns the keyboard while it's open (incl. its own Escape).
      if (isSignatureModalOpen) {
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        handleDeleteAnnotation(selectedId);
        setSelectedId(null);
      }
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }

      // Escape drops back to the Hand (view-only) tool from anywhere.
      if (e.key === 'Escape') {
        handleSelectTool(HAND_TOOL);
        return;
      }

      // Undo / Redo: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z (or Ctrl+Y)
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }

      // Duplicate selected element: Ctrl/Cmd + D
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedId) {
          e.preventDefault();
          handleDuplicateAnnotation(selectedId);
        }
        return;
      }

      // Tool shortcuts (Excalidraw-style): H=Hand, 1=Tick, 2=Cross, 3=Circle, 4=Text, 5=Signature
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
        if (tool) {
          handleSelectTool(tool.type);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsDraggingCanvas(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [selectedId, savedSignature, isSignatureModalOpen]);

  // Canvas Panning (Wheel / Trackpad) logic
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent default browser scrolling / navigation / zoom
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Zoom toward the cursor: keep the point under the pointer fixed on screen.
        const rect = element.getBoundingClientRect();
        const viewportCenterX = rect.left + rect.width / 2;
        const viewportCenterY = rect.top + rect.height / 2;

        setScale((prevScale) => {
          const ZOOM_SENSITIVITY = 0.0015;
          const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
          const nextScale = Math.min(3.0, Math.max(0.5, prevScale * factor));
          const ratio = nextScale / prevScale;
          if (ratio === 1) return prevScale;

          // pan' = pan + (P - V - pan) * (1 - ratio)
          setPan((prevPan) => {
            const dx = e.clientX - viewportCenterX - prevPan.x;
            const dy = e.clientY - viewportCenterY - prevPan.y;
            return {
              x: prevPan.x + dx * (1 - ratio),
              y: prevPan.y + dy * (1 - ratio),
            };
          });

          return nextScale;
        });
      } else {
        // Pan (Trackpad gives both X and Y)
        setPan(prev => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY
        }));
      }
    };

    // Use { passive: false } to allow preventing default
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files[0]) {
      const selectedFile = files[0];
      if (selectedFile.type !== 'application/pdf') {
        setError('Please select a valid PDF file.');
        return;
      }
      setFile(selectedFile);
      setError(null);
      setAnnotations([]);
      resetHistory();
      setExportName(defaultExportName(selectedFile.name));
      setPageNumber(1);
      setPageDimensions({});
      setSelectedId(null);
      setPan({ x: 0, y: 0 }); // Reset view to center
      setScale(1.0);

      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          const buffer = e.target.result as ArrayBuffer;
          setFileData(buffer);
          // Pre-load dimensions using pdf-lib
          try {
            const pdfDoc = await PDFDocument.load(buffer);
            const pages = pdfDoc.getPages();
            const dims: Record<number, PageDimensions> = {};
            pages.forEach((p, idx) => {
              dims[idx + 1] = { width: p.getWidth(), height: p.getHeight() };
            });
            setPageDimensions(dims);
          } catch (err) {
            console.error("Error reading PDF dimensions:", err);
          }
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    }
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
  };

  const handleAddAnnotation = (ann: AnnotationPoint) => {
    commitHistory();
    setAnnotations((prev) => [...prev, ann]);
    setSelectedId(ann.id);
  };

  const handleDeleteAnnotation = (id: string) => {
    commitHistory();
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleUpdateAnnotationText = (id: string, text: string) => {
    commitCoalesced(`text:${id}`);
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)));
  };

  const handleDuplicateAnnotation = (id: string) => {
    commitHistory();
    setAnnotations((prev) => {
      const src = prev.find((a) => a.id === id);
      if (!src) return prev;

      // Offset the copy so it's visibly separate from the original.
      const OFFSET = 12; // PDF points
      const dims = pageDimensions[src.pageIndex];
      let newX = src.x + OFFSET;
      let newY = src.y - OFFSET; // down-right, PDF Y grows up
      if (dims) {
        newX = Math.max(0, Math.min(newX, dims.width));
        newY = Math.max(0, Math.min(newY, dims.height));
      }

      const copy: AnnotationPoint = {
        ...src,
        id: Math.random().toString(36).slice(2) + Date.now().toString(36),
        x: newX,
        y: newY,
        displayX: newX,
        displayY: dims ? dims.height - newY : src.displayY + OFFSET,
      };

      setSelectedId(copy.id);
      return [...prev, copy];
    });
  };

  const handleUpdateAnnotationStyle = (
    id: string,
    patch: Partial<Pick<AnnotationPoint, 'size' | 'color' | 'text'>>
  ) => {
    // Coalesce per (id + which fields) so dragging the size slider = one undo entry.
    commitCoalesced(`style:${id}:${Object.keys(patch).join(',')}`);
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const handleSave = async () => {
    if (!fileData || !file) return;
    setIsSaving(true);
    try {
      await saveAnnotatedPdf(fileData, annotations, exportName);
    } catch (e) {
      console.error(e);
      setError('Failed to save the PDF. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const changePage = (offset: number) => {
    setPageNumber((prev) => Math.min(Math.max(1, prev + offset), numPages));
  };

  const handleResetView = () => {
    setPan({ x: 0, y: 0 });
    setScale(1.0);
  };

  // Coordinate Conversion Helpers (standard PDF bottom-left origin)
  const getDisplayCoordinates = (ann: AnnotationPoint) => {
    return { x: ann.x, y: ann.y };
  };

  const updateAnnotationFromDisplay = (id: string, newX: number | null, newY: number | null) => {
    commitCoalesced(`coord:${id}`);
    setAnnotations(prev => prev.map(ann => {
      if (ann.id !== id) return ann;
      const dims = pageDimensions[ann.pageIndex];

      const canonicalX = newX !== null ? newX : ann.x;
      const canonicalY = newY !== null ? newY : ann.y;

      // Keep CSS display coords in sync (top-left origin) for canvas rendering.
      const cssDisplayX = canonicalX;
      const cssDisplayY = dims ? dims.height - canonicalY : ann.displayY;

      return {
        ...ann,
        x: canonicalX,
        y: canonicalY,
        displayX: cssDisplayX,
        displayY: cssDisplayY,
      };
    }));
  };

  // Called once at the start of a drag or resize gesture on the canvas,
  // so the whole gesture collapses into a single undo entry.
  const handleBeginGesture = () => {
    commitHistory();
  };

  // Live size update during a resize-handle drag (history already committed on gesture begin).
  const handleUpdateAnnotationSize = (id: string, size: number) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, size } : a)));
  };

  // Selecting the signature tool with no signature yet prompts the user to create one.
  const handleSelectTool = (tool: Tool) => {
    setActiveTool(tool);
    if (tool === HAND_TOOL) {
      setSelectedId(null); // hand mode is view-only; drop any selection handles
    }
    if (tool === ElementType.SIGNATURE && !savedSignature) {
      setIsSignatureModalOpen(true);
    }
  };

  const handleSaveSignature = (sig: SavedSignature) => {
    setSavedSignature(sig);
    setActiveTool(ElementType.SIGNATURE);
  };

  const handleUpdateAnnotationPosition = (id: string, x: number, y: number) => {
    setAnnotations(prev => prev.map(ann => {
      if (ann.id !== id) return ann;
      const dims = pageDimensions[ann.pageIndex];

      let displayX = x;
      // Default if dims missing
      let displayY = ann.displayY;

      if (dims) {
        displayY = dims.height - y;
      }

      return {
        ...ann,
        x,
        y,
        displayX,
        displayY
      };
    }));
  };

  const selectedAnnotation = useMemo(
    () => annotations.find((a) => a.id === selectedId) || null,
    [annotations, selectedId]
  );

  const sortedAnnotations = useMemo(() => {
    return [...annotations].sort((a, b) => {
      if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;

      // Sort visually Top to Bottom:
      // In PDF coords (Bottom-Left origin), higher Y is higher on page.
      // So sort by Y descending.
      // Use a small tolerance for floating point comparisons if roughly on same line, then sort left-to-right
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 2) {
        return yDiff;
      }
      return a.x - b.x;
    });
  }, [annotations]);


  // Drag-to-Pan Logic (Space + Click)
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    // Pan with the Hand tool, Space held, or Middle Mouse button
    if (isSpacePressed || isHandTool || e.button === 1) {
      e.preventDefault();
      setIsDraggingCanvas(true);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    } else {
      // Regular click handling falls through to elements
      setSelectedId(null);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (isDraggingCanvas && dragStartRef.current) {
      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      setPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDraggingCanvas(false);
    dragStartRef.current = null;
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!file) {
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);

    if (!file && e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type !== 'application/pdf') {
        setError('Please select a valid PDF file.');
        return;
      }
      setFile(droppedFile);
      setError(null);
      setAnnotations([]);
      resetHistory();
      setExportName(defaultExportName(droppedFile.name));
      setPageNumber(1);
      setPageDimensions({});
      setSelectedId(null);
      setPan({ x: 0, y: 0 });
      setScale(1.0);

      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          const buffer = e.target.result as ArrayBuffer;
          setFileData(buffer);
          try {
            const pdfDoc = await PDFDocument.load(buffer);
            const pages = pdfDoc.getPages();
            const dims: Record<number, PageDimensions> = {};
            pages.forEach((p, idx) => {
              dims[idx + 1] = { width: p.getWidth(), height: p.getHeight() };
            });
            setPageDimensions(dims);
          } catch (err) {
            console.error("Error reading PDF dimensions:", err);
          }
        }
      };
      reader.readAsArrayBuffer(droppedFile);
    }
  };


  return (
    <div
      className="flex h-screen w-screen bg-canvas text-body overflow-hidden font-sans relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >

      {/* Sidebar */}
      <aside className="w-80 flex flex-col border-r border-line bg-surface z-20 shrink-0 shadow-2xl">
        <div className="p-6 border-b border-line">
          <div className="flex items-center space-x-3 mb-1">
            <div className="p-2 bg-indigo-600 rounded-lg">
              <MousePointerClick className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-bold text-strong tracking-tight">PDF Annotator</h1>
          </div>
          <p className="text-xs text-faint mt-1">Pick a tool, click to place, drag to move.</p>
        </div>

        {/* File Upload */}
        {!file && (
          <div className="p-4 border-b border-line bg-surface/50">
            <label className={`flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-all group ${isDraggingFile ? 'border-indigo-500 bg-indigo-500/20 scale-105' : 'border-line-strong hover:bg-elevated/50 hover:border-indigo-500'}`}>
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className={`w-8 h-8 mb-3 transition-colors ${isDraggingFile ? 'text-accent animate-bounce' : 'text-faint group-hover:text-accent'}`} />
                <p className="mb-1 text-sm text-muted"><span className="font-semibold">{isDraggingFile ? 'Drop PDF here' : 'Click to select PDF'}</span></p>
                <p className="text-xs text-faint">PDF files only</p>
              </div>
              <input ref={fileInputRef} type="file" className="hidden" accept="application/pdf" onChange={onFileChange} />
            </label>
          </div>
        )}

        {/* File Info */}
        {file && (
          <div className="p-4 border-b border-line bg-surface/50 flex items-center justify-between">
            <div className="flex items-center space-x-3 overflow-hidden">
              <FileText className="w-5 h-5 text-accent flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-strong truncate">{file.name}</p>
              </div>
            </div>
            <button
              onClick={() => { setFile(null); setFileData(null); setAnnotations([]); resetHistory(); setSelectedId(null); }}
              className="p-1.5 text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Tool Palette */}
        {file && (
          <div className="p-4 border-b border-line bg-surface/50">
            <span className="text-xs font-semibold text-faint uppercase tracking-wider">Tools</span>
            <div className="grid grid-cols-6 gap-1 mt-3">
              {TOOLS.map((tool) => {
                const isActive = activeTool === tool.type;
                return (
                  <button
                    key={tool.type}
                    onClick={() => handleSelectTool(tool.type)}
                    title={tool.hint}
                    className={`relative flex flex-col items-center justify-center gap-1 py-2 rounded-lg border transition-all ${
                      isActive
                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-500/20'
                        : 'bg-elevated border-line-strong text-muted hover:bg-raised hover:text-strong'
                    }`}
                  >
                    {/* Keyboard shortcut, like Excalidraw */}
                    <span
                      className={`absolute top-1 right-1 text-[9px] font-mono leading-none ${
                        isActive ? 'text-indigo-200' : 'text-faint'
                      }`}
                    >
                      {tool.key.toUpperCase()}
                    </span>
                    {tool.icon}
                    <span className="text-[10px] font-medium">{tool.label}</span>
                  </button>
                );
              })}
            </div>
            {/* Signature preview — shown while the Sign tool is active */}
            {activeTool === ElementType.SIGNATURE && (
              <div className="mt-3 p-2 bg-elevated/60 border border-line-strong rounded-lg">
                {savedSignature ? (
                  <>
                    <div className="h-12 bg-white rounded flex items-center justify-center overflow-hidden">
                      <img
                        src={savedSignature.dataUrl}
                        alt="Your signature"
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                    <button
                      onClick={() => setIsSignatureModalOpen(true)}
                      className="w-full mt-2 py-1.5 text-[10px] font-medium text-accent hover:text-accent-hi hover:bg-indigo-400/10 rounded transition-colors"
                    >
                      Change signature
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsSignatureModalOpen(true)}
                    className="w-full py-2 text-[11px] font-medium text-accent hover:text-accent-hi hover:bg-indigo-400/10 rounded transition-colors"
                  >
                    + Create your signature
                  </button>
                )}
              </div>
            )}

            <p className="text-[10px] text-faint mt-2 leading-relaxed">
              <span className="font-mono text-muted">H</span> hand / just view ·{' '}
              <span className="font-mono text-muted">Esc</span> back to hand ·{' '}
              <span className="font-mono text-muted">1–5</span> switch tools ·{' '}
              <span className="font-mono text-muted">Ctrl/⌘+D</span> duplicate ·{' '}
              <span className="font-mono text-muted">Ctrl/⌘+Z</span> undo ·{' '}
              <span className="font-mono text-muted">Del</span> remove ·{' '}
              <span className="font-mono text-muted">Ctrl/⌘+scroll</span> zoom. Drag the corner handle to resize; double-click text to edit.
            </p>
          </div>
        )}

        {/* Selected Element Styling */}
        {file && selectedAnnotation && (
          <div className="p-4 border-b border-line bg-surface/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-faint uppercase tracking-wider">
                {selectedAnnotation.type === ElementType.TEXT
                  ? 'Text'
                  : selectedAnnotation.type === ElementType.TICK
                  ? 'Tick'
                  : selectedAnnotation.type === ElementType.CIRCLE
                  ? 'Circle'
                  : selectedAnnotation.type === ElementType.SIGNATURE
                  ? 'Signature'
                  : 'Cross'}{' '}
                Style
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDuplicateAnnotation(selectedAnnotation.id)}
                  title="Duplicate (Ctrl/Cmd + D)"
                  className="p-1.5 text-muted hover:text-accent hover:bg-indigo-400/10 rounded transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => { handleDeleteAnnotation(selectedAnnotation.id); setSelectedId(null); }}
                  title="Delete (Del)"
                  className="p-1.5 text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {selectedAnnotation.type === ElementType.TEXT && (
              <div className="mt-3">
                <label className="text-[10px] text-faint">Content</label>
                <textarea
                  value={selectedAnnotation.text ?? ''}
                  onChange={(e) => handleUpdateAnnotationStyle(selectedAnnotation.id, { text: e.target.value })}
                  rows={2}
                  className="w-full mt-1 bg-canvas/60 border border-line-strong rounded px-2 py-1.5 text-sm text-strong focus:outline-none focus:border-indigo-500 resize-none"
                />
              </div>
            )}

            <div className="mt-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-faint">
                  {selectedAnnotation.type === ElementType.TEXT
                    ? 'Font size'
                    : selectedAnnotation.type === ElementType.SIGNATURE
                    ? 'Width'
                    : 'Size'}
                </label>
                <span className="text-[10px] font-mono text-muted">{Math.round(selectedAnnotation.size)}pt</span>
              </div>
              <input
                type="range"
                min={selectedAnnotation.type === ElementType.SIGNATURE ? 20 : 6}
                max={selectedAnnotation.type === ElementType.SIGNATURE ? 300 : 72}
                step={1}
                value={selectedAnnotation.size}
                onChange={(e) => handleUpdateAnnotationStyle(selectedAnnotation.id, { size: parseInt(e.target.value, 10) })}
                className="w-full mt-1 accent-indigo-500"
              />
            </div>

            {/* A signature is a baked image, so colour doesn't apply to it. */}
            {selectedAnnotation.type !== ElementType.SIGNATURE && (
              <div className="mt-3">
                <label className="text-[10px] text-faint">Color</label>
                <div className="flex items-center gap-2 mt-1.5">
                  {SWATCHES.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleUpdateAnnotationStyle(selectedAnnotation.id, { color: c })}
                      // border matches the panel so it reads as a gap inside the ring
                      className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                        selectedAnnotation.color.toLowerCase() === c.toLowerCase()
                          ? 'border-surface ring-2 ring-indigo-500'
                          : 'border-line-strong'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input
                    type="color"
                    value={selectedAnnotation.color}
                    onChange={(e) => handleUpdateAnnotationStyle(selectedAnnotation.id, { color: e.target.value })}
                    className="w-6 h-6 rounded cursor-pointer bg-transparent border border-line-strong"
                    title="Custom color"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Elements List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-faint uppercase tracking-wider">Elements</h3>
            <span className="text-xs bg-elevated text-muted px-2 py-0.5 rounded-full">{annotations.length}</span>
          </div>

          {annotations.length === 0 ? (
            <div className="text-center py-10 px-4">
              <p className="text-fainter text-sm">Nothing placed yet.</p>
              <p className="text-fainter text-xs mt-1">Pick a tool above, then click on the page to place it.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sortedAnnotations.map((ann, idx) => {
                const displayCoords = getDisplayCoordinates(ann);
                const isSelected = selectedId === ann.id;
                const isHovered = hoveredId === ann.id;

                // Check if we need to render a page header
                const showPageHeader = idx === 0 || ann.pageIndex !== sortedAnnotations[idx - 1].pageIndex;

                const typeIcon =
                  ann.type === ElementType.TICK ? <Check className="w-3.5 h-3.5" />
                  : ann.type === ElementType.CROSS ? <X className="w-3.5 h-3.5" />
                  : ann.type === ElementType.CIRCLE ? <Circle className="w-3.5 h-3.5" />
                  : ann.type === ElementType.SIGNATURE ? <PenTool className="w-3.5 h-3.5" />
                  : <Type className="w-3.5 h-3.5" />;

                const primaryLabel =
                  ann.type === ElementType.TEXT
                    ? (ann.text?.trim() || 'Empty text')
                    : ann.type === ElementType.TICK ? 'Tick'
                    : ann.type === ElementType.CIRCLE ? 'Circle'
                    : ann.type === ElementType.SIGNATURE ? 'Signature'
                    : 'Cross';

                return (
                  <React.Fragment key={ann.id}>
                    {showPageHeader && (
                      <div className="mt-4 mb-2 first:mt-0">
                        <h4 className="text-[10px] font-bold text-faint uppercase tracking-wider pl-1">
                          Page {ann.pageIndex}
                        </h4>
                      </div>
                    )}
                    <div
                      onMouseEnter={() => setHoveredId(ann.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => setSelectedId(ann.id)}
                      className={`group flex items-center justify-between p-2 border rounded-lg transition-all cursor-pointer
                                        ${isSelected
                          ? 'bg-accent/10 border-indigo-500/50'
                          : isHovered
                            ? 'bg-elevated border-line-strong'
                            : 'bg-elevated/50 border-line-strong/50'
                        }
                                    `}
                    >
                      {/* Type Badge */}
                      <div
                        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded mr-2 bg-raised"
                        style={{ color: ann.color === '#000000' ? '#e2e8f0' : ann.color }}
                      >
                        {typeIcon}
                      </div>

                      {/* Label + coords */}
                      <div className="flex-1 min-w-0 mr-2">
                        <p className="text-xs font-medium text-strong truncate">{primaryLabel}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div className="flex items-center bg-canvas/50 rounded px-1 border border-line-strong/50 focus-within:border-indigo-500/50">
                            <span className="text-[9px] text-faint mr-1 font-mono">X</span>
                            <input
                              type="number"
                              value={Math.round(displayCoords.x)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => updateAnnotationFromDisplay(ann.id, parseFloat(e.target.value) || 0, null)}
                              className="w-12 bg-transparent text-[11px] font-mono text-body focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center bg-canvas/50 rounded px-1 border border-line-strong/50 focus-within:border-indigo-500/50">
                            <span className="text-[9px] text-faint mr-1 font-mono">Y</span>
                            <input
                              type="number"
                              value={Math.round(displayCoords.y)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => updateAnnotationFromDisplay(ann.id, null, parseFloat(e.target.value) || 0)}
                              className="w-12 bg-transparent text-[11px] font-mono text-body focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteAnnotation(ann.id); }}
                        className={`p-1 rounded flex-shrink-0 transition-all ${isSelected || isHovered ? 'text-danger hover:bg-danger/20' : 'text-transparent group-hover:text-faint'}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Action */}
        {file && (
          <div className="p-4 border-t border-line bg-surface">
            {/* Download file name */}
            <label className="text-[10px] font-semibold text-faint uppercase tracking-wider">
              File name
            </label>
            <div className="flex items-center mt-1.5 mb-3 bg-canvas/60 border border-line-strong rounded-lg focus-within:border-indigo-500 transition-colors">
              <input
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && annotations.length > 0 && !isSaving) handleSave();
                }}
                placeholder="document"
                spellCheck={false}
                className="flex-1 min-w-0 bg-transparent px-2.5 py-2 text-xs text-strong focus:outline-none"
              />
              <span className="pr-2.5 text-xs font-mono text-faint shrink-0">.pdf</span>
            </div>

            <button
              onClick={handleSave}
              disabled={annotations.length === 0 || isSaving}
              className={`flex items-center justify-center w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-all shadow-lg ${annotations.length === 0
                ? 'bg-elevated text-faint cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25'
                }`}
            >
              {isSaving ? (
                <span className="flex items-center space-x-2">
                  <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                  <span>Processing...</span>
                </span>
              ) : (
                <span className="flex items-center space-x-2">
                  <Download className="w-4 h-4" />
                  <span>Download PDF</span>
                </span>
              )}
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Area (Infinite Canvas) */}
      <main className="flex-1 flex flex-col relative bg-canvas h-full overflow-hidden">
        {/* Toolbar */}
        <header className="h-16 border-b border-line bg-surface/80 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-20 pointer-events-auto shrink-0" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center space-x-4">
            <div className="flex items-center bg-elevated rounded-lg p-1 border border-line-strong">
              <button
                onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
                className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors"
                disabled={!file}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="w-16 text-center text-xs font-mono text-body">{Math.round(scale * 100)}%</span>
              <button
                onClick={() => setScale(s => Math.min(3.0, s + 0.2))}
                className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors"
                disabled={!file}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {numPages > 0 && (
              <div className="flex items-center bg-elevated rounded-lg p-1 border border-line-strong">
                <button
                  onClick={() => changePage(-1)}
                  disabled={pageNumber <= 1}
                  className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-xs font-mono text-body">
                  Page {pageNumber} / {numPages}
                </span>
                <button
                  onClick={() => changePage(1)}
                  disabled={pageNumber >= numPages}
                  className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Undo / Redo */}
            {file && (
              <div className="flex items-center bg-elevated rounded-lg p-1 border border-line-strong">
                <button
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo (Ctrl/⌘+Z)"
                  className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors disabled:opacity-30"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo (Ctrl/⌘+Shift+Z)"
                  className="p-1.5 text-muted hover:text-strong hover:bg-raised rounded transition-colors disabled:opacity-30"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center space-x-4">
            {/* Pan Hint */}
            <div className="text-[10px] text-faint hidden md:flex items-center space-x-2 bg-elevated/50 px-2 py-1 rounded border border-line-strong/30">
              <span className="px-1.5 py-0.5 bg-raised rounded text-body font-mono">Space</span>
              <span>+ Drag to Pan</span>
            </div>

            {/* Reset Button */}
            <button
              onClick={handleResetView}
              disabled={!file}
              className={`p-1.5 rounded-lg transition-all flex items-center space-x-2 border border-transparent
                        ${!file ? 'text-fainter cursor-not-allowed' : 'text-muted hover:text-strong hover:bg-elevated hover:border-line-strong'}
                    `}
              title="Reset Zoom & Position"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="text-xs font-medium hidden sm:inline">Reset</span>
            </button>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-1.5 rounded-lg transition-all border border-transparent text-muted hover:text-strong hover:bg-elevated hover:border-line-strong"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {error && (
              <div className="flex items-center space-x-2 text-danger text-sm bg-danger/10 px-3 py-1.5 rounded-full border border-danger/20">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </header>

        {/* Viewport */}
        <div
          ref={viewportRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          className={`flex-1 overflow-hidden relative bg-[radial-gradient(var(--c-dot)_1px,transparent_1px)] [background-size:16px_16px] flex items-center justify-center
                ${isSpacePressed || isDraggingCanvas || isHandTool ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
            `}
        >
          {isDraggingFile && !file && (
            <div className="absolute inset-0 bg-indigo-500/10 border-4 border-dashed border-indigo-500/50 z-50 flex items-center justify-center pointer-events-none">
              <div className="bg-surface/90 px-8 py-6 rounded-xl border-2 border-indigo-500 shadow-2xl">
                <Upload className="w-16 h-16 text-accent mx-auto mb-4 animate-bounce" />
                <p className="text-xl font-bold text-strong text-center">Drop PDF here</p>
                <p className="text-sm text-muted text-center mt-2">Release to upload</p>
              </div>
            </div>
          )}
          {!file ? (
            <div
              className="flex flex-col items-center justify-center text-fainter cursor-pointer hover:text-faint transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-24 h-24 bg-surface rounded-2xl border-2 border-dashed border-line flex items-center justify-center mb-4 hover:border-line-strong hover:bg-elevated/50 transition-all">
                <FileText className="w-10 h-10 opacity-20" />
              </div>
              <p>Select a PDF to begin</p>
            </div>
          ) : (
            <div
              className="transition-transform duration-75 ease-linear will-change-transform"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px)`
              }}
            >
              <Document
                file={file}
                onLoadSuccess={onDocumentLoadSuccess}
                loading={
                  <div className="flex flex-col items-center space-y-4 p-20 bg-surface/50 rounded-xl backdrop-blur-sm border border-line">
                    <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
                    <p className="text-sm text-muted animate-pulse">Loading PDF...</p>
                  </div>
                }
                error={
                  <div className="text-danger p-10 bg-surface/80 rounded-xl border border-red-500/20 flex items-center space-x-2">
                    <AlertCircle className="w-5 h-5" />
                    <span>Error loading PDF. Please try another file.</span>
                  </div>
                }
              >
                <div className="shadow-2xl rounded-sm overflow-hidden ring-1 ring-black/10 dark:ring-white/10 bg-white">
                  <PdfCanvas
                    pageNumber={pageNumber}
                    scale={scale}
                    annotations={annotations}
                    pageDimensions={pageDimensions[pageNumber] || null}
                    selectedId={selectedId}
                    hoveredId={hoveredId}
                    isPanning={isSpacePressed || isDraggingCanvas || isHandTool}
                    activeTool={activeTool}
                    savedSignature={savedSignature}
                    onAddAnnotation={handleAddAnnotation}
                    onSelectAnnotation={setSelectedId}
                    onHoverAnnotation={setHoveredId}
                    onBeginGesture={handleBeginGesture}
                    onUpdateAnnotationPosition={handleUpdateAnnotationPosition}
                    onUpdateAnnotationSize={handleUpdateAnnotationSize}
                    onUpdateAnnotationText={handleUpdateAnnotationText}
                    onPageLoadSuccess={() => console.log(`Page ${pageNumber} loaded`)}
                  />
                </div>
              </Document>
            </div>
          )}
        </div>
      </main>

      <SignatureModal
        open={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onSave={handleSaveSignature}
      />
    </div>
  );
};

export default App;