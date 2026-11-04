import { ean13CheckDigit } from '../print/barcodeEncode';

/** 13-digit in-store EAN-13 (prefix 20). Digits only. */
export function randomInStoreEan13(): string {
  let body = '20';
  while (body.length < 12) body += String(Math.floor(Math.random() * 10));
  return body + String(ean13CheckDigit(body));
}

/** Keep a typed number. A blank field, or a code with letters, becomes a fresh 13-digit code. */
export function barcodeOrGenerated(value: string, used: Set<string>): string {
  const code = String(value || '').trim();
  if (/^\d+$/.test(code)) {
    used.add(code);
    return code;
  }
  let next = randomInStoreEan13();
  while (used.has(next)) next = randomInStoreEan13();
  used.add(next);
  return next;
}
