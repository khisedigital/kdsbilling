import qrcode from 'qrcode-generator';

export function paymentQrData(upiId: string, shopName: string, amount: number): string {
  const id = upiId.trim();
  if (!id || !Number.isFinite(amount) || amount <= 0 || amount.toFixed(2) === '0.00') return '';
  return `upi://pay?pa=${encodeURIComponent(id)}&pn=${encodeURIComponent(shopName.trim())}&am=${amount.toFixed(2)}&cu=INR`;
}

function makeQr(data: string) {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();
  return qr;
}

export function paymentQrSvg(data: string): string {
  return makeQr(data).createSvgTag({ cellSize: 4, margin: 16, scalable: true });
}

/** Insert a centered QR bitmap before the receipt's existing feed and cut. */
export function insertPaymentQr(bytes: number[], data: string, charsPerLine: number): number[] {
  const hasCut = bytes.length >= 3 &&
    bytes[bytes.length - 3] === 0x1d && bytes[bytes.length - 2] === 0x56;
  const feedCount = hasCut ? 6 : 4;
  const tailLength = feedCount + (hasCut ? 3 : 0);
  const tailStart = bytes.length - tailLength;
  if (tailStart < 0 || bytes.slice(tailStart, tailStart + feedCount).some((b) => b !== 0x0a)) {
    throw new Error('Cannot add payment QR: unrecognized receipt feed.');
  }

  const qr = makeQr(data);
  const modules = qr.getModuleCount();
  const width = charsPerLine <= 32 ? 384 : 576;
  const scale = Math.min(4, Math.floor(width / (modules + 8)));
  if (scale < 3) throw new Error('Payment QR is too large for this printer.');
  const size = (modules + 8) * scale;
  const left = Math.floor((width - size) / 2);
  const widthBytes = width / 8;
  const out = bytes.slice(0, tailStart);
  for (let y0 = 0; y0 < size; y0 += 24) {
    const rows = Math.min(24, size - y0);
    out.push(0x1d, 0x76, 0x30, 0, widthBytes, 0, rows, 0);
    for (let y = y0; y < y0 + rows; y += 1) {
      for (let xb = 0; xb < widthBytes; xb += 1) {
        let value = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const col = Math.floor((xb * 8 + bit - left) / scale) - 4;
          const row = Math.floor(y / scale) - 4;
          if (row >= 0 && row < modules && col >= 0 && col < modules && qr.isDark(row, col)) {
            value |= 0x80 >> bit;
          }
        }
        out.push(value);
      }
    }
  }
  return out.concat(bytes.slice(tailStart));
}
