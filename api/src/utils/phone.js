function normalizePhone(input) {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) return null;
  return digits;
}

function placeholderEmailForPhone(phone) {
  return `${phone}@shop.local`;
}

module.exports = { normalizePhone, placeholderEmailForPhone };
