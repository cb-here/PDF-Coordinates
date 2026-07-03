export enum ElementType {
  TICK = 'TICK',     // Checkmark stamp
  CROSS = 'CROSS',   // X / cross stamp
  CIRCLE = 'CIRCLE', // Circle / ring stamp
  TEXT = 'TEXT',     // Free editable text
}

export interface AnnotationPoint {
  id: string;
  type: ElementType;
  pageIndex: number; // 1-based index for UI, but we might handle 0-based internally
  x: number; // PDF Point coordinates (bottom-left origin) - anchor point
  y: number; // PDF Point coordinates (bottom-left origin) - anchor point
  displayX: number; // CSS/View coordinates relative to page top-left (unscaled)
  displayY: number; // CSS/View coordinates relative to page top-left (unscaled)

  // Element-specific styling / content
  text?: string;   // Content for TEXT elements
  size: number;    // Font size (TEXT) or glyph size (TICK/CROSS), in PDF points
  color: string;   // Hex color e.g. "#dc2626"
}

export interface PageDimensions {
  width: number;
  height: number;
}

export enum ToolMode {
  VIEW = 'VIEW',
  ANNOTATE = 'ANNOTATE',
}

export enum CoordinateOrigin {
  BOTTOM_LEFT = 'BOTTOM_LEFT',
  TOP_LEFT = 'TOP_LEFT',
  TOP_RIGHT = 'TOP_RIGHT',
  BOTTOM_RIGHT = 'BOTTOM_RIGHT',
}

// Defaults per element type
export const DEFAULT_SIZES: Record<ElementType, number> = {
  [ElementType.TICK]: 18,
  [ElementType.CROSS]: 18,
  [ElementType.CIRCLE]: 18,
  [ElementType.TEXT]: 14,
};

// Everything defaults to black.
export const DEFAULT_COLORS: Record<ElementType, string> = {
  [ElementType.TICK]: '#000000',
  [ElementType.CROSS]: '#000000',
  [ElementType.CIRCLE]: '#000000',
  [ElementType.TEXT]: '#000000',
};
