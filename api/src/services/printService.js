const { DEVANAGARI, renderIndicLine, paperDotsForMarkup } = require('./indicEscPos');
const { getMasterModels } = require('../models/master');

function formatMoneyThermal(amount) {
  const n = parseFloat(amount);
  const value = Number.isFinite(n) ? n.toFixed(2) : '0.00';
  return `Rs.${value}`;
}

function formatMoneyHtml(amount, currency = 'INR') {
  const n = parseFloat(amount);
  const value = Number.isFinite(n) ? n.toFixed(2) : '0.00';
  const sym = currency === 'INR' ? '₹' : currency;
  return `${sym}${value}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function resolveAbsoluteUrl(url, publicBaseUrl) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!publicBaseUrl) return url;
  const base = publicBaseUrl.replace(/\/$/, '');
  return url.startsWith('/') ? `${base}${url}` : `${base}/${url}`;
}

function resolveBillDate(bill) {
  return bill?.createdAt || bill?.created_at || bill?.dataValues?.createdAt || bill?.dataValues?.created_at || null;
}

/** Fixed ASCII datetime — avoids locale glyphs thermal printers can't print */
function formatReceiptDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Keep thermal text ESC/POS safe. Marathi stays so it can be drawn as an image. */
function sanitizeThermalText(value) {
  return String(value ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[<>]/g, '')
    .replace(/[^\x20-\x7E\n\u0900-\u097F\u200C\u200D]/g, '?');
}

/**
 * Column widths for common ESC/POS Font A printers.
 * 58mm ≈ 32 cols, 80mm ≈ 42 cols (48 often overflows / wraps badly).
 */
function charsForFormat(format) {
  if (format === '58') return 32;
  if (format === '80') return 42;
  return 42;
}

function billCopy(language) {
  const mr = language === 'mr';
  return {
    taxInvoice: mr ? 'टॅक्स इनव्हॉइस' : 'TAX INVOICE',
    bill: mr ? 'बिल' : 'Bill',
    billNo: mr ? 'बिल क्र.' : 'Bill No',
    date: mr ? 'तारीख' : 'Date',
    customer: mr ? 'ग्राहक' : 'Customer',
    walkIn: mr ? 'काउंटर' : 'Walk-in',
    item: mr ? 'वस्तू' : 'ITEM',
    qty: mr ? 'नग' : 'QTY',
    rate: mr ? 'दर' : 'RATE',
    amt: mr ? 'रक्कम' : 'AMT',
    itemWord: mr ? 'वस्तू' : 'Item',
    qtyWord: mr ? 'नग' : 'Qty',
    rateWord: mr ? 'दर' : 'Rate',
    amount: mr ? 'रक्कम' : 'Amount',
    subtotal: mr ? 'बेरीज' : 'Subtotal',
    discount: mr ? 'सूट' : 'Discount',
    tax: mr ? 'कर' : 'Tax',
    round: mr ? 'राउंड ऑफ' : 'Round off',
    total: mr ? 'एकूण' : 'TOTAL',
    change: mr ? 'परत' : 'Change',
    thanks: mr ? 'धन्यवाद! पुन्हा भेट द्या' : 'Thank you! Visit Again',
    phone: mr ? 'फोन' : 'Ph',
  };
}

const MR_PAY = { cash: 'रोख', upi: 'UPI', card: 'कार्ड', credit: 'उधार', store_credit: 'वॉलेट' };

function payLabel(mode, language) {
  const raw = String(mode || '').toLowerCase();
  if (language !== 'mr') return String(mode || '').toUpperCase();
  return MR_PAY[raw] || String(mode || '');
}

function formatPrintedProductName(baseName, size, color) {
  const name = String(baseName || '').trim();
  const parts = [size, color].map((p) => String(p || '').trim()).filter(Boolean);
  if (!name) return parts.join(' · ') || '-';
  return parts.length ? `${name} (${parts.join(' · ')})` : name;
}

function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

/** Marathi bill → Marathi product name when available; otherwise English / saved line name. */
function itemPrintName(item, language, masterNameMrByEnglish = null) {
  const variant = item.variant || item.ProductVariant;
  const product = variant?.product || variant?.Product;
  const size = variant?.size;
  const color = variant?.color;
  const saved = String(item.product_name || item.productName || '').trim();
  if (language === 'mr') {
    const englishKey = String(product?.name || '').trim().toLowerCase();
    const marathi = String(
      product?.name_mr
      || product?.nameMr
      || item.product_name_mr
      || (englishKey && masterNameMrByEnglish?.get(englishKey))
      || '',
    ).trim();
    if (marathi) return formatPrintedProductName(marathi, size, color);
    // Already stored as Marathi on the line (createBill with language=mr).
    if (hasDevanagari(saved)) return saved;
  } else if (product?.name) {
    return formatPrintedProductName(product.name, size, color);
  }
  return saved || '-';
}

/** Fill missing Marathi names from master catalog (by English product name). */
async function loadMasterNameMrMap(bill) {
  const names = [];
  for (const item of bill.items || []) {
    const product = item.variant?.product || item.ProductVariant?.product;
    if (product?.name_mr) continue;
    if (hasDevanagari(item.product_name)) continue;
    const english = String(product?.name || '').trim();
    if (english) names.push(english);
  }
  const unique = [...new Set(names)];
  const map = new Map();
  if (!unique.length) return map;
  try {
    const { MasterProduct } = getMasterModels();
    const { Op } = require('sequelize');
    const rows = await MasterProduct.findAll({
      where: { name: { [Op.in]: unique }, status: 'active' },
      attributes: ['name', 'name_mr'],
    });
    for (const row of rows) {
      const mr = row.name_mr ? String(row.name_mr).trim() : '';
      if (mr) map.set(String(row.name).trim().toLowerCase(), mr);
    }
  } catch {
    // Master DB unavailable — keep English names.
  }
  return map;
}

function buildReceiptPayload(
  bill,
  tenant,
  shopSettings = {},
  publicBaseUrl = null,
  language = 'en',
  masterNameMrByEnglish = null,
) {
  const mr = language === 'mr';
  const shopName =
    (mr && String(shopSettings.shopNameMr || '').trim()) || shopSettings.shopName || tenant.name;
  const addressMr = mr ? String(shopSettings.addressMr || '').trim() : '';
  const footer = (shopSettings.billFooter || 'Thank you!').trim() || 'Thank you!';
  const phone = String(shopSettings.phone || tenant.owner_mobile || '').trim();
  const lang = mr ? 'mr' : 'en';

  const tagline = (mr && String(shopSettings.taglineMr || '').trim()) || shopSettings.tagline || '';
  const invoiceTitle = (mr && String(shopSettings.invoiceTitleMr || '').trim()) || shopSettings.invoiceTitle || '';
  const terms = (mr && String(shopSettings.termsMr || '').trim()) || shopSettings.terms || '';

  // Generate UPI payment string if enabled
  let paymentQrData = '';
  if (shopSettings.enablePaymentQr === true && shopSettings.paymentQrUpiId) {
    const upiId = encodeURIComponent(shopSettings.paymentQrUpiId.trim());
    const amount = Math.round(parseFloat(bill.total_amount) * 100) / 100;
    const billNo = encodeURIComponent(String(bill.bill_number || 'Bill').substring(0, 80));
    paymentQrData = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(shopName)}&am=${amount}&tn=${billNo}`;
  }

  return {
    shopName,
    tagline: shopSettings.showTagline !== false ? tagline : '',
    address: addressMr || shopSettings.address || '',
    city: addressMr ? '' : shopSettings.city || '',
    state: shopSettings.state || '',
    stateCode: shopSettings.stateCode || '',
    pincode: shopSettings.pincode || '',
    gstin: (shopSettings.showGstin !== false && shopSettings.gstin) ? shopSettings.gstin : '',
    fssai: (shopSettings.showFssai !== false && shopSettings.fssai) ? shopSettings.fssai : '',
    drugLicense: (shopSettings.showDrugLicense !== false && shopSettings.drugLicense) ? shopSettings.drugLicense : '',
    tradeLicense: (shopSettings.showTradeLicense !== false && shopSettings.tradeLicense) ? shopSettings.tradeLicense : '',
    pan: (shopSettings.showPan !== false && shopSettings.pan) ? shopSettings.pan : '',
    invoiceTitle,
    phone,
    secondaryPhone: shopSettings.secondaryPhone || '',
    email: shopSettings.email || '',
    website: shopSettings.website || '',
    upiId: (shopSettings.showUpi !== false && shopSettings.upiId) ? shopSettings.upiId : '',
    terms: shopSettings.showTerms !== false ? terms : '',
    billFooter: footer,
    showLogo: shopSettings.showLogo !== false,
    logoUrl: (shopSettings.showLogo !== false && shopSettings.logoUrl) ? resolveAbsoluteUrl(shopSettings.logoUrl, publicBaseUrl) : null,
    billQrCodeType: shopSettings.billQrCodeType || 'none',
    enablePaymentQr: shopSettings.enablePaymentQr === true,
    paymentQrUpiId: (shopSettings.enablePaymentQr === true && shopSettings.paymentQrUpiId) ? shopSettings.paymentQrUpiId : '',
    paymentQrData,
    billNumber: bill.bill_number,
    date: resolveBillDate(bill),
    customer: bill.customer?.name || (language === 'mr' ? 'काउंटर' : 'Walk-in'),
    customerPhone: bill.customer?.phone || '',
    items: (bill.items || []).map((i) => ({
      name: itemPrintName(i, lang, masterNameMrByEnglish),
      sku: i.sku,
      qty: formatBillQty(i.quantity, itemUom(i)),
      price: parseFloat(i.unit_price),
      total: parseFloat(i.line_total),
      taxAmount: parseFloat(i.tax_amount),
      taxes: (i.taxes || []).map((t) => ({
        name: t.tax_name,
        rate: parseFloat(t.rate_percent),
        amount: parseFloat(t.tax_amount),
      })),
    })),
    subtotal: parseFloat(bill.subtotal),
    discount: parseFloat(bill.discount_amount),
    tax: parseFloat(bill.tax_amount),
    roundOff: parseFloat(bill.round_off_amount || bill.roundOffAmount || 0),
    total: parseFloat(bill.total_amount),
    payments: (bill.payments || []).map((p) => ({
      mode: p.payment_mode,
      amount: parseFloat(p.amount),
    })),
    change: parseFloat(bill.change_amount),
    currency: tenant.currency_code,
  };
}

/** Center a line within paper width using spaces (thermal-safe, no ESC). */
function centerLine(text, charsPerLine) {
  const value = sanitizeThermalText(text).trim();
  if (!value) return '';
  const body = value.length > charsPerLine ? value.slice(0, charsPerLine) : value;
  const pad = Math.max(0, Math.floor((charsPerLine - body.length) / 2));
  return `${' '.repeat(pad)}${body}`;
}

/**
 * Word-wrap text to paper width.
 * Prefers breaks at spaces; only hard-splits overlong tokens.
 */
function wrapWords(text, width) {
  const value = sanitizeThermalText(text).replace(/\s+/g, ' ').trim();
  if (!value) return [];
  if (value.length <= width) return [value];

  const lines = [];
  const tokens = value.split(' ').filter(Boolean);
  let current = '';

  const flush = () => {
    if (current) {
      lines.push(current);
      current = '';
    }
  };

  const pushHard = (token) => {
    let rest = token;
    while (rest.length > width) {
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    current = rest;
  };

  for (const token of tokens) {
    if (token.length > width) {
      flush();
      pushHard(token);
      continue;
    }
    const next = current ? `${current} ${token}` : token;
    if (next.length <= width) {
      current = next;
    } else {
      flush();
      current = token;
    }
  }
  flush();
  return lines;
}

function pushWrappedLeft(lines, text, charsPerLine) {
  for (const part of wrapWords(text, charsPerLine)) {
    lines.push(part);
  }
}

/** Wrap and emit as tagged ESC/POS markup (mobile / network encoder understands these). */
function pushTaggedWrapped(lines, text, width, openTag, closeTag) {
  for (const part of wrapWords(text, width)) {
    lines.push(`${openTag}${part}${closeTag}`);
  }
}

/** Single address block — avoid repeating city / state when already present. */
function formatAddressBlock(address, city, state, pincode) {
  const parts = [];
  const addr = sanitizeThermalText(address || '').replace(/\s+/g, ' ').trim();
  const cityVal = sanitizeThermalText(city || '').replace(/\s+/g, ' ').trim();
  const stateVal = sanitizeThermalText(state || '').replace(/\s+/g, ' ').trim();
  const pin = sanitizeThermalText(pincode || '').replace(/\s+/g, ' ').trim();

  if (addr) parts.push(addr);
  if (cityVal && !addr.toLowerCase().includes(cityVal.toLowerCase())) {
    parts.push(cityVal);
  }
  if (stateVal && !addr.toLowerCase().includes(stateVal.toLowerCase())) {
    parts.push(stateVal);
  }
  if (pin && !addr.includes(pin)) {
    parts.push(pin);
  }
  return parts.join(', ');
}

function ruleLine(charsPerLine, char = '-') {
  return char.repeat(charsPerLine);
}

/**
 * Shop header for 58mm / 80mm:
 * - banner + large centered shop name
 * - optional tagline
 * - address / phone / GSTIN / FSSAI / Drug License / PAN under it
 * - Invoice title label
 */
function pushShopHeader(lines, payload, charsPerLine, copy) {
  const star = ruleLine(charsPerLine, '=');
  lines.push(star);

  // Double-width shop name → wrap at half width so it does not overflow
  const nameWidth = Math.max(12, Math.floor(charsPerLine / 2));
  const shopName = sanitizeThermalText(payload.shopName || 'SHOP').trim() || 'SHOP';
  const shopTitle = /[\u0900-\u097F]/.test(shopName) ? shopName : shopName.toUpperCase();
  pushTaggedWrapped(lines, shopTitle, nameWidth, '<CB>', '</CB>');

  if (payload.tagline) {
    pushTaggedWrapped(lines, sanitizeThermalText(payload.tagline), charsPerLine, '<C>', '</C>');
  }

  lines.push(star);

  const addressBlock = formatAddressBlock(payload.address, payload.city, payload.state, payload.pincode);
  if (addressBlock) {
    pushTaggedWrapped(lines, addressBlock, charsPerLine, '<C>', '</C>');
  }
  if (payload.phone) {
    const phText = payload.secondaryPhone
      ? `${copy.phone}: ${payload.phone} / ${payload.secondaryPhone}`
      : `${copy.phone}: ${payload.phone}`;
    pushTaggedWrapped(lines, phText, charsPerLine, '<C>', '</C>');
    if (charsPerLine >= 42 && payload.gstin) lines.push('');
  }
  if (payload.gstin) {
    pushTaggedWrapped(lines, `GSTIN: ${payload.gstin}`, charsPerLine, '<C>', '</C>');
  }
  if (payload.fssai) {
    pushTaggedWrapped(lines, `FSSAI: ${payload.fssai}`, charsPerLine, '<C>', '</C>');
  }
  if (payload.drugLicense) {
    pushTaggedWrapped(lines, `D.L. No: ${payload.drugLicense}`, charsPerLine, '<C>', '</C>');
  }
  if (payload.tradeLicense) {
    pushTaggedWrapped(lines, `Trade Lic: ${payload.tradeLicense}`, charsPerLine, '<C>', '</C>');
  }
  if (payload.pan) {
    pushTaggedWrapped(lines, `PAN: ${payload.pan}`, charsPerLine, '<C>', '</C>');
  }

  lines.push(ruleLine(charsPerLine, '-'));
  const docTitle = payload.invoiceTitle || copy.taxInvoice;
  pushTaggedWrapped(lines, docTitle, charsPerLine, '<C>', '</C>');
  lines.push(ruleLine(charsPerLine, '-'));
}


/** Visual column count — Devanagari graphemes count as one cell each. */
function colLen(text) {
  const value = String(text || '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('mr', { granularity: 'grapheme' }).segment(value)].length;
  }
  return Array.from(value).length;
}

function padCell(text, width, align = 'left') {
  const raw = String(text || '');
  let body = raw;
  if (colLen(body) > width) {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      body = [...new Intl.Segmenter('mr', { granularity: 'grapheme' }).segment(raw)]
        .slice(0, width)
        .map((p) => p.segment)
        .join('');
    } else {
      body = Array.from(raw).slice(0, width).join('');
    }
  }
  const gap = width - colLen(body);
  if (gap <= 0) return body;
  return align === 'right' ? `${' '.repeat(gap)}${body}` : `${body}${' '.repeat(gap)}`;
}

function moneyCell(amount) {
  const n = parseFloat(amount);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function itemTaxDetails(item) {
  const taxes = Array.isArray(item.taxes) ? item.taxes : [];
  if (taxes.length) {
    return taxes.map((tax) => {
      const rate = parseFloat(tax.rate);
      const rateLabel = Number.isFinite(rate) ? ` (${parseFloat(rate.toFixed(4))}%)` : '';
      return {
        label: `${sanitizeThermalText(tax.name || 'Tax')}${rateLabel}`,
        amount: tax.amount,
      };
    });
  }

  const taxAmount = parseFloat(item.taxAmount);
  return Number.isFinite(taxAmount) && taxAmount > 0
    ? [{ label: '', amount: taxAmount }]
    : [];
}

function tableCols(charsPerLine) {
  // Qty is wide enough for a barcode weight: 100g, 50g, 1.5kg.
  if (charsPerLine <= 32) return { item: 9, qty: 6, rate: 7, amt: 7 };
  if (charsPerLine <= 42) return { item: 15, qty: 7, rate: 8, amt: 9 };
  return { item: 18, qty: 7, rate: 8, amt: 9 };
}

function itemUom(item) {
  if (item?.uom?.code) return item.uom;
  return item?.variant?.product?.uom || item?.ProductVariant?.product?.uom || null;
}

/** 0.1 kg → "100 g", 0.05 kg → "50 g", 1 → "1 kg". Pieces stay a number. */
function formatBillQty(qty, uom) {
  const n = parseFloat(qty);
  if (!Number.isFinite(n)) return '0';
  const code = String(uom?.code || '').toLowerCase();
  const type = uom?.type;
  const weight = type === 'weight' || ['g', 'gm', 'gram', 'grams', 'kg', 'kgs', 'kilogram', 'kilograms'].includes(code);
  const volume = type === 'volume' || ['ml', 'l', 'ltr', 'litre', 'liter', 'liters'].includes(code);
  if (!weight && !volume) {
    return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
  }
  if (code === 'kg' || (weight && !code)) {
    if (n < 1) {
      const grams = Math.round(n * 1000);
      return grams >= 1000 ? '1 kg' : `${grams} g`;
    }
    return `${parseFloat(n.toFixed(4))} kg`;
  }
  if (code === 'g' || code === 'gm' || code === 'gram' || code === 'grams') return `${Math.round(n)} g`;
  if (code === 'ltr' || code === 'l' || code === 'litre' || code === 'liter') {
    if (n < 1) {
      const ml = Math.round(n * 1000);
      return ml >= 1000 ? '1 ltr' : `${ml} ml`;
    }
    return `${parseFloat(n.toFixed(4))} ltr`;
  }
  if (code === 'ml') return `${Math.round(n)} ml`;
  return Number.isInteger(n) ? `${n} ${uom.code}` : `${parseFloat(n.toFixed(3))} ${uom.code}`;
}

function tableHeaderLine(charsPerLine, copy) {
  const c = tableCols(charsPerLine);
  return (
    padCell(copy.item, c.item) + ' ' +
    padCell(copy.qty, c.qty, 'right') + ' ' +
    padCell(copy.rate, c.rate, 'right') + ' ' +
    padCell(copy.amt, c.amt, 'right')
  ).slice(0, charsPerLine);
}

function tableItemLines(charsPerLine, name, qty, rate, amt) {
  const c = tableCols(charsPerLine);
  const rawQty = String(qty ?? '').trim();
  const qtyStr = /[a-z]/i.test(rawQty)
    ? rawQty.replace(/\s+/g, '')
    : (() => {
      const qtyNum = parseFloat(rawQty);
      if (!Number.isFinite(qtyNum)) return '0';
      return Number.isInteger(qtyNum) ? String(qtyNum) : String(parseFloat(qtyNum.toFixed(3)));
    })();
  const rateStr = moneyCell(rate);
  const amtStr = moneyCell(amt);
  const nameLines = wrapWords(sanitizeThermalText(name), c.item);
  if (!nameLines.length) nameLines.push('-');
  return nameLines.map((line, idx) => {
    if (idx === 0) {
      return (
        padCell(line, c.item) + ' ' +
        padCell(qtyStr, c.qty, 'right') + ' ' +
        padCell(rateStr, c.rate, 'right') + ' ' +
        padCell(amtStr, c.amt, 'right')
      ).slice(0, charsPerLine);
    }
    return padCell(line, c.item);
  });
}

function renderThermal(payload, charsPerLine = 32, language = 'en') {
  const divider = (ch = '-') => ruleLine(charsPerLine, ch);
  const row = (left, right) => {
    const l = sanitizeThermalText(left);
    const r = sanitizeThermalText(right);
    const space = charsPerLine - colLen(l) - colLen(r);
    return l + ' '.repeat(Math.max(1, space)) + r;
  };

  const copy = billCopy(language);
  const lines = [];
  const add80mmGap = () => {
    if (charsPerLine >= 42) lines.push('');
  };
  pushShopHeader(lines, payload, charsPerLine, copy);
  lines.push(row(copy.date, formatReceiptDate(payload.date)));
  if (payload.billNumber != null && String(payload.billNumber).trim()) {
    lines.push(row(copy.billNo, payload.billNumber));
  }
  add80mmGap();
  lines.push(row(copy.customer, sanitizeThermalText(payload.customer).slice(0, Math.max(8, charsPerLine - 10))));
  lines.push(divider('='));
  lines.push(`<B>${tableHeaderLine(charsPerLine, copy)}</B>`);
  lines.push(divider('-'));

  for (const [index, item] of payload.items.entries()) {
    lines.push(...tableItemLines(charsPerLine, item.name, item.qty, item.price, item.total));
    for (const tax of itemTaxDetails(item)) {
      pushWrappedLeft(
        lines,
        `Tax: ${tax.label ? `${tax.label} ` : ''}${formatMoneyThermal(tax.amount)}`,
        charsPerLine,
      );
    }
    if (index < payload.items.length - 1) add80mmGap();
  }

  lines.push(divider('='));
  lines.push(row(copy.subtotal, formatMoneyThermal(payload.subtotal)));
  if (payload.discount > 0) {
    lines.push(row(copy.discount, `-${formatMoneyThermal(payload.discount)}`));
  }
  add80mmGap();
  lines.push(row(copy.tax, formatMoneyThermal(payload.tax)));
  if (Math.abs(payload.roundOff || 0) >= 0.005) {
    const ro = payload.roundOff;
    lines.push(row(copy.round, `${ro > 0 ? '+' : '-'}${formatMoneyThermal(Math.abs(ro))}`));
  }
  add80mmGap();
  lines.push(`<B>${row(copy.total, formatMoneyThermal(payload.total))}</B>`);
  lines.push(divider('-'));
  for (const p of payload.payments) {
    lines.push(row(payLabel(p.mode, language), formatMoneyThermal(p.amount)));
  }
  if (payload.change > 0) {
    lines.push(row(copy.change, formatMoneyThermal(payload.change)));
  }
  lines.push(divider('='));

  if (payload.upiId) {
    lines.push(`<C>UPI: ${payload.upiId}</C>`);
    lines.push(divider('-'));
  }

  if (payload.terms) {
    pushTaggedWrapped(lines, payload.terms, charsPerLine, '<C>', '</C>');
    lines.push(divider('-'));
  }

  const customFooter = sanitizeThermalText(payload.billFooter || '').trim();
  const isThankYouFooter = /thank\s*you/i.test(customFooter);
  if (customFooter && !isThankYouFooter) {
    pushTaggedWrapped(lines, customFooter, charsPerLine, '<C>', '</C>');
  }
  lines.push(`<C>${copy.thanks}</C>`);
  lines.push(divider('='));

  return {
    format: 'thermal',
    charsPerLine,
    lines,
    raw: lines.join('\n'),
  };
}

function renderA4(payload, language = 'en') {
  const copy = billCopy(language);
  const itemsHtml = payload.items.map((i) => {
    const taxHtml = itemTaxDetails(i).map((tax) =>
      `<div class="item-tax">${tax.label ? `${escapeHtml(tax.label)}: ` : 'Tax: '}${formatMoneyHtml(tax.amount, payload.currency)}</div>`
    ).join('');
    return `
    <tr>
      <td>${escapeHtml(i.name)}${i.sku ? `<br><small style="color:#6b7280">${escapeHtml(i.sku)}</small>` : ''}${taxHtml}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:right">${formatMoneyHtml(i.price, payload.currency)}</td>
      <td style="text-align:right">${formatMoneyHtml(i.total, payload.currency)}</td>
    </tr>`;
  }).join('');

  const logoHtml = payload.showLogo && payload.logoUrl
    ? `<img src="${escapeHtml(payload.logoUrl)}" alt="Logo" class="logo" />`
    : '';

  const addressBlock = formatAddressBlock(payload.address, payload.city, payload.state, payload.pincode);
  const metaBits = [
    payload.tagline ? `<div style="font-style:italic;margin-bottom:2px">${escapeHtml(payload.tagline)}</div>` : '',
    addressBlock ? escapeHtml(addressBlock) : '',
    payload.phone
      ? escapeHtml(payload.secondaryPhone ? `${copy.phone}: ${payload.phone} / ${payload.secondaryPhone}` : `${copy.phone}: ${payload.phone}`)
      : '',
    payload.gstin ? `GSTIN: ${escapeHtml(payload.gstin)}` : '',
    payload.fssai ? `FSSAI Lic No: ${escapeHtml(payload.fssai)}` : '',
    payload.drugLicense ? `D.L. No: ${escapeHtml(payload.drugLicense)}` : '',
    payload.tradeLicense ? `Trade Lic: ${escapeHtml(payload.tradeLicense)}` : '',
    payload.pan ? `PAN: ${escapeHtml(payload.pan)}` : '',
  ].filter(Boolean);

  const paymentsHtml = (payload.payments || []).map((p) =>
    `<div class="pay-row"><span>${escapeHtml(payLabel(p.mode, language))}</span><span>${formatMoneyHtml(p.amount, payload.currency)}</span></div>`
  ).join('');
  const upiHtml = payload.upiId
    ? `<div class="pay-row"><span>UPI</span><span><strong>${escapeHtml(payload.upiId)}</strong></span></div>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      @page {
        size: A4 portrait;
        margin: 3mm 10mm 6mm;
      }
      *{box-sizing:border-box}
      html, body {
        width: 100%;
        max-width: 100%;
        margin: 0;
        padding: 0;
      }
      body{font-family:Georgia,'Times New Roman','Nirmala UI','Noto Sans Devanagari',Mangal,serif;padding:4px 16px 16px;color:#111;width:100%;max-width:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .banner{text-align:center;border-top:2px double #111;border-bottom:2px double #111;padding:8px 12px 8px;margin-bottom:12px;width:100%}
      .logo{max-height:56px;max-width:180px;object-fit:contain;margin-bottom:6px}
      .shop{font-size:24px;font-weight:700;letter-spacing:0.04em;margin:0 0 4px;text-transform:uppercase;line-height:1.3}
      .meta{color:#374151;font-size:12px;margin:2px 0;line-height:1.4;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif}
      .doc-title{margin-top:6px;font-size:12px;letter-spacing:0.18em;font-weight:700;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif}
      .bill-meta{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;text-align:left;margin:0 0 10px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:12px;color:#374151;line-height:1.4;width:100%}
      .customer-details{flex:1;min-width:0}
      .bill-identifiers{text-align:right;min-width:190px}
      .bill-meta strong{color:#111}
      table{width:100%;border-collapse:collapse;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      th,td{border-bottom:1px solid #e5e7eb;padding:7px 6px;text-align:left;line-height:1.35}
      th{background:#f3f4f6;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#4b5563}
      .item-tax{font-size:10px;line-height:1.35;margin-top:2px}
      .totals{margin-top:12px;margin-left:auto;width:280px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      .totals .row{display:flex;justify-content:space-between;padding:3px 0}
      .totals .grand{border-top:2px solid #111;margin-top:6px;padding-top:8px;font-size:16px;font-weight:700}
      .pay{margin-top:12px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      .pay-row{display:flex;justify-content:space-between;max-width:280px;margin-left:auto;padding:2px 0}
      .footer{text-align:center;margin-top:24px;padding-top:10px;border-top:1px solid #d1d5db;color:#374151;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px;width:100%}
      .cut-space{height:16mm;width:100%}
      @media print {
        @page {
          size: A4 portrait;
          margin: 3mm 10mm 6mm;
        }
        html, body {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .banner, .bill-meta, table, .footer {
          width: 100% !important;
          max-width: 100% !important;
        }
        .banner { padding: 6px 10px !important; margin-bottom: 8px !important; }
        .cut-space { height: 16mm !important; }
      }
    </style>
    </head><body>
    <div class="banner">
      ${logoHtml}
      <h1 class="shop">${escapeHtml(payload.shopName || 'Shop')}</h1>
      ${metaBits.map((m) => `<p class="meta">${m}</p>`).join('')}
      <p class="doc-title">${escapeHtml(payload.invoiceTitle || copy.taxInvoice)}</p>
    </div>
    <div class="bill-meta">
      <div class="customer-details">
        <div><strong>${escapeHtml(copy.customer)}</strong></div>
        <div>${escapeHtml(payload.customer)}</div>
        ${payload.customerPhone ? `<div><strong>${escapeHtml(copy.phone)}</strong> ${escapeHtml(payload.customerPhone)}</div>` : ''}
      </div>
      <div class="bill-identifiers">
        <div><strong>${escapeHtml(copy.date)}</strong> ${escapeHtml(formatReceiptDate(payload.date))}</div>
        ${payload.billNumber != null && String(payload.billNumber).trim()
          ? `<div><strong>${escapeHtml(copy.billNo)}</strong> ${escapeHtml(payload.billNumber)}</div>`
          : ''}
      </div>
    </div>
    <table><thead><tr><th>${escapeHtml(copy.itemWord)}</th><th style="text-align:center">${escapeHtml(copy.qtyWord)}</th><th style="text-align:right">${escapeHtml(copy.rateWord)}</th><th style="text-align:right">${escapeHtml(copy.amount)}</th></tr></thead>
    <tbody>${itemsHtml}</tbody></table>
    <div class="totals">
      <div class="row"><span>${escapeHtml(copy.subtotal)}</span><span>${formatMoneyHtml(payload.subtotal, payload.currency)}</span></div>
      ${payload.discount > 0 ? `<div class="row"><span>${escapeHtml(copy.discount)}</span><span>-${formatMoneyHtml(payload.discount, payload.currency)}</span></div>` : ''}
      <div class="row"><span>${escapeHtml(copy.tax)}</span><span>${formatMoneyHtml(payload.tax, payload.currency)}</span></div>
      ${Math.abs(payload.roundOff || 0) >= 0.005
        ? `<div class="row"><span>${escapeHtml(copy.round)}</span><span>${payload.roundOff > 0 ? '+' : '-'}${formatMoneyHtml(Math.abs(payload.roundOff), payload.currency)}</span></div>`
        : ''}
      <div class="row grand"><span>${escapeHtml(copy.total)}</span><span>${formatMoneyHtml(payload.total, payload.currency)}</span></div>
    </div>
    ${paymentsHtml ? `<div class="pay">${paymentsHtml}${upiHtml}</div>` : (upiHtml ? `<div class="pay">${upiHtml}</div>` : '')}
    <div class="footer">
      ${payload.terms ? `<p style="font-size:11px;color:#4b5563;margin-bottom:6px"><strong>Terms & Conditions:</strong> ${escapeHtml(payload.terms)}</p>` : ''}
      ${payload.billFooter && !/^thank you!?$/i.test(String(payload.billFooter).trim())
        ? `<p>${escapeHtml(payload.billFooter)}</p>`
        : ''}
      <p><strong>${escapeHtml(copy.thanks)}</strong></p>
    </div>
    <div class="cut-space"></div>
    </body></html>`;

  return { format: 'a4', html, mimeType: 'text/html' };
}

/**
 * Convert markup tags in thermal raw text to ESC/POS bytes (for server network print).
 * Tags: <C> <CB> <CD> <CM> <B> <D> <M> <L> <R>
 */
function thermalMarkupToEscPos(rawText) {
  const INIT = Buffer.from([0x1b, 0x40]);
  const RESET = Buffer.from([0x1b, 0x61, 0x00, 0x1d, 0x21, 0x00, 0x1b, 0x21, 0x00]);
  const FEED = Buffer.from([0x0a, 0x0a, 0x0a, 0x0a, 0x0a]);
  const CUT = Buffer.from([0x1d, 0x56, 0x00]);
  const text = String(rawText || '');
  const dots = paperDotsForMarkup(text);
  let align = 'left';

  const tags = {
    '<C>': Buffer.from([0x1b, 0x61, 0x01]),
    '</C>': Buffer.from([]),
    '<L>': Buffer.from([0x1b, 0x61, 0x00]),
    '</L>': Buffer.from([]),
    '<R>': Buffer.from([0x1b, 0x61, 0x02]),
    '</R>': Buffer.from([]),
    '<B>': Buffer.from([0x1b, 0x21, 0x08]),
    '</B>': Buffer.from([0x1b, 0x21, 0x00]),
    '<D>': Buffer.from([0x1d, 0x21, 0x01]),
    '</D>': Buffer.from([0x1d, 0x21, 0x00]),
    '<M>': Buffer.from([0x1b, 0x21, 0x10]),
    '</M>': Buffer.from([0x1b, 0x21, 0x00]),
    '<CB>': Buffer.from([0x1b, 0x61, 0x01, 0x1d, 0x21, 0x11, 0x1b, 0x21, 0x08]),
    '</CB>': Buffer.from([0x1d, 0x21, 0x00, 0x1b, 0x21, 0x00]),
    '<CD>': Buffer.from([0x1b, 0x61, 0x01, 0x1d, 0x21, 0x01]),
    '</CD>': Buffer.from([0x1d, 0x21, 0x00]),
    '<CM>': Buffer.from([0x1b, 0x61, 0x01, 0x1b, 0x21, 0x10]),
    '</CM>': Buffer.from([0x1b, 0x21, 0x00]),
  };
  const tagNames = Object.keys(tags).sort((a, b) => b.length - a.length);

  const chunks = [INIT];
  if (DEVANAGARI.test(text)) {
    // Leave UTF-8 / Chinese mode so the following image is not printed as ???.
    chunks.push(Buffer.from([0x1c, 0x2e, 0x1b, 0x74, 0x00]));
  }
  let i = 0;
  let buf = '';

  const setAlign = (tag) => {
    if (tag === '<L>') align = 'left';
    else if (tag === '<R>') align = 'right';
    else if (tag === '<C>' || tag === '<CB>' || tag === '<CD>' || tag === '<CM>') align = 'center';
  };

  const flushText = () => {
    if (!buf) return;
    const body = buf.replace(/\n/g, '');
    if (DEVANAGARI.test(body)) {
      chunks.push(Buffer.from([0x1b, 0x61, 0x00]));
      chunks.push(renderIndicLine(body, dots, align));
    } else {
      chunks.push(Buffer.from(buf, 'ascii'));
    }
    buf = '';
  };

  while (i < text.length) {
    if (text[i] === '<') {
      let matched = null;
      for (const name of tagNames) {
        if (text.startsWith(name, i)) {
          matched = name;
          break;
        }
      }
      if (matched) {
        flushText();
        setAlign(matched);
        chunks.push(tags[matched]);
        i += matched.length;
        continue;
      }
    }
    if (text[i] === '\n') {
      buf += '\n';
      flushText();
      chunks.push(RESET);
      align = 'left';
      i += 1;
      continue;
    }
    const code = text.charCodeAt(i);
    const indic = (code >= 0x0900 && code <= 0x097f) || code === 0x200c || code === 0x200d;
    if ((code >= 0x20 && code <= 0x7e) || indic) buf += text[i];
    i += 1;
  }
  flushText();
  chunks.push(FEED, CUT);
  return Buffer.concat(chunks);
}

async function generatePrint(bill, tenant, format = '80', shopSettings = {}, publicBaseUrl = null, language = 'en') {
  const lang = language === 'mr' ? 'mr' : 'en';
  const masterNameMrByEnglish = lang === 'mr' ? await loadMasterNameMrMap(bill) : null;
  const payload = buildReceiptPayload(
    bill,
    tenant,
    shopSettings,
    publicBaseUrl,
    lang,
    masterNameMrByEnglish,
  );
  if (format === 'a4') return renderA4(payload, lang);
  return renderThermal(payload, charsForFormat(format), lang);
}

module.exports = {
  generatePrint,
  buildReceiptPayload,
  charsForFormat,
  thermalMarkupToEscPos,
  centerLine,
};
