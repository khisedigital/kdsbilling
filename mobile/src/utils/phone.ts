export function normalizeMobile(input: string): string | null {
  if (!input) return null;
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return null;
  return digits;
}

export function formatMobileDisplay(mobile: string): string {
  const digits = normalizeMobile(mobile);
  if (!digits) return mobile;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}
