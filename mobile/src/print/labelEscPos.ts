import { encodeBarcode, isValidEan13 } from './barcodeEncode';
import { DEVANAGARI_FONTS, graphemes, hasDevanagari } from './indicText';
import {
  clipThermal,
  drawThermalText,
  thermalHeight,
  thermalWidth,
} from './thermalFont';

export type GapLabelContent = {
  shopName: string;
  productName: string;
  detail: string;
  barcode: string;
  mrp: string;
  price: string;
};

/** Same physical sticker as Android Microlan path. */
export const LABEL_WIDTH_MM = 50;
/** Default sticker height — must match the loaded roll or gap feed drifts. */
export const LABEL_HEIGHT_MM = 28;
export type LabelHeightMm = 25 | 28 | 30;
export const LABEL_HEIGHT_OPTIONS: LabelHeightMm[] = [30, 28, 25];

/**
 * 58 mm head ≈ 384 dots @ 203 dpi.
 * Render at this width (not 50×8=400) so we never downscale — that softens text.
 */
const PRINTER_WIDTH_PX = 384;
const LABEL_WIDTH_PX = PRINTER_WIDTH_PX;

export function normalizeLabelHeightMm(value?: number | null): LabelHeightMm {
  if (value === 25 || value === 30) return value;
  return 28;
}

/** Exact Android formula — do not shrink. Short rasters underfeed and cut after a few stickers. */
function labelHeightPx(heightMm: LabelHeightMm): number {
  return Math.floor((LABEL_WIDTH_PX * heightMm) / LABEL_WIDTH_MM);
}

const ESC_INIT = [0x1b, 0x40];
/** Gap / black-mark form-feed (same as SDKDemoApk). */
const LABEL_FORM_FEED = [0x1d, 0x0c];

function requireCanvas(): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('Label printing needs the KDSPOZ desktop app.');
  }
  return document.createElement('canvas');
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '..';
  const parts = graphemes(text);
  let end = parts.length;
  while (end > 0 && ctx.measureText(`${parts.slice(0, end).join('')}${ellipsis}`).width > maxWidth) {
    end -= 1;
  }
  return end <= 0 ? ellipsis : `${parts.slice(0, end).join('')}${ellipsis}`;
}

function setPrinterFont(ctx: CanvasRenderingContext2D, sizePx: number, bold = false) {
  const size = Math.max(10, Math.round(sizePx));
  const weight = bold ? '700' : '400';
  const family = `Arial, Helvetica, "Segoe UI", ${DEVANAGARI_FONTS}, sans-serif`;
  ctx.font = `${weight} ${size}px ${family}`;
}

/** Human-readable barcode digits — normal monospace, integer px. */
function setDigitFont(ctx: CanvasRenderingContext2D, sizePx: number) {
  const size = Math.max(13, Math.round(sizePx));
  ctx.font = `400 ${size}px "Courier New", Courier, ui-monospace, monospace`;
}

/** Single clean draw on integer pixels. */
function drawCleanText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.fillText(text, Math.round(x), Math.round(y));
}

/**
 * Spaced barcode digits under the bars — far easier to read on thermal than a tight string.
 * Drawn digit-by-digit so gaps stay open after mono harden.
 */
function drawSpacedDigits(
  ctx: CanvasRenderingContext2D,
  code: string,
  centerX: number,
  baselineY: number,
  sizePx: number,
  maxWidth: number,
) {
  const raw = code.replace(/\s+/g, '');
  if (!raw) return;
  setDigitFont(ctx, sizePx);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const gap = Math.max(2, Math.round(sizePx / 6));
  const widths = Array.from(raw).map((ch) => ctx.measureText(ch).width);
  let total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, raw.length - 1);
  let size = sizePx;
  while (total > maxWidth && size > 13) {
    size -= 1;
    setDigitFont(ctx, size);
    for (let i = 0; i < raw.length; i += 1) widths[i] = ctx.measureText(raw[i]).width;
    total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, raw.length - 1);
  }
  let x = Math.round(centerX - total / 2);
  const y = Math.round(baselineY);
  ctx.fillStyle = '#000';
  for (let i = 0; i < raw.length; i += 1) {
    ctx.fillText(raw[i], x, y);
    x += Math.round(widths[i] + gap);
  }
}

/**
 * Draw barcode as solid run-length bars (same as Android).
 * Per-module rounding left hairline gaps that looked "broken" on thermal.
 * Do not thicken/dilate — that merges bars and hurts scanning.
 */
function drawBarcodeBars(
  ctx: CanvasRenderingContext2D,
  barcode: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  let modules = '';
  try {
    modules = encodeBarcode(barcode);
  } catch {
    modules = '1011001101011001101001101101001';
  }
  const quiet = 10;
  const total = modules.length + quiet * 2;
  const left = Math.floor(x);
  const span = Math.max(total, Math.floor(width));
  const top = Math.floor(y);
  const bottom = Math.max(top + 1, Math.floor(y + height));
  // Integer columns so a 1-module gap never rounds away to nothing.
  const col = (index: number) => left + Math.floor((index * span) / total);
  ctx.fillStyle = '#fff';
  ctx.fillRect(left, top, span, bottom - top);
  ctx.fillStyle = '#000';
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== '1') {
      i += 1;
      continue;
    }
    let run = 1;
    while (i + run < modules.length && modules[i + run] === '1') run += 1;
    const start = col(quiet + i);
    const end = col(quiet + i + run);
    if (end > start) ctx.fillRect(start, top, end - start, bottom - top);
    i += run;
  }
}

/**
 * Snap text to pure black/white (strict cut — soft gray edges look blurry on thermal).
 * Optional 1px thicken is for thin Indic strokes only — never use it on barcode bars.
 */
function hardenToMono(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts?: { thicken?: boolean; y0?: number; y1?: number },
) {
  const thicken = opts?.thicken === true;
  const y0 = Math.max(0, opts?.y0 ?? 0);
  const y1 = Math.min(height, opts?.y1 ?? height);
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let y = y0; y < y1; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = px[i + 3];
      if (alpha < 128) {
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
        px[i + 3] = 255;
        continue;
      }
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      // Mid cut. A high cut (168) kept the gray halo and printed as a dark smear.
      const on = lum < 128;
      const v = on ? 0 : 255;
      px[i] = v;
      px[i + 1] = v;
      px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  if (thicken) {
    const copy = new Uint8ClampedArray(px);
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (copy[i] === 0) continue;
        const left = x > 0 && copy[i - 4] === 0;
        const right = x + 1 < width && copy[i + 4] === 0;
        if (left || right) {
          px[i] = 0;
          px[i + 1] = 0;
          px[i + 2] = 0;
        }
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Fit human-readable barcode into the footer strip (long Code 128 codes shrink). */
function fitBarcodeDigits(
  ctx: CanvasRenderingContext2D,
  code: string,
  maxWidth: number,
  preferredSize: number,
): { text: string; size: number } {
  const raw = code.replace(/\s+/g, '');
  let size = preferredSize;
  while (size >= 13) {
    setDigitFont(ctx, size);
    if (ctx.measureText(raw).width <= maxWidth) return { text: raw, size };
    size -= 1;
  }
  setDigitFont(ctx, 13);
  return { text: ellipsize(ctx, raw, maxWidth), size: 13 };
}

/**
 * Marathi has no thermal bitmap. Draw it large, then keep a dot only when most of
 * that block is ink, so the gray outline halo does not print as a blur.
 */
function drawSnappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  size: number,
  maxWidth: number,
  align: 'left' | 'center' | 'right',
): number {
  const zoom = 3;
  setPrinterFont(ctx, size, false);
  const clipped = ellipsize(ctx, text, Math.max(8, maxWidth));
  const textW = Math.max(1, Math.ceil(ctx.measureText(clipped).width));
  const textH = size + 2;
  const off = requireCanvas();
  off.width = textW * zoom;
  off.height = textH * zoom;
  const pen = off.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!pen) return textW;
  pen.fillStyle = '#fff';
  pen.fillRect(0, 0, off.width, off.height);
  pen.fillStyle = '#000';
  setPrinterFont(pen, size * zoom, false);
  pen.textBaseline = 'top';
  pen.textAlign = 'left';
  pen.fillText(clipped, 0, zoom);
  const image = pen.getImageData(0, 0, off.width, off.height);
  const px = image.data;
  let destX = Math.round(x);
  if (align === 'center') destX = Math.round(x - textW / 2);
  if (align === 'right') destX = Math.round(x - textW);
  const destY = Math.round(top);
  const need = Math.ceil((zoom * zoom) / 2);
  ctx.fillStyle = '#000';
  for (let py = 0; py < textH; py += 1) {
    for (let pxX = 0; pxX < textW; pxX += 1) {
      let dark = 0;
      for (let sy = 0; sy < zoom; sy += 1) {
        for (let sx = 0; sx < zoom; sx += 1) {
          const i = ((py * zoom + sy) * off.width + (pxX * zoom + sx)) * 4;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum < 150) dark += 1;
        }
      }
      if (dark >= need) ctx.fillRect(destX + pxX, destY + py, 1, 1);
    }
  }
  return textW;
}

function pieceWidth(ctx: CanvasRenderingContext2D, text: string, scaleX: number, size: number): number {
  if (!text) return 0;
  if (hasDevanagari(text)) {
    setPrinterFont(ctx, size, false);
    return Math.ceil(ctx.measureText(text).width);
  }
  return thermalWidth(text, scaleX, 2);
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  scaleX: number,
  scaleY: number,
  maxWidth: number,
  align: 'left' | 'center' | 'right',
): void {
  if (!text) return;
  if (hasDevanagari(text)) {
    drawSnappedText(ctx, text, x, top, thermalHeight(scaleY), maxWidth, align);
    return;
  }
  const drawn = clipThermal(text, maxWidth, scaleX, 2);
  const width = thermalWidth(drawn, scaleX, 2);
  let left = Math.round(x);
  if (align === 'center') left = Math.round(x - width / 2);
  if (align === 'right') left = Math.round(x - width);
  drawThermalText(ctx, drawn, left, top, scaleX, scaleY, 2);
}

/**
 * Canvas layout matches Android LabelBitmap.kt (50×H mm thermal sticker @ 384×H).
 * Latin text is a thermal bitmap font (solid dots). Marathi is snapped onto that same grid.
 * Height must match the physical roll or gap form-feed skips a sticker.
 */
export function renderGapLabelCanvas(
  content: GapLabelContent,
  heightMm: LabelHeightMm = LABEL_HEIGHT_MM,
): HTMLCanvasElement {
  const width = LABEL_WIDTH_PX;
  const height = labelHeightPx(normalizeLabelHeightMm(heightMm));
  const canvas = requireCanvas();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Could not prepare the label image.');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.imageSmoothingEnabled = false;

  /**
   * Shop is double-height thermal dots (16×24). Product, price, and barcode
   * digits are 16×16. Every stroke is a whole printer dot.
   */
  const padX = 8;
  const padY = 8;
  const shopSX = 2;
  const shopSY = 3;
  const bodySX = 2;
  const bodySY = 2;
  const shopH = thermalHeight(shopSY);
  const bodyH = thermalHeight(bodySY);
  const digitH = thermalHeight(2);
  const bottomClear = 16;
  const footerReserve = digitH + 4 + bottomClear;
  let y = padY;

  const shopSource = (content.shopName.trim() || 'Shop').replace(/[A-Za-z]+/g, (word) => word.toUpperCase());
  const productSource = content.productName.trim() || 'Product';
  const qtyText = content.detail.trim();
  const priceText = (content.price || content.mrp || '').trim();

  drawPiece(ctx, shopSource, width / 2, y, shopSX, shopSY, width - padX * 2, 'center');
  y += shopH + 4;

  const rowTop = y;
  const priceW = pieceWidth(ctx, priceText, bodySX, bodyH);
  const qtyW = pieceWidth(ctx, qtyText, bodySX, bodyH);
  const between = qtyText && priceText ? 8 : 0;
  let rightEdge = width - padX;
  if (priceText) {
    drawPiece(ctx, priceText, rightEdge, rowTop, bodySX, bodySY, priceW + 4, 'right');
    rightEdge -= priceW + between;
  }
  if (qtyText) {
    drawPiece(ctx, qtyText, rightEdge, rowTop, bodySX, bodySY, qtyW + 4, 'right');
    rightEdge -= qtyW + 8;
  }
  const leftMax = Math.max(48, rightEdge - padX);
  drawPiece(ctx, productSource, padX, rowTop, bodySX, bodySY, leftMax, 'left');
  y = rowTop + bodyH + 3;

  ctx.fillStyle = '#000';
  ctx.fillRect(padX, Math.round(y), width - padX * 2, 1);
  y += 4;

  const code = content.barcode.trim().replace(/\s+/g, '') || '2000000000008';
  const barTop = Math.min(Math.floor(y), Math.max(0, height - footerReserve - 24));
  const barBottom = Math.min(height - footerReserve, Math.max(barTop + 24, height - footerReserve));
  const barH = Math.max(22, barBottom - barTop);
  drawBarcodeBars(ctx, code, padX, barTop, width - padX * 2, barH);

  const digitTop = barTop + barH + 3;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, Math.max(0, digitTop), width, height - Math.max(0, digitTop));
  const digitMax = width - padX * 2;
  let digitScale = 2;
  let digitGap = 2;
  if (thermalWidth(code, digitScale, digitGap) > digitMax) digitGap = 1;
  if (thermalWidth(code, digitScale, digitGap) > digitMax) digitScale = 1;
  const digitW = thermalWidth(code, digitScale, digitGap);
  const digitDrawH = thermalHeight(digitScale);
  const digitY = Math.min(height - bottomClear - digitDrawH, digitTop);
  drawThermalText(ctx, code, Math.round((width - digitW) / 2), digitY, digitScale, digitScale, digitGap);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, height - bottomClear, width, bottomClear);
  return canvas;
}

function fitToPrinterWidth(source: HTMLCanvasElement, maxWidthPx: number): HTMLCanvasElement {
  if (source.width <= maxWidthPx) return source;
  const scale = maxWidthPx / source.width;
  const dstW = maxWidthPx;
  const dstH = Math.max(1, Math.round(source.height * scale));
  const out = requireCanvas();
  out.width = dstW;
  out.height = dstH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not scale the label image.');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, dstW, dstH);
  return out;
}

/** ESC/POS / TSPL raster from canvas pixels. */
function canvasToRaster(
  canvas: HTMLCanvasElement,
  opts?: { trim?: boolean },
): { widthBytes: number; height: number; data: Uint8Array } {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read the label image.');
  const { width, height } = canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const px = image.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = px[i + 3];
      if (alpha < 128) continue;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      // Strict cut keeps white barcode gaps open (soft threshold filled them in).
      if (lum >= 128) continue;
      data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const raster = { widthBytes, height, data };
  return opts?.trim === false ? raster : trimTrailingWhite(raster, 4);
}

/** Drop empty rows under the digits so GS FF seeks the gap (full white bottom drifts). */
function trimTrailingWhite(
  raster: { widthBytes: number; height: number; data: Uint8Array },
  padRows: number,
): { widthBytes: number; height: number; data: Uint8Array } {
  const { widthBytes, height, data } = raster;
  let last = -1;
  for (let y = height - 1; y >= 0; y -= 1) {
    const row = y * widthBytes;
    let ink = false;
    for (let x = 0; x < widthBytes; x += 1) {
      if (data[row + x]) {
        ink = true;
        break;
      }
    }
    if (ink) {
      last = y;
      break;
    }
  }
  if (last < 0) return raster;
  const nextH = Math.min(height, last + 1 + Math.max(0, padRows));
  if (nextH >= height) return raster;
  return { widthBytes, height: nextH, data: data.subarray(0, widthBytes * nextH) };
}

function buildRasterCommand(raster: { widthBytes: number; height: number; data: Uint8Array }): Uint8Array {
  const { widthBytes, height, data } = raster;
  // GS v 0 m xL xH yL yH d1…dk
  const out = new Uint8Array(8 + data.length);
  out[0] = 0x1d;
  out[1] = 0x76;
  out[2] = 0x30;
  out[3] = 0x00;
  out[4] = widthBytes & 0xff;
  out[5] = (widthBytes >> 8) & 0xff;
  out[6] = height & 0xff;
  out[7] = (height >> 8) & 0xff;
  out.set(data, 8);
  return out;
}

/** ~32 cols on a 50 mm sticker @ Font A (12-dot cells on a 384-dot head). */
const LABEL_TEXT_COLS = 32;

/** Printer text mode: ASCII only (₹ → Rs.). Marathi needs the raster path. */
function toPrinterText(text: string): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—·]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '?')
    .trim();
}

function clipPrinterText(text: string, maxCols: number): string {
  const raw = toPrinterText(text);
  if (raw.length <= maxCols) return raw;
  if (maxCols <= 2) return raw.slice(0, maxCols);
  return `${raw.slice(0, maxCols - 2)}..`;
}

function pushBytes(out: number[], bytes: ArrayLike<number>) {
  for (let i = 0; i < bytes.length; i += 1) out.push(bytes[i] & 0xff);
}

function pushAscii(out: number[], text: string) {
  for (let i = 0; i < text.length; i += 1) out.push(text.charCodeAt(i) & 0xff);
}

/** Native EAN-13 or Code 128 — printer draws sharp bars + HRI digits in its own font. */
function pushNativeBarcode(out: number[], code: string) {
  const value = code.replace(/\s+/g, '');
  // GS h height, GS w module, GS H HRI below, GS f Font A for HRI
  pushBytes(out, [0x1d, 0x68, 60, 0x1d, 0x77, 2, 0x1d, 0x48, 2, 0x1d, 0x66, 0]);
  if (isValidEan13(value)) {
    // GS k 67 12 + first 12 digits (printer computes check digit)
    pushBytes(out, [0x1d, 0x6b, 67, 12]);
    pushAscii(out, value.slice(0, 12));
    return;
  }
  // GS k 73 n {B + data — Code 128 set B
  const payload = `{B${value}`;
  pushBytes(out, [0x1d, 0x6b, 73, payload.length]);
  pushAscii(out, payload);
}

/**
 * One sticker using the printer's built-in Font A (not a soft canvas bitmap).
 * Layout: shop / product + qty + price / native barcode + HRI / GS FF.
 */
function buildNativeGapLabelUnit(content: GapLabelContent): number[] {
  const shop = clipPrinterText(
    (content.shopName.trim() || 'Shop').replace(/[A-Za-z]+/g, (w) => w.toUpperCase()),
    LABEL_TEXT_COLS,
  );
  const product = toPrinterText(content.productName.trim() || 'Product');
  const qty = toPrinterText(content.detail.trim());
  const price = toPrinterText((content.price || content.mrp || '').trim());
  const right = [qty, price].filter(Boolean).join('  ');
  const rightCols = Math.min(LABEL_TEXT_COLS, right.length);
  const leftCols = Math.max(4, LABEL_TEXT_COLS - rightCols - (right ? 1 : 0));
  const left = clipPrinterText(product, leftCols);
  const midPad = Math.max(1, LABEL_TEXT_COLS - left.length - right.length);
  const line2 = right ? `${left}${' '.repeat(midPad)}${right}` : left;
  const code = content.barcode.trim().replace(/\s+/g, '') || '2000000000008';

  const out: number[] = [];
  // Font A, normal size, no bold — printer default face (sharp on thermal).
  pushBytes(out, [
    0x1b, 0x4d, 0x00, // ESC M 0 Font A
    0x1b, 0x45, 0x00, // emphasize off
    0x1d, 0x21, 0x00, // GS ! normal char size
    0x1b, 0x21, 0x00, // ESC ! normal
    0x1b, 0x32, // default line spacing
  ]);
  pushBytes(out, [0x1b, 0x61, 0x01]); // center shop
  pushAscii(out, shop);
  out.push(0x0a);
  pushBytes(out, [0x1b, 0x61, 0x00]); // left product line
  pushAscii(out, line2.slice(0, LABEL_TEXT_COLS));
  out.push(0x0a);
  pushBytes(out, [0x1b, 0x61, 0x01]); // center barcode
  pushNativeBarcode(out, code);
  out.push(0x0a);
  pushBytes(out, LABEL_FORM_FEED);
  return out;
}

/** Full-bitmap fallback when Marathi/Devanagari cannot use printer text fonts. */
function buildRasterGapLabelUnit(content: GapLabelContent, heightMm: LabelHeightMm): number[] {
  const fitted = fitToPrinterWidth(
    renderGapLabelCanvas(content, normalizeLabelHeightMm(heightMm)),
    PRINTER_WIDTH_PX,
  );
  const rasterCmd = buildRasterCommand(canvasToRaster(fitted, { trim: false }));
  const out = new Uint8Array(rasterCmd.length + LABEL_FORM_FEED.length);
  out.set(rasterCmd, 0);
  out.set(LABEL_FORM_FEED, rasterCmd.length);
  return Array.from(out);
}

/**
 * ESC/POS label job. These printers print a GS v 0 image and ignore TSPL.
 * The image is hard black/white (no gray halo), so name, price, and bars stay separate.
 */
export function buildGapLabelEscPos(
  content: GapLabelContent,
  copies: number,
  heightMm: LabelHeightMm = LABEL_HEIGHT_MM,
): number[] {
  const count = Math.max(1, Math.min(999, Math.floor(copies) || 1));
  const unit = buildRasterGapLabelUnit(content, heightMm);
  const header = [
    0x1b, 0x40, // INIT
    0x1b, 0x61, 0x00, // left
    0x1d, 0x4c, 0x00, 0x00, // left margin 0
  ];
  const out: number[] = [...header];
  for (let i = 0; i < count; i += 1) out.push(...unit);
  return out;
}

/** Feed a few blanks via gap sensor so the head re-learns sticker edges. */
export function buildLabelCalibrateEscPos(): number[] {
  return [...ESC_INIT, ...LABEL_FORM_FEED, ...LABEL_FORM_FEED, ...LABEL_FORM_FEED];
}

function encodeAscii(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** 203 dpi. TSPL coordinates are dots on the sticker, not the 58 mm head. */
const TSPL_PAGE_WIDTH = LABEL_WIDTH_MM * 8;

type TsplFont = { id: string; w: number; h: number };

function tsplFont(heightMm: LabelHeightMm, role: 'shop' | 'body'): TsplFont {
  if (heightMm <= 25) return { id: '3', w: 16, h: 24 };
  if (role === 'shop') return { id: '4', w: 24, h: 32 };
  return { id: '3', w: 16, h: 24 };
}

function tsplAscii(text: string, maxChars: number): string {
  const raw = toPrinterText(text).replace(/"/g, "'");
  if (maxChars <= 0) return '';
  if (raw.length <= maxChars) return raw;
  if (maxChars <= 2) return raw.slice(0, maxChars);
  return `${raw.slice(0, maxChars - 2)}..`;
}

/** Printer-drawn bars + human-readable digits. Narrow gaps stay open at density 5. */
function tsplBarcodeLine(code: string, y: number, maxHeight: number, pageW: number): string {
  const height = Math.max(36, Math.min(110, Math.floor(maxHeight)));
  const value = code.replace(/\s+/g, '') || '2000000000008';
  if (isValidEan13(value)) {
    const narrow = 2;
    const bars = 95 * narrow;
    const x = Math.max(8, Math.floor((pageW - bars) / 2));
    return `BARCODE ${x},${y},"EAN13",${height},1,0,${narrow},2,"${value.slice(0, 12)}"`;
  }
  const safe = value.replace(/"/g, '');
  const n = Math.max(1, safe.length);
  let narrow = 2;
  let bars = (11 * n + 35) * narrow;
  if (bars > pageW - 16) {
    narrow = 1;
    bars = (11 * n + 35) * narrow;
  }
  const wide = narrow * 2;
  const x = Math.max(4, Math.floor((pageW - Math.min(bars, pageW - 8)) / 2));
  return `BARCODE ${x},${y},"128",${height},1,0,${narrow},${wide},"${safe}"`;
}

/**
 * Shop + product + price only. The barcode is a TSPL BARCODE command under this band,
 * so Marathi text can be a picture without turning the bars into a dark dither.
 */
function renderLabelTextBand(content: GapLabelContent): HTMLCanvasElement {
  const width = PRINTER_WIDTH_PX;
  const padX = 8;
  const shopSize = 22;
  const productSize = 20;
  const qtySize = 18;
  const priceSize = 22;
  const height = 4 + shopSize + 6 + Math.max(productSize, qtySize, priceSize) + 6;
  const canvas = requireCanvas();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Could not prepare the label image.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.imageSmoothingEnabled = false;

  const shopSource = (content.shopName.trim() || 'Shop').replace(/[A-Za-z]+/g, (word) => word.toUpperCase());
  const productSource = content.productName.trim() || 'Product';
  const qtyText = content.detail.trim();
  const priceText = (content.price || content.mrp || '').trim();

  setPrinterFont(ctx, shopSize, false);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const shop = ellipsize(ctx, shopSource, width - padX * 2);
  drawCleanText(ctx, shop, width / 2, 4);

  const nameY = 4 + shopSize + 6 + productSize;
  setPrinterFont(ctx, qtySize, false);
  const qtyW = qtyText ? ctx.measureText(qtyText).width : 0;
  setPrinterFont(ctx, priceSize, false);
  const priceW = priceText ? ctx.measureText(priceText).width : 0;
  const between = qtyText && priceText ? 8 : 0;
  const rightWidth = qtyW + between + priceW;
  const leftMax = Math.max(width * 0.28, width - padX * 2 - rightWidth - 8);
  setPrinterFont(ctx, productSize, false);
  const productText = ellipsize(ctx, productSource, leftMax);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  setPrinterFont(ctx, productSize, false);
  drawCleanText(ctx, productText, padX, nameY);
  if (qtyText || priceText) {
    ctx.textAlign = 'right';
    let x = width - padX;
    if (priceText) {
      setPrinterFont(ctx, priceSize, false);
      drawCleanText(ctx, priceText, x, nameY);
      x -= priceW + between;
    }
    if (qtyText) {
      setPrinterFont(ctx, qtySize, false);
      drawCleanText(ctx, qtyText, x, nameY);
    }
  }
  hardenToMono(ctx, width, height, { thicken: false });
  return canvas;
}

/**
 * Desktop label job in the printer's own language (same idea as the Seznik design app).
 * Letters and the barcode are printer fonts, not a softened picture.
 * Density 5 keeps the heat low so strokes do not bleed together.
 * Marathi names are a short sharp picture; the barcode is still a printer command.
 */
export function buildGapLabelTspl(
  content: GapLabelContent,
  copies: number,
  heightMm: LabelHeightMm = LABEL_HEIGHT_MM,
): number[] {
  const hMm = normalizeLabelHeightMm(heightMm);
  const count = Math.max(1, Math.min(999, Math.floor(copies) || 1));
  const pageW = TSPL_PAGE_WIDTH;
  const pageH = hMm * 8;
  const indic = hasDevanagari(
    `${content.shopName} ${content.productName} ${content.detail} ${content.price} ${content.mrp}`,
  );
  const code = content.barcode.trim().replace(/\s+/g, '') || '2000000000008';
  const header = [
    `SIZE ${LABEL_WIDTH_MM} mm,${hMm} mm`,
    'GAP 2 mm,0 mm',
    'DENSITY 5',
    'SPEED 4',
    'DIRECTION 1',
    'REFERENCE 0,0',
    'CLS',
  ];

  const hri = 22;
  const margin = 10;
  let barcodeY = 70;

  if (!indic) {
    const shopFont = tsplFont(hMm, 'shop');
    const bodyFont = tsplFont(hMm, 'body');
    const shop = tsplAscii(
      (content.shopName.trim() || 'Shop').replace(/[A-Za-z]+/g, (word) => word.toUpperCase()),
      Math.floor((pageW - 16) / shopFont.w),
    );
    const shopX = Math.max(8, Math.floor((pageW - shop.length * shopFont.w) / 2));
    const shopY = 6;
    const bodyY = shopY + shopFont.h + 4;
    const maxRightDots = Math.floor(pageW * 0.46);
    const price = tsplAscii((content.price || content.mrp || '').trim(), Math.floor(maxRightDots / bodyFont.w));
    const priceDots = price.length * bodyFont.w;
    const qtyBudget = Math.floor((maxRightDots - priceDots - (price ? bodyFont.w : 0)) / bodyFont.w);
    const qty = qtyBudget > 1 ? tsplAscii(content.detail.trim(), qtyBudget) : '';
    const right = [qty, price].filter(Boolean).join(' ');
    const rightW = right.length * bodyFont.w;
    const rightX = Math.max(8, pageW - 8 - rightW);
    const leftMax = Math.max(4, Math.floor(((right ? rightX - 8 : pageW - 8) - 8) / bodyFont.w));
    const left = tsplAscii(content.productName.trim() || 'Product', leftMax);
    header.push(`TEXT ${shopX},${shopY},"${shopFont.id}",0,1,1,"${shop}"`);
    header.push(`TEXT 8,${bodyY},"${bodyFont.id}",0,1,1,"${left}"`);
    if (right) header.push(`TEXT ${rightX},${bodyY},"${bodyFont.id}",0,1,1,"${right}"`);
    barcodeY = bodyY + bodyFont.h + 6;
    const barH = pageH - barcodeY - hri - margin;
    header.push(tsplBarcodeLine(code, barcodeY, barH, pageW));
    header.push(`PRINT 1,${count}`);
    return Array.from(encodeAscii(`${header.join('\r\n')}\r\n`));
  }

  const band = renderLabelTextBand(content);
  const raster = canvasToRaster(band, { trim: false });
  const bandX = Math.max(0, Math.floor((pageW - band.width) / 2));
  const bandY = 4;
  barcodeY = bandY + raster.height + 6;
  const barH = pageH - barcodeY - hri - margin;
  const preamble = encodeAscii(
    `${header.join('\r\n')}\r\nBITMAP ${bandX},${bandY},${raster.widthBytes},${raster.height},0,`,
  );
  const tail = encodeAscii(
    `\r\n${tsplBarcodeLine(code, barcodeY, barH, pageW)}\r\nPRINT 1,${count}\r\n`,
  );
  const out = new Uint8Array(preamble.length + raster.data.length + tail.length);
  out.set(preamble, 0);
  out.set(raster.data, preamble.length);
  out.set(tail, preamble.length + raster.data.length);
  return Array.from(out);
}

/** Feed three blank stickers so the gap sensor lines up with the next label. */
export function buildLabelCalibrateTspl(heightMm: LabelHeightMm = LABEL_HEIGHT_MM): number[] {
  const hMm = normalizeLabelHeightMm(heightMm);
  return Array.from(
    encodeAscii(
      [
        `SIZE ${LABEL_WIDTH_MM} mm,${hMm} mm`,
        'GAP 2 mm,0 mm',
        'DENSITY 5',
        'CLS',
        'PRINT 1,3',
        '',
      ].join('\r\n'),
    ),
  );
}
