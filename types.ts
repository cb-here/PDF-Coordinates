export enum ElementType {
  TICK = 'TICK',           // Checkmark stamp
  CROSS = 'CROSS',         // X / cross stamp
  CIRCLE = 'CIRCLE',       // Circle / ring stamp
  TEXT = 'TEXT',           // Free editable text
  SIGNATURE = 'SIGNATURE', // Drawn or typed signature image
}

// The hand is a view-only mode, not something you can place, so it lives
// alongside ElementType rather than inside it.
export const HAND_TOOL = 'HAND';
export type Tool = ElementType | typeof HAND_TOOL;

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
  size: number;    // Font size (TEXT), glyph size (TICK/CROSS/CIRCLE), or width (SIGNATURE), in PDF points
  color: string;   // Hex color e.g. "#dc2626"

  // SIGNATURE only
  imageData?: string;   // PNG data URL of the signature
  aspectRatio?: number; // width / height, so height = size / aspectRatio
}

// A signature the user has created, reusable across placements.
export interface SavedSignature {
  dataUrl: string;
  aspectRatio: number;
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
  [ElementType.SIGNATURE]: 120, // width in PDF points
};

// Everything defaults to black.
export const DEFAULT_COLORS: Record<ElementType, string> = {
  [ElementType.TICK]: '#000000',
  [ElementType.CROSS]: '#000000',
  [ElementType.CIRCLE]: '#000000',
  [ElementType.TEXT]: '#000000',
  [ElementType.SIGNATURE]: '#000000',
};
