'use strict';

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_SQL } = require('./schema');
const extra = require('./extra');

/** @type {Map<string, DatabaseSync>} */
const openDbs = new Map();

function safeShop(shopCode) {
  return String(shopCode || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
}

function dbPathFor(userDataPath, shopCode) {
  const dir = path.join(userDataPath, 'offline', safeShop(shopCode));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'kdspoz.sqlite');
}

/** Normalize barcode rows from API / cache into { barcode, quantity, is_primary }. */
function normalizeBarcodeRows(variant) {
  const out = [];
  const seen = new Set();
  const push = (code, quantity, isPrimary) => {
    const barcode = String(code || '').trim();
    if (!barcode || seen.has(barcode)) return;
    seen.add(barcode);
    let qty = null;
    if (quantity != null && quantity !== '') {
      const n = Number(quantity);
      if (Number.isFinite(n) && n > 0) qty = n;
    }
    out.push({ barcode, quantity: qty, is_primary: isPrimary ? 1 : 0 });
  };

  const list = Array.isArray(variant?.barcodes) ? variant.barcodes : [];
  for (const b of list) {
    if (typeof b === 'string') {
      push(b, null, out.length === 0);
      continue;
    }
    if (!b || typeof b !== 'object') continue;
    push(b.barcode || b.code, b.quantity, !!b.is_primary);
  }
  // Legacy top-level barcode / quantityBarcodes fields.
  if (variant?.barcode) push(variant.barcode, null, true);
  if (Array.isArray(variant?.quantityBarcodes)) {
    for (const qb of variant.quantityBarcodes) {
      if (!qb) continue;
      if (typeof qb === 'string') continue;
      push(qb.barcode || qb.code, qb.quantity, false);
    }
  }
  return out;
}

function primaryPlainBarcode(variant) {
  const rows = normalizeBarcodeRows(variant);
  const plain = rows.find((r) => r.quantity == null);
  return (plain || rows[0] || {}).barcode || null;
}

function replaceVariantBarcodes(db, productId, variantId, variant) {
  db.prepare(`DELETE FROM variant_barcodes WHERE variant_id = ?`).run(String(variantId));
  const insert = db.prepare(
    `INSERT OR REPLACE INTO variant_barcodes (barcode, variant_id, product_id, quantity, is_primary)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of normalizeBarcodeRows(variant)) {
    insert.run(
      row.barcode,
      String(variantId),
      String(productId),
      row.quantity,
      row.is_primary,
    );
  }
}

/** One-time backfill so already-synced shops get pack barcodes searchable. */
function backfillVariantBarcodes(db) {
  const countRow = db.prepare(`SELECT COUNT(*) AS n FROM variant_barcodes`).get();
  if (Number(countRow?.n) > 0) return;
  const variants = db.prepare(`SELECT id, product_id, barcode, json FROM product_variants`).all();
  if (!variants.length) return;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO variant_barcodes (barcode, variant_id, product_id, quantity, is_primary)
     VALUES (?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  try {
    for (const row of variants) {
      let parsed = null;
      try {
        parsed = row.json ? JSON.parse(row.json) : null;
      } catch {
        parsed = null;
      }
      const source = parsed && typeof parsed === 'object'
        ? parsed
        : { barcode: row.barcode, barcodes: row.barcode ? [row.barcode] : [] };
      for (const bc of normalizeBarcodeRows(source)) {
        insert.run(bc.barcode, String(row.id), String(row.product_id), bc.quantity, bc.is_primary);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function migrate(db) {
  db.exec(SCHEMA_SQL);
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run('sync_device_id', randomUUID());
  // Ensure newer columns exist on DBs created before schema v2.
  try {
    db.exec(`ALTER TABLE customers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'`);
  } catch {
    /* already exists */
  }
  try {
    backfillVariantBarcodes(db);
  } catch {
    /* ignore backfill errors on corrupt rows */
  }
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run('schema_version', '3');
}

/**
 * Open (or reuse) the per-shop SQLite DB.
 * Uses Electron/Node built-in `node:sqlite` — no native addon.
 */
function openShopDb(userDataPath, shopCode) {
  const key = safeShop(shopCode);
  const existing = openDbs.get(key);
  if (existing) return existing;

  const filePath = dbPathFor(userDataPath, key);
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  openDbs.set(key, db);
  return db;
}

function closeAll() {
  for (const [key, db] of openDbs) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    openDbs.delete(key);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function getMeta(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

function saveShopSettings(db, settings) {
  db.prepare(
    `INSERT INTO shop_settings (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(settings ?? null), nowIso());
}

function readShopSettings(db) {
  const row = db.prepare('SELECT json FROM shop_settings WHERE id = 1').get();
  if (!row?.json) return null;
  try {
    return JSON.parse(row.json);
  } catch {
    return null;
  }
}

/** Upsert catalog snapshot. Pass clearProducts:true on a full replace sync. */
function replaceCatalog(db, { products = [], categories = [], brands = [], clearProducts = false, syncStock = true, insertOnly = false, protectPending = false } = {}) {
  if (insertOnly && clearProducts) throw new Error('Cannot clear the catalog during an add-only pull');
  const ts = nowIso();
  let writtenProducts = 0;
  let writtenCategories = 0;
  let writtenBrands = 0;
  const allowSyncStock = syncStock !== false ? 1 : 0;
  const upsertCat = db.prepare(
    `INSERT INTO categories (id, name, name_mr, sort_order, status, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, name_mr = excluded.name_mr, sort_order = excluded.sort_order,
       status = excluded.status, json = excluded.json, updated_at = excluded.updated_at`,
  );
  const upsertBrand = db.prepare(
    `INSERT INTO brands (id, name, name_mr, status, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, name_mr = excluded.name_mr, status = excluded.status,
       json = excluded.json, updated_at = excluded.updated_at`,
  );
  const upsertProduct = db.prepare(
    `INSERT INTO products (id, name, name_mr, category_id, brand_id, is_favorite, status, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, name_mr = excluded.name_mr, category_id = excluded.category_id,
       brand_id = excluded.brand_id, is_favorite = excluded.is_favorite, status = excluded.status,
       json = excluded.json, updated_at = excluded.updated_at`,
  );
  const upsertVariant = db.prepare(
    `INSERT INTO product_variants
      (id, product_id, sku, barcode, selling_price, cost_price, mrp, stock_qty, unit, json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id = excluded.product_id,
       sku = excluded.sku,
       barcode = excluded.barcode,
       selling_price = excluded.selling_price,
       cost_price = excluded.cost_price,
       mrp = excluded.mrp,
       stock_qty = CASE
         WHEN ? = 1 THEN excluded.stock_qty
         ELSE product_variants.stock_qty
       END,
       unit = excluded.unit,
       json = excluded.json,
       updated_at = excluded.updated_at`,
  );

  db.exec('BEGIN');
  try {
    // Default: upsert only (update existing + insert new). Never wipe the whole catalog
    // unless an explicit clearProducts flag is passed.
    if (protectPending && !insertOnly && !clearProducts) {
      const pendingSales = db.prepare(
        `SELECT 1 FROM sales WHERE sync_status IN ('pending', 'local_only') LIMIT 1`,
      ).get();
      const pendingQueue = db.prepare(
        `SELECT 1 FROM sync_queue WHERE sync_status IN ('pending', 'local_only') LIMIT 1`,
      ).get();
      if (pendingSales || pendingQueue) insertOnly = true;
    }
    if (clearProducts === true && Array.isArray(products)) {
      db.exec('DELETE FROM variant_barcodes;');
      db.exec('DELETE FROM product_variants;');
      db.exec('DELETE FROM products;');
    }
    for (const c of categories) {
      if (!c?.id) continue;
      if (insertOnly && db.prepare('SELECT 1 FROM categories WHERE id = ?').get(String(c.id))) continue;
      upsertCat.run(
        String(c.id),
        String(c.name || ''),
        c.nameMr ?? c.name_mr ?? null,
        Number(c.sortOrder ?? c.sort_order) || 0,
        String(c.status || 'active'),
        JSON.stringify(c),
        ts,
      );
      writtenCategories += 1;
    }
    for (const b of brands) {
      if (!b?.id) continue;
      if (insertOnly && db.prepare('SELECT 1 FROM brands WHERE id = ?').get(String(b.id))) continue;
      upsertBrand.run(
        String(b.id),
        String(b.name || ''),
        b.nameMr ?? b.name_mr ?? null,
        String(b.status || 'active'),
        JSON.stringify(b),
        ts,
      );
      writtenBrands += 1;
    }
    for (const incoming of products) {
      if (!incoming?.id) continue;
      let p = incoming;
      const current = insertOnly ? getProduct(db, String(p.id)) : null;
      if (current) {
        const existingIds = new Set((current.variants || []).map((v) => String(v.id)));
        const additions = (p.variants || []).filter((v) => v?.id && !existingIds.has(String(v.id)));
        let addedBarcodes = 0;
        const existingVariants = (current.variants || []).map((variant) => {
          const remote = (p.variants || []).find((v) => String(v?.id) === String(variant.id));
          if (!remote) return variant;
          const codes = normalizeBarcodeRows(variant);
          const known = new Set(codes.map((row) => row.barcode));
          for (const row of normalizeBarcodeRows(remote)) {
            if (known.has(row.barcode)) continue;
            codes.push({ ...row, is_primary: codes.some((code) => code.is_primary) ? 0 : row.is_primary });
            known.add(row.barcode);
            addedBarcodes += 1;
          }
          return { ...variant, barcodes: codes };
        });
        if (!additions.length && !addedBarcodes) continue;
        p = { ...current, variants: [...existingVariants, ...additions] };
      }
      {
        const incomingCodes = new Map();
        for (const v of p.variants || []) {
          const existingVariant = v?.id && db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(String(v.id));
          if (existingVariant && String(existingVariant.product_id) !== String(p.id)) {
            throw new Error('Cannot import live product: its variant belongs to another local product');
          }
          for (const row of normalizeBarcodeRows(v)) {
            const owner = incomingCodes.get(row.barcode);
            if (owner && owner !== String(v.id)) {
              throw new Error('Cannot import live product: its barcode belongs to another local variant');
            }
            incomingCodes.set(row.barcode, String(v.id));
            const existing = db.prepare('SELECT variant_id FROM variant_barcodes WHERE barcode = ?').get(row.barcode);
            if (existing && String(existing.variant_id) !== String(v.id)) {
              throw new Error('Cannot import live product: its barcode belongs to another local variant');
            }
          }
        }
      }
      // Preserve local stock on catalog pull — write those qtys into the JSON blob too.
      const variantsIn = Array.isArray(p.variants) ? p.variants : [];
      const variantsOut = variantsIn.map((v) => {
        if (!v?.id) return v;
        const incomingStock = Number(v.stockQty ?? v.stock_qty ?? 0) || 0;
        const barcodeRows = normalizeBarcodeRows(v);
        const plain = primaryPlainBarcode(v);
        const withCodes = {
          ...v,
          barcode: plain || v.barcode || null,
          barcodes: barcodeRows.map((r) => ({
            barcode: r.barcode,
            is_primary: !!r.is_primary,
            ...(r.quantity != null ? { quantity: r.quantity } : {}),
          })),
        };
        if (allowSyncStock === 1 || clearProducts === true) {
          return { ...withCodes, stockQty: incomingStock, stock_qty: incomingStock };
        }
        const local = db
          .prepare(`SELECT stock_qty FROM product_variants WHERE id = ?`)
          .get(String(v.id));
        if (!local) return { ...withCodes, stockQty: incomingStock, stock_qty: incomingStock };
        const localQty = Number(local.stock_qty) || 0;
        return { ...withCodes, stockQty: localQty, stock_qty: localQty };
      });
      const productStock = variantsOut.reduce(
        (s, v) => s + (Number(v?.stockQty ?? v?.stock_qty) || 0),
        0,
      );
      const productRow = {
        ...p,
        variants: variantsOut,
        stockQty: productStock,
        stock_qty: productStock,
      };
      upsertProduct.run(
        String(p.id),
        String(p.name || ''),
        p.nameMr ?? p.name_mr ?? null,
        p.categoryId ?? p.category_id ?? null,
        p.brandId ?? p.brand_id ?? null,
        p.isFavorite || p.is_favorite ? 1 : 0,
        String(p.status || 'active'),
        JSON.stringify(productRow),
        ts,
      );
      writtenProducts += 1;
      for (const v of variantsOut) {
        if (!v?.id) continue;
        // Prefer plain (non-pack) barcode in the column; pack codes live in variant_barcodes.
        const barcode = primaryPlainBarcode(v);
        const variantJson = {
          ...v,
          barcode: barcode || v.barcode || null,
          barcodes: normalizeBarcodeRows(v).map((r) => ({
            barcode: r.barcode,
            is_primary: !!r.is_primary,
            quantity: r.quantity,
          })),
        };
        upsertVariant.run(
          String(v.id),
          String(p.id),
          String(v.sku || ''),
          barcode != null ? String(barcode) : null,
          Number(v.sellingPrice ?? v.selling_price) || 0,
          Number(v.costPrice ?? v.cost_price) || 0,
          v.mrp != null ? Number(v.mrp) : null,
          Number(v.stockQty ?? v.stock_qty) || 0,
          v.unit || null,
          JSON.stringify(variantJson),
          ts,
          allowSyncStock,
        );
        replaceVariantBarcodes(db, p.id, v.id, variantJson);
      }
    }
    setMeta(db, 'catalog_updated_at', ts);
    setMeta(db, 'catalog_product_count', String(countProducts(db)));
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { products: writtenProducts, categories: writtenCategories, brands: writtenBrands };
}

/** Overlay live product_variants.stock_qty onto the denormalized products.json blob. */
function hydrateProductStock(db, product) {
  if (!product?.id) return product;
  const rows = db
    .prepare(`SELECT id, stock_qty FROM product_variants WHERE product_id = ?`)
    .all(String(product.id));
  if (!rows.length) return product;
  const byId = new Map(rows.map((r) => [String(r.id), Number(r.stock_qty) || 0]));
  const variants = (product.variants || []).map((v) => {
    if (!v?.id || !byId.has(String(v.id))) return v;
    const qty = byId.get(String(v.id));
    return { ...v, stockQty: qty, stock_qty: qty };
  });
  const total = variants.reduce((s, v) => s + (Number(v.stockQty ?? v.stock_qty) || 0), 0);
  return { ...product, variants, stockQty: total, stock_qty: total };
}

function hydrateProductBarcodes(db, product) {
  if (!product?.id) return product;
  const rows = db.prepare(
    `SELECT variant_id, barcode, quantity, is_primary FROM variant_barcodes
     WHERE product_id = ? ORDER BY is_primary DESC, barcode`,
  ).all(String(product.id));
  const byVariant = new Map();
  for (const row of rows) {
    const id = String(row.variant_id);
    if (!byVariant.has(id)) byVariant.set(id, []);
    byVariant.get(id).push({
      barcode: row.barcode,
      quantity: row.quantity,
      is_primary: !!row.is_primary,
    });
  }
  const variants = (product.variants || []).map((variant) => {
    const barcodes = byVariant.get(String(variant.id));
    if (!barcodes) return variant;
    const plain = barcodes.find((row) => row.quantity == null);
    return {
      ...variant,
      barcode: plain?.barcode || null,
      barcodes,
      quantityBarcodes: barcodes
        .filter((row) => row.quantity != null)
        .map((row) => ({ barcode: row.barcode, quantity: row.quantity })),
    };
  });
  return { ...product, variants };
}

/** Re-link product and variant tax groups from the local tax master table. */
function hydrateProductTax(db, product) {
  if (!product?.id) return product;
  let taxById = new Map();
  try {
    const rows = db.prepare(`SELECT id, json FROM tax_groups`).all();
    taxById = new Map(rows.map((row) => {
      try {
        return [String(row.id), JSON.parse(row.json)];
      } catch {
        return [String(row.id), null];
      }
    }));
  } catch {
    return product;
  }

  const taxGroupFor = (taxId, existing) => {
    const id = String(taxId || existing?.id || '').trim();
    if (!id) return existing || undefined;
    const master = taxById.get(id);
    return master
      ? { id: master.id || id, name: master.name || '', total_rate: master.total_rate }
      : (existing || undefined);
  };

  const taxId = product.tax_group_id ?? product.taxGroupId ?? product.taxGroup?.id ?? null;
  const taxGroup = taxGroupFor(taxId, product.taxGroup);
  const variants = (product.variants || []).map((v) => {
    const variantTaxId = v.tax_group_id ?? v.taxGroupId ?? v.taxGroup?.id ?? null;
    const variantTaxGroup = taxGroupFor(variantTaxId, v.taxGroup);
    return variantTaxId || variantTaxGroup
      ? { ...v, tax_group_id: variantTaxId || null, taxGroupId: variantTaxId || null, taxGroup: variantTaxGroup }
      : v;
  });
  return {
    ...product,
    tax_group_id: taxId || null,
    taxGroupId: taxId || null,
    taxGroup,
    variants,
  };
}

function hydrateProduct(db, product) {
  return hydrateProductTax(db, hydrateProductBarcodes(db, hydrateProductStock(db, product)));
}

/** Keep products.json variants[].stockQty aligned after column updates. */
function syncVariantStockIntoProductJson(db, variantId, stockQty) {
  const id = String(variantId || '').trim();
  if (!id) return;
  const row = db.prepare(`SELECT product_id FROM product_variants WHERE id = ?`).get(id);
  if (!row?.product_id) return;
  const prod = db.prepare(`SELECT json FROM products WHERE id = ?`).get(String(row.product_id));
  if (!prod?.json) return;
  try {
    const parsed = JSON.parse(prod.json);
    const qty = Number(stockQty) || 0;
    if (!Array.isArray(parsed.variants)) return;
    let touched = false;
    parsed.variants = parsed.variants.map((v) => {
      if (String(v?.id) !== id) return v;
      touched = true;
      return { ...v, stockQty: qty, stock_qty: qty };
    });
    if (!touched) return;
    const total = parsed.variants.reduce(
      (s, v) => s + (Number(v.stockQty ?? v.stock_qty) || 0),
      0,
    );
    parsed.stockQty = total;
    parsed.stock_qty = total;
    db.prepare(`UPDATE products SET json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify(parsed),
      nowIso(),
      String(row.product_id),
    );
  } catch {
    /* ignore corrupt json */
  }
}

function listProducts(db, { search = '', limit = 100, offset = 0, categoryId = null, brandId = null, status = 'active' } = {}) {
  const q = String(search || '').trim();
  const lim = Math.max(1, Math.min(50000, Math.floor(Number(limit) || 100)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const cat = categoryId != null && String(categoryId).trim() ? String(categoryId).trim() : null;
  const filters = `status = ? AND (? IS NULL OR brand_id = ?)`;
  const filterParams = [status || 'active', brandId || null, brandId || null];
  let rows;
  if (q) {
    const safe = q.replace(/[%_]/g, '');
    const like = `%${safe}%`;
    const prefix = `${safe}%`;
    // Exact / prefix matches first so "Sugar" beats "… sugar free …" in long catalogs.
    // Include variant_barcodes so pack/quantity barcodes (250g, 1kg packs) are findable.
    const runSearch = (withPackIndex) => {
      const packClause = withPackIndex
        ? `OR id IN (
             SELECT product_id FROM variant_barcodes
             WHERE barcode = ? COLLATE NOCASE OR barcode LIKE ? COLLATE NOCASE
           )`
        : '';
      // Also match barcodes embedded in product JSON (pack codes) when index is empty/old.
      const jsonClause = `OR json LIKE ?`;
      const jsonLike = `%"barcode":"${safe}"%`;
      const orderSql = `ORDER BY
           CASE
             WHEN id IN (SELECT product_id FROM product_variants
               WHERE sku = ? COLLATE NOCASE OR barcode = ? COLLATE NOCASE) THEN 0
             ${withPackIndex ? `WHEN id IN (SELECT product_id FROM variant_barcodes
               WHERE barcode = ? COLLATE NOCASE) THEN 0` : ''}
             WHEN name = ? COLLATE NOCASE THEN 1
             WHEN IFNULL(name_mr,'') = ? COLLATE NOCASE THEN 1
             WHEN name LIKE ? COLLATE NOCASE THEN 2
             WHEN IFNULL(name_mr,'') LIKE ? COLLATE NOCASE THEN 2
             ELSE 3
           END,
           is_favorite DESC,
           name COLLATE NOCASE`;
      const orderParams = [
        safe, safe, ...(withPackIndex ? [safe] : []), safe, safe, prefix, prefix, lim, off,
      ];
      if (cat) {
        return db
          .prepare(
            `SELECT json FROM products
             WHERE ${filters} AND category_id = ? AND (
               name LIKE ? COLLATE NOCASE
               OR IFNULL(name_mr,'') LIKE ? COLLATE NOCASE
               OR id IN (
                 SELECT product_id FROM product_variants
                 WHERE sku LIKE ? COLLATE NOCASE OR IFNULL(barcode,'') LIKE ? COLLATE NOCASE
               )
               ${packClause}
               ${jsonClause}
             )
             ${orderSql}
             LIMIT ? OFFSET ?`,
          )
          .all(
            ...(withPackIndex
              ? [...filterParams, cat, like, like, like, like, safe, like, jsonLike, ...orderParams]
              : [...filterParams, cat, like, like, like, like, jsonLike, ...orderParams]),
          );
      }
      return db
        .prepare(
          `SELECT json FROM products
           WHERE ${filters} AND (
             name LIKE ? COLLATE NOCASE
             OR IFNULL(name_mr,'') LIKE ? COLLATE NOCASE
             OR id IN (
               SELECT product_id FROM product_variants
               WHERE sku LIKE ? COLLATE NOCASE OR IFNULL(barcode,'') LIKE ? COLLATE NOCASE
             )
             ${packClause}
             ${jsonClause}
           )
           ${orderSql}
           LIMIT ? OFFSET ?`,
        )
        .all(
          ...(withPackIndex
            ? [...filterParams, like, like, like, like, safe, like, jsonLike, ...orderParams]
            : [...filterParams, like, like, like, like, jsonLike, ...orderParams]),
        );
    };
    try {
      rows = runSearch(true);
    } catch {
      // Older DB without variant_barcodes — still search JSON + primary barcode column.
      rows = runSearch(false);
    }
  } else if (cat) {
    rows = db
      .prepare(
        `SELECT json FROM products
         WHERE ${filters} AND category_id = ?
         ORDER BY is_favorite DESC, name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .all(...filterParams, cat, lim, off);
  } else {
    rows = db
      .prepare(
        `SELECT json FROM products
         WHERE ${filters}
         ORDER BY is_favorite DESC, name COLLATE NOCASE
         LIMIT ? OFFSET ?`,
      )
      .all(...filterParams, lim, off);
  }
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .map((p) => hydrateProduct(db, p));
}

function getProduct(db, id) {
  const pid = String(id || '').trim();
  if (!pid) return null;
  const row = db.prepare(`SELECT json FROM products WHERE id = ?`).get(pid);
  if (!row?.json) return null;
  try {
    return hydrateProduct(db, JSON.parse(row.json));
  } catch {
    return null;
  }
}

function countProducts(db, { search = '', categoryId = null, brandId = null, status = 'active' } = {}) {
  const safe = String(search || '').trim().replace(/[%_]/g, '');
  const like = `%${safe}%`;
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM products
     WHERE status = ? AND (? IS NULL OR category_id = ?) AND (? IS NULL OR brand_id = ?)
       AND (? = '' OR name LIKE ? COLLATE NOCASE OR IFNULL(name_mr,'') LIKE ? COLLATE NOCASE
         OR id IN (SELECT product_id FROM product_variants
           WHERE sku LIKE ? COLLATE NOCASE OR IFNULL(barcode,'') LIKE ? COLLATE NOCASE)
         OR id IN (SELECT product_id FROM variant_barcodes
           WHERE barcode = ? COLLATE NOCASE OR barcode LIKE ? COLLATE NOCASE)
         OR json LIKE ?)`,
  ).get(status || 'active', categoryId || null, categoryId || null, brandId || null, brandId || null,
    safe, like, like, like, like, safe, like, `%"barcode":"${safe}"%`);
  return Number(row?.n) || 0;
}

function listCategories(db) {
  return db
    .prepare(`SELECT json FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE`)
    .all()
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function listBrands(db) {
  return db
    .prepare(`SELECT json FROM brands ORDER BY name COLLATE NOCASE`)
    .all()
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function replaceCustomers(db, customers = [], insertOnly = false) {
  const ts = nowIso();
  let written = 0;
  const upsert = db.prepare(
    `INSERT INTO customers (id, name, phone, json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, phone = excluded.phone, json = excluded.json, updated_at = excluded.updated_at`,
  );
  db.exec('BEGIN');
  try {
    // Upsert only: update existing customers, insert new ones. Never wipe local rows.
    for (const c of customers) {
      if (!c?.id) continue;
      if (insertOnly && db.prepare('SELECT 1 FROM customers WHERE id = ?').get(String(c.id))) continue;
      upsert.run(
        String(c.id),
        String(c.name || ''),
        c.phone != null ? String(c.phone) : null,
        JSON.stringify(c),
        ts,
      );
      written += 1;
    }
    setMeta(db, 'customers_updated_at', ts);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { customers: written };
}

function listCustomers(db, { search = '', limit = 200 } = {}) {
  const q = String(search || '').trim();
  const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 200)));
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    rows = db
      .prepare(
        `SELECT json FROM customers
         WHERE name LIKE ? COLLATE NOCASE OR IFNULL(phone,'') LIKE ?
         ORDER BY name COLLATE NOCASE
         LIMIT ?`,
      )
      .all(like, like, lim);
  } else {
    rows = db
      .prepare(`SELECT json FROM customers ORDER BY name COLLATE NOCASE LIMIT ?`)
      .all(lim);
  }
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function upsertCustomer(db, customer) {
  if (!customer?.id) throw new Error('customer.id required');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO customers (id, name, phone, json, updated_at, sync_status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, phone = excluded.phone, json = excluded.json,
       updated_at = excluded.updated_at, sync_status = excluded.sync_status`,
  ).run(
    String(customer.id),
    String(customer.name || ''),
    customer.phone != null ? String(customer.phone) : null,
    JSON.stringify(customer),
    ts,
    customer.sync_status || customer.syncStatus || 'pending',
  );
  return { id: String(customer.id) };
}

function adjustVariantStock(db, variantId, deltaQty) {
  const id = String(variantId || '').trim();
  if (!id) return;
  db.prepare(
    `UPDATE product_variants
     SET stock_qty = stock_qty + ?, updated_at = ?
     WHERE id = ?`,
  ).run(Number(deltaQty) || 0, nowIso(), id);
  const row = db.prepare(`SELECT stock_qty FROM product_variants WHERE id = ?`).get(id);
  if (row) syncVariantStockIntoProductJson(db, id, row.stock_qty);
}

function saveSale(db, sale) {
  const clientBillId = String(sale.clientBillId || '').trim();
  if (!clientBillId) throw new Error('clientBillId required');
  if (sale.insertOnly && db.prepare('SELECT 1 FROM sales WHERE client_bill_id = ?').get(clientBillId)) {
    return { clientBillId, skipped: true };
  }
  const bill = sale.bill || {};
  const payload = sale.payload || {};
  const ts = sale.createdAt || nowIso();

  const insertSale = db.prepare(
    `INSERT INTO sales (
      client_bill_id, server_bill_id, bill_number, status, customer_id, customer_name,
      subtotal, discount_amount, tax_amount, round_off_amount, total_amount, paid_amount, change_amount,
      payload_json, bill_json, sync_status, sync_attempts, last_error, created_at, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_bill_id) DO UPDATE SET
      server_bill_id = COALESCE(excluded.server_bill_id, sales.server_bill_id),
      bill_number = excluded.bill_number,
      status = excluded.status,
      customer_id = excluded.customer_id,
      customer_name = excluded.customer_name,
      subtotal = excluded.subtotal,
      discount_amount = excluded.discount_amount,
      tax_amount = excluded.tax_amount,
      round_off_amount = excluded.round_off_amount,
      total_amount = excluded.total_amount,
      paid_amount = excluded.paid_amount,
      change_amount = excluded.change_amount,
      payload_json = excluded.payload_json,
      bill_json = excluded.bill_json,
      sync_status = excluded.sync_status,
      sync_attempts = excluded.sync_attempts,
      last_error = excluded.last_error,
      synced_at = COALESCE(excluded.synced_at, sales.synced_at)`,
  );
  const deleteItems = db.prepare('DELETE FROM sale_items WHERE client_bill_id = ?');
  const deletePays = db.prepare('DELETE FROM sale_payments WHERE client_bill_id = ?');
  const insertItem = db.prepare(
    `INSERT INTO sale_items (
      id, client_bill_id, line_no, variant_id, product_name, product_name_mr, sku,
      quantity, unit_price, mrp, discount_amount, line_total, is_custom
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPay = db.prepare(
    `INSERT INTO sale_payments (id, client_bill_id, mode, amount, reference_number)
     VALUES (?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    insertSale.run(
      clientBillId,
      sale.serverBillId || null,
      String(bill.bill_number || sale.billNumber || `OFF-${clientBillId.slice(0, 8)}`),
      String(bill.status || 'completed'),
      bill.customer?.id || payload.customerId || null,
      bill.customer?.name || payload.customerName || null,
      Number(bill.subtotal) || 0,
      Number(bill.discount_amount) || 0,
      Number(bill.tax_amount) || 0,
      Number(bill.round_off_amount) || 0,
      Number(bill.total_amount) || 0,
      Number(bill.paid_amount) || 0,
      Number(bill.change_amount) || 0,
      JSON.stringify(payload),
      JSON.stringify(bill),
      sale.syncStatus || 'pending',
      Number(sale.syncAttempts) || 0,
      sale.lastError || null,
      ts,
      sale.syncedAt || null,
    );
    deleteItems.run(clientBillId);
    deletePays.run(clientBillId);
    (bill.items || []).forEach((item, idx) => {
      // Always scope line ids to this bill — server/local payloads often reuse
      // short ids like "local-item-0" which collide across sales (global PK).
      const lineId = `${clientBillId}-i${idx}`;
      insertItem.run(
        lineId,
        clientBillId,
        idx,
        item.variant_id || item.variantId || null,
        String(item.product_name || item.productName || ''),
        item.product_name_mr ?? item.productNameMr ?? null,
        item.sku || '',
        Number(item.quantity) || 0,
        Number(item.unit_price ?? item.unitPrice) || 0,
        item.mrp != null ? Number(item.mrp) : null,
        Number(item.discount_amount ?? item.discountAmount) || 0,
        Number(item.line_total ?? item.lineTotal) || 0,
        item.isCustom || item.is_custom ? 1 : 0,
      );
    });
    (bill.payments || payload.payments || []).forEach((p, idx) => {
      insertPay.run(
        `${clientBillId}-p${idx}`,
        clientBillId,
        String(p.payment_mode || p.mode || 'cash'),
        Number(p.amount) || 0,
        p.reference_number || p.referenceNumber || null,
      );
    });

    // Reduce local stock for completed pending sales (once on insert).
    if ((sale.syncStatus || 'pending') === 'pending' && !sale.skipStock) {
      for (const item of bill.items || []) {
        const vid = item.variant_id || item.variantId;
        if (!vid || String(vid).startsWith('custom-')) continue;
        adjustVariantStock(db, vid, -(Number(item.quantity) || 0));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { clientBillId };
}

function listPendingSales(db) {
  const rows = db
    .prepare(
      `SELECT client_bill_id, payload_json, bill_json, sync_attempts, last_error, created_at
       FROM sales
       WHERE sync_status = 'pending'
       ORDER BY created_at ASC`,
    )
    .all();
  return rows.map((r) => ({
    clientBillId: r.client_bill_id,
    createdAt: r.created_at,
    payload: JSON.parse(r.payload_json),
    bill: JSON.parse(r.bill_json),
    syncAttempts: Number(r.sync_attempts) || 0,
    lastError: r.last_error || undefined,
  }));
}

function retryMissingVariantSales(db) {
  const rows = db.prepare(
    `SELECT DISTINCT s.client_bill_id, s.payload_json
     FROM sales s JOIN sale_items i ON i.client_bill_id = s.client_bill_id
     WHERE s.sync_status = 'local_only' AND s.server_bill_id IS NULL
       AND i.variant_id IS NOT NULL
       AND (
         s.last_error = 'Variant not found: ' || i.variant_id
       )`,
  ).all();
  const retry = db.prepare(
    `UPDATE sales SET sync_status = 'pending'
     WHERE client_bill_id = ? AND sync_status = 'local_only' AND server_bill_id IS NULL`,
  );
  let count = 0;
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json);
    if ((payload.clientBillId || payload.client_bill_id) !== row.client_bill_id) continue;
    count += Number(retry.run(row.client_bill_id).changes);
  }
  return count;
}

function markSaleSynced(db, clientBillId, serverBillId) {
  db.prepare(
    `UPDATE sales
     SET sync_status = 'synced', server_bill_id = ?, synced_at = ?, last_error = NULL
     WHERE client_bill_id = ?`,
  ).run(serverBillId || null, nowIso(), String(clientBillId));
}

function markSaleSyncError(db, clientBillId, message, attempts, localOnly = false) {
  db.prepare(
    `UPDATE sales
     SET sync_attempts = ?, last_error = ?, sync_status = CASE WHEN ? THEN 'local_only' ELSE sync_status END
     WHERE client_bill_id = ? AND sync_status = 'pending'`,
  ).run(Number(attempts) || 0, String(message || ''), localOnly ? 1 : 0, String(clientBillId));
}

function deletePendingSale(db, clientBillId) {
  const id = String(clientBillId || '').trim();
  if (!id) throw new Error('Sale id required');

  db.exec('BEGIN IMMEDIATE');
  try {
    const sale = db
      .prepare(`SELECT sync_status, server_bill_id FROM sales WHERE client_bill_id = ?`)
      .get(id);
    if (!sale || sale.sync_status !== 'pending' || sale.server_bill_id) {
      throw new Error('Only unsynced local sales can be deleted');
    }

    const ledgerRows = db
      .prepare(
        `SELECT id, customer_id, entry_type, amount, sync_status
         FROM customer_ledger
         WHERE reference_type = 'sale' AND reference_id = ?`,
      )
      .all(id);
    const ledgerIds = ledgerRows.map((row) => row.id);
    if (ledgerRows.some((row) => row.sync_status !== 'pending')) {
      throw new Error('Cannot delete this sale because its customer ledger has already synced');
    }
    if (ledgerIds.length) {
      const placeholders = ledgerIds.map(() => '?').join(',');
      const syncedLedgerQueue = db
        .prepare(
          `SELECT 1 AS found FROM sync_queue
           WHERE entity_type = 'customer_ledger'
             AND entity_id IN (${placeholders})
             AND sync_status != 'pending'
           LIMIT 1`,
        )
        .get(...ledgerIds);
      if (syncedLedgerQueue) {
        throw new Error('Cannot delete this sale because its customer ledger has already synced');
      }

      const balanceDeltas = new Map();
      for (const row of ledgerRows) {
        const type = String(row.entry_type || '');
        const amount = Math.abs(Number(row.amount) || 0);
        const delta = type === 'store_credit_add' || type === 'payment' ? amount : -amount;
        balanceDeltas.set(
          row.customer_id,
          (balanceDeltas.get(row.customer_id) || 0) - delta,
        );
      }
      for (const [customerId, delta] of balanceDeltas) {
        const customerRow = db.prepare(`SELECT json FROM customers WHERE id = ?`).get(customerId);
        if (!customerRow?.json) continue;
        let customer;
        try {
          customer = JSON.parse(customerRow.json);
        } catch {
          throw new Error('Cannot safely restore the customer balance for this sale');
        }
        const balance = Math.round(
          ((Number(customer.store_credit_balance ?? customer.storeCreditBalance) || 0) + delta) * 100,
        ) / 100;
        customer.store_credit_balance = balance;
        customer.storeCreditBalance = balance;
        db.prepare(
          `UPDATE customers SET json = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        ).run(JSON.stringify(customer), nowIso(), customerId);
      }

      db.prepare(
        `DELETE FROM sync_queue
         WHERE entity_type = 'customer_ledger'
           AND entity_id IN (${placeholders})
           AND sync_status = 'pending'`,
      ).run(...ledgerIds);
      db.prepare(
        `DELETE FROM customer_ledger
         WHERE reference_type = 'sale' AND reference_id = ?`,
      ).run(id);
    }

    const saleItems = db
      .prepare(`SELECT variant_id, quantity FROM sale_items WHERE client_bill_id = ?`)
      .all(id);
    for (const item of saleItems) {
      if (item.variant_id) {
        adjustVariantStock(db, item.variant_id, Number(item.quantity) || 0);
      }
    }

    db.prepare(`DELETE FROM sale_items WHERE client_bill_id = ?`).run(id);
    db.prepare(`DELETE FROM sale_payments WHERE client_bill_id = ?`).run(id);
    db.prepare(`DELETE FROM sales WHERE client_bill_id = ?`).run(id);
    db.exec('COMMIT');
    return { deleted: true };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction may already have rolled back.
    }
    throw err;
  }
}

function pendingSaleCount(db) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE sync_status = 'pending'`).get();
  return Number(row?.n) || 0;
}

function getStatus(db) {
  const pendingQueue = db
    .prepare(`SELECT COUNT(*) AS n FROM sync_queue WHERE sync_status = 'pending'`)
    .get();
  const held = db.prepare(`SELECT COUNT(*) AS n FROM held_bills`).get();
  return {
    schemaVersion: Number(getMeta(db, 'schema_version', '0')) || 0,
    catalogUpdatedAt: getMeta(db, 'catalog_updated_at'),
    catalogProductCount: Number(getMeta(db, 'catalog_product_count', '0')) || countProducts(db),
    pendingSales: pendingSaleCount(db),
    pendingQueue: Number(pendingQueue?.n) || 0,
    localOnlyCount: Number(db.prepare(
      `SELECT (SELECT COUNT(*) FROM sales WHERE sync_status = 'local_only')
       + (SELECT COUNT(*) FROM sync_queue WHERE sync_status = 'local_only') AS n`,
    ).get()?.n) || 0,
    localOnlyRecords: db.prepare(
      `SELECT 'sale' AS type, client_bill_id AS id, bill_number AS label, last_error AS error, created_at
       FROM sales WHERE sync_status = 'local_only'
       UNION ALL
       SELECT entity_type AS type, id, entity_id AS label, last_error AS error, created_at
       FROM sync_queue WHERE sync_status = 'local_only'
       ORDER BY created_at DESC LIMIT 20`,
    ).all(),
    heldCount: Number(held?.n) || 0,
  };
}

function saveAuthSession(db, session) {
  db.prepare(
    `INSERT INTO auth_session (
      id, shop_code, mobile, password_hash, salt, access_token, refresh_token, user_json, tenant_json, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_code = excluded.shop_code,
      mobile = excluded.mobile,
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      user_json = excluded.user_json,
      tenant_json = excluded.tenant_json,
      updated_at = excluded.updated_at`,
  ).run(
    String(session.shopCode || ''),
    String(session.mobile || ''),
    String(session.passwordHash || ''),
    String(session.salt || ''),
    session.accessToken || null,
    session.refreshToken || null,
    JSON.stringify(session.user || {}),
    JSON.stringify(session.tenant || {}),
    nowIso(),
  );
}

function readAuthSession(db) {
  const row = db.prepare('SELECT * FROM auth_session WHERE id = 1').get();
  if (!row) return null;
  return {
    shopCode: row.shop_code,
    mobile: row.mobile,
    passwordHash: row.password_hash,
    salt: row.salt,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    user: JSON.parse(row.user_json || '{}'),
    tenant: JSON.parse(row.tenant_json || '{}'),
    updatedAt: row.updated_at,
  };
}

/** UI sends YYYY-MM-DD; sales store full ISO times — expand so the whole day is included. */
function dayBoundStart(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
    return `${s}T00:00:00.000Z`;
  }
  return s;
}
function dayBoundEnd(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T23:59:59.999`);
    if (!isNaN(d.getTime())) return d.toISOString();
    return `${s}T23:59:59.999Z`;
  }
  return s;
}

function listSales(db, { search = '', status, from, to, limit = 500, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 500)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(String(status));
  }
  if (from) {
    where.push('created_at >= ?');
    params.push(dayBoundStart(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(dayBoundEnd(to));
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim().replace(/[%_]/g, '')}%`;
    where.push('(bill_number LIKE ? COLLATE NOCASE OR IFNULL(customer_name,\'\') LIKE ? COLLATE NOCASE)');
    params.push(like, like);
  }
  const sql = `
    SELECT client_bill_id, server_bill_id, bill_number, status, total_amount, paid_amount,
           customer_name, created_at, bill_json, sync_status
    FROM sales
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?`;
  params.push(lim, off);
  const rows = db.prepare(sql).all(...params);
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM sales ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .get(...params.slice(0, -2));
  return {
    items: rows.map((r) => {
      let bill = {};
      try {
        bill = JSON.parse(r.bill_json || '{}');
      } catch {
        bill = {};
      }
      return {
        ...bill,
        id: r.server_bill_id || r.client_bill_id,
        client_bill_id: r.client_bill_id,
        bill_number: r.bill_number,
        status: r.status,
        total_amount: r.total_amount,
        paid_amount: r.paid_amount,
        created_at: r.created_at,
        customerName: r.customer_name,
        sync_status: r.sync_status,
        is_returnable: r.status === 'completed',
      };
    }),
    pagination: {
      page: Math.floor(off / lim) + 1,
      limit: lim,
      total: Number(totalRow?.n) || 0,
      totalPages: Math.max(1, Math.ceil((Number(totalRow?.n) || 0) / lim)),
    },
  };
}

/** Fill missing line units from the local catalog so old bills still print 100g / 1kg. */
function attachSaleItemUoms(db, bill) {
  const items = Array.isArray(bill?.items) ? bill.items : [];
  const missingIds = [...new Set(
    items
      .filter((item) => !item?.uom?.code && !item?.variant?.product?.uom?.code)
      .map((item) => String(item?.variant_id || item?.variantId || '').trim())
      .filter(Boolean),
  )];
  if (!missingIds.length) return bill;
  let rows = [];
  try {
    const placeholders = missingIds.map(() => '?').join(',');
    rows = db.prepare(
      `SELECT v.id AS variant_id, v.unit AS unit_code, p.json AS product_json
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.id IN (${placeholders})`,
    ).all(...missingIds);
  } catch {
    return bill;
  }
  const byVariant = new Map();
  for (const row of rows) {
    let uom = null;
    try {
      const product = JSON.parse(row.product_json || '{}');
      if (product?.uom?.code) uom = product.uom;
    } catch {
      uom = null;
    }
    const code = String(uom?.code || row.unit_code || '').trim();
    if (!code) continue;
    byVariant.set(String(row.variant_id), {
      code,
      name: uom?.name || code,
      type: uom?.type || null,
    });
  }
  if (!byVariant.size) return bill;
  bill.items = items.map((item) => {
    if (item?.uom?.code || item?.variant?.product?.uom?.code) return item;
    const uom = byVariant.get(String(item?.variant_id || item?.variantId || ''));
    return uom ? { ...item, uom } : item;
  });
  return bill;
}

function getSale(db, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const row = db
    .prepare(
      `SELECT * FROM sales WHERE client_bill_id = ? OR server_bill_id = ? OR bill_number = ? LIMIT 1`,
    )
    .get(key, key, key);
  if (!row) return null;
  try {
    const bill = attachSaleItemUoms(db, JSON.parse(row.bill_json || '{}'));
    return {
      ...bill,
      id: row.server_bill_id || row.client_bill_id,
      client_bill_id: row.client_bill_id,
      bill_number: row.bill_number,
      status: row.status,
      sync_status: row.sync_status,
      created_at: row.created_at,
    };
  } catch {
    return null;
  }
}

function saveHeldBill(db, held) {
  const id = String(held.id || '').trim();
  if (!id) throw new Error('held.id required');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO held_bills (id, name, customer_id, cart_json, sync_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       customer_id = excluded.customer_id,
       cart_json = excluded.cart_json,
       updated_at = excluded.updated_at`,
  ).run(
    id,
    String(held.name || 'Held'),
    held.customerId || null,
    JSON.stringify(held.cartData || held.cart_json || {}),
    held.syncStatus || 'pending',
    held.createdAt || ts,
    ts,
  );
  return { id };
}

function listHeldBills(db) {
  return db
    .prepare(`SELECT * FROM held_bills ORDER BY updated_at DESC`)
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      customerId: r.customer_id,
      cartData: JSON.parse(r.cart_json || '{}'),
      created_at: r.created_at,
      updated_at: r.updated_at,
      sync_status: r.sync_status,
    }));
}

function deleteHeldBill(db, id) {
  db.prepare(`DELETE FROM held_bills WHERE id = ?`).run(String(id));
}

function enqueueSync(db, { entityType, entityId, op, payload }) {
  const id = `${entityType}:${entityId}:${op}:${randomUUID()}`;
  db.prepare(
    `INSERT INTO sync_queue (id, entity_type, entity_id, op, payload_json, sync_status, sync_attempts, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
  ).run(id, String(entityType), String(entityId), String(op), JSON.stringify(payload || {}), nowIso());
  return { id };
}

function saveStockMovementsAndQueue(db, entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Stock movements are required');
  db.exec('BEGIN');
  try {
    const movements = entries.map(({ row, endpoint, item, notes }) => {
      if (!row?.id || !row.variantId || !Number.isFinite(Number(row.qtyDelta))
        || Number(row.qtyDelta) === 0 || !item || item.variantId !== row.variantId
        || !['opening', 'in', 'out', 'adjust', 'damage'].includes(endpoint)) {
        throw new Error('Invalid local stock movement');
      }
      const quantity = Number(item.quantity);
      const expectedDelta = endpoint === 'out' || endpoint === 'damage' ? -Math.abs(quantity) : quantity;
      if (!Number.isFinite(quantity) || expectedDelta !== Number(row.qtyDelta)) {
        throw new Error('Stock movement quantity does not match its queued operation');
      }
      if (!db.prepare('SELECT 1 FROM product_variants WHERE id = ?').get(row.variantId)) {
        throw new Error(`Local variant not found: ${row.variantId}`);
      }
      const saved = extra.saveStockMovement(db, row);
      if (saved.stockQty == null) throw new Error(`Local stock unavailable for variant: ${row.variantId}`);
      enqueueSync(db, {
        entityType: 'stock_movement',
        entityId: row.id,
        op: endpoint,
        payload: { syncProtocol: 2, endpoint, item, notes },
      });
      return { id: saved.id, variantId: row.variantId, stockQty: saved.stockQty };
    });
    db.exec('COMMIT');
    return { movements };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function upsertProductsAndQueue(db, products, entry) {
  if (!Array.isArray(products) || !products.length) throw new Error('Products are required');
  if (!entry?.entityType || !entry?.entityId || !entry?.op) throw new Error('Sync entry is required');
  db.exec('BEGIN');
  try {
    for (const product of products) extra.upsertProductLocal(db, product);
    const queued = enqueueSync(db, entry);
    db.exec('COMMIT');
    return queued;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteProductAndQueueInternal(db, id) {
  const pendingSale = db.prepare(
    `SELECT 1 FROM sale_items si
     JOIN sales s ON s.client_bill_id = si.client_bill_id
     JOIN product_variants v ON v.id = si.variant_id
     WHERE v.product_id = ? AND s.sync_status IN ('pending', 'local_only') LIMIT 1`,
  ).get(id);
  if (pendingSale) throw new Error('Sync pending bills before deleting this product');
  const referencedIds = new Set([
    id,
    ...db.prepare(`SELECT id FROM product_variants WHERE product_id = ?`).all(id).map((row) => String(row.id)),
  ]);
  const referencesProduct = (value) => {
    if (typeof value === 'string') return referencedIds.has(value);
    if (Array.isArray(value)) return value.some(referencesProduct);
    return value != null && typeof value === 'object' && Object.values(value).some(referencesProduct);
  };
  const otherPending = db.prepare(
    `SELECT payload_json FROM sync_queue
     WHERE sync_status IN ('pending', 'local_only') AND NOT (entity_type = 'product' AND entity_id = ?)`,
  ).all(id);
  if (otherPending.some((row) => referencesProduct(JSON.parse(row.payload_json || '{}')))) {
    throw new Error('Sync pending transactions before deleting this product');
  }
  const pendingCreate = db.prepare(
    `SELECT 1 FROM sync_queue WHERE entity_type = 'product' AND entity_id = ?
     AND op = 'create' AND sync_status = 'pending'`,
  ).get(id);
  db.prepare(
    `DELETE FROM sync_queue WHERE entity_type = 'product' AND entity_id = ? AND sync_status = 'pending'`,
  ).run(id);
  const mappedIds = JSON.parse(getMeta(db, 'product_sync_id_map', '{}') || '{}');
  if (!pendingCreate || mappedIds[id]) {
    enqueueSync(db, { entityType: 'product', entityId: id, op: 'delete', payload: { id } });
  }
  extra.deleteProductLocal(db, id);
}

function deleteProductAndQueue(db, id) {
  const productId = String(id || '').trim();
  if (!productId) throw new Error('Product id is required');
  db.exec('BEGIN');
  try {
    if (!db.prepare(`SELECT id FROM products WHERE id = ?`).get(productId)) {
      throw new Error('Product not found in local database');
    }
    deleteProductAndQueueInternal(db, productId);
    db.exec('COMMIT');
    return { deleted: true };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function deleteAllProductsAndQueue(db) {
  db.exec('BEGIN');
  try {
    const products = db.prepare(`SELECT id FROM products`).all();
    for (const product of products) {
      deleteProductAndQueueInternal(db, String(product.id));
    }
    db.exec('COMMIT');
    return { deleted: products.length };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function generateBarcodesAndQueue(db, items, quantityMode = false) {
  db.exec('BEGIN');
  try {
    const results = quantityMode
      ? extra.ensureQuantityBarcodesLocal(db, items)
      : extra.generateBarcodesLocal(db, items);
    const expected = quantityMode ? items.length : new Set(items.filter(Boolean).map(String)).size;
    if (results.length !== expected) throw new Error('Some product variants were not found');
    const changedIds = [...new Set(results.filter((item) => item.generated).map((item) => item.variantId))];
    const byProduct = new Map();
    const findVariant = db.prepare(`SELECT product_id FROM product_variants WHERE id = ?`);
    for (const id of changedIds) {
      const row = findVariant.get(String(id));
      if (!row) throw new Error('Product variant not found');
      const productId = String(row.product_id);
      if (!byProduct.has(productId)) byProduct.set(productId, new Set());
      byProduct.get(productId).add(String(id));
    }
    const pendingCreate = db.prepare(
      `SELECT 1 FROM sync_queue WHERE entity_type = 'product' AND entity_id = ?
       AND op = 'create' AND sync_status = 'pending'`,
    );
    for (const [productId, variantIds] of byProduct) {
      if (pendingCreate.get(productId)) continue;
      const product = getProduct(db, productId);
      if (!product) throw new Error('Product not found');
      const variants = product.variants.filter((variant) => variantIds.has(String(variant.id))).map((variant) => ({
        id: variant.id,
        sellingPrice: Number(variant.sellingPrice ?? variant.selling_price) || 0,
        barcodes: (variant.barcodes || []).filter((row) => row.quantity == null).map((row) => row.barcode),
        quantityBarcodes: variant.quantityBarcodes || [],
      }));
      enqueueSync(db, {
        entityType: 'product', entityId: productId, op: 'update',
        payload: { id: productId, variantSyncMode: 'append', variants },
      });
    }
    db.exec('COMMIT');
    return results;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listPendingSyncQueue(db) {
  return db
    .prepare(`SELECT * FROM sync_queue WHERE sync_status = 'pending' ORDER BY created_at ASC`)
    .all()
    .map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op,
      payload: JSON.parse(r.payload_json || '{}'),
      syncAttempts: r.sync_attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
    }));
}

function markSyncQueueDone(db, id) {
  db.exec('BEGIN');
  try {
    const row = db.prepare(`SELECT entity_type, entity_id FROM sync_queue WHERE id = ?`).get(String(id));
    db.prepare(`UPDATE sync_queue SET sync_status = 'synced' WHERE id = ?`).run(String(id));
    if (row?.entity_type === 'stock_movement') {
      db.prepare(`UPDATE stock_movements SET sync_status = 'synced',
        json = json_set(json, '$.syncStatus', 'synced') WHERE id = ?`).run(row.entity_id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function markSyncQueueError(db, id, message, attempts, localOnly = false) {
  db.prepare(
    `UPDATE sync_queue SET sync_attempts = ?, last_error = ?,
       sync_status = CASE WHEN ? THEN 'local_only' ELSE sync_status END
     WHERE id = ? AND sync_status = 'pending'`,
  ).run(Number(attempts) || 0, String(message || ''), localOnly ? 1 : 0, String(id));
}

function replaceJsonTable(db, table, rows, idKey = 'id', insertOnly = false) {
  const ts = nowIso();
  db.exec('BEGIN');
  try {
    // Upsert only — keep local rows that are not in this batch.
    const hasNameCol = table === 'expense_categories';
    const stmt = hasNameCol
      ? db.prepare(
          `INSERT INTO ${table} (id, name, json, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json, updated_at = excluded.updated_at`,
        )
      : db.prepare(
          `INSERT INTO ${table} (id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
        );
    for (const row of rows || []) {
      const id = row?.[idKey] || row?.id;
      if (!id) continue;
      if (insertOnly && db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(String(id))) continue;
      if (hasNameCol) {
        stmt.run(String(id), String(row?.name || ''), JSON.stringify(row), ts);
      } else {
        stmt.run(String(id), JSON.stringify(row), ts);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  return { count: (rows || []).length };
}

function listJsonTable(db, table) {
  return db
    .prepare(`SELECT json FROM ${table}`)
    .all()
    .map((r) => {
      try {
        return JSON.parse(r.json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function saveExpense(db, expense) {
  const id = String(expense.id || '').trim();
  if (!id) throw new Error('expense.id required');
  if (expense.insertOnly && db.prepare('SELECT 1 FROM expenses WHERE id = ?').get(id)) return { id };
  const catId = expense.categoryId || expense.category_id || null;
  const expenseDate = String(expense.expenseDate || expense.expense_date || nowIso().slice(0, 10));
  const fullExpense = {
    ...expense,
    id,
    categoryId: catId,
    category_id: catId,
    amount: Number(expense.amount) || 0,
    expense_date: expenseDate,
    expenseDate,
    notes: expense.notes || expense.note || null,
  };
  db.prepare(
    `INSERT INTO expenses (id, category_id, amount, note, expense_date, json, sync_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       category_id = excluded.category_id,
       amount = excluded.amount,
       note = excluded.note,
       expense_date = excluded.expense_date,
       json = excluded.json,
       sync_status = excluded.sync_status`,
  ).run(
    id,
    catId,
    Number(expense.amount) || 0,
    expense.notes || expense.note || null,
    expenseDate,
    JSON.stringify(fullExpense),
    expense.syncStatus || 'pending',
    expense.createdAt || nowIso(),
  );
  return { id };
}

function listExpenses(db, { from, to, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (from) {
    where.push('e.expense_date >= ?');
    params.push(String(from).slice(0, 10));
  }
  if (to) {
    where.push('e.expense_date <= ?');
    params.push(String(to).slice(0, 10));
  }
  params.push(Math.max(1, Math.min(2000, Number(limit) || 200)));
  return db
    .prepare(
      `SELECT e.id, e.category_id, e.amount, e.note, e.expense_date, e.json, e.sync_status, e.created_at,
              ec.name AS category_name, ec.json AS category_json
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT ?`,
    )
    .all(...params)
    .map((r) => {
      let parsed = {};
      try {
        parsed = JSON.parse(r.json) || {};
      } catch {
        parsed = {};
      }
      let catName = r.category_name;
      if (!catName && r.category_json) {
        try {
          catName = JSON.parse(r.category_json)?.name;
        } catch {
          catName = null;
        }
      }
      const categoryName = catName || parsed.category?.name || parsed.categoryName || 'Expense';
      return {
        ...parsed,
        id: r.id,
        amount: Number(r.amount) || 0,
        expense_date: r.expense_date,
        expenseDate: r.expense_date,
        category_id: r.category_id,
        categoryId: r.category_id,
        category: { id: r.category_id, name: categoryName },
        note: r.note,
        notes: r.note,
        syncStatus: r.sync_status,
        createdAt: r.created_at,
      };
    })
    .filter(Boolean);
}

/** Local dashboard aggregates from sales / stock / held / customers. */
function buildDashboard(db) {
  const today = nowIso().slice(0, 10);
  const daySum = (datePrefix) => {
    const row = db
      .prepare(
        `SELECT IFNULL(SUM(total_amount),0) AS revenue, COUNT(*) AS orders
         FROM sales WHERE status = 'completed' AND created_at LIKE ?`,
      )
      .get(`${datePrefix}%`);
    return { revenue: Number(row?.revenue) || 0, orders: Number(row?.orders) || 0 };
  };
  const todayStats = daySum(today);
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yIso = y.toISOString().slice(0, 10);
  const yesterdayStats = daySum(yIso);
  const monthPrefix = today.slice(0, 7);
  const monthRow = db
    .prepare(
      `SELECT IFNULL(SUM(total_amount),0) AS revenue, COUNT(*) AS orders
       FROM sales WHERE status = 'completed' AND created_at LIKE ?`,
    )
    .get(`${monthPrefix}%`);
  const payments = db
    .prepare(
      `SELECT mode, IFNULL(SUM(amount),0) AS amount, COUNT(*) AS count
       FROM sale_payments sp
       JOIN sales s ON s.client_bill_id = sp.client_bill_id
       WHERE s.status = 'completed' AND s.created_at LIKE ?
       GROUP BY mode`,
    )
    .all(`${today}%`)
    .map((r) => ({ mode: r.mode, amount: Number(r.amount) || 0, count: Number(r.count) || 0 }));
  const recent = listSales(db, { limit: 8, offset: 0 }).items;
  const lowStock = db
    .prepare(
      `SELECT v.id, v.sku, p.name, v.stock_qty AS quantity
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       WHERE v.stock_qty <= 5
       ORDER BY v.stock_qty ASC
       LIMIT 20`,
    )
    .all()
    .map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      quantity: Number(r.quantity) || 0,
      reorderLevel: 5,
    }));
  const best = db
    .prepare(
      `SELECT product_name, IFNULL(SUM(quantity),0) AS totalQty, IFNULL(SUM(line_total),0) AS revenue
       FROM sale_items si
       JOIN sales s ON s.client_bill_id = si.client_bill_id
       WHERE s.status = 'completed' AND s.created_at LIKE ?
       GROUP BY product_name
       ORDER BY totalQty DESC
       LIMIT 8`,
    )
    .all(`${monthPrefix}%`)
    .map((r) => ({
      product_name: r.product_name,
      totalQty: Number(r.totalQty) || 0,
      revenue: Number(r.revenue) || 0,
    }));
  const customersCount = db.prepare(`SELECT COUNT(*) AS n FROM customers`).get();
  const heldCount = db.prepare(`SELECT COUNT(*) AS n FROM held_bills`).get();
  const outOfStock = db
    .prepare(`SELECT COUNT(*) AS n FROM product_variants WHERE stock_qty <= 0`)
    .get();
  const expenseToday = db
    .prepare(`SELECT IFNULL(SUM(amount),0) AS n FROM expenses WHERE expense_date = ?`)
    .get(today);
  const expenseMonth = db
    .prepare(`SELECT IFNULL(SUM(amount),0) AS n FROM expenses WHERE expense_date LIKE ?`)
    .get(`${monthPrefix}%`);

  const orders = todayStats.orders;
  return {
    todaySales: todayStats.revenue,
    yesterdaySales: yesterdayStats.revenue,
    salesDeltaPct:
      yesterdayStats.revenue > 0
        ? ((todayStats.revenue - yesterdayStats.revenue) / yesterdayStats.revenue) * 100
        : 0,
    monthSales: Number(monthRow?.revenue) || 0,
    ordersCount: orders,
    yesterdayOrdersCount: yesterdayStats.orders,
    monthOrdersCount: Number(monthRow?.orders) || 0,
    avgTicket: orders > 0 ? todayStats.revenue / orders : 0,
    todayProfit: 0,
    monthProfit: 0,
    todayExpenses: Number(expenseToday?.n) || 0,
    monthExpenses: Number(expenseMonth?.n) || 0,
    heldCount: Number(heldCount?.n) || 0,
    customersCount: Number(customersCount?.n) || 0,
    returnsToday: 0,
    outOfStockCount: Number(outOfStock?.n) || 0,
    lowStockCount: lowStock.length,
    lowStock,
    bestSellers: best,
    paymentBreakdown: payments,
    hourlySales: [],
    weekTrend: [],
    recentTransactions: recent.map((b) => ({
      id: b.id,
      bill_number: b.bill_number,
      total_amount: b.total_amount,
      created_at: b.created_at,
      customerName: b.customerName || null,
    })),
  };
}

function buildSalesReport(db, { from, to } = {}) {
  from = from ? dayBoundStart(from) : from;
  to = to ? dayBoundEnd(to) : to;
  const where = [`status = 'completed'`];
  const params = [];
  if (from) {
    where.push('created_at >= ?');
    params.push(String(from));
  }
  if (to) {
    where.push('created_at <= ?');
    params.push(String(to));
  }
  const summary = db
    .prepare(
      `SELECT IFNULL(SUM(total_amount),0) AS revenue,
              IFNULL(SUM(discount_amount),0) AS discount,
              IFNULL(SUM(tax_amount),0) AS tax,
              COUNT(*) AS bills
       FROM sales WHERE ${where.join(' AND ')}`,
    )
    .get(...params);
  const byDay = db
    .prepare(
      `SELECT substr(created_at,1,10) AS day,
              IFNULL(SUM(total_amount),0) AS revenue,
              COUNT(*) AS bills
       FROM sales WHERE ${where.join(' AND ')}
       GROUP BY substr(created_at,1,10)
       ORDER BY day ASC`,
    )
    .all(...params);

  const billRows = db
    .prepare(
      `SELECT s.client_bill_id AS id, s.bill_number, s.total_amount, s.tax_amount, s.discount_amount, s.created_at,
              c.name AS customer_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.created_at DESC`,
    )
    .all(...params)
    .map((r) => ({
      id: r.id,
      bill_number: r.bill_number,
      total_amount: Number(r.total_amount) || 0,
      tax_amount: Number(r.tax_amount) || 0,
      discount_amount: Number(r.discount_amount) || 0,
      created_at: r.created_at,
      customer: r.customer_name ? { name: r.customer_name } : null,
    }));

  const topProducts = db
    .prepare(
      `SELECT si.product_name, si.sku,
              IFNULL(SUM(si.quantity), 0) AS total_qty,
              IFNULL(SUM(si.line_total), 0) AS revenue
       FROM sale_items si
       JOIN sales s ON s.client_bill_id = si.client_bill_id
       WHERE ${where.join(' AND ')}
       GROUP BY si.product_name, si.sku
       ORDER BY total_qty DESC, revenue DESC
       LIMIT 10`,
    )
    .all(...params)
    .map((r) => ({
      product_name: r.product_name,
      sku: r.sku || '',
      total_qty: Number(r.total_qty) || 0,
      revenue: Number(r.revenue) || 0,
    }));

  return {
    revenue: Number(summary?.revenue) || 0,
    discount: Number(summary?.discount) || 0,
    tax: Number(summary?.tax) || 0,
    bills: billRows,
    count: billRows.length,
    summary: {
      count: billRows.length,
      total: Number(summary?.revenue) || 0,
      tax: Number(summary?.tax) || 0,
      discount: Number(summary?.discount) || 0,
    },
    topProducts,
    mostSold: topProducts[0] || null,
    byDay: byDay.map((r) => ({
      day: r.day,
      revenue: Number(r.revenue) || 0,
      bills: Number(r.bills) || 0,
    })),
  };
}

/**
 * One-time import of legacy JSON outbox files into SQLite.
 */
function importLegacyOutbox(db, offlineRoot) {
  const outboxDir = path.join(offlineRoot, 'outbox');
  if (!fs.existsSync(outboxDir)) return 0;
  let imported = 0;
  for (const name of fs.readdirSync(outboxDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(outboxDir, name), 'utf8');
      const sale = JSON.parse(raw);
      if (!sale?.clientBillId) continue;
      const exists = db.prepare('SELECT 1 AS x FROM sales WHERE client_bill_id = ?').get(sale.clientBillId);
      if (exists) continue;
      saveSale(db, {
        ...sale,
        syncStatus: 'pending',
        skipStock: true, // stock already reduced when JSON outbox was written
      });
      imported += 1;
    } catch {
      /* skip bad file */
    }
  }
  if (imported > 0) setMeta(db, 'legacy_outbox_imported_at', nowIso());
  return imported;
}

module.exports = {
  openShopDb,
  closeAll,
  dbPathFor,
  safeShop,
  getStatus,
  saveShopSettings,
  readShopSettings,
  replaceCatalog,
  listProducts,
  getProduct,
  countProducts,
  listCategories,
  listBrands,
  replaceCustomers,
  listCustomers,
  upsertCustomer,
  adjustVariantStock,
  saveSale,
  listPendingSales,
  retryMissingVariantSales,
  markSaleSynced,
  markSaleSyncError,
  deletePendingSale,
  pendingSaleCount,
  importLegacyOutbox,
  setMeta,
  getMeta,
  nowIso,
  saveAuthSession,
  readAuthSession,
  listSales,
  getSale,
  saveHeldBill,
  listHeldBills,
  deleteHeldBill,
  enqueueSync,
  saveStockMovementsAndQueue,
  upsertProductsAndQueue,
  deleteAllProductsAndQueue,
  deleteProductAndQueue,
  generateBarcodesAndQueue,
  listPendingSyncQueue,
  markSyncQueueDone,
  markSyncQueueError,
  replaceJsonTable,
  listJsonTable,
  saveExpense,
  listExpenses,
  buildDashboard,
  buildSalesReport,
  ...extra,
};
