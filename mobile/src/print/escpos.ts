export interface ThermalPrintPayload {
  format: string;
  charsPerLine?: number;
  lines?: string[];
  raw?: string;
  html?: string;
  mimeType?: string;
}

/** Keep printable ASCII; preserve style tags until ESC/POS encode */
export function sanitizeEscPosText(text: string): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—·]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\n\r\t<>/]/g, '?');
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
        const body = centered[1].replace(/<\/?[A-Z]+>/g, '').trim();
        if (!body) return '';
        const clipped = body.slice(0, width);
        const pad = Math.max(0, Math.floor((width - clipped.length) / 2));
        return `${' '.repeat(pad)}${clipped}`;
      }
      const bold = line.match(/^<B>(.*)<\/B>\s*$/);
      if (bold) {
        return bold[1].replace(/<\/?[A-Z]+>/g, '').slice(0, width);
      }
      const cleaned = line.replace(/<\/?[A-Z]+>/g, '');
      if (!cleaned.trim()) return '';
      if (cleaned.length <= width) return cleaned;
      const lead = cleaned.match(/^ */)?.[0].length ?? 0;
      const body = cleaned.trimStart().slice(0, Math.max(1, width - Math.min(lead, width - 1)));
      return `${' '.repeat(Math.min(lead, width - body.length))}${body}`;
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
 * Font is sized to fill the content band (large + bold for thermal clarity).
 * Never uses `100vw` (that ignored paper size and clipped the right edge).
 */
export function buildThermalHtml(
  text: string,
  charsPerLine: number,
  paper: ThermalHtmlPaper = charsPerLine <= 32 ? '58' : '80',
) {
  const cols = receiptCharsForPaper(paper);
  const plain = toPlainReceipt(text, cols);
  const paperMm = paper === '58' ? 58 : 80;
  // 58 mm: extra left padding for converter offset; 80 mm: equal sides.
  const sideLeftMm = paper === '58' ? 4 : 2.5;
  const sideRightMm = paper === '58' ? 2 : 2.5;
  const printableMm = Number((paperMm - sideLeftMm - sideRightMm).toFixed(2));
  const glyphEm = paper === '58' ? 0.62 : 0.55;
  const fontMm = Number((Math.max(8, printableMm) / cols / glyphEm).toFixed(4));
  const lineMm = fontMm * 1.28;
  const lineCount = Math.max(1, plain.split('\n').length);
  const heightMm = Math.max(80, Math.ceil(lineCount * lineMm + 20));

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
pre {
  box-sizing: border-box;
  margin: 0;
  width: ${paperMm}mm;
  max-width: ${paperMm}mm;
  /* 58 mm: larger left padding for converter; 80 mm: equal sides */
  padding: 2mm ${sideRightMm}mm 8mm ${sideLeftMm}mm;
  font-family: "Courier New", Courier, ui-monospace, monospace;
  font-weight: 700;
  font-size: ${fontMm}mm;
  line-height: 1.28;
  letter-spacing: 0;
  font-kerning: none;
  font-variant-ligatures: none;
  -webkit-font-smoothing: none;
  color: #000;
  white-space: pre;
  overflow: hidden;
  text-rendering: geometricPrecision;
}
@media print {
  html, body, pre {
    width: ${paperMm}mm !important;
    max-width: ${paperMm}mm !important;
  }
  pre {
    padding: 1.5mm ${sideRightMm}mm 6mm ${sideLeftMm}mm !important;
    font-size: ${fontMm}mm !important;
    font-weight: 700 !important;
  }
}
</style></head><body><pre>${escapeHtml(plain)}</pre></body></html>`;

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

/**
 * Encode receipt as sharp plain ESC/POS.
 *
 * Page/print area follows paper size:
 * - 58 mm (2″): GS L ≈ 3 mm, GS W = remaining 2″ band
 * - 80 mm: GS L=0, GS W=576
 */
export function buildEscPosBytes(text: string, charsPerLine = 32): number[] {
  const plain = toPlainReceipt(text, charsPerLine);
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

  for (let i = 0; i < plain.length; i += 1) {
    const code = plain.charCodeAt(i);
    if (code === 0x0a || (code >= 0x20 && code <= 0x7e)) out.push(code);
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
