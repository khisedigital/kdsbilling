/**
 * EAN-13 for valid 13-digit codes, Code 128 otherwise.
 * Modules are '1' (bar) and '0' (space), without quiet zones.
 * Same rules as the 50×25 label printer app.
 */

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const STOP = 106;

const EAN_L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_R = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const weight = i % 2 === 0 ? 1 : 3;
    sum += (first12.charCodeAt(i) - 48) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === value.charCodeAt(12) - 48;
}

export function encodeBarcode(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error('Barcode is empty.');
  return isValidEan13(value) ? encodeEan13(value) : encodeCode128(value);
}

function encodeEan13(value: string): string {
  const parity = EAN_PARITY[value.charCodeAt(0) - 48];
  let modules = '101';
  for (let i = 1; i <= 6; i += 1) {
    const digit = value.charCodeAt(i) - 48;
    modules += parity[i - 1] === 'L' ? EAN_L[digit] : EAN_G[digit];
  }
  modules += '01010';
  for (let i = 7; i <= 12; i += 1) modules += EAN_R[value.charCodeAt(i) - 48];
  modules += '101';
  return modules;
}

function encodeCode128(value: string): string {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Barcode cannot contain "${ch}".`);
  }
  const values = code128Values(value);
  let checksum = values[0];
  for (let i = 1; i < values.length; i += 1) checksum += values[i] * i;
  const symbols = [...values, checksum % 103, STOP];
  return symbols.map((symbol) => widthsToModules(CODE128_PATTERNS[symbol])).join('');
}

function code128Values(value: string): number[] {
  const allDigits = [...value].every((ch) => ch >= '0' && ch <= '9');
  if (allDigits && value.length >= 4) {
    const even = value.length - (value.length % 2);
    const values = [START_C];
    for (let i = 0; i < even; i += 2) values.push(parseInt(value.slice(i, i + 2), 10));
    if (even < value.length) {
      values.push(CODE_B);
      values.push(value.charCodeAt(even) - 32);
    }
    return values;
  }
  return [START_B, ...[...value].map((ch) => ch.charCodeAt(0) - 32)];
}

function widthsToModules(widths: string): string {
  let out = '';
  for (let i = 0; i < widths.length; i += 1) {
    const bar = i % 2 === 0 ? '1' : '0';
    out += bar.repeat(widths.charCodeAt(i) - 48);
  }
  return out;
}
