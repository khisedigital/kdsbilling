import {
  MARGIN_58_LEFT_DOTS,
  buildEscPosBytes,
  buildThermalHtml,
  receiptCharsForPaper,
  receiptPrintArea,
  toPlainReceipt,
} from '../src/print/escpos';

describe('receipt paper width balance', () => {
  it('uses 30 cols on 58mm (with left margin) and 48 on 80mm', () => {
    expect(receiptCharsForPaper('58')).toBe(30);
    expect(receiptCharsForPaper('80')).toBe(48);
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

  it('builds 58mm HTML with extra left padding for converter', () => {
    const { paperMm, charsPerLine, html, sideLeftMm, sideRightMm } = buildThermalHtml('SHOP', 30, '58');
    expect(paperMm).toBe(58);
    expect(charsPerLine).toBe(30);
    expect(sideLeftMm).toBeGreaterThan(sideRightMm!);
    expect(html).toMatch(/size:\s*58mm\s+\d+mm/);
    expect(html).toContain('Receipt 58mm');
    expect(html).toContain(`padding: 1mm ${sideRightMm}mm 8mm ${sideLeftMm}mm`);
    expect(html).not.toContain('100vw');
  });

  it('58mm / 2″ keeps 384-dot page with left converter margin', () => {
    const a58 = receiptPrintArea(30);
    expect(a58.paperDots).toBe(384);
    expect(a58.leftDots).toBe(MARGIN_58_LEFT_DOTS);
    expect(a58.widthDots).toBe(30 * 12);
    expect(a58.leftDots + a58.widthDots).toBeLessThanOrEqual(384);

    const a80 = receiptPrintArea(48);
    expect(a80.paperDots).toBe(576);
    expect(a80.leftDots).toBe(0);
    expect(a80.widthDots).toBe(576);
  });

  it('does not left-only indent full-width rules (avoids extra right gap)', () => {
    const rule = '-'.repeat(30);
    const plain = toPlainReceipt(rule, 30);
    expect(plain).toBe(rule);
    expect(plain.startsWith(' ')).toBe(false);
  });

  it('centers shop names within the full paper width', () => {
    const plain = toPlainReceipt('<C>SHOP</C>', 30);
    const left = plain.match(/^ */)![0].length;
    const right = 30 - plain.length;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('58mm / 2″ ESC/POS sets GS L left margin and GS W content width', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 30);
    const gsL = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x4c);
    const gsW = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x57);
    expect(gsL).toBeGreaterThanOrEqual(0);
    expect(gsW).toBeGreaterThanOrEqual(0);
    expect(bytes[gsL + 2] + (bytes[gsL + 3] << 8)).toBe(MARGIN_58_LEFT_DOTS);
    expect(bytes[gsW + 2] + (bytes[gsW + 3] << 8)).toBe(360);
  });

  it('does not send ESC j reverse-feed (unsupported printers print "jx")', () => {
    const bytes = buildEscPosBytes('TOTAL 10.00', 48);
    const reverseAt = bytes.findIndex((b, i) => b === 0x1b && bytes[i + 1] === 0x6a);
    expect(reverseAt).toBe(-1);
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
