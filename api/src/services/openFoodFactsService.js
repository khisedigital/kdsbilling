const { Op } = require('sequelize');
const AppError = require('../utils/AppError');
const { getMasterModels } = require('../models/master');
const productService = require('./productService');

const SEARCH_URLS = [
  'https://world.openfoodfacts.org/api/v2/search',
  'https://in.openfoodfacts.org/api/v2/search',
  'https://world.openfoodfacts.net/api/v2/search',
];
const CGI_SEARCH_URLS = [
  'https://world.openfoodfacts.org/cgi/search.pl',
  'https://in.openfoodfacts.org/cgi/search.pl',
  'https://world.openfoodfacts.net/cgi/search.pl',
];
const PRODUCT_URLS = [
  'https://world.openfoodfacts.org/api/v2/product/',
  'https://in.openfoodfacts.org/api/v2/product/',
  'https://world.openfoodfacts.net/api/v2/product/',
];
const USER_AGENT = 'KDSPOZ/1.0 (shop billing; +https://khisedigital.info)';
const PAGE_SIZE = 100;
const PRODUCT_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'product_name_mr',
  'generic_name',
  'generic_name_en',
  'brands',
  'quantity',
  'categories_tags',
  'countries_tags',
  'unique_scans_n',
].join(',');

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

function hasDevanagari(value) {
  return /[\u0900-\u097F]/.test(String(value || ''));
}

function cleanText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.slice(0, max);
}

function latinDigits(value) {
  return String(value || '').replace(/[०-९]/g, (digit) => {
    const index = DEVANAGARI_DIGITS.indexOf(digit);
    return index >= 0 ? String(index) : digit;
  });
}

function pickBarcode(code) {
  const digits = String(code || '').replace(/\D/g, '');
  return /^\d{4,18}$/.test(digits) ? digits : '';
}

/** First pack size in an Open Food Facts quantity, e.g. "500 ml (451 g)" → "500 ml". */
function parsePackSize(raw) {
  if (!raw) return null;
  const text = latinDigits(raw).replace(',', '.').replace(/\s+/g, ' ').trim();
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*(kgs?|gr|gms?|g|mls?|ltr|litres?|liters?|l|cl|pcs|pc|pieces)?/i,
  );
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  let unit = String(match[2] || '').toLowerCase();
  if (unit === 'gr' || unit === 'gm' || unit === 'gms') unit = 'g';
  if (unit === 'kgs' || unit === 'kg') unit = 'kg';
  if (unit === 'mls' || unit === 'ml') unit = 'ml';
  if (unit === 'ltr' || unit === 'litre' || unit === 'liter' || unit === 'litres' || unit === 'liters' || unit === 'l') {
    unit = 'L';
  }
  if (unit === 'cl') {
    value *= 10;
    unit = 'ml';
  }
  if (unit === 'pc' || unit === 'pcs' || unit === 'pieces') unit = 'pc';
  if (!unit) return null;
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  return `${shown} ${unit}`.slice(0, 30);
}

function pickNames(hit) {
  const raw = cleanText(hit.product_name, 200);
  const english = cleanText(hit.product_name_en, 200);
  const generic = cleanText(hit.generic_name_en, 200);
  const marathiField = cleanText(hit.product_name_mr, 200);
  if (/wird geladen|loading\.\.\.|unknown product/i.test(raw)) return null;

  let name = '';
  if (raw && !hasDevanagari(raw)) name = raw;
  else if (english && !hasDevanagari(english)) name = english;
  else if (generic && !hasDevanagari(generic)) name = generic;
  else name = raw || english || generic;

  if (!name || name.length < 2) return null;
  const nameMr = marathiField || (hasDevanagari(raw) ? raw : '');
  return { name, nameMr };
}

function brandList(hit) {
  const brands = Array.isArray(hit.brands) ? hit.brands : String(hit.brands || '').split(',');
  return brands.map((item) => cleanText(item, 150)).filter(Boolean);
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Brand lists arrive in any order, and the product name is often repeated as a brand. */
function pickBrand(hit, productName) {
  const brands = brandList(hit);
  const nameKey = normalizeKey(productName);
  return brands.find((brand) => normalizeKey(brand) !== nameKey) || brands[0] || '';
}

function brandGroupKey(hit, productName) {
  const nameKey = normalizeKey(productName);
  const keys = brandList(hit)
    .map(normalizeKey)
    .filter((brand) => brand && brand !== nameKey);
  const unique = [...new Set(keys.length ? keys : brandList(hit).map(normalizeKey).filter(Boolean))];
  return unique.sort().join(' ');
}

function pickCategory(hit) {
  const tags = Array.isArray(hit.categories_tags) ? hit.categories_tags : [];
  const specific = [...tags].reverse().find((tag) => String(tag).startsWith('en:'));
  if (!specific) return '';
  const label = String(specific)
    .slice(3)
    .replace(/-/g, ' ')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return cleanText(label, 150);
}

/** Drop pack size and words like "biscuit" so "Parle-G" and "Parle-G Biscuit" group together. */
function baseName(name) {
  return normalizeKey(name)
    .replace(/\d+(?:\.\d+)?\s*(kg|g|ml|l|pc)\b/g, ' ')
    .replace(/\b(biscuits?|cookies?|wafers?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameWithoutSize(name) {
  return String(name || '')
    .replace(/\b\d+(?:[.,]\d+)?\s*(kgs?|gms?|gr|g|mls?|ltr|l)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.-])/g, '$1')
    .trim();
}

function groupKey(name, brandKey) {
  return `${baseName(name) || normalizeKey(name)}|${brandKey}`;
}

function mapHit(hit) {
  const names = pickNames(hit);
  const barcode = pickBarcode(hit.code);
  if (!names || !barcode) return null;
  return {
    name: names.name,
    nameMr: names.nameMr,
    brand: pickBrand(hit, names.name),
    brandKey: brandGroupKey(hit, names.name),
    category: pickCategory(hit),
    description: cleanText(hit.generic_name_en || hit.generic_name, 800) || '',
    barcode,
    size: parsePackSize(hit.quantity),
  };
}

function withSize(name, nameMr, size) {
  if (!size) return { name, nameMr };
  const nextName = name.toLowerCase().includes(size.toLowerCase()) ? name : `${name} ${size}`.slice(0, 200);
  const nextMr =
    nameMr && !nameMr.toLowerCase().includes(size.toLowerCase())
      ? `${nameMr} ${size}`.slice(0, 200)
      : nameMr;
  return { name: nextName, nameMr: nextMr };
}

/**
 * Same product name + brand with different pack sizes becomes one product
 * and one variant per size. A single pack stays a normal product.
 */
function groupHits(hits) {
  const order = [];
  const groups = new Map();

  for (const hit of hits || []) {
    const row = mapHit(hit);
    if (!row) continue;
    const key = groupKey(row.name, row.brandKey);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    const bucket = groups.get(key);
    if (bucket.some((item) => item.barcode === row.barcode)) continue;
    if (bucket.length && !bucket[0].nameMr && row.nameMr) bucket[0].nameMr = row.nameMr;
    if (bucket.length && !bucket[0].category && row.category) bucket[0].category = row.category;
    if (bucket.length && !bucket[0].description && row.description) bucket[0].description = row.description;
    bucket.push(row);
  }

  return order.map((key) => {
    const items = groups.get(key);
    const first = items[0];
    const bySize = new Map();
    for (const item of items) {
      const sizeKey = item.size || '';
      if (!bySize.has(sizeKey)) bySize.set(sizeKey, []);
      const codes = bySize.get(sizeKey);
      if (!codes.includes(item.barcode)) codes.push(item.barcode);
    }
    const sized = [...bySize.keys()].filter(Boolean);
    if (sized.length >= 2) {
      const bases = items
        .map((item) => nameWithoutSize(item.name))
        .filter((name) => name.length >= 2)
        .sort((a, b) => a.length - b.length);
      return {
        id: key,
        name: bases[0] || first.name,
        nameMr: first.nameMr,
        brand: first.brand,
        category: first.category,
        description: first.description || '',
        variants: sized.map((size) => ({
          size,
          barcodes: bySize.get(size),
        })),
      };
    }
    const size = sized[0] || '';
    const titled = withSize(first.name, first.nameMr, size);
    const barcodes = (size ? bySize.get(size) : bySize.get('')) || [];
    return {
      id: key,
      name: titled.name,
      nameMr: titled.nameMr,
      brand: first.brand,
      category: first.category,
      description: first.description || '',
      barcodes: barcodes.slice(0, 3),
    };
  });
}

async function fetchIndiaPage(page) {
  const params = new URLSearchParams({
    countries_tags: 'india',
    page: String(page),
    page_size: String(PAGE_SIZE),
    fields: PRODUCT_FIELDS,
  });
  for (const base of SEARCH_URLS) {
    try {
      const response = await fetch(`${base}?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) continue;
      const body = await response.json();
      const products = Array.isArray(body.products) ? body.products : [];
      const pageSize = Number(body.page_size) || PAGE_SIZE;
      const count = Number(body.count) || products.length;
      return {
        hits: products,
        count,
        pageCount: Math.max(1, Math.ceil(count / pageSize)),
      };
    } catch (err) {
      // world.openfoodfacts.org often returns 503; the .net host serves the same search.
    }
  }
  throw new AppError('Open Food Facts is not reachable right now', 502, 'UPSTREAM_ERROR');
}

async function fetchUpstream(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('upstream');
  return response.json();
}

function rankIndia(hits) {
  return [...(hits || [])].sort((a, b) => {
    const score = (hit) => {
      const countries = hit?.countries_tags || '';
      const text = Array.isArray(countries) ? countries.join(' ') : String(countries);
      return (/india/i.test(text) ? 1000000 : 0) + (Number(hit.unique_scans_n) || 0);
    };
    return score(b) - score(a);
  });
}

async function searchByName(term) {
  const params = new URLSearchParams({
    search_terms: term,
    search_simple: '1',
    action: 'process',
    json: '1',
    page: '1',
    page_size: '24',
    fields: PRODUCT_FIELDS,
  });
  for (const base of CGI_SEARCH_URLS) {
    try {
      const body = await fetchUpstream(`${base}?${params}`);
      return rankIndia(Array.isArray(body.products) ? body.products : []);
    } catch (err) {
      // try the next host
    }
  }
  throw new AppError('Open Food Facts is not reachable right now', 502, 'UPSTREAM_ERROR');
}

async function fetchProduct(code) {
  for (const base of PRODUCT_URLS) {
    try {
      const url = new URL(`${base}${code}`);
      url.searchParams.set('fields', PRODUCT_FIELDS);
      const body = await fetchUpstream(url);
      if (Number(body.status) !== 1 || !body.product) continue;
      if (!body.product.code) body.product.code = code;
      return body.product;
    } catch (err) {
      // try the next host
    }
  }
  return null;
}

/**
 * No search term lists every Indian product from the v2 search, one page at a time.
 * A name or barcode searches that same source. page_count on the list call is unreliable.
 */
async function searchOpenFoodFacts(query = {}) {
  const term = String(query.q || query.search || '').trim();
  if (term.length >= 2) {
    if (/^\d{4,18}$/.test(term)) {
      const product = await fetchProduct(term);
      const names = product ? pickNames(product) : null;
      const related = names ? await searchByName(names.name).catch(() => []) : [];
      const hits = [...(product ? [product] : []), ...related];
      return {
        products: groupHits(hits),
        page: 1,
        pageCount: 1,
        count: hits.length,
      };
    }
    const hits = await searchByName(term);
    return {
      products: groupHits(hits),
      page: 1,
      pageCount: 1,
      count: hits.length,
    };
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const found = await fetchIndiaPage(page);
  return {
    products: groupHits(found.hits),
    page,
    pageCount: found.pageCount,
    count: found.count,
  };
}

async function ensureNamedRow(Model, name) {
  const trimmed = cleanText(name, 150);
  if (!trimmed) return null;
  const existing = await Model.findOne({
    where: { deleted_at: null, name: { [Op.like]: trimmed } },
  });
  if (existing && String(existing.name).trim().toLowerCase() === trimmed.toLowerCase()) {
    return existing.id;
  }
  try {
    const created = await Model.create({ name: trimmed, status: 'active' });
    return created.id;
  } catch (err) {
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;
    const held = await Model.findOne({ where: { name: { [Op.like]: trimmed } } });
    if (!held) throw err;
    if (held.deleted_at || held.status !== 'active') {
      await held.update({ deleted_at: null, status: 'active' });
    }
    return held.id;
  }
}

async function resolvePcsUom(db) {
  const uom =
    (await db.UnitOfMeasure.findOne({ where: { code: 'pcs' } })) ||
    (await db.UnitOfMeasure.findOne({ where: { code: 'pc' } })) ||
    (await db.UnitOfMeasure.findOne({ where: { code: 'nos' } }));
  if (!uom) {
    throw new AppError('Unit of measure "pcs" is missing in this shop', 400, 'VALIDATION_ERROR');
  }
  return uom;
}

function money(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100) / 100;
}

const PRICE_URL = 'https://prices.openfoodfacts.org/api/v1/prices';

/** Latest Indian rupee price for each barcode. MRP is the undiscounted price when one is recorded. */
async function fetchInrPrices(codes) {
  const prices = new Map();
  const unique = [...new Set((codes || []).map(pickBarcode).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 40) {
    const chunk = unique.slice(index, index + 40);
    const url = `${PRICE_URL}?product_code__in=${chunk.join(',')}&order_by=-date&size=100`;
    try {
      const body = await fetchUpstream(url);
      const items = Array.isArray(body.items) ? body.items : [];
      for (const item of items) {
        const code = pickBarcode(item.product_code);
        if (!code || prices.has(code) || String(item.currency || '').toUpperCase() !== 'INR') continue;
        const selling = money(item.price);
        if (!selling) continue;
        const bare = money(item.price_without_discount);
        const mrp = item.price_is_discounted && bare && bare > selling ? bare : selling;
        prices.set(code, { mrp, sellingPrice: selling });
      }
    } catch (err) {
      // A pack with no recorded price keeps MRP empty and selling price at 0.
    }
  }
  return prices;
}

function priceForBarcodes(barcodes, prices, fallback) {
  for (const code of barcodes || []) {
    if (prices.has(code)) return prices.get(code);
  }
  const selling = money(fallback?.sellingPrice);
  const mrp = money(fallback?.mrp) ?? selling;
  return { sellingPrice: selling ?? 0, mrp };
}

function sanitizeImportProduct(raw) {
  const name = cleanText(raw?.name, 200);
  if (!name) return null;
  const nameMr = cleanText(raw?.nameMr || raw?.name_mr, 200);
  const brand = cleanText(raw?.brand, 150);
  const category = cleanText(raw?.category, 150);
  const description = cleanText(raw?.description, 800);
  const mrp = money(raw?.mrp);
  const sellingPrice = money(raw?.sellingPrice);
  const variants = Array.isArray(raw?.variants)
    ? raw.variants
        .map((variant) => {
          const size = cleanText(variant?.size, 30);
          const barcodes = (Array.isArray(variant?.barcodes) ? variant.barcodes : [variant?.barcode])
            .map(pickBarcode)
            .filter(Boolean);
          const unique = [...new Set(barcodes)];
          if (!size || !unique.length) return null;
          return {
            size,
            barcodes: unique,
            mrp: money(variant?.mrp),
            sellingPrice: money(variant?.sellingPrice),
          };
        })
        .filter(Boolean)
    : [];
  const barcodes = [...new Set((Array.isArray(raw?.barcodes) ? raw.barcodes : [raw?.barcode]).map(pickBarcode).filter(Boolean))];
  const base = { name, nameMr, brand, category, description, mrp, sellingPrice };
  if (variants.length >= 2) {
    return { ...base, variants };
  }
  if (!barcodes.length && variants.length === 1) {
    return {
      ...base,
      barcodes: variants[0].barcodes,
      mrp: variants[0].mrp ?? mrp,
      sellingPrice: variants[0].sellingPrice ?? sellingPrice,
    };
  }
  if (!barcodes.length) return null;
  return { ...base, barcodes };
}

async function dropTakenBarcodes(db, barcodes) {
  if (!barcodes.length) return [];
  const taken = await db.Barcode.findAll({
    where: { barcode: { [Op.in]: barcodes } },
    attributes: ['barcode'],
  });
  const used = new Set(taken.map((row) => row.barcode));
  return barcodes.filter((code) => !used.has(code));
}

async function importOpenFoodProducts(db, body = {}, options = {}) {
  const incoming = Array.isArray(body.products) ? body.products : [];
  if (!incoming.length) {
    throw new AppError('Select at least one product to import', 400, 'VALIDATION_ERROR');
  }
  if (incoming.length > 50) {
    throw new AppError('Import up to 50 products at a time', 400, 'VALIDATION_ERROR');
  }

  const uom = await resolvePcsUom(db);
  const priceCodes = incoming.flatMap((raw) => {
    const item = sanitizeImportProduct(raw);
    if (!item) return [];
    return item.variants ? item.variants.flatMap((variant) => variant.barcodes) : item.barcodes || [];
  });
  const prices = await fetchInrPrices(priceCodes);
  const results = {
    imported: 0,
    skipped: 0,
    failed: 0,
    masterCreated: 0,
    masterUpdated: 0,
    errors: [],
    products: [],
  };

  for (const raw of incoming) {
    const item = sanitizeImportProduct(raw);
    if (!item) {
      results.failed += 1;
      results.errors.push({ name: cleanText(raw?.name, 200) || 'Product', message: 'Product has no usable barcode' });
      continue;
    }

    try {
      if (item.variants) {
        item.variants = item.variants.map((variant) => {
          const price = priceForBarcodes(variant.barcodes, prices, variant);
          return { ...variant, mrp: price.mrp, sellingPrice: price.sellingPrice };
        });
      } else {
        const price = priceForBarcodes(item.barcodes, prices, item);
        item.mrp = price.mrp;
        item.sellingPrice = price.sellingPrice;
      }
      const categoryId = await ensureNamedRow(db.Category, item.category);
      const brandId = await ensureNamedRow(db.Brand, item.brand);
      const master = await syncMasterCatalog(options.tenant, item);
      results.masterCreated += master.created;
      results.masterUpdated += master.updated;
      const existing = await db.Product.findOne({
        where: { name: item.name, deleted_at: null },
      });
      if (existing) {
        const patch = {};
        if (!existing.category_id && categoryId) patch.category_id = categoryId;
        if (!existing.brand_id && brandId) patch.brand_id = brandId;
        if (Object.keys(patch).length) await existing.update(patch);
        results.skipped += 1;
        results.errors.push({ name: item.name, message: 'Product already exists' });
        continue;
      }

      let payload;

      if (item.variants) {
        const variants = [];
        for (const variant of item.variants) {
          const barcodes = await dropTakenBarcodes(db, variant.barcodes);
          if (!barcodes.length) continue;
          const price = priceForBarcodes(barcodes, prices, variant);
          variants.push({
            size: variant.size,
            barcode: barcodes[0],
            barcodes,
            sellingPrice: price.sellingPrice,
            mrp: price.mrp,
            costPrice: 0,
          });
        }
        if (!variants.length) {
          results.skipped += 1;
          results.errors.push({ name: item.name, message: 'Barcode already exists' });
          continue;
        }
        if (variants.length === 1) {
          const titled = withSize(item.name, item.nameMr, variants[0].size);
          payload = {
            name: titled.name,
            nameMr: titled.nameMr || null,
            description: item.description || null,
            categoryId,
            brandId,
            uomId: uom.id,
            sellingPrice: variants[0].sellingPrice,
            mrp: variants[0].mrp,
            costPrice: 0,
            barcode: variants[0].barcode,
            barcodes: variants[0].barcodes,
          };
        } else {
          payload = {
            name: item.name,
            nameMr: item.nameMr || null,
            description: item.description || null,
            categoryId,
            brandId,
            uomId: uom.id,
            sellingPrice: 0,
            variants,
          };
        }
      } else {
        const barcodes = await dropTakenBarcodes(db, item.barcodes);
        if (!barcodes.length) {
          results.skipped += 1;
          results.errors.push({ name: item.name, message: 'Barcode already exists' });
          continue;
        }
        const price = priceForBarcodes(barcodes, prices, item);
        payload = {
          name: item.name,
          nameMr: item.nameMr || null,
          description: item.description || null,
          categoryId,
          brandId,
          uomId: uom.id,
          sellingPrice: price.sellingPrice,
          mrp: price.mrp,
          costPrice: 0,
          barcode: barcodes[0],
          barcodes,
        };
      }

      const product = await productService.createProduct(db, payload, {
        branchId: options.branchId || null,
        userId: options.userId || null,
      });
      results.imported += 1;
      results.products.push({ id: product.id, name: product.name });
    } catch (err) {
      results.failed += 1;
      results.errors.push({ name: item.name, message: err.message || 'Import failed' });
    }
  }

  return results;
}

async function findOrCreateMasterNamed(Model, businessTypeId, name) {
  const trimmed = cleanText(name, 150);
  if (!trimmed) return null;
  const [row] = await Model.findOrCreate({
    where: { business_type_id: businessTypeId, name: trimmed },
    defaults: {
      business_type_id: businessTypeId,
      name: trimmed,
      status: 'active',
      sort_order: 0,
    },
  });
  return row.id;
}

/** One master product, with a variant for each pack size. */
async function saveMasterItem(businessTypeId, item) {
  const { MasterCategory, MasterBrand } = getMasterModels();
  const categoryId = await findOrCreateMasterNamed(MasterCategory, businessTypeId, item.category);
  const brandId = await findOrCreateMasterNamed(MasterBrand, businessTypeId, item.brand);
  const catalogMaster = require('./catalogMasterService');
  return catalogMaster.upsertImportedMasterProduct({ businessTypeId, categoryId, brandId, item });
}

function applyImportPrices(item, prices) {
  if (item.variants) {
    item.variants = item.variants.map((variant) => {
      const price = priceForBarcodes(variant.barcodes, prices, variant);
      return { ...variant, mrp: price.mrp, sellingPrice: price.sellingPrice };
    });
    return item;
  }
  const price = priceForBarcodes(item.barcodes, prices, item);
  item.mrp = price.mrp;
  item.sellingPrice = price.sellingPrice;
  return item;
}

async function syncMasterCatalog(tenant, item) {
  const businessTypeId = tenant?.business_type_id || null;
  if (!businessTypeId) return { created: 0, updated: 0 };
  const saved = await saveMasterItem(businessTypeId, item);
  return { created: saved.created ? 1 : 0, updated: saved.created ? 0 : 1 };
}

/**
 * Admin import writes the master catalog only. Shops then import from that catalog.
 */
async function importOpenFoodToMaster(businessTypeId, body = {}) {
  if (!businessTypeId) throw new AppError('Business type is required', 400, 'VALIDATION_ERROR');
  const { BusinessType } = getMasterModels();
  const businessType = await BusinessType.findByPk(businessTypeId);
  if (!businessType) throw new AppError('Business type not found', 404, 'NOT_FOUND');

  const incoming = Array.isArray(body.products) ? body.products : [];
  if (!incoming.length) throw new AppError('Select at least one product to import', 400, 'VALIDATION_ERROR');
  if (incoming.length > 50) throw new AppError('Import up to 50 products at a time', 400, 'VALIDATION_ERROR');

  const priceCodes = incoming.flatMap((raw) => {
    const item = sanitizeImportProduct(raw);
    if (!item) return [];
    return item.variants ? item.variants.flatMap((variant) => variant.barcodes) : item.barcodes || [];
  });
  const prices = await fetchInrPrices(priceCodes);
  const results = { imported: 0, created: 0, updated: 0, failed: 0, errors: [] };

  for (const raw of incoming) {
    const item = sanitizeImportProduct(raw);
    if (!item) {
      results.failed += 1;
      results.errors.push({ name: cleanText(raw?.name, 200) || 'Product', message: 'Product has no usable barcode' });
      continue;
    }
    try {
      applyImportPrices(item, prices);
      const saved = await saveMasterItem(businessTypeId, item);
      results.imported += 1;
      if (saved.created) results.created += 1;
      else results.updated += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ name: item.name, message: err.message || 'Import failed' });
    }
  }

  return results;
}

module.exports = {
  searchOpenFoodFacts,
  importOpenFoodProducts,
  importOpenFoodToMaster,
  groupHits,
  parsePackSize,
};
