import { encodeBarcode } from './barcodeEncode';
import { DEVANAGARI_FONTS, graphemes, hasDevanagari } from './indicText';

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
/** Default sticker height — match the roll in the printer (50×28 or 50×25). */
export const LABEL_HEIGHT_MM = 28;
export type LabelHeightMm = 25 | 28;
export const LABEL_HEIGHT_OPTIONS: LabelHeightMm[] = [28, 25];

/**
 * 58 mm head ≈ 384 dots @ 203 dpi.
 * Render at this width (not 50×8=400) so we never downscale — that softens text.
 */
const PRINTER_WIDTH_PX = 384;
const LABEL_WIDTH_PX = PRINTER_WIDTH_PX;

export function normalizeLabelHeightMm(value?: number | null): LabelHeightMm {
  return value === 25 ? 25 : 28;
}

function labelHeightPx(heightMm: LabelHeightMm): number {
  // Full sticker height so GS FF lands on the next gap (short images skip a label).
  return Math.round((PRINTER_WIDTH_PX * heightMm) / LABEL_WIDTH_MM);
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

function setPrinterFont(ctx: CanvasRenderingContext2D, sizePx: number, bold = true) {
  const size = Math.max(10, Math.round(sizePx));
  const weight = bold ? '700' : '400';
  // Digits use light monospace — bold + multi-stroke turns into a dark blob on thermal.
  const family = bold
    ? `Arial, Helvetica, "Segoe UI", ${DEVANAGARI_FONTS}, sans-serif`
    : `"Courier New", Courier, ${DEVANAGARI_FONTS}, monospace`;
  ctx.font = `${weight} ${size}px ${family}`;
}

/** Single clean draw — avoid double-stroke darkness. */
function drawCleanText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
) {
  ctx.fillText(text, Math.round(x), Math.round(y));
}

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
  const quiet = 8;
  const total = modules.length + quiet * 2;
  const module = width / total;
  const x0 = Math.floor(x);
  const top = Math.floor(y);
  const bottom = Math.max(top + 1, Math.floor(y + height));
  ctx.fillStyle = '#000';
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== '1') {
      i += 1;
      continue;
    }
    let run = 1;
    while (i + run < modules.length && modules[i + run] === '1') run += 1;
    const start = Math.round(x0 + (quiet + i) * module);
    const end = Math.round(x0 + (quiet + i + run) * module);
    if (end > start) ctx.fillRect(start, top, end - start, bottom - top);
    i += run;
  }
}

/**
 * Pure black/white for shop/product/bars.
 * Digits are drawn AFTER this so light anti-aliased text is not wiped to white.
 */
function hardenToMono(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const image = ctx.getImageData(0, 0, width, height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    const alpha = px[i + 3];
    if (alpha < 128) {
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = 255;
      continue;
    }
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    // Keep the whole stroke. A low cutoff leaves only the dark core of each letter.
    const on = lum < 170;
    const v = on ? 0 : 255;
    px[i] = v;
    px[i + 1] = v;
    px[i + 2] = v;
    px[i + 3] = 255;
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
  while (size >= 11) {
    setPrinterFont(ctx, size, true);
    if (ctx.measureText(raw).width <= maxWidth) return { text: raw, size };
    size -= 1;
  }
  setPrinterFont(ctx, 11, true);
  return { text: ellipsize(ctx, raw, maxWidth), size: 11 };
}

/**
 * Canvas layout matches Android LabelBitmap.kt (50×H mm thermal sticker @ 384×H).
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
  ctx.strokeStyle = '#000';
  ctx.imageSmoothingEnabled = false;
  (ctx as CanvasRenderingContext2D & { textRendering?: string }).textRendering = 'geometricPrecision';

  const padX = Math.max(6, Math.floor(width / 32));
  const padY = Math.max(4, Math.floor(height / 24));
  let y = padY;

  const shopSource = (content.shopName.trim() || 'Shop').replace(/[A-Za-z]+/g, (word) => word.toUpperCase());
  const productSource = content.productName.trim() || 'Product';
  const qtyText = content.detail.trim();
  const priceText = (content.price || content.mrp || '').trim();
  const indic = hasDevanagari(`${shopSource} ${productSource} ${qtyText}`);
  const shopSize = indic ? 24 : 22;
  const productSize = indic ? 20 : 18;
  const priceSize = indic ? 20 : 18;

  setPrinterFont(ctx, shopSize, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const shop = ellipsize(ctx, shopSource, width - padX * 2);
  const shopY = y + shopSize;

  setPrinterFont(ctx, priceSize, true);
  const rightPart = [qtyText, priceText].filter(Boolean).join('  ');
  const rightWidth = rightPart ? ctx.measureText(rightPart).width : 0;
  const gap = 10;
  const leftMax = Math.max(width * 0.32, width - padX * 2 - rightWidth - gap);

  setPrinterFont(ctx, productSize, true);
  const productText = ellipsize(ctx, productSource, leftMax);
  const nameY = shopY + (indic ? 8 : 5) + Math.max(productSize, priceSize);

  const drawNames = () => {
    ctx.fillStyle = '#000';
    setPrinterFont(ctx, shopSize, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    drawCleanText(ctx, shop, width / 2, shopY);

    ctx.textAlign = 'left';
    setPrinterFont(ctx, productSize, true);
    drawCleanText(ctx, productText, padX, nameY);
    if (rightPart) {
      ctx.textAlign = 'right';
      setPrinterFont(ctx, priceSize, true);
      drawCleanText(ctx, rightPart, width - padX, nameY);
    }
  };

  // Marathi strokes are thin. Draw them after the black/white pass so matras are not erased.
  if (!indic) drawNames();
  y = nameY + (indic ? 8 : 5);

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, Math.round(y) + 0.5);
  ctx.lineTo(width - padX, Math.round(y) + 0.5);
  ctx.stroke();
  y += 5;

  // Bars fill the sticker down to the digit line so the print uses the selected label height.
  const footerSize = 18;
  const footerReserve = footerSize + padY + 4;
  const barTop = Math.floor(y);
  const barBottom = Math.max(barTop + 24, Math.floor(height - footerReserve));
  const code = content.barcode.trim() || '2000000000008';
  drawBarcodeBars(ctx, code, padX, barTop, width - padX * 2, barBottom - barTop);

  // Harden bars/text first, then paint solid black digits (anti-alias was making them vanish).
  hardenToMono(ctx, width, height);
  if (indic) drawNames();

  const digitTop = barBottom + 2;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, digitTop, width, height - digitTop);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const fitted = fitBarcodeDigits(ctx, code, width - padX * 2, footerSize);
  setPrinterFont(ctx, fitted.size, true);
  // Baseline sits inside the footer strip, not on the label edge.
  const digitY = Math.min(height - Math.max(2, padY - 1), digitTop + fitted.size);
  drawCleanText(ctx, fitted.text, width / 2, digitY);
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

/** ESC/POS GS v 0 raster from canvas pixels. */
function canvasToRaster(canvas: HTMLCanvasElement): { widthBytes: number; height: number; data: Uint8Array } {
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
      // 170 keeps thin Devanagari strokes (matras) that anti-aliasing leaves gray.
      if (lum >= 170) continue;
      data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { widthBytes, height, data };
}

function appendRaster(out: number[], raster: { widthBytes: number; height: number; data: Uint8Array }) {
  const { widthBytes, height, data } = raster;
  // GS v 0 m xL xH yL yH d1…dk
  out.push(0x1d, 0x76, 0x30, 0x00);
  out.push(widthBytes & 0xff, (widthBytes >> 8) & 0xff);
  out.push(height & 0xff, (height >> 8) & 0xff);
  for (let i = 0; i < data.length; i += 1) out.push(data[i]);
}

/**
 * ESC/POS label job: INIT + (raster + GS FF) × copies.
 * USB desktop printers receive this via the raw system queue.
 */
export function buildGapLabelEscPos(
  content: GapLabelContent,
  copies: number,
  heightMm: LabelHeightMm = LABEL_HEIGHT_MM,
): number[] {
  const count = Math.max(1, Math.min(99, Math.floor(copies) || 1));
  const fitted = fitToPrinterWidth(
    renderGapLabelCanvas(content, normalizeLabelHeightMm(heightMm)),
    PRINTER_WIDTH_PX,
  );
  const raster = canvasToRaster(fitted);
  // Left edge of the head. A centered align parks the sticker image in the middle of the roll.
  const out: number[] = [...ESC_INIT, 0x1b, 0x61, 0x00, 0x1d, 0x4c, 0x00, 0x00];
  for (let i = 0; i < count; i += 1) {
    appendRaster(out, raster);
    out.push(...LABEL_FORM_FEED);
  }
  return out;
}
