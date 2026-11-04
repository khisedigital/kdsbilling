/** Devanagari block used by Marathi (and Hindi) names. */
export const DEVANAGARI_RE = /[\u0900-\u097F]/;

/** Zero-width joiner / non-joiner used inside conjuncts. */
const JOINER_RE = /[\u200C\u200D]/;

export function hasDevanagari(text: string): boolean {
  return DEVANAGARI_RE.test(text);
}

/**
 * Windows: Nirmala UI. Android / Chrome: Noto Sans Devanagari.
 * Listed after Latin faces so English stays on Arial or Courier.
 */
export const DEVANAGARI_FONTS = '"Nirmala UI", "Noto Sans Devanagari", Mangal';

type GraphemeSegmenter = new (
  locales?: string,
  options?: { granularity: 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> };

function segmenter(): GraphemeSegmenter | null {
  const intl = Intl as typeof Intl & { Segmenter?: GraphemeSegmenter };
  return typeof intl.Segmenter === 'function' ? intl.Segmenter : null;
}

/** One user-perceived character, so a vowel sign is not cut off the letter. */
export function graphemes(text: string): string[] {
  const Segmenter = segmenter();
  if (Segmenter) {
    return [...new Segmenter('mr', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  }
  return Array.from(text);
}

export function colLength(text: string): number {
  return graphemes(text).length;
}

export function clipCols(text: string, width: number): string {
  const parts = graphemes(text);
  if (parts.length <= width) return text;
  return parts.slice(0, Math.max(0, width)).join('');
}

/** Keep Marathi letters. Other non-ASCII still becomes ? for thermal text mode. */
export function keepPrintable(text: string): string {
  return String(text ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—·]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\n\r\t<>/\u0900-\u097F\u200C\u200D]/g, (ch) => (JOINER_RE.test(ch) ? ch : '?'));
}
