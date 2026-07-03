import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';
import { AnnotationPoint, ElementType } from '../types';

// Convert a hex color string (#rrggbb / #rgb) to a pdf-lib rgb() color.
const hexToRgb = (hex: string) => {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  if ([r, g, b].some((v) => Number.isNaN(v))) {
    return rgb(0, 0, 0);
  }
  return rgb(r, g, b);
};

// Draw a checkmark centred on (cx, cy). `size` is the bounding box edge length in points.
const drawTick = (page: PDFPage, cx: number, cy: number, size: number, color: string) => {
  const s = size / 2;
  const c = hexToRgb(color);
  const thickness = Math.max(1, size * 0.14);

  // Checkmark geometry relative to centre.
  const p1 = { x: cx - s * 0.55, y: cy - s * 0.05 };
  const p2 = { x: cx - s * 0.12, y: cy - s * 0.5 };
  const p3 = { x: cx + s * 0.65, y: cy + s * 0.55 };

  page.drawLine({ start: p1, end: p2, thickness, color: c, lineCap: 1 as any });
  page.drawLine({ start: p2, end: p3, thickness, color: c, lineCap: 1 as any });
};

// Draw a cross (X) centred on (cx, cy). `size` is the bounding box edge length in points.
const drawCross = (page: PDFPage, cx: number, cy: number, size: number, color: string) => {
  const s = size / 2;
  const c = hexToRgb(color);
  const thickness = Math.max(1, size * 0.14);
  const arm = s * 0.7;

  page.drawLine({
    start: { x: cx - arm, y: cy - arm },
    end: { x: cx + arm, y: cy + arm },
    thickness,
    color: c,
    lineCap: 1 as any,
  });
  page.drawLine({
    start: { x: cx - arm, y: cy + arm },
    end: { x: cx + arm, y: cy - arm },
    thickness,
    color: c,
    lineCap: 1 as any,
  });
};

// Draw a hollow circle (ring) centred on (cx, cy). `size` is the bounding box edge length.
const drawCircleElement = (page: PDFPage, cx: number, cy: number, size: number, color: string) => {
  const c = hexToRgb(color);
  const thickness = Math.max(1, size * 0.1);
  // Inset the radius by half the stroke width so the ring stays inside the bounding box.
  const radius = Math.max(1, size / 2 - thickness / 2);
  page.drawCircle({
    x: cx,
    y: cy,
    size: radius,
    borderColor: c,
    borderWidth: thickness,
    // no fill
  });
};

// Draw multi-line text. The anchor (ann.x, ann.y) is the TOP-LEFT of the text block,
// matching the on-screen rendering where text grows downward from the click point.
const drawTextElement = (
  page: PDFPage,
  ann: AnnotationPoint,
  font: PDFFont,
) => {
  const text = ann.text ?? '';
  if (!text) return;

  const size = ann.size;
  const color = hexToRgb(ann.color);
  const lineHeight = size * 1.15;
  // Approximate ascent so the first line's top aligns with the anchor.
  const ascent = font.heightAtSize(size, { descender: false });

  const TOP_PADDING = 2; // matches the CSS top padding on the canvas text box
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const baselineY = ann.y - TOP_PADDING - ascent - i * lineHeight;
    page.drawText(line, {
      x: ann.x + 3, // small left padding to match the CSS padding on canvas
      y: baselineY,
      size,
      font,
      color,
    });
  });
};

export const saveAnnotatedPdf = async (
  originalPdfBytes: ArrayBuffer,
  annotations: AnnotationPoint[],
  fileName: string,
): Promise<void> => {
  try {
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const pages = pdfDoc.getPages();
    const textFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Group annotations by page
    const annotationsByPage: Record<number, AnnotationPoint[]> = {};
    annotations.forEach((ann) => {
      (annotationsByPage[ann.pageIndex] ||= []).push(ann);
    });

    Object.keys(annotationsByPage).forEach((pageIdxStr) => {
      const pageIndex = parseInt(pageIdxStr, 10) - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) return;

      const page = pages[pageIndex];
      const pageAnns = annotationsByPage[parseInt(pageIdxStr, 10)];

      pageAnns.forEach((ann) => {
        switch (ann.type) {
          case ElementType.TICK:
            drawTick(page, ann.x, ann.y, ann.size, ann.color);
            break;
          case ElementType.CROSS:
            drawCross(page, ann.x, ann.y, ann.size, ann.color);
            break;
          case ElementType.CIRCLE:
            drawCircleElement(page, ann.x, ann.y, ann.size, ann.color);
            break;
          case ElementType.TEXT:
            drawTextElement(page, ann, textFont);
            break;
        }
      });
    });

    const modifiedPdfBytes = await pdfDoc.save();
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `annotated_${fileName}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  } catch (error) {
    console.error('Error saving PDF:', error);
    throw new Error('Failed to save annotated PDF.');
  }
};
