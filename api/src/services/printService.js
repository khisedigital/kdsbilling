const { DEVANAGARI, renderIndicLine, paperDotsForMarkup } = require('./indicEscPos');

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

function buildReceiptPayload(bill, tenant, shopSettings = {}, publicBaseUrl = null, language = 'en') {
  const mr = language === 'mr';
  const shopName =
    (mr && String(shopSettings.shopNameMr || '').trim()) || shopSettings.shopName || tenant.name;
  const addressMr = mr ? String(shopSettings.addressMr || '').trim() : '';
  const footer = (shopSettings.billFooter || 'Thank you!').trim() || 'Thank you!';
  const phone = String(shopSettings.phone || tenant.owner_mobile || '').trim();
  return {
    shopName,
    address: addressMr || shopSettings.address || '',
    city: addressMr ? '' : shopSettings.city || '',
    gstin: shopSettings.gstin || '',
    phone,
    billFooter: footer,
    logoUrl: resolveAbsoluteUrl(shopSettings.logoUrl, publicBaseUrl),
    billNumber: bill.bill_number,
    date: resolveBillDate(bill),
    customer: bill.customer?.name || (language === 'mr' ? 'काउंटर' : 'Walk-in'),
    items: (bill.items || []).map((i) => ({
      name: i.product_name,
      sku: i.sku,
      qty: parseFloat(i.quantity),
      price: parseFloat(i.unit_price),
      total: parseFloat(i.line_total),
      taxes: i.taxes?.map((t) => ({ name: t.tax_name, amount: parseFloat(t.tax_amount) })),
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

/** Single address block — avoid repeating city when already present. */
function formatAddressBlock(address, city) {
  const addr = sanitizeThermalText(address || '').replace(/\s+/g, ' ').trim();
  const cityVal = sanitizeThermalText(city || '').replace(/\s+/g, ' ').trim();
  if (!addr && !cityVal) return '';
  if (!addr) return cityVal;
  if (!cityVal) return addr;
  if (addr.toLowerCase().includes(cityVal.toLowerCase())) return addr;
  return `${addr}, ${cityVal}`;
}

function ruleLine(charsPerLine, char = '-') {
  return char.repeat(charsPerLine);
}

/**
 * Shop header for 58mm / 80mm:
 * - banner + large centered shop name
 * - address / phone / GSTIN under it
 * - TAX INVOICE label
 *
 * Tags (<CB>, <C>, <B>) are converted to ESC/POS on the mobile / network printer path.
 */
function pushShopHeader(lines, payload, charsPerLine, copy) {
  const star = ruleLine(charsPerLine, '=');
  lines.push(star);

  // Double-width shop name → wrap at half width so it does not overflow
  const nameWidth = Math.max(12, Math.floor(charsPerLine / 2));
  const shopName = sanitizeThermalText(payload.shopName || 'SHOP').trim() || 'SHOP';
  const shopTitle = /[\u0900-\u097F]/.test(shopName) ? shopName : shopName.toUpperCase();
  pushTaggedWrapped(lines, shopTitle, nameWidth, '<CB>', '</CB>');

  lines.push(star);

  const addressBlock = formatAddressBlock(payload.address, payload.city);
  if (addressBlock) {
    pushTaggedWrapped(lines, addressBlock, charsPerLine, '<C>', '</C>');
  }
  if (payload.phone) {
    pushTaggedWrapped(lines, `${copy.phone}: ${payload.phone}`, charsPerLine, '<C>', '</C>');
  }
  if (payload.gstin) {
    pushTaggedWrapped(lines, `GSTIN: ${payload.gstin}`, charsPerLine, '<C>', '</C>');
  }

  lines.push(ruleLine(charsPerLine, '-'));
  lines.push(`<C>${copy.taxInvoice}</C>`);
  lines.push(ruleLine(charsPerLine, '-'));
}


function padCell(text, width, align = 'left') {
  const body = String(text || '').slice(0, width);
  const gap = width - body.length;
  if (gap <= 0) return body;
  return align === 'right' ? `${' '.repeat(gap)}${body}` : `${body}${' '.repeat(gap)}`;
}

function moneyCell(amount) {
  const n = parseFloat(amount);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function tableCols(charsPerLine) {
  if (charsPerLine <= 32) return { item: 12, qty: 3, rate: 7, amt: 7 };
  return { item: 18, qty: 4, rate: 8, amt: 9 };
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
  const qtyNum = parseFloat(qty);
  const qtyStr = Number.isInteger(qtyNum) ? String(qtyNum) : String(parseFloat(qtyNum.toFixed(3)));
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
    const space = charsPerLine - l.length - r.length;
    return l + ' '.repeat(Math.max(1, space)) + r;
  };

  const copy = billCopy(language);
  const lines = [];
  pushShopHeader(lines, payload, charsPerLine, copy);
  lines.push(row(copy.bill, String(payload.billNumber || '')));
  lines.push(row(copy.date, formatReceiptDate(payload.date)));
  lines.push(row(copy.customer, sanitizeThermalText(payload.customer).slice(0, Math.max(8, charsPerLine - 10))));
  lines.push(divider('='));
  lines.push(`<B>${tableHeaderLine(charsPerLine, copy)}</B>`);
  lines.push(divider('-'));

  for (const item of payload.items) {
    lines.push(...tableItemLines(charsPerLine, item.name, item.qty, item.price, item.total));
  }

  lines.push(divider('='));
  lines.push(row(copy.subtotal, formatMoneyThermal(payload.subtotal)));
  if (payload.discount > 0) {
    lines.push(row(copy.discount, `-${formatMoneyThermal(payload.discount)}`));
  }
  lines.push(row(copy.tax, formatMoneyThermal(payload.tax)));
  if (Math.abs(payload.roundOff || 0) >= 0.005) {
    const ro = payload.roundOff;
    lines.push(row(copy.round, `${ro > 0 ? '+' : '-'}${formatMoneyThermal(Math.abs(ro))}`));
  }
  lines.push(`<B>${row(copy.total, formatMoneyThermal(payload.total))}</B>`);
  lines.push(divider('-'));
  for (const p of payload.payments) {
    lines.push(row(payLabel(p.mode, language), formatMoneyThermal(p.amount)));
  }
  if (payload.change > 0) {
    lines.push(row(copy.change, formatMoneyThermal(payload.change)));
  }
  lines.push(divider('='));

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
  const itemsHtml = payload.items.map((i) => `
    <tr>
      <td>${escapeHtml(i.name)}${i.sku ? `<br><small style="color:#6b7280">${escapeHtml(i.sku)}</small>` : ''}</td>
      <td style="text-align:center">${i.qty}</td>
      <td style="text-align:right">${formatMoneyHtml(i.price, payload.currency)}</td>
      <td style="text-align:right">${formatMoneyHtml(i.total, payload.currency)}</td>
    </tr>`).join('');

  const logoHtml = payload.logoUrl
    ? `<img src="${escapeHtml(payload.logoUrl)}" alt="Logo" class="logo" />`
    : '';

  const addressBlock = formatAddressBlock(payload.address, payload.city);
  const metaBits = [
    addressBlock,
    payload.phone ? `${copy.phone}: ${payload.phone}` : '',
    payload.gstin ? `GSTIN: ${payload.gstin}` : '',
  ].filter(Boolean).map(escapeHtml);

  const paymentsHtml = (payload.payments || []).map((p) =>
    `<div class="pay-row"><span>${escapeHtml(payLabel(p.mode, language))}</span><span>${formatMoneyHtml(p.amount, payload.currency)}</span></div>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>
      *{box-sizing:border-box}
      body{font-family:Georgia,'Times New Roman','Nirmala UI','Noto Sans Devanagari',Mangal,serif;padding:36px 40px;color:#111;max-width:720px;margin:0 auto}
      .banner{text-align:center;border-top:3px double #111;border-bottom:3px double #111;padding:18px 12px 16px;margin-bottom:22px}
      .logo{max-height:64px;max-width:200px;object-fit:contain;margin-bottom:10px}
      .shop{font-size:26px;font-weight:700;letter-spacing:0.04em;margin:0 0 8px;text-transform:uppercase;line-height:1.2}
      .meta{color:#374151;font-size:13px;margin:3px 0;line-height:1.4;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif}
      .doc-title{margin-top:12px;font-size:12px;letter-spacing:0.18em;font-weight:700;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif}
      .bill-meta{display:flex;justify-content:space-between;gap:16px;margin:0 0 18px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px;color:#374151}
      .bill-meta strong{color:#111}
      table{width:100%;border-collapse:collapse;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      th,td{border-bottom:1px solid #e5e7eb;padding:10px 8px;text-align:left}
      th{background:#f3f4f6;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#4b5563}
      .totals{margin-top:16px;margin-left:auto;width:260px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      .totals .row{display:flex;justify-content:space-between;padding:4px 0}
      .totals .grand{border-top:2px solid #111;margin-top:8px;padding-top:10px;font-size:16px;font-weight:700}
      .pay{margin-top:18px;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
      .pay-row{display:flex;justify-content:space-between;max-width:260px;margin-left:auto;padding:2px 0}
      .footer{text-align:center;margin-top:32px;padding-top:14px;border-top:1px solid #d1d5db;color:#374151;font-family:Arial,Helvetica,'Nirmala UI','Noto Sans Devanagari',Mangal,sans-serif;font-size:13px}
    </style>
    </head><body>
    <div class="banner">
      ${logoHtml}
      <h1 class="shop">${escapeHtml(payload.shopName || 'Shop')}</h1>
      ${metaBits.map((m) => `<p class="meta">${m}</p>`).join('')}
      <p class="doc-title">${escapeHtml(copy.taxInvoice)}</p>
    </div>
    <div class="bill-meta">
      <div><strong>${escapeHtml(copy.bill)}</strong> ${escapeHtml(payload.billNumber)}<br/><strong>${escapeHtml(copy.customer)}</strong> ${escapeHtml(payload.customer)}</div>
      <div style="text-align:right"><strong>${escapeHtml(copy.date)}</strong> ${escapeHtml(formatReceiptDate(payload.date))}</div>
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
    ${paymentsHtml ? `<div class="pay">${paymentsHtml}</div>` : ''}
    <div class="footer">
      ${payload.billFooter && !/^thank you!?$/i.test(String(payload.billFooter).trim())
        ? `<p>${escapeHtml(payload.billFooter)}</p>`
        : ''}
      <p><strong>${escapeHtml(copy.thanks)}</strong></p>
    </div>
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

function generatePrint(bill, tenant, format = '80', shopSettings = {}, publicBaseUrl = null, language = 'en') {
  const lang = language === 'mr' ? 'mr' : 'en';
  const payload = buildReceiptPayload(bill, tenant, shopSettings, publicBaseUrl, lang);
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
