const fs = require('fs');
const path = require('path');

const FONT_PATH = path.join(__dirname, '../../assets/fonts/NotoSansDevanagari-Bold.ttf');
const DEVANAGARI = /[\u0900-\u097F]/;
const AMOUNT_TAIL = /^(.*\S)\s+(\d+(?:\.\d+)?\s+\d+\.\d{2}\s+\d+\.\d{2})\s*$/;

let fontReady = false;

function loadCanvas() {
  return require('@napi-rs/canvas');
}

function ensureFont(GlobalFonts) {
  if (fontReady) return;
  if (!fs.existsSync(FONT_PATH)) throw new Error('Marathi font file is missing on the server.');
  if (!GlobalFonts.registerFromPath(FONT_PATH, 'KdsDevanagari')) {
    throw new Error('Could not load the Marathi font.');
  }
  fontReady = true;
}

function graphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('mr', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

function wrapByPixels(ctx, text, maxWidth) {
  const lines = [];
  let current = '';
  for (const part of graphemes(text)) {
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

/** ESC * 24-dot bands. GS v 0 is ignored by many POS heads and prints as ???. */
function bitImage(width, height, px) {
  const out = [0x1b, 0x33, 24];
  const black = (x, y) => {
    if (x >= width || y >= height) return false;
    const i = (y * width + x) * 4;
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    return lum < 112;
  };
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
  return Buffer.from(out);
}

/**
 * Draw one receipt line that contains Marathi and return ESC/POS bit-image bytes.
 * align: 'left' | 'center' | 'right'
 */
function renderIndicLine(text, widthPx, align = 'left') {
  const { createCanvas, GlobalFonts } = loadCanvas();
  ensureFont(GlobalFonts);
  const width = Math.max(8, Number(widthPx) || 384);
  const fontSize = 20;
  const probe = createCanvas(width, 4);
  const measure = probe.getContext('2d');
  measure.font = `400 ${fontSize}px KdsDevanagari`;

  const trimmed = String(text || '').trim();
  const amounts = align === 'center' ? null : trimmed.match(AMOUNT_TAIL);
  const nameSource = amounts ? amounts[1].trim() : trimmed;
  const tail = amounts ? amounts[2].trim() : '';
  const tailWidth = tail ? measure.measureText(tail).width + 8 : 0;
  const nameMax = Math.max(40, width - tailWidth - 4);
  const center = align === 'center' || align === 'right';
  const rows = wrapByPixels(measure, nameSource || ' ', center ? width - 8 : nameMax);
  const sample = measure.measureText('ईंशिाी्ॐ');
  const ascent = Math.ceil(Math.max(
    sample.fontBoundingBoxAscent || 0,
    sample.actualBoundingBoxAscent || 0,
    fontSize * 1.05,
  ));
  const descent = Math.ceil(Math.max(
    sample.fontBoundingBoxDescent || 0,
    sample.actualBoundingBoxDescent || 0,
    fontSize * 0.45,
  ));
  const padTop = Math.ceil(fontSize * 0.32);
  const rowH = Math.ceil(ascent + descent + padTop);
  const height = Math.max(rowH, rowH * rows.length);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.font = `400 ${fontSize}px KdsDevanagari`;
  ctx.textBaseline = 'alphabetic';

  rows.forEach((row, index) => {
    const baseline = Math.round(padTop + ascent + index * rowH);
    if (center && !tail) {
      ctx.textAlign = align === 'right' ? 'right' : 'center';
      ctx.fillText(row, align === 'right' ? width - 2 : width / 2, baseline);
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillText(row, 2, baseline);
    if (tail && index === 0) {
      ctx.textAlign = 'right';
      ctx.fillText(tail, width - 2, baseline);
    }
  });

  const image = ctx.getImageData(0, 0, width, height);
  return bitImage(width, height, image.data);
}

function paperDotsForMarkup(rawText) {
  const lines = String(rawText || '').split('\n');
  for (const line of lines) {
    const bare = line.replace(/<[^>]+>/g, '');
    if (/^=+$/.test(bare) && bare.length >= 16) {
      return bare.length <= 32 ? 384 : 576;
    }
  }
  return 384;
}

module.exports = {
  DEVANAGARI,
  renderIndicLine,
  paperDotsForMarkup,
};
