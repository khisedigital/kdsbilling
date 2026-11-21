import {
  MARGIN_58_LEFT_DOTS,
  buildEscPosBytes,
  buildThermalHtml,
  receiptCharsForPaper,
  receiptPrintArea,
  toPlainReceipt,
} from '../src/print/escpos';

describe('receipt paper width balance', () => {
  it('uses 32 cols on 58mm (full width) and 48 on 80mm', () => {
    expect(receiptCharsForPaper('58')).toBe(32);
    expect(receiptCharsForPaper('80')).toBe(48);
    expect(receiptCharsForPaper('58mm')).toBe(32);
    expect(receiptCharsForPaper('80mm')).toBe(48);
  });

  it('builds web/system HTML from the Paper size setting (full 80mm = 48 cols)', () => {
    const sample = `${'='.repeat(48)}\nTOTAL                    10.00\n`;
    const { html, paperMm, charsPerLine } = buildThermalHtml(sample, 42, '80');
    expect(paperMm).toBe(80);
    expect(charsPerLine).toBe(48);
    expect(html).toMatch(/size:\s*80mm\s+\d+mm/);
    expect(html).toContain('Receipt 80mm');
    expect(html).not.toContain('100vw');
    expect(html).toContain('font-weight: 500');
    expect(html).toContain('='.repeat(48));
  });

  it('builds 58mm HTML with equal side padding (native 2″)', () => {
    const { paperMm, charsPerLine, html, sideLeftMm, sideRightMm } = buildThermalHtml('SHOP', 32, '58');
    expect(paperMm).toBe(58);
    expect(charsPerLine).toBe(32);
    expect(sideLeftMm).toBe(sideRightMm);
    expect(html).toMatch(/size:\s*58mm\s+\d+mm/);
    expect(html).toContain('Receipt 58mm');
    expect(html).toContain(`padding: 1mm ${sideRightMm}mm 8mm ${sideLeftMm}mm`);
    expect(html).not.toContain('100vw');
  });

  it('58mm / 2″ uses full 384-dot page with no left inset', () => {
    const a58 = receiptPrintArea(32);
    expect(a58.paperDots).toBe(384);
    expect(a58.leftDots).toBe(MARGIN_58_LEFT_DOTS);
    expect(a58.leftDots).toBe(0);
    expect(a58.widthDots).toBe(384);

    const a80 = receiptPrintArea(48);
    expect(a80.paperDots).toBe(576);
    expect(a80.leftDots).toBe(0);
    expect(a80.widthDots).toBe(576);
  });

  it('does not left-only indent full-width rules (avoids extra right gap)', () => {
    const rule = '-'.repeat(32);
    const plain = toPlainReceipt(rule, 32);
    expect(plain).toBe(rule);
    expect(plain.startsWith(' ')).toBe(false);
  });

  it('centers shop names within the full paper width', () => {
    const plain = toPlainReceipt('<C>SHOP</C>', 32);
    const left = plain.match(/^ */)![0].length;
    const right = 32 - plain.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('58mm ESC/POS is ESC @ + text only (no GS L/W — those stall after shop name)', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 32, '58');
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x4c)).toBe(-1);
    expect(bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x57)).toBe(-1);
    expect(bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x4d)).toBe(-1);
  });

  it('explicit paper 58mm wins even if charsPerLine looks like 80mm', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 48, '58');
    expect(bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x57)).toBe(-1);
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain('TOTAL 10.00');
  });

  it('uses a safe tear-off feed for bill cutting', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 32, '58');
    // Trailing LFs for safe manual tear-off without cutting into text
    let trailing = 0;
    for (let i = bytes.length - 1; i >= 0 && bytes[i] === 0x0a; i -= 1) trailing += 1;
    expect(trailing).toBeLessThanOrEqual(6);
    expect(trailing).toBeGreaterThanOrEqual(3);
  });

  it('80mm feeds safely past the cutter blade before cutting', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 48, '80');
    const cutIndex = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x56);
    expect(cutIndex).toBeGreaterThan(0);
    // Count line feeds right before CUT command
    let preCutLfs = 0;
    for (let i = cutIndex - 1; i >= 0 && bytes[i] === 0x0a; i -= 1) preCutLfs += 1;
    expect(preCutLfs).toBeGreaterThanOrEqual(5);
  });

  it('does not send ESC j reverse-feed (unsupported printers print "jx")', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 48);
    const reverseAt = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x6a);
    expect(reverseAt).toBe(-1);
  });

  it('prints the rest of the bill after a Latin shop name', () => {
    const createElement = () => {
      throw new Error('Latin shop name must stay text, not a bitmap');
    };
    const previous = (global as { document?: unknown }).document;
    (global as { document?: { createElement: typeof createElement } }).document = { createElement };
    try {
      const bytes = buildEscPosBytes('<CB>KIRANA STORES</CB>\nITEM 1 10.00\n', 32);
      const text = Buffer.from(bytes).toString('latin1');
      expect(text).toContain('KIRANA STORES');
      expect(text).toContain('ITEM 1 10.00');
      const escStar = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x2a);
      expect(escStar).toBe(-1);
      // ESC M (Font A) leaked as "M===" on portable heads.
      const escM = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x4d);
      expect(escM).toBe(-1);
      // No GS ! at all on Latin 58mm — enlarge OR reset both upset some heads.
      expect(bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x21)).toBe(-1);
    } finally {
      if (previous === undefined) delete (global as { document?: unknown }).document;
      else (global as { document?: unknown }).document = previous;
    }
  });

  it('80mm ESC/POS still fills the head (GS L=0, GS W=576)', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 48);
    const gsL = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x4c);
    const gsW = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x57);
    expect(gsL).toBeGreaterThanOrEqual(0);
    expect(gsW).toBeGreaterThanOrEqual(0);
    expect(bytes[gsL + 2] + (bytes[gsL + 3] << 8)).toBe(0);
    expect(bytes[gsW + 2] + (bytes[gsW + 3] << 8)).toBe(576);
  });
});
