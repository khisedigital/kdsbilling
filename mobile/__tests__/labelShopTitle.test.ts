import { buildGapLabelEscPos, buildGapLabelTspl } from '../src/print/labelEscPos';

describe('label shop title font size and centering', () => {
  const sampleLabel = {
    shopName: 'MAHALAXMI SUPER MARKET',
    productName: 'Sugar 1kg',
    detail: '1kg',
    barcode: '2000000000008',
    mrp: '50',
    price: '45',
  };

  it('uses Font 3 for English shop title in TSPL so it does not overflow or appear oversized', () => {
    const bytes = buildGapLabelTspl(sampleLabel, 1, 28);
    const text = String.fromCharCode(...bytes);
    // Should use Font "3", not the oversized Font "4"
    expect(text).toMatch(/TEXT \d+,\d+,"3",0,1,1,"MAHALAXMI SUPER MARKET"/);
  });

  it('sets left margin (inset >= 24 dots / ~3mm) so product name is not clipped on the left', () => {
    const bytes = buildGapLabelTspl(sampleLabel, 1, 28);
    const text = String.fromCharCode(...bytes);
    // Product name line must start at >= 24 dots (e.g. 28 dots) to clear head dead zone
    const match = text.match(/TEXT (\d+),\d+,"3",0,1,1,"Sugar 1kg"/);
    expect(match).not.toBeNull();
    const leftMargin = parseInt(match![1], 10);
    expect(leftMargin).toBeGreaterThanOrEqual(24);
  });

  it('sends center alignment (ESC a 1) in ESC/POS so label has equal margins on both sides of the roll', () => {
    const mockCtx = {
      fillStyle: '',
      fillRect: () => {},
      measureText: (text: string) => ({ width: text.length * 8 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => {},
      drawImage: () => {},
    };
    const mockCanvas = {
      width: 384,
      height: 215,
      getContext: () => mockCtx,
    };
    const previous = (global as { document?: unknown }).document;
    (global as { document?: unknown }).document = {
      createElement: () => mockCanvas,
    };

    try {
      const bytes = buildGapLabelEscPos(sampleLabel, 1, 28);
      // Header must contain ESC a 1 ([0x1b, 0x61, 0x01]) for center alignment
      const headerPrefix = bytes.slice(0, 7);
      expect(headerPrefix).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x4c]);
    } finally {
      if (previous === undefined) delete (global as { document?: unknown }).document;
      else (global as { document?: unknown }).document = previous;
    }
  });
});
