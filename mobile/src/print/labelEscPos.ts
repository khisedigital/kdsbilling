import { encodeBarcode } from './barcodeEncode';

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
export const LABEL_HEIGHT_MM = 25;

/** 203 dpi. */
const DOTS_PER_MM = 8;
const LABEL_WIDTH_PX = LABEL_WIDTH_MM * DOTS_PER_MM;
const LABEL_HEIGHT_PX = LABEL_HEIGHT_MM * DOTS_PER_MM;

/** 58 mm head ≈ 384 dots — scale down only, never stretch. */
const PRINTER_WIDTH_PX = 384;

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
  let end = text.length;
  while (end > 0 && ctx.measureText(`${text.slice(0, end)}${ellipsis}`).width > maxWidth) {
    end -= 1;
  }
  return end <= 0 ? ellipsis : `${text.slice(0, end)}${ellipsis}`;
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
  const module = Math.max(2, Math.floor(width / total));
  let cursor = Math.floor(x) + quiet * module;
  const top = Math.floor(y);
  const bottom = Math.max(top + 1, Math.floor(y + height));
  ctx.fillStyle = '#000';
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== '1') {
      cursor += module;
      i += 1;
      continue;
    }
    let run = 1;
    while (i + run < modules.length && modules[i + run] === '1') run += 1;
    ctx.fillRect(cursor, top, run * module, bottom - top);
    cursor += run * module;
    i += run;
  }
}

/**
 * Canvas layout matches Android LabelBitmap.kt (50×25 mm thermal sticker).
 */
export function renderGapLabelCanvas(content: GapLabelContent): HTMLCanvasElement {
  const width = LABEL_WIDTH_PX;
  const height = LABEL_HEIGHT_PX;
  const canvas = requireCanvas();
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the label image.');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.imageSmoothingEnabled = false;
  ctx.font = '16px monospace';

  const padX = Math.max(4, Math.floor(width / 40));
  const padY = Math.max(3, Math.floor(height / 28));
  let y = padY;

  const shopSize = height * 0.11;
  ctx.font = `${Math.round(shopSize)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const shop = ellipsize(ctx, content.shopName.trim() || 'Shop', width - padX * 2);
  y += shopSize;
  ctx.fillText(shop, width / 2, y);
  y += 10;

  const rowSize = height * 0.105;
  ctx.font = `${Math.round(rowSize)}px monospace`;
  const qtyText = content.detail.trim();
  const priceText = (content.price || content.mrp || '').trim();
  const rightPart = [qtyText, priceText].filter(Boolean).join('  ');
  const rightWidth = rightPart ? ctx.measureText(rightPart).width : 0;
  const gap = 10;
  const leftMax = Math.max(width * 0.35, width - padX * 2 - rightWidth - gap);
  const productText = ellipsize(ctx, content.productName.trim() || 'Product', leftMax);

  y += rowSize;
  ctx.textAlign = 'left';
  ctx.fillText(productText, padX, y);
  if (rightPart) {
    ctx.textAlign = 'right';
    ctx.fillText(rightPart, width - padX, y);
  }
  y += 10;

  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padX, y);
  ctx.lineTo(width - padX, y);
  ctx.stroke();
  y += 10;

  const footerSize = height * 0.075;
  const footerReserve = footerSize + padY + 2;
  const barTop = Math.floor(y);
  const maxBarH = Math.floor(height * 0.26);
  const barBottom = Math.max(
    barTop + 16,
    Math.min(Math.floor(height - footerReserve), barTop + maxBarH),
  );
  const code = content.barcode.trim() || '2000000000008';
  drawBarcodeBars(ctx, code, padX, barTop, width - padX * 2, barBottom - barTop);

  ctx.font = `${Math.round(footerSize)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(code, width / 2, height - padY);

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
      if (lum >= 160) continue;
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
export function buildGapLabelEscPos(content: GapLabelContent, copies: number): number[] {
  const count = Math.max(1, Math.min(99, Math.floor(copies) || 1));
  const fitted = fitToPrinterWidth(renderGapLabelCanvas(content), PRINTER_WIDTH_PX);
  const raster = canvasToRaster(fitted);
  const out: number[] = [...ESC_INIT];
  for (let i = 0; i < count; i += 1) {
    appendRaster(out, raster);
    out.push(...LABEL_FORM_FEED);
  }
  return out;
}
