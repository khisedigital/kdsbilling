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
 * 58mm / 2″ native head = 384 dots → 32 cols (full width).
 */
export function receiptCharsForPaper(format: '58' | '80' | string): number {
  const raw = String(format || '').trim().toLowerCase();
  if (raw === '80' || raw === '80mm' || raw.startsWith('80')) return 48;
  if (raw === '58' || raw === '58mm' || raw.startsWith('58')) return 32;
  return 32;
}

/**
 * Legacy converter inset (80→58 paper guide). Native 58 mm portables must use 0 —
 * GS L with a non-zero margin prints as "8a8a…" junk on many of those heads.
 */
export const MARGIN_58_LEFT_DOTS = 0;

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
 *   58 mm → 32 cols, equal side padding (native 2″ head)
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
  // Equal sides — converter-style left inset left a blank strip on native 58 mm.
  const sideLeftMm = paper === '58' ? 2 : 2.5;
  const sideRightMm = paper === '58' ? 2 : 2.5;
  const printableMm = Number((paperMm - sideLeftMm - sideRightMm).toFixed(2));
  // 80mm uses 0.60 so 48 monospace characters fill 100% of the printable width.
  const glyphEm = paper === '58' ? 0.62 : 0.60;
  const fontMm = Number((Math.max(8, printableMm) / cols / glyphEm).toFixed(4));
  const shopFontMm = fontMm;
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
  width: 100%;
  max-width: ${paperMm}mm;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.shop {
  box-sizing: border-box;
  width: 100%;
  max-width: ${paperMm}mm;
  padding: 0mm ${sideRightMm}mm 0.5mm ${sideLeftMm}mm;
  font-family: Arial, Helvetica, ${DEVANAGARI_FONTS}, sans-serif;
  font-weight: 400;
  font-size: ${shopFontMm}mm;
  line-height: 1.4;
  text-align: center;
  color: #000;
  -webkit-font-smoothing: none;
  font-smooth: never;
  text-rendering: geometricPrecision;
}
.body {
  box-sizing: border-box;
  width: 100%;
  max-width: ${paperMm}mm;
  /* 58 mm: larger left padding for converter; 80 mm: equal sides */
  padding: 1mm ${sideRightMm}mm 8mm ${sideLeftMm}mm;
}
.center, .line {
  box-sizing: border-box;
  width: 100%;
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
  html, body {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .body, .shop {
    width: 100% !important;
    max-width: 100% !important;
  }
  .shop {
    padding-top: 0 !important;
    font-size: ${shopFontMm}mm !important;
    font-weight: 400 !important;
    line-height: 1.4 !important;
  }
  .center, .line {
    width: 100% !important;
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
 * Minimal ESC/POS for portable 58/80 mm heads.
 * Centering is spaces only — no ESC M / GS ! / ESC a (those leak or stall).
 */
const ESC = {
  INIT: [0x1b, 0x40],
  /** Advance past the print head so the cutter can reach the gap (short feed). */
  FEED_TAIL: [0x0a, 0x0a, 0x0a],
  /** Partial cut — ignored by heads without a cutter. */
  CUT: [0x1d, 0x56, 0x01],
};

/**
 * Print-area dots for Font A (~12 dots/char @ 203 dpi).
 *
 * - 58 mm / 2″ (≤32 cols): **384-dot** full page.
 * - 80 mm (48 cols): **576-dot** full page.
 */
export function receiptPrintArea(charsPerLine: number): {
  leftDots: number;
  widthDots: number;
  rightDots: number;
  paperDots: number;
} {
  const cols = Math.max(16, Math.min(96, charsPerLine));
  const paperDots = cols <= 32 ? 384 : 576;
  const widthDots = cols <= 32 ? 384 : 576;

  if (cols <= 32) {
    return {
      leftDots: MARGIN_58_LEFT_DOTS,
      widthDots,
      rightDots: 0,
      paperDots,
    };
  }

  return { leftDots: 0, widthDots, rightDots: Math.max(0, paperDots - widthDots), paperDots };
}

/** True for 58 mm / 2″ roll jobs (Font A, ≤32 cols). */
export function is58mmChars(charsPerLine: number): boolean {
  return charsPerLine <= 32;
}

function canDrawCanvas(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/**
 * Receipt text size in canvas px (Marathi / mixed bitmaps).
 * 58mm matches Font A (~12×24). 80mm is a mild bump (not double-height).
 */
function thermalBodyPx(charsPerLine: number): number {
  return charsPerLine > 32 ? 30 : 24;
}

function thermalShopPx(charsPerLine: number): number {
  return charsPerLine > 32 ? 32 : 24;
}

/** Bundled face when the desktop app has loaded it; otherwise Windows system faces. */
function canvasIndicFont(px: number): string {
  const loaded =
    typeof document !== 'undefined' &&
    ((globalThis as { __kdsIndicFont?: boolean }).__kdsIndicFont ||
      document.fonts?.check?.(`400 ${px}px KdsDevanagari`));
  const family = loaded ? 'KdsDevanagari' : '"Nirmala UI", "Noto Sans Devanagari", Mangal';
  // Always regular — bold Devanagari prints heavier than English Font A.
  return `400 ${px}px ${family}, sans-serif`;
}

/**
 * Pull trailing amount(s) / column cells off a Marathi line so the label
 * stays left and money (or qty/rate/amt headers) stays right-justified.
 */
function splitAmountTail(line: string): { name: string; tail: string } | null {
  const itemMatch = line.match(/^(.*\S)\s+(\d+(?:\.\d+)?\s+\d+\.\d{2}\s+\d+\.\d{2})\s*$/);
  if (itemMatch && hasDevanagari(itemMatch[1])) {
    return { name: itemMatch[1].trim(), tail: itemMatch[2].trim() };
  }
  const kvMatch = line.match(/^(.*\S)\s+([+\-]?\d+\.\d{2})\s*$/);
  if (kvMatch && hasDevanagari(kvMatch[1])) {
    return { name: kvMatch[1].trim(), tail: kvMatch[2].trim() };
  }
  // Table header: "वस्तू … नग  दर  रक्कम" — keep item label left, columns right.
  const headerMatch = line.match(/^(.*\S)\s{2,}(\S+(?:\s+\S+){1,3})\s*$/);
  if (headerMatch && hasDevanagari(line) && !/^\d/.test(headerMatch[2])) {
    return { name: headerMatch[1].trim(), tail: headerMatch[2].replace(/\s+/g, '  ').trim() };
  }
  return null;
}

function centeredBody(line: string): string | null {
  const body = line.trim();
  if (!body || body === line) return null;
  // Centered receipt lines are left-padded only, so a trailing pad is not required.
  const lead = line.length - line.trimStart().length;
  if (lead >= 2) return body;
  return null;
}

/** Label on the left, value on the right (date, customer, totals). */
function splitJustified(line: string): { name: string; tail: string } | null {
  const match = String(line || '').trim().match(/^(\S.*?)\s{2,}(\S.*)$/);
  if (!match) return null;
  const name = match[1].trim();
  const tail = match[2].trim();
  if (!name || !tail) return null;
  return { name, tail };
}

/**
 * Ink height of this line only. The font's em box is much taller than the
 * letters and was leaving a blank band above every Marathi header line.
 */
function lineBox(
  measure: CanvasRenderingContext2D,
  sample: string,
  fontSize: number,
  compact: boolean,
  ascentFloor = compact ? 0.9 : 1.05,
) {
  const probe = measure.measureText(sample || 'ई') as TextMetrics;
  const ascent = Math.ceil(
    Math.max(probe.actualBoundingBoxAscent || 0, fontSize * ascentFloor),
  );
  const descent = Math.ceil(
    Math.max(probe.actualBoundingBoxDescent || 0, fontSize * (compact ? 0.28 : 0.32)),
  );
  const pad = compact ? 2 : 3;
  return { ascent, descent, pad };
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

/** Break a shop name on spaces first, so a word is not split in the middle. */
function wrapWordsByPixels(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return wrapByPixels(ctx, text.trim(), maxWidth);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (ctx.measureText(word).width <= maxWidth) current = word;
    else {
      lines.push(...wrapByPixels(ctx, word, maxWidth));
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

type Raster = { width: number; widthBytes: number; height: number; data: Uint8Array };

/**
 * Draw at 2× and keep a dot when any subpixel is actually ink.
 * A single 1× threshold was dropping vowel signs and conjuncts.
 */
function packSupersampled(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): Raster {
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height);
  const srcW = width * scale;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const i = ((y * scale + sy) * srcW + (x * scale + sx)) * 4;
          sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        }
      }
      // Mid-gray only. Turning the pale edge black was printing the letters too heavy.
      if (sum / (scale * scale) >= 136) continue;
      data[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { width, widthBytes, height, data };
}

/** Drop the blank rows the em box leaves above and below the letters. */
function trimRasterRows(raster: Raster, pad = 1): Raster {
  const { width, widthBytes, height, data } = raster;
  const ink = (y: number) => {
    const start = y * widthBytes;
    for (let i = 0; i < widthBytes; i += 1) if (data[start + i]) return true;
    return false;
  };
  let top = 0;
  let bottom = height - 1;
  while (top < bottom && !ink(top)) top += 1;
  while (bottom > top && !ink(bottom)) bottom -= 1;
  top = Math.max(0, top - pad);
  bottom = Math.min(height - 1, bottom + pad);
  const nextH = bottom - top + 1;
  if (nextH >= height) return raster;
  const next = new Uint8Array(widthBytes * nextH);
  next.set(data.subarray(top * widthBytes, (bottom + 1) * widthBytes));
  return { width, widthBytes, height: nextH, data: next };
}

/** One receipt line drawn with a Devanagari font, as a black/white raster. */
function renderIndicRaster(
  text: string,
  widthPx: number,
  opts?: { fontSize?: number; center?: boolean; compact?: boolean; shop?: boolean },
): Raster {
  const width = Math.max(8, widthPx);
  const fontSize = opts?.fontSize ?? 24;
  const compact = Boolean(opts?.compact);
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('Could not draw the Marathi receipt line.');
  measure.font = canvasIndicFont(fontSize);

  const paddedCenter = opts?.center ? null : centeredBody(text);
  const centered = Boolean(opts?.center || paddedCenter);
  const justified = centered ? null : splitJustified(text);
  const amounts = justified || (centered ? null : splitAmountTail(text));
  const nameSource = opts?.center
    ? text.trim()
    : paddedCenter || amounts?.name || text.trim() || text;
  const tail = amounts?.tail || '';
  const tailWidth = tail ? measure.measureText(tail).width + 8 : 0;
  const nameMax = Math.max(40, width - tailWidth - 4);
  const wrapWidth = centered ? width - 8 : nameMax;
  const rows = (opts?.shop ? wrapWordsByPixels : wrapByPixels)(measure, nameSource, wrapWidth);

  // किर्ीं is taller than many names. Measuring it keeps those marks inside the picture.
  const sample = opts?.shop ? `${nameSource}किर्ीं` : `${nameSource}${tail}`;
  // Same metrics for shop + body so Marathi does not look taller/heavier than English.
  const box = lineBox(measure, sample, fontSize, compact && !opts?.shop);
  const rowH = box.ascent + box.descent + box.pad;
  const height = Math.max(rowH, rowH * rows.length);
  const scale = 2;

  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not draw the Marathi receipt line.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = canvasIndicFont(fontSize);
  ctx.textBaseline = 'alphabetic';

  rows.forEach((row, index) => {
    const baseline = box.pad + box.ascent + index * rowH;
    if (centered) {
      ctx.textAlign = 'center';
      ctx.fillText(row, Math.round(width / 2), baseline);
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillText(row, 2, baseline);
    if (tail && index === 0) {
      ctx.textAlign = 'right';
      ctx.fillText(tail, width - 2, baseline);
    }
  });

  const image = ctx.getImageData(0, 0, width * scale, height * scale);
  return trimRasterRows(packSupersampled(image.data, width, height, scale), compact ? 1 : 2);
}

/**
 * Bytes that some portable heads treat as real-time commands even inside a
 * GS v 0 bitmap — clearing the buffer mid-header (slip breaks at the start).
 * Flip one bit; invisible at 203 dpi.
 */
function scrubImageByte(slice: number): number {
  if (slice === 0x10 || slice === 0x1b || slice === 0x1d) return slice ^ 0x01;
  return slice;
}

/**
 * GS v 0 raster bit image (row-major).
 * ESC * 24-dot mode prints as "8a8a…" / "===3" junk on many portable 58 mm heads.
 * Keep each command tiny — a tall multi-band picture makes those heads print the
 * shop header, stall, then the spooler retries and the bill starts over.
 */
function appendBitImage(out: number[], raster: Raster) {
  const { widthBytes, height, data } = raster;
  // 24-row bands — smaller USB bursts; large 32-row GS v 0 packs made some
  // Windows 80 mm heads print one strip then raise the red error LED.
  const maxRows = 24;
  for (let y0 = 0; y0 < height; y0 += maxRows) {
    const rows = Math.min(maxRows, height - y0);
    out.push(
      0x1d, 0x76, 0x30, 0x00,
      widthBytes & 0xff, (widthBytes >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff,
    );
    const start = y0 * widthBytes;
    const end = start + rows * widthBytes;
    for (let i = start; i < end; i += 1) {
      out.push(scrubImageByte(data[i]));
    }
  }
}

/**
 * Mixed / Marathi receipts.
 * ASCII lines (===, English shop, qty/rate) stay in plain text.
 * Only Devanagari lines become small GS v 0 pictures.
 * Rasterizing the English shop on an MR bill was a common stall point —
 * head printed ==== + name, then died; spooler retry restarted the slip.
 */
function appendIndicReceiptLines(out: number[], source: string, widthPx: number, charsPerLine: number) {
  const pictureWidth = Math.max(8, widthPx - 4);
  const bodyPx = thermalBodyPx(charsPerLine);
  const shopPx = thermalShopPx(charsPerLine);
  for (const line of String(source || '').replace(/\r/g, '').split('\n')) {
    const title = line.match(/^<CB>(.*)<\/CB>\s*$/);
    if (title) {
      const body = title[1].replace(/<\/?[A-Z]+>/g, '').trim();
      if (!body) {
        out.push(0x0a);
        continue;
      }
      if (!hasDevanagari(body)) {
        appendShopTitle(out, body, charsPerLine, widthPx);
        continue;
      }
      appendBitImage(out, renderIndicRaster(body, pictureWidth, {
        center: true,
        fontSize: shopPx,
        shop: true,
      }));
      continue;
    }
    const centeredTag = line.match(/^<C>(.*)<\/C>\s*$/);
    if (centeredTag) {
      const body = centeredTag[1].replace(/<\/?[A-Z]+>/g, '').trim();
      if (!body) {
        out.push(0x0a);
        continue;
      }
      if (!hasDevanagari(body)) {
        const plain = toPlainReceipt(`<C>${body}</C>`, charsPerLine);
        appendPlainChars(out, plain || body);
        continue;
      }
      appendBitImage(out, renderIndicRaster(body, pictureWidth, {
        center: true,
        fontSize: bodyPx,
        compact: true,
      }));
      continue;
    }
    const plain = toPlainReceipt(line, charsPerLine);
    if (!plain) {
      if (!line.trim()) out.push(0x0a);
      continue;
    }
    if (!hasDevanagari(plain)) {
      appendPlainChars(out, plain);
      continue;
    }
    const centered = centeredBody(plain);
    appendBitImage(out, renderIndicRaster(centered || plain, pictureWidth, {
      center: Boolean(centered),
      fontSize: bodyPx,
      compact: true,
    }));
  }
}

function wrapAsciiCols(text: string, cols: number): string[] {
  const width = Math.max(8, cols);
  const clean = text.replace(/[^\x20-\x7E]/g, '').trim();
  if (!clean) return [];
  const lines: string[] = [];
  let cur = '';
  for (const word of clean.split(/\s+/)) {
    if (word.length > width) {
      if (cur) lines.push(cur);
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      cur = '';
      continue;
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function appendShopTitle(out: number[], title: string, charsPerLine: number, widthPx: number) {
  const body = title.replace(/<\/?[A-Z]+>/g, '').trim();
  if (!body) {
    out.push(0x0a);
    return;
  }
  // Marathi still needs a raster (built-in font has no Devanagari).
  if (hasDevanagari(body) && canDrawCanvas()) {
    const pictureWidth = Math.max(8, widthPx - 4);
    appendBitImage(out, renderIndicRaster(body, pictureWidth, {
      center: true,
      fontSize: thermalShopPx(charsPerLine),
      shop: true,
    }));
    return;
  }
  // Latin: normal size only, centered with spaces.
  // Hardware double-height (GS !) + ESC M made portable heads print the shop
  // name twice (once normal, once tall) and leak "M===" into the slip.
  const lines = wrapAsciiCols(body.toUpperCase(), charsPerLine);
  if (!lines.length) {
    out.push(0x0a);
    return;
  }
  for (const line of lines) {
    const plain = toPlainReceipt(`<C>${line}</C>`, charsPerLine);
    appendPlainChars(out, plain || line);
  }
}

function appendPlainChars(out: number[], text: string) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) out.push(code);
  }
  out.push(0x0a);
}

function blankRaster(width: number, height: number): Raster {
  const w = Math.max(8, width);
  const h = Math.max(1, height);
  return { width: w, widthBytes: Math.ceil(w / 8), height: h, data: new Uint8Array(Math.ceil(w / 8) * h) };
}

/** Stack line pictures into one tall image so the head never leaves graphics mid-ticket. */
function stackRasters(parts: Raster[]): Raster {
  if (!parts.length) return blankRaster(8, 8);
  const width = Math.max(...parts.map((part) => part.width));
  const widthBytes = Math.ceil(width / 8);
  const height = parts.reduce((sum, part) => sum + part.height, 0);
  const data = new Uint8Array(widthBytes * height);
  let y = 0;
  for (const part of parts) {
    for (let row = 0; row < part.height; row += 1) {
      data.set(
        part.data.subarray(row * part.widthBytes, (row + 1) * part.widthBytes),
        (y + row) * widthBytes,
      );
    }
    y += part.height;
  }
  return { width, widthBytes, height, data };
}

/**
 * Marathi (and mixed) receipts: draw every line into one continuous raster.
 * One ESC * shop picture then ASCII text makes many 58/80 mm heads stop after the name.
 */
function renderIndicReceipt(source: string, widthPx: number, charsPerLine: number): Raster {
  // Use nearly the full head width — a large inset left a blank strip on 58 mm.
  const pictureWidth = Math.max(8, widthPx - 4);
  const bodyPx = thermalBodyPx(charsPerLine);
  const shopPx = thermalShopPx(charsPerLine);
  const parts: Raster[] = [];
  for (const line of String(source || '').replace(/\r/g, '').split('\n')) {
    const title = line.match(/^<CB>(.*)<\/CB>\s*$/);
    if (title) {
      const body = title[1].replace(/<\/?[A-Z]+>/g, '').trim();
      if (!body) {
        parts.push(blankRaster(pictureWidth, 8));
        continue;
      }
      parts.push(renderIndicRaster(body, pictureWidth, {
        center: true,
        fontSize: shopPx,
        shop: true,
      }));
      continue;
    }
    const centeredTag = line.match(/^<C>(.*)<\/C>\s*$/);
    if (centeredTag) {
      const body = centeredTag[1].replace(/<\/?[A-Z]+>/g, '').trim();
      if (!body) {
        parts.push(blankRaster(pictureWidth, 6));
        continue;
      }
      parts.push(renderIndicRaster(body, pictureWidth, {
        center: true,
        fontSize: bodyPx,
        compact: true,
      }));
      continue;
    }
    const plain = toPlainReceipt(line, charsPerLine);
    if (!plain) {
      if (!line.trim()) parts.push(blankRaster(pictureWidth, 8));
      continue;
    }
    const centered = centeredBody(plain);
    parts.push(renderIndicRaster(centered || plain, pictureWidth, {
      center: Boolean(centered),
      fontSize: bodyPx,
      compact: true,
    }));
  }
  return stackRasters(parts);
}

function appendReceiptLine(out: number[], line: string, charsPerLine: number, widthPx: number) {
  const title = line.match(/^<CB>(.*)<\/CB>\s*$/);
  if (title) {
    appendShopTitle(out, title[1], charsPerLine, widthPx);
    return;
  }
  const centeredTag = line.match(/^<C>(.*)<\/C>\s*$/);
  if (centeredTag) {
    const body = centeredTag[1].replace(/<\/?[A-Z]+>/g, '').trim();
    if (!body) {
      out.push(0x0a);
      return;
    }
    // Space-pad centering — ESC a 1 also glitches on some portable heads.
    const plain = toPlainReceipt(`<C>${body}</C>`, charsPerLine);
    appendPlainChars(out, plain || body);
    return;
  }
  const plain = toPlainReceipt(line, charsPerLine);
  if (!plain) {
    if (!line.trim()) out.push(0x0a);
    return;
  }
  appendPlainChars(out, plain);
}

/**
 * Encode receipt as sharp plain ESC/POS.
 *
 * Page width is implied by column count (32→58 mm, 48→80 mm). We do **not**
 * send GS L / GS W — those stall many portable 58 **and** 80 mm heads after the
 * first line (shop name), then the spooler retries from the top.
 *
 * When `paper` is set, column count is taken from the paper size — never from a
 * stale charsPerLine — so Settings → 58mm cannot still print an 80mm page.
 */
export function buildEscPosBytes(
  text: string,
  charsPerLine = 32,
  paper?: '58' | '80',
): number[] {
  const source = String(text || '').replace(/\r/g, '');
  const roll: '58' | '80' = paper ?? (charsPerLine <= 32 ? '58' : '80');
  const cols = receiptCharsForPaper(roll);
  const { leftDots, widthDots } = receiptPrintArea(cols);
  const useIndic = hasDevanagari(source) && canDrawCanvas();
  // ESC @ only — no GS a / ESC a.
  const out: number[] = [...ESC.INIT];

  if (roll === '80') {
    // 80mm ESC/POS fills the head (GS L=0, GS W=576)
    out.push(
      0x1d, 0x4c, leftDots & 0xff, (leftDots >> 8) & 0xff,
      0x1d, 0x57, widthDots & 0xff, (widthDots >> 8) & 0xff,
    );
  }

  if (useIndic) {
    // Devanagari lines → small bitmaps; ASCII lines stay text (one job, one write).
    appendIndicReceiptLines(out, source, widthDots, cols);
  } else {
    for (const line of source.split('\n')) {
      appendReceiptLine(out, line, cols, widthDots);
    }
  }

  if (!out.length || out[out.length - 1] !== 0x0a) out.push(0x0a);
  out.push(...ESC.FEED_TAIL);
  if (roll === '80') {
    out.push(...ESC.CUT);
  }
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
  // Bluetooth only — desktop system/network return as soon as the job is accepted.
  return Math.min(2500, Math.max(400, 200 + lines * 25));
}
