import { clipCols, colLength, DEVANAGARI_FONTS, graphemes, hasDevanagari, keepPrintable } from './indicText';

export interface ThermalPrintPayload {
  format: string;
  charsPerLine?: number;
  lines?: string[];
  raw?: string;
  html?: string;
  mimeType?: string;
}

/** Keep printable text. Marathi (Devanagari) is preserved; other symbols become ?. */
export function sanitizeEscPosText(text: string): string {
  return keepPrintable(text);
}

/**
 * Paper column count for a roll size. 80mm must use 48 (Font A @ 203 dpi),
 * not 42 — 42 leaves a large empty strip on the right.
 * 58mm / 2″ uses 30 cols so a small left margin fits inside the 384-dot area
 * (80→58 converter paper offset).
 */
export function receiptCharsForPaper(format: '58' | '80' | string): number {
  if (format === '80') return 48;
  if (format === '58') return 30;
  return 30;
}

/** ~3 mm left inset for 58 mm / converter (8 dots/mm × 3). */
export const MARGIN_58_LEFT_DOTS = 24;

/**
 * Flatten to plain ASCII receipt text (preview / fallback).
 * Preserves leading spaces used for horizontal centering.
 * Supports optional <C>...</C> tags (centered within paper width).
 * Full-width lines (rules / tables) span the whole printable width so left and
 * right paper edges stay balanced — do not left-only indent (that pushes empty
 * space to the right).
 */
export function toPlainReceipt(text: string, charsPerLine = 32): string {
  const width = Math.max(16, Math.min(96, charsPerLine));
  const mapped = sanitizeEscPosText(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => {
      const centered = line.match(/^<(?:C|CB|CD|CM)>(.*)<\/(?:C|CB|CD|CM)>\s*$/);
      if (centered) {
        const body = clipCols(centered[1].replace(/<\/?[A-Z]+>/g, '').trim(), width);
        if (!body) return '';
        const pad = Math.max(0, Math.floor((width - colLength(body)) / 2));
        return `${' '.repeat(pad)}${body}`;
      }
      const bold = line.match(/^<B>(.*)<\/B>\s*$/);
      if (bold) {
        return clipCols(bold[1].replace(/<\/?[A-Z]+>/g, ''), width);
      }
      const cleaned = line.replace(/<\/?[A-Z]+>/g, '');
      if (!cleaned.trim()) return '';
      if (colLength(cleaned) <= width) return cleaned;
      const lead = cleaned.match(/^ */)?.[0].length ?? 0;
      const body = clipCols(cleaned.trimStart(), Math.max(1, width - Math.min(lead, width - 1)));
      return `${' '.repeat(Math.min(lead, width - colLength(body)))}${body}`;
    });

  const lines: string[] = [];
  for (const line of mapped) {
    if (line.length === 0) {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    lines.push(line);
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type ThermalHtmlPaper = '58' | '80';

/**
 * Roll-paper receipt HTML for system / browser / Electron print.
 *
 * Layout:
 *   page = paper width (58 or 80 mm)
 *   58 mm → 30 cols, larger left padding (80→58 converter offset)
 *   80 mm → 48 cols, equal side padding
 *
 * Font is sized to fill the content band. Regular weight stays readable on thermal;
 * heavy bold fills in the letters and prints as a dark smear.
 * Never uses `100vw` (that ignored paper size and clipped the right edge).
 */
export function buildThermalHtml(
  text: string,
  charsPerLine: number,
  paper: ThermalHtmlPaper = charsPerLine <= 32 ? '58' : '80',
) {
  const cols = receiptCharsForPaper(paper);
  const source = String(text || '').replace(/\r/g, '');
  const shopTitles = [...source.matchAll(/<CB>(.*?)<\/CB>/g)].map((m) => m[1].trim()).filter(Boolean);
  // Drop CB lines from body — they render as a large heading above the monospace strip.
  const withoutShop = source.replace(/^.*<CB>.*?<\/CB>.*$/gm, '');
  const paperMm = paper === '58' ? 58 : 80;
  // 58 mm: extra left padding for converter offset; 80 mm: equal sides.
  const sideLeftMm = paper === '58' ? 4 : 2.5;
  const sideRightMm = paper === '58' ? 2 : 2.5;
  const printableMm = Number((paperMm - sideLeftMm - sideRightMm).toFixed(2));
  const glyphEm = paper === '58' ? 0.62 : 0.55;
  const fontMm = Number((Math.max(8, printableMm) / cols / glyphEm).toFixed(4));
  const shopFontMm = Number((fontMm * 1.55).toFixed(4));
  const lineMm = fontMm * 1.55;
  const bodyLines = withoutShop.split('\n');
  const lineCount = Math.max(1, bodyLines.filter((line) => line.trim()).length + shopTitles.length * 2);
  const heightMm = Math.max(80, Math.ceil(lineCount * lineMm + 20));
  const shopHtml = shopTitles
    .map((title) => `<div class="shop">${escapeHtml(title)}</div>`)
    .join('');
  const bodyHtml = bodyLines
    .map((line) => {
      const centered = line.match(/^<C>(.*)<\/C>\s*$/);
      if (centered) {
        const body = centered[1].replace(/<\/?[A-Z]+>/g, '').trim();
        return body ? `<div class="center">${escapeHtml(body)}</div>` : '';
      }
      const plainLine = toPlainReceipt(line, cols);
      if (!plainLine) return '';
      return `<div class="line">${escapeHtml(plainLine)}</div>`;
    })
    .join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Receipt ${paperMm}mm · ${cols} cols</title>
<style>
@page { size: ${paperMm}mm ${heightMm}mm; margin: 0; }
html, body {
  margin: 0;
  padding: 0;
  width: ${paperMm}mm;
  max-width: ${paperMm}mm;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.shop {
  box-sizing: border-box;
  width: ${paperMm}mm;
  max-width: ${paperMm}mm;
  padding: 2mm ${sideRightMm}mm 1mm ${sideLeftMm}mm;
  font-family: Arial, Helvetica, ${DEVANAGARI_FONTS}, sans-serif;
  font-weight: 600;
  font-size: ${shopFontMm}mm;
  line-height: 1.5;
  text-align: center;
  color: #000;
  -webkit-font-smoothing: none;
  font-smooth: never;
  text-rendering: geometricPrecision;
}
.body {
  box-sizing: border-box;
  width: ${paperMm}mm;
  max-width: ${paperMm}mm;
  /* 58 mm: larger left padding for converter; 80 mm: equal sides */
  padding: 1mm ${sideRightMm}mm 8mm ${sideLeftMm}mm;
}
.center, .line {
  box-sizing: border-box;
  margin: 0;
  font-weight: 500;
  font-size: ${fontMm}mm;
  line-height: 1.55;
  padding-top: 0.4mm;
  color: #000;
  -webkit-font-smoothing: none;
  font-smooth: never;
  text-rendering: geometricPrecision;
}
.center {
  text-align: center;
  font-family: Arial, Helvetica, ${DEVANAGARI_FONTS}, sans-serif;
}
.line {
  font-family: "Courier New", Courier, ${DEVANAGARI_FONTS}, ui-monospace, monospace;
  letter-spacing: 0;
  font-kerning: none;
  font-variant-ligatures: none;
  white-space: pre;
  overflow: hidden;
}
@media print {
  html, body, .body, .shop {
    width: ${paperMm}mm !important;
    max-width: ${paperMm}mm !important;
  }
  .shop {
    font-size: ${shopFontMm}mm !important;
    font-weight: 600 !important;
    line-height: 1.5 !important;
  }
  .center, .line {
    font-size: ${fontMm}mm !important;
    font-weight: 500 !important;
    line-height: 1.55 !important;
    -webkit-font-smoothing: none !important;
    font-smooth: never !important;
  }
}
</style></head><body>${shopHtml}<div class="body">${bodyHtml}</div></body></html>`;

  return {
    html,
    paperMm,
    heightMm,
    charsPerLine: cols,
    printableMm,
    sideMm: sideLeftMm,
    sideLeftMm,
    sideRightMm,
  };
}

export function bytesToBase64(bytes: number[]): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    const c = i + 2 < bytes.length ? bytes[i + 2] : NaN;
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}

/**
 * Minimal ESC/POS — same approach as typical clean POS apps:
 * Font A, normal size, no bold/double-width (those look blurred on many 58/80mm printers).
 * Centering is done with spaces in the text, not hardware bold/size.
 */
const ESC = {
  INIT: [0x1b, 0x40],
  /** Font A (standard sharp font) */
  FONT_A: [0x1b, 0x4d, 0x00],
  /** Default line spacing */
  LINE_SPACING: [0x1b, 0x32],
  /** Clear emphasize + size */
  NORMAL_MODE: [0x1b, 0x45, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x21, 0x00],
  ALIGN_LEFT: [0x1b, 0x61, 0x00],
  FEED_TAIL: [0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a],
  /** Partial cut (ignored by printers without cutter) */
  CUT: [0x1d, 0x56, 0x01],
};

/**
 * Print-area dots for Font A (~12 dots/char @ 203 dpi).
 *
 * - 58 mm / 2″ (≤32 cols): **384-dot** page, **left margin** for 80→58 converter
 *   paper offset (content width = page − margin).
 * - 80 mm (48 cols): **576-dot** page, left 0 (unchanged).
 */
export function receiptPrintArea(charsPerLine: number): {
  leftDots: number;
  widthDots: number;
  rightDots: number;
  paperDots: number;
} {
  const cols = Math.max(16, Math.min(96, charsPerLine));
  const charDots = 12;
  // 2″ (58 mm) → 384 dots; 3″ (80 mm) → 576 dots.
  const paperDots = cols <= 32 ? 384 : 576;
  const contentDots = cols * charDots;

  if (cols <= 32) {
    // Converter often seats paper a few mm in from the head’s left edge.
    const leftDots = MARGIN_58_LEFT_DOTS;
    const widthDots = Math.min(contentDots, paperDots - leftDots) & ~1;
    const rightDots = Math.max(0, paperDots - leftDots - widthDots);
    return { leftDots, widthDots, rightDots, paperDots };
  }

  const leftover = Math.max(0, paperDots - contentDots);
  let leftDots = Math.floor(leftover / 2) & ~1;
  let rightDots = leftover - leftDots;
  if (rightDots - leftDots > 1) {
    leftDots += 2;
    rightDots = leftover - leftDots;
  }
  const widthDots = Math.max(0, paperDots - leftDots - rightDots) & ~1;
  rightDots = Math.max(0, paperDots - leftDots - widthDots);
  return { leftDots, widthDots, rightDots, paperDots };
}

/** True for 58 mm / 2″ roll jobs (Font A, ≤32 cols). */
export function is58mmChars(charsPerLine: number): boolean {
  return charsPerLine <= 32;
}

function canDrawCanvas(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** Bundled face when the desktop app has loaded it; otherwise Windows system faces. */
function canvasIndicFont(px: number): string {
  const loaded =
    typeof document !== 'undefined' &&
    ((globalThis as { __kdsIndicFont?: boolean }).__kdsIndicFont ||
      document.fonts?.check?.(`400 ${px}px KdsDevanagari`));
  const family = loaded ? 'KdsDevanagari' : '"Nirmala UI", "Noto Sans Devanagari", Mangal';
  return `400 ${px}px ${family}, sans-serif`;
}

/** Shop name: medium weight so the counters stay open on a thermal head. */
function canvasShopFont(px: number, indic: boolean): string {
  if (indic) return canvasIndicFont(px);
  return `600 ${px}px Arial, Helvetica, sans-serif`;
}

/** Qty / rate / amount sitting on the same row as a Marathi item name. */
function splitAmountTail(line: string): { name: string; tail: string } | null {
  const match = line.match(/^(.*\S)\s+(\d+(?:\.\d+)?\s+\d+\.\d{2}\s+\d+\.\d{2})\s*$/);
  if (!match || !hasDevanagari(match[1])) return null;
  return { name: match[1].trim(), tail: match[2].trim() };
}

function centeredBody(line: string): string | null {
  const body = line.trim();
  if (!body || body === line) return null;
  // Centered receipt lines are left-padded only, so a trailing pad is not required.
  const lead = line.length - line.trimStart().length;
  if (lead >= 2) return body;
  return null;
}

/** Room above Devanagari so vowel signs are not sliced off the raster. */
function textBox(measure: CanvasRenderingContext2D, sample: string, fontSize: number) {
  const probe = measure.measureText(sample) as TextMetrics & {
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
  };
  const ascent = Math.ceil(
    Math.max(probe.fontBoundingBoxAscent || 0, probe.actualBoundingBoxAscent || 0, fontSize * 1.05),
  );
  const descent = Math.ceil(
    Math.max(probe.fontBoundingBoxDescent || 0, probe.actualBoundingBoxDescent || 0, fontSize * 0.45),
  );
  const padTop = Math.ceil(fontSize * 0.32);
  return { ascent, descent, padTop };
}

function wrapByPixels(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const parts = graphemes(text);
  const lines: string[] = [];
  let current = '';
  for (const part of parts) {
    const next = current + part;
    if (!current || ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    lines.push(current);
    current = part;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

/**
 * Snap canvas glyphs to pure black/white.
 * Soft antialiased edges print as gray blur on 203 dpi thermal heads.
 */
function hardenRasterPixels(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 108,
) {
  void width;
  void height;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // Keep only the dark core. Gray edges and a thicker stroke print as a dark blur.
    const on = lum < threshold;
    const v = on ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
  }
}

/** One receipt line drawn with a Devanagari font, as a black/white raster. */
function renderIndicRaster(
  text: string,
  widthPx: number,
  opts?: { fontSize?: number; center?: boolean; padTop?: number },
): { width: number; widthBytes: number; height: number; data: Uint8Array } {
  const width = Math.max(8, widthPx);
  const fontSize = opts?.fontSize ?? 20;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('Could not draw the Marathi receipt line.');
  measure.font = canvasIndicFont(fontSize);

  const paddedCenter = opts?.center ? null : centeredBody(text);
  const amounts = opts?.center || paddedCenter ? null : splitAmountTail(text);
  const nameSource = opts?.center
    ? text.trim()
    : paddedCenter || amounts?.name || text.trim() || text;
  const tail = amounts?.tail || '';
  const tailWidth = tail ? measure.measureText(tail).width + 8 : 0;
  const centered = Boolean(opts?.center || paddedCenter);
  const nameMax = Math.max(40, width - tailWidth - 4);
  const rows = wrapByPixels(measure, nameSource, centered ? width - 8 : nameMax);

  const box = textBox(measure, 'ईंशिाी्ॐ', fontSize);
  const padTop = opts?.padTop ?? box.padTop;
  const ascent = box.ascent;
  const descent = box.descent;
  const rowH = Math.ceil(ascent + descent + padTop);
  const height = Math.max(rowH, rowH * rows.length);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not draw the Marathi receipt line.');
  ctx.imageSmoothingEnabled = false;
  (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = 'geometricPrecision';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = canvasIndicFont(fontSize);
  ctx.textBaseline = 'alphabetic';

  rows.forEach((row, index) => {
    const baseline = Math.round(ascent + padTop + index * rowH);
    if (centered) {
      ctx.textAlign = 'center';
      ctx.fillText(row, Math.round(width / 2), baseline);
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillText(row, 2, baseline);
    if (tail && index === 0) {
      ctx.font = canvasIndicFont(fontSize);
      ctx.textAlign = 'right';
      ctx.fillText(tail, width - 2, baseline);
      ctx.font = canvasIndicFont(fontSize);
    }
  });

  const image = ctx.getImageData(0, 0, width, height);
  hardenRasterPixels(image.data, width, height);
  ctx.putImageData(image, 0, 0);

  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const px = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (px[i] > 127) continue;
      data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, widthBytes, height, data };
}

/**
 * ESC * 24-dot bit image.
 * GS v 0 is skipped by a lot of 58/80 mm heads, and the bitmap bytes then print as ???.
 */
function appendBitImage(
  out: number[],
  raster: { width: number; widthBytes: number; height: number; data: Uint8Array },
) {
  const { width, widthBytes, height, data } = raster;
  const black = (x: number, y: number) => {
    if (x >= width || y >= height) return false;
    return (data[y * widthBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  };
  out.push(0x1b, 0x33, 24);
  for (let band = 0; band < height; band += 24) {
    out.push(0x1b, 0x2a, 33, width & 0xff, (width >> 8) & 0xff);
    for (let x = 0; x < width; x += 1) {
      for (let k = 0; k < 3; k += 1) {
        let slice = 0;
        for (let b = 0; b < 8; b += 1) {
          if (black(x, band + k * 8 + b)) slice |= 0x80 >> b;
        }
        out.push(slice);
      }
    }
    out.push(0x0a);
  }
  out.push(0x1b, 0x32);
}

/**
 * Large centered shop name as a hard B/W raster (English + Marathi).
 * Avoids GS ! double-width, which softens edges on many 58/80 mm printers.
 */
function renderShopTitleRaster(
  text: string,
  widthPx: number,
): { width: number; widthBytes: number; height: number; data: Uint8Array } {
  const width = Math.max(8, widthPx);
  const indic = hasDevanagari(text);
  // Scale with paper, but stay light enough that letters do not fill in.
  const fontSize = Math.max(22, Math.min(32, Math.round(width * (indic ? 0.055 : 0.058))));
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('Could not draw the shop name.');
  measure.font = canvasShopFont(fontSize, indic);

  // Latin → uppercase for punch; Devanagari stays as typed.
  const body = indic ? text.trim() : text.trim().toUpperCase();
  const rows = wrapByPixels(measure, body, width - 16);
  const box = textBox(measure, indic ? 'ईंशिाी्ॐ' : 'Hg', fontSize);
  const ascent = box.ascent;
  const descent = box.descent;
  const padTop = Math.max(8, box.padTop);
  const padBottom = 6;
  const rowH = Math.ceil(ascent + descent + 6);
  const height = Math.max(rowH + padTop + padBottom, rowH * rows.length + padTop + padBottom);

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not draw the shop name.');
  ctx.imageSmoothingEnabled = false;
  (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = 'geometricPrecision';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = canvasShopFont(fontSize, indic);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  rows.forEach((row, index) => {
    const baseline = Math.round(padTop + ascent + index * rowH);
    ctx.fillText(row, Math.round(width / 2), baseline);
  });

  const image = ctx.getImageData(0, 0, width, height);
  hardenRasterPixels(image.data, width, height);
  ctx.putImageData(image, 0, 0);

  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const px = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (px[i] > 127) continue;
      data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, widthBytes, height, data };
}

function appendShopTitle(out: number[], title: string, widthPx: number) {
  const body = title.replace(/<\/?[A-Z]+>/g, '').trim();
  if (!body) {
    out.push(0x0a);
    return;
  }
  // Desktop / web: large mono raster — clearest shop name on thermal.
  if (canDrawCanvas()) {
    out.push(0x1b, 0x61, 0x00);
    appendBitImage(out, renderShopTitleRaster(body, widthPx));
    return;
  }
  // Native fallback: double-height only (not double-width) + bold.
  out.push(
    0x1b, 0x4a, 8,
    0x1b, 0x61, 0x01,
    0x1b, 0x45, 0x01,
    0x1d, 0x21, 0x01,
    0x1b, 0x21, 0x18,
  );
  const upper = body.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    const code = upper.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) out.push(code);
  }
  out.push(0x0a, 0x1d, 0x21, 0x00, 0x1b, 0x45, 0x00, 0x1b, 0x21, 0x00, 0x1b, 0x61, 0x00);
}

function appendPlainChars(out: number[], text: string) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) out.push(code);
  }
  out.push(0x0a);
}

function appendReceiptLine(out: number[], line: string, charsPerLine: number, widthPx: number) {
  const title = line.match(/^<CB>(.*)<\/CB>\s*$/);
  if (title) {
    appendShopTitle(out, title[1], widthPx);
    return;
  }
  const centeredTag = line.match(/^<C>(.*)<\/C>\s*$/);
  if (centeredTag) {
    const body = centeredTag[1].replace(/<\/?[A-Z]+>/g, '').trim();
    if (!body) {
      out.push(0x0a);
      return;
    }
    if (hasDevanagari(body) && canDrawCanvas()) {
      out.push(0x1b, 0x61, 0x00);
      appendBitImage(out, renderIndicRaster(body, widthPx, { center: true }));
      return;
    }
    out.push(0x1b, 0x61, 0x01);
    appendPlainChars(out, body);
    out.push(0x1b, 0x61, 0x00);
    return;
  }
  const plain = toPlainReceipt(line, charsPerLine);
  if (!plain) {
    if (!line.trim()) out.push(0x0a);
    return;
  }
  if (hasDevanagari(plain) && canDrawCanvas()) {
    const centered = centeredBody(plain);
    appendBitImage(out, renderIndicRaster(centered || plain, widthPx, { center: Boolean(centered) }));
    return;
  }
  appendPlainChars(out, plain);
}

/**
 * Encode receipt as sharp plain ESC/POS.
 *
 * Page/print area follows paper size:
 * - 58 mm (2″): GS L ≈ 3 mm, GS W = remaining 2″ band
 * - 80 mm: GS L=0, GS W=576
 */
export function buildEscPosBytes(text: string, charsPerLine = 32): number[] {
  const source = String(text || '').replace(/\r/g, '');
  const { leftDots, widthDots } = receiptPrintArea(charsPerLine);
  const out: number[] = [
    ...ESC.INIT,
    ...ESC.FONT_A,
    ...ESC.LINE_SPACING,
    ...ESC.NORMAL_MODE,
    ...ESC.ALIGN_LEFT,
    // GS L — left margin (58 mm converter inset; 0 on 80 mm)
    0x1d, 0x4c, leftDots & 0xff, (leftDots >> 8) & 0xff,
    // GS W — print area width inside the 2″ / 3″ page
    0x1d, 0x57, widthDots & 0xff, (widthDots >> 8) & 0xff,
    // Do not send ESC j (reverse feed): many POS printers ignore ESC and
    // print the rest as text → first line shows "jx" (j + n=120).
  ];

  if (hasDevanagari(source) && canDrawCanvas()) {
    // Leave UTF-8 / Chinese character mode so the image is not printed as ???.
    out.push(0x1c, 0x2e, 0x1b, 0x74, 0x00);
  }
  for (const line of source.split('\n')) {
    appendReceiptLine(out, line, charsPerLine, widthDots);
  }

  if (!out.length || out[out.length - 1] !== 0x0a) out.push(0x0a);
  out.push(...ESC.FEED_TAIL);
  out.push(...ESC.CUT);
  return out;
}

export function utf8ToBase64(value: string): string {
  const utf8 = unescape(encodeURIComponent(value));
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < utf8.length; i += 3) {
    const a = utf8.charCodeAt(i);
    const b = i + 1 < utf8.length ? utf8.charCodeAt(i + 1) : NaN;
    const c = i + 2 < utf8.length ? utf8.charCodeAt(i + 2) : NaN;
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'document';
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function estimatePrintFlushMs(text: string): number {
  const lines = Math.max(1, text.split('\n').length);
  return Math.min(4000, Math.max(700, 300 + lines * 40));
}
