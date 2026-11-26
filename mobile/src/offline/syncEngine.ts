import api from '../services/api';
import { createBill, fetchCustomers } from '../services/businessService';
import type { BillDetail } from '../services/businessService';
import { fetchAllProducts, fetchBrands, fetchCategories } from '../services/catalogService';
import { getShopSettings } from '../services/shopSettingsService';
import { fetchSuppliers } from '../services/inventoryService';
import { bumpCatalogRevision, writeCachedCategories, writeCachedProducts } from '../services/catalogCache';
import { getDesktopBridge } from '../desktop/bridge';
import { useAuthStore } from '../store/authStore';
import type { Product, ProductVariant, QuantityBarcodeInput } from '../types/catalog';
import { apiError } from '../utils/apiError';
import { isDesktopOfflineCapable } from './capability';
import { useConnectivityStore } from './connectivityStore';
import {
  listOutboxSales,
  markOutboxSaleError,
  refreshPendingCount,
  removeOutboxSale,
} from './outbox';
import type { OutboxSale } from './outbox';
import {
  localListSyncQueue,
  localMarkSyncQueueDone,
  localMarkSyncQueueError,
  localSaveDailyClosing,
  localSaveExpense,
  localSaveReturn,
} from './localApi';
import {
  hasSqliteBridge,
  sqliteReplaceCatalogBatched,
  sqliteReplaceCustomers,
  sqliteSaveSale,
  sqliteSaveShopSettings,
  sqliteReadShopSettings,
  sqliteRetryMissingVariantSales,
  sqliteGetMeta,
  sqliteGetProduct,
  sqliteListProducts,
  sqliteSetMeta,
  sqliteStatus,
} from './sqliteApi';

let running = false;
const PRODUCT_ID_MAP_KEY = 'product_sync_id_map';

type ProductIdMap = Record<string, string>;
type QueueItem = Awaited<ReturnType<typeof localListSyncQueue>>[number];

class LocalOnlySyncError extends Error {}

function isRecordSyncError(err: unknown): boolean {
  const status = errStatus(err);
  return err instanceof LocalOnlySyncError
    || (status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status));
}

function remapProductIds<T>(value: T, ids: ProductIdMap, variantEntry = false): T {
  if (Array.isArray(value)) return value.map((item) => remapProductIds(item, ids, variantEntry)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        const isProductId = ['productId', 'product_id', 'variantId', 'variant_id'].includes(key)
          || (key === 'id' && variantEntry);
        if (isProductId && typeof item === 'string') return [key, ids[item] || item];
        return [key, remapProductIds(item, ids, key === 'variants')];
      }),
    ) as T;
  }
  return value;
}

function containsAbsoluteStock(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAbsoluteStock);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) =>
    ((key === 'stockQty' || key === 'stock_qty') && item != null)
    || containsAbsoluteStock(item),
  );
}

function errStatus(err: unknown): number {
  return Number((err as { response?: { status?: number } })?.response?.status) || 0;
}

function errCode(err: unknown): string {
  return String(
    (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code
      || '',
  );
}

function errMessage(err: unknown): string {
  return String(
    (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      || (err instanceof Error ? err.message : err)
      || '',
  );
}

function isNotFoundErr(err: unknown): boolean {
  const status = errStatus(err);
  const code = errCode(err);
  const message = errMessage(err);
  return (
    status === 404
    || code === 'NOT_FOUND'
    || /variant not found/i.test(message)
    || /product not found/i.test(message)
    || /product variant not found/i.test(message)
  );
}

async function syncLocalProduct(
  local: Product,
  ids: ProductIdMap,
  openingStock?: Record<string, number>,
  missingVariantId?: string,
): Promise<void> {
  const unresolved = () => new LocalOnlySyncError(
    `Cannot safely match local product ${local.id} to the live catalog. Verify the product and stock before resolving it.`,
  );
  if (!local.uom_id || !local.variants?.length) throw unresolved();
  if (openingStock && (local.variants.length !== Object.keys(openingStock).length
    || local.variants.some((variant) => !(variant.id in openingStock)
      || openingStock[variant.id] == null || !Number.isFinite(Number(openingStock[variant.id]))))) {
    throw new LocalOnlySyncError(`Cannot safely determine initial stock for product ${local.id}; its variants changed before sync`);
  }
  const variants = (local.variants || []).map((localRow) => {
    const variant = localRow as ProductVariant & { quantityBarcodes?: QuantityBarcodeInput[] };
    const barcodeRows = [
      ...(variant.barcodes || []).map((row) => typeof row === 'string'
        ? { barcode: row, quantity: null }
        : { barcode: row.barcode, quantity: row.quantity ?? null }),
      ...(variant.quantityBarcodes || []).map((row) => ({ barcode: row.barcode || '', quantity: row.quantity })),
    ];
    if (variant.barcode && !barcodeRows.some((row) => row.barcode === variant.barcode)) {
      barcodeRows.unshift({ barcode: variant.barcode, quantity: null });
    }
    return {
      id: variant.id, remoteVariantId: ids[variant.id], sku: variant.sku, size: variant.size, color: variant.color,
      costPrice: variant.cost_price, sellingPrice: variant.selling_price, mrp: variant.mrp,
      wholesalePrice: variant.wholesale_price, uomId: variant.uom_id, taxGroupId: variant.tax_group_id,
      reorderLevel: variant.reorder_level, status: variant.status, barcodes: barcodeRows,
      ...(openingStock ? { openingStock: openingStock[variant.id] } : {}),
    };
  });
  let response;
  try {
    const deviceId = await sqliteGetMeta('sync_device_id');
    if (!deviceId) throw new Error('Offline device identity is unavailable; restart the desktop app before syncing');
    response = await api.post('/products/sync-catalog', {
      deviceId,
      remoteProductId: ids[local.id],
      product: {
        id: local.id, name: local.name, nameMr: local.name_mr, description: local.description,
        uomId: local.uom_id, categoryId: local.category_id, brandId: local.brand_id,
        taxGroupId: local.tax_group_id, taxCode: local.tax_code, isWeightBased: local.is_weight_based,
        allowDecimalQty: local.allow_decimal_qty, hasVariants: local.has_variants,
        isFavorite: local.is_favorite ?? local.isFavorite, status: local.status,
      },
      variants,
    });
  } catch (err) {
    if (errStatus(err) === 409) throw new LocalOnlySyncError(errMessage(err));
    if (errStatus(err) === 404) throw new Error('Update the live server to enable missing product recovery');
    throw err;
  }
  const remote = response.data?.data as {
    identityProtocol?: number; productId?: string; variants?: Array<{ localId: string; variantId: string }>;
  } | undefined;
  if (remote?.identityProtocol !== 1) {
    throw new Error('Update the live server and apply the catalog sync identity migration before syncing products');
  }
  if (!remote.productId || !Array.isArray(remote.variants) || remote.variants.length !== variants.length) {
    throw new Error('Invalid product sync response');
  }
  if (ids[local.id] && ids[local.id] !== remote.productId) throw unresolved();
  const next = { ...ids };
  const used = new Set<string>();
  for (const variant of variants) {
    const matches = remote.variants.filter((row) => row.localId === variant.id && row.variantId);
    if (matches.length !== 1 || used.has(matches[0].variantId)) throw unresolved();
    const remoteId = matches[0].variantId;
    used.add(remoteId);
    if (variant.id === missingVariantId && (ids[variant.id] || variant.id) === remoteId) {
      throw new LocalOnlySyncError(`Live variant ${remoteId} is still unavailable for this bill`);
    }
    if (ids[variant.id] && ids[variant.id] !== remoteId) throw unresolved();
    next[variant.id] = remoteId;
  }
  next[local.id] = remote.productId;
  await sqliteSetMeta(PRODUCT_ID_MAP_KEY, JSON.stringify(next));
  Object.assign(ids, next);
}

async function reconcileSaleVariant(variantId: string, ids: ProductIdMap): Promise<void> {
  const local = await findLocalProductForVariant(variantId);
  await syncLocalProduct(local, ids, undefined, variantId);
}

async function findLocalProductForVariant(variantId: string): Promise<Product> {
  const products: Product[] = [];
  for (const status of ['active', 'inactive']) {
    const limit = 500;
    for (let offset = 0; ; offset += limit) {
      const page = await sqliteListProducts({ status, limit, offset });
      products.push(...(page.items as Product[]).filter((product) =>
        product.variants?.some((variant) => variant.id === variantId),
      ));
      if (page.items.length < limit) break;
    }
  }
  if (products.length !== 1) {
    throw new LocalOnlySyncError(`Cannot find a unique local product for variant ${variantId}; verify the product before syncing`);
  }
  return products[0];
}

function initialProductStock(row: Pick<QueueItem, 'payload'>, local: Product): Record<string, number> {
  const payload = row.payload || {};
  const variants = local.variants || [];
  const initialVariants = Array.isArray(payload.variants) ? payload.variants : [];
  if (payload.localInitialVariantStock) return payload.localInitialVariantStock;
  if (variants.length !== (initialVariants.length || 1) || variants.length !== 1) {
    throw new LocalOnlySyncError(`Cannot safely determine initial stock for product ${local.id}`);
  }
  return { [variants[0].id]: initialVariants[0]?.stockQty ?? payload.stockQty ?? 0 };
}

async function preflightSaleProducts(
  sale: OutboxSale,
  ids: ProductIdMap,
  queue: QueueItem[],
  verified: Set<string>,
): Promise<void> {
  const items = sale.payload.items;
  if (!Array.isArray(items) || !items.length) throw new LocalOnlySyncError(`Bill ${sale.clientBillId} has no product items`);
  for (const item of items) {
    if (item && typeof item === 'object'
      && (item.isCustom === true || (typeof item.variantId === 'string' && item.variantId.startsWith('custom-')))) {
      continue;
    }
    if (!item || typeof item !== 'object' || typeof item.variantId !== 'string' || !item.variantId) {
      throw new LocalOnlySyncError(`Bill ${sale.clientBillId} contains an item without a variant ID`);
    }
    await preflightVariant(item.variantId, ids, queue, verified);
  }
}

async function preflightVariant(
  variantId: string,
  ids: ProductIdMap,
  queue: QueueItem[],
  verified: Set<string>,
): Promise<void> {
  if (verified.has(variantId)) return;
  const local = await findLocalProductForVariant(variantId);
  const create = queue.find((row) => row.entityType === 'product' && row.op === 'create' && row.entityId === local.id);
  await syncLocalProduct(local, ids, create ? initialProductStock(create, local) : undefined);
  for (const variant of local.variants || []) verified.add(variant.id);
}

async function createPendingBill(sale: OutboxSale, ids: ProductIdMap): Promise<BillDetail> {
  const payload = sale.payload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const desktop = hasSqliteBridge();
  const deviceId = desktop ? (sale.bill.device_id || await sqliteGetMeta('sync_device_id')) : null;
  if (desktop && (!deviceId || !sale.bill.bill_number || !sale.clientBillId)) {
    throw new Error('Offline bill identity is unavailable; restart the desktop app before syncing');
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const request = {
        ...remapProductIds(payload, ids),
        syncRequireIdempotency: true,
        ...(desktop ? {
          clientBillId: sale.clientBillId,
          billNumber: sale.bill.bill_number,
          deviceId,
          offlineTotals: {
            subtotal: sale.bill.subtotal,
            taxAmount: sale.bill.tax_amount,
            discountAmount: sale.bill.discount_amount,
            roundOffAmount: sale.bill.round_off_amount ?? 0,
            totalAmount: sale.bill.total_amount,
            items: sale.bill.items?.map((item) => ({
              quantity: item.quantity,
              unitPrice: item.unit_price,
              discountAmount: item.discount_amount ?? 0,
              taxAmount: item.tax_amount ?? 0,
              lineTotal: item.line_total,
            })),
          },
        } : {}),
      };
      const bill = await createBill(request, desktop) as BillDetail;
      if (desktop && (!bill || bill.id !== sale.clientBillId || bill.bill_number !== sale.bill.bill_number
        || bill.device_id !== deviceId)) {
        throw new Error(`Invalid identity acknowledgment for offline bill ${sale.clientBillId}`);
      }
      return bill;
    } catch (err) {
      if (desktop && errStatus(err) === 404 && /route not found/i.test(errMessage(err))) {
        throw new Error('Update the live server to enable offline bill identity sync');
      }
      const missing = /^Variant not found:\s*(\S+)\s*$/i.exec(errMessage(err))?.[1];
      const item = items.find((row) =>
        row && typeof row === 'object' && typeof row.variantId === 'string'
        && (ids[row.variantId] || row.variantId) === missing,
      );
      if (!missing || !item || attempt >= items.length || !desktop) throw err;
      try {
        await reconcileSaleVariant(item.variantId, ids);
      } catch (reconcileError) {
        if (reconcileError instanceof LocalOnlySyncError) throw reconcileError;
        throw new Error(`Could not verify the live product: ${errMessage(reconcileError)}`);
      }
    }
  }
}

async function pushSyncQueueItem(row: {
  id: string;
  entityType: string;
  entityId: string;
  op: string;
  payload: any;
  syncAttempts?: number;
}, ids: ProductIdMap): Promise<void> {
  const type = row.entityType;
  const op = row.op;
  const originalEntityId = row.entityId;
  if (type === 'product') row = { ...row, entityId: ids[row.entityId] || row.entityId };
  const p = remapProductIds(row.payload || {}, ids);

  if (type === 'customer' && op === 'create') {
    const { name, phone, email, address, notes } = p;
    await api.post('/customers', { name, phone, email, address, notes });
    return;
  }
  if (type === 'customer' && op === 'update') {
    await api.put(`/customers/${row.entityId}`, p);
    return;
  }
  if (type === 'customer' && op === 'delete') {
    try {
      await api.delete(`/customers/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'category' && op === 'create') {
    await api.post('/categories', {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      parentId: p.parentId ?? p.parent_id,
      description: p.description,
    });
    return;
  }
  if (type === 'category' && op === 'update') {
    await api.put(`/categories/${row.entityId}`, {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      parentId: p.parentId ?? p.parent_id,
      description: p.description,
    });
    return;
  }
  if (type === 'category' && op === 'delete') {
    try {
      await api.delete(`/categories/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'brand' && op === 'create') {
    await api.post('/brands', {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      description: p.description,
    });
    return;
  }
  if (type === 'brand' && op === 'update') {
    await api.put(`/brands/${row.entityId}`, {
      name: p.name,
      nameMr: p.nameMr ?? p.name_mr,
      description: p.description,
    });
    return;
  }
  if (type === 'brand' && op === 'delete') {
    try {
      await api.delete(`/brands/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'profile' && op === 'update') {
    await api.patch('/auth/profile', {
      name: p.name,
      phone: p.phone,
    });
    return;
  }
  if (type === 'shop_settings' && op === 'update') {
    await api.patch('/shop-settings', p);
    return;
  }
  if (type === 'expense' && op === 'create') {
    await api.post('/expenses', {
      categoryId: p.categoryId || p.category_id,
      amount: p.amount,
      notes: p.notes || p.note,
      expenseDate: p.expenseDate || p.expense_date,
      paymentMode: p.paymentMode || p.payment_mode || 'cash',
    });
    return;
  }
  if (type === 'held_bill' && op === 'create') {
    await api.post('/bills/hold', {
      name: p.name,
      cartData: p.cartData,
      customerId: p.customerId,
    });
    return;
  }
  if (type === 'held_bill' && op === 'delete') {
    await api.delete(`/bills/held/${row.entityId}`);
    return;
  }
  if (type === 'return' && op === 'create') {
    await api.post('/returns', p);
    return;
  }
  if (type === 'purchase' && op === 'create') {
    await api.post('/purchases/bills', p);
    return;
  }
  if (type === 'supplier' && op === 'create') {
    await api.post('/suppliers', p);
    return;
  }
  if (type === 'supplier' && op === 'update') {
    await api.put(`/suppliers/${row.entityId}`, p);
    return;
  }
  if (type === 'supplier' && op === 'delete') {
    try {
      await api.delete(`/suppliers/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'product' && op === 'create') {
      const localProduct = await sqliteGetProduct(originalEntityId) as Product | null;
      if (!localProduct) throw new LocalOnlySyncError('Pending product not found in local database');
      await syncLocalProduct(localProduct, ids, initialProductStock(row, localProduct));
      return;
  }
  if (type === 'product' && op === 'update') {
    if (containsAbsoluteStock(p)) {
      throw new LocalOnlySyncError(
        `Product ${originalEntityId} has an absolute stock edit; verify live stock and reconcile the change before syncing`,
      );
    }
    const { id, ...rest } = p;
    const targetId = row.entityId || id;
    try {
      await api.put(`/products/${targetId}`, rest);
      return;
    } catch (err) {
      throw err;
    }
  }
  if (type === 'product' && op === 'delete') {
    try {
      await api.delete(`/products/${row.entityId}`);
    } catch (err) {
      if (isNotFoundErr(err)) return;
      throw err;
    }
    return;
  }
  if (type === 'product' && op === 'favorite') {
    try {
      await api.put(`/products/${row.entityId}/favorite`, { isFavorite: p.isFavorite });
    } catch (err) {
      throw err;
    }
    return;
  }
  if (type === 'product_favorites_bulk') {
    try {
      await api.post('/products/favorites/bulk', {
        categoryId: p.categoryId,
        brandId: p.brandId || undefined,
        isFavorite: p.isFavorite,
      });
    } catch (err) {
      throw err;
    }
    return;
  }
  if (type === 'price_bulk' && op === 'update') {
    const items = Array.isArray((p as any).items) ? (p as any).items : [];
    if (!items.length) return;
    if (containsAbsoluteStock(items)) {
      throw new LocalOnlySyncError('Bulk product edits contain absolute stock changes; verify live stock and reconcile them before syncing');
    }
    await api.post('/products/price-bulk', { items });
    return;
  }
  if (type === 'daily_closing') {
    const closingDate = String(
      p.closingDate ||
      p.closing_date ||
      (row.entityId && /^\d{4}-\d{2}-\d{2}$/.test(row.entityId)
        ? row.entityId
        : new Date().toISOString().slice(0, 10))
    );
    const payload = { ...p, closingDate };
    const errStatus = (err: any) => Number(err?.response?.status) || 0;
    const errCode = (err: any) => String(err?.response?.data?.error?.code || '');
    const errMessage = (err: any) => String(err?.response?.data?.error?.message || err?.message || '');
    const isAlreadyClosed = (err: any) => {
      const status = errStatus(err);
      const code = errCode(err);
      const message = errMessage(err);
      return (
        status === 409
        || code === 'DUPLICATE'
        || code === 'DUPLICATE_ENTRY'
        || /already closed/i.test(message)
        || /closing already done/i.test(message)
      );
    };
    const isMissingClosing = (err: any) => {
      const status = errStatus(err);
      const message = errMessage(err);
      return status === 404 || /closing not found/i.test(message);
    };
    const isPastClosingLocked = (err: any) => /only today's register/i.test(errMessage(err));

    /** Live API often only accepts the server UUID — resolve by closing_date. */
    const findServerClosingId = async (): Promise<string | null> => {
      try {
        const { data } = await api.get('/daily-closings');
        const items = Array.isArray(data?.data) ? data.data : [];
        const hit = items.find((c: any) => {
          const date = String(c?.closing_date || c?.closingDate || '');
          return date === closingDate;
        });
        return hit?.id ? String(hit.id) : null;
      } catch {
        return null;
      }
    };

    const putById = async (id: string) => {
      await api.put(`/daily-closings/${id}`, payload);
    };

    // Offline rows use a local id the server never saw. Never PUT by date string on
    // older APIs (they treat :id as UUID and return "Closing not found").
    if (op === 'update' || op === 'create') {
      if (row.entityId && !/^\d{4}-\d{2}-\d{2}$/.test(String(row.entityId))) {
        try {
          await putById(String(row.entityId));
          return;
        } catch (err: any) {
          if (!isMissingClosing(err) && !isAlreadyClosed(err)) {
            if (isPastClosingLocked(err)) return;
            throw err;
          }
        }
      }

      try {
        await api.post('/daily-closings', payload);
        return;
      } catch (err: any) {
        if (!isAlreadyClosed(err) && !isMissingClosing(err)) throw err;
      }

      const serverId = await findServerClosingId();
      if (serverId) {
        try {
          await putById(serverId);
          return;
        } catch (err: any) {
          // Already on server / locked past day — clear queue instead of blocking sync.
          if (isAlreadyClosed(err) || isMissingClosing(err) || isPastClosingLocked(err)) return;
          throw err;
        }
      }

      // No server row and create was rejected as duplicate — treat as synced.
      return;
    }
  }
  if (type === 'stock_movement') {
    if (p.syncProtocol !== 2) {
      throw new LocalOnlySyncError(
        `Stock movement ${originalEntityId} predates retry-safe sync; verify the live stock history before reconciling it`,
      );
    }
    let response;
    try {
      response = await api.post('/stock/sync-movement', {
        clientMovementId: originalEntityId,
        operation: p.endpoint || op,
        variantId: p.item?.variantId,
        quantity: p.item?.quantity,
        unitCost: p.item?.unitCost,
        notes: p.notes,
      });
    } catch (err) {
      if (errStatus(err) === 404 && /route not found/i.test(errMessage(err))) {
        throw new Error('Update the live server to enable retry-safe stock sync');
      }
      throw err;
    }
    const operation = p.endpoint || op;
    const quantity = Number(p.item?.quantity);
    const expectedChange = Number((operation === 'out' || operation === 'damage'
      ? -Math.abs(quantity) : quantity).toFixed(3));
    if (response.data?.data?.clientMovementId !== originalEntityId || !response.data?.data?.movementId
      || response.data?.data?.variantId !== p.item?.variantId
      || Number(response.data?.data?.quantityChange) !== expectedChange) {
      throw new Error(`Invalid acknowledgment for stock movement ${originalEntityId}`);
    }
    return;
  }
  if (type === 'customer_ledger') {
    // Server may not expose a generic ledger create; keep queued until API exists.
    // Treat as synced locally so it doesn't block forever.
    return;
  }
  throw new LocalOnlySyncError(`Unsupported sync item: ${type}/${op}`);
}

/** Push pending sales + generic sync_queue (desktop → live DB). */
export async function flushOutbox(): Promise<{ synced: number; failed: number; skipped?: number }> {
  if (!isDesktopOfflineCapable()) return { synced: 0, failed: 0 };
  if (!navigator.onLine) {
    useConnectivityStore.getState().setOnline(false);
    return { synced: 0, failed: 0 };
  }
  if (running) return { synced: 0, failed: 0 };
  running = true;

  let synced = 0;
  let failed = 0;
  let skipped = 0;
  try {
    if (hasSqliteBridge()) {
      const status = await sqliteStatus();
      if (typeof status?.localOnlyCount !== 'number' || status.syncGuardVersion !== 1) {
        throw new Error('Restart the desktop app to enable safe sync');
      }
    }
    if (hasSqliteBridge()) await sqliteRetryMissingVariantSales();
    const storedMap = hasSqliteBridge() ? await sqliteGetMeta(PRODUCT_ID_MAP_KEY) : null;
    const ids: ProductIdMap = storedMap ? JSON.parse(storedMap) : {};
    const queue = hasSqliteBridge() ? await localListSyncQueue() : [];
    const sales = await listOutboxSales();
    const verifiedVariants = new Set<string>();
    const pending = [
      ...queue.map((row) => ({ kind: 'queue' as const, row })),
      ...sales.map((row) => ({ kind: 'sale' as const, row })),
    ].sort((a, b) => String(a.row.createdAt).localeCompare(String(b.row.createdAt)));
    for (const entry of pending) {
      if (entry.kind === 'queue') {
        const row = entry.row;
        try {
          if (hasSqliteBridge() && row.entityType === 'stock_movement' && row.payload?.syncProtocol === 2) {
            const variantId = row.payload?.item?.variantId;
            if (typeof variantId !== 'string' || !variantId) {
              throw new LocalOnlySyncError(`Stock movement ${row.entityId} has no variant ID`);
            }
            await preflightVariant(variantId, ids, queue, verifiedVariants);
          }
          await pushSyncQueueItem(row, ids);
        } catch (err) {
          const message = apiError(err, err instanceof Error ? err.message : String(err));
          const canSkip = isRecordSyncError(err) && hasSqliteBridge();
          await localMarkSyncQueueError(row.id, message, (row.syncAttempts || 0) + 1, canSkip);
          useConnectivityStore.getState().setLastSyncError(message);
          if (!canSkip) { failed += 1; break; }
          skipped += 1;
          continue;
        }
        await localMarkSyncQueueDone(row.id);
        synced += 1;
      } else {
        const row = entry.row;
        let created: BillDetail;
        try {
          if (hasSqliteBridge()) await preflightSaleProducts(row, ids, queue, verifiedVariants);
          created = await createPendingBill(row, ids);
        } catch (err) {
          const message = apiError(err, err instanceof Error ? err.message : String(err));
          const canSkip = isRecordSyncError(err) && hasSqliteBridge();
          await markOutboxSaleError(row, message, canSkip);
          useConnectivityStore.getState().setLastSyncError(message);
          if (!canSkip) { failed += 1; break; }
          skipped += 1;
          continue;
        }
        await removeOutboxSale(row.clientBillId, created?.id || null, created, row.payload);
        synced += 1;
      }
    }
    const status = hasSqliteBridge() ? await sqliteStatus() : null;
    if (!failed && !skipped && !status?.localOnlyCount) {
      for (const [localId, remoteId] of Object.entries(ids)) {
        const local = await sqliteGetProduct(localId) as Product | null;
        if (local) {
          const { data } = await api.get(`/products/${remoteId}`);
          if (!data?.data?.id) throw new Error('Could not reload synced product');
          const remoteVariants: ProductVariant[] = data.data.variants || [];
          if ((local.variants || []).some((variant) =>
            !remoteVariants.some((remote) => remote.id === (ids[variant.id] || variant.id)),
          )) {
            throw new Error('Local product has variants that are not yet synced; retry sync before downloading');
          }
        }
      }
    }
  } finally {
    running = false;
    await refreshPendingCount();
  }
  return skipped ? { synced, failed, skipped } : { synced, failed };
}

async function pullServerSales(limitPages = 5, insertOnly = false): Promise<number> {
  let imported = 0;
  for (let page = 1; page <= limitPages; page += 1) {
    const { data } = await api.get('/bills', { params: { page, limit: 100, status: 'completed' } });
    const payload = data?.data;
    const items: any[] = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    if (!items.length) break;
    for (const bill of items) {
      if (!bill?.id) continue;
      const clientBillId = String(bill.client_bill_id || bill.clientBillId || `srv-${bill.id}`);
      const saved = await sqliteSaveSale({
        clientBillId,
        serverBillId: String(bill.id),
        syncStatus: 'synced',
        insertOnly,
        skipStock: true,
        syncedAt: new Date().toISOString(),
        createdAt: bill.created_at || bill.createdAt || new Date().toISOString(),
        bill,
        payload: {},
      });
      if (!saved?.skipped) imported += 1;
    }
    const totalPages = Number(payload?.pagination?.totalPages) || page;
    if (page >= totalPages) break;
  }
  return imported;
}

async function pullServerExpenses(insertOnly = false): Promise<number> {
  const { data } = await api.get('/expenses', { params: { limit: 500 } });
  const payload = data?.data;
  const items: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  for (const row of items) {
    if (!row?.id) continue;
    await localSaveExpense({ ...row, syncStatus: 'synced', insertOnly });
  }
  return items.length;
}

async function pullServerReturns(insertOnly = false): Promise<number> {
  const { data } = await api.get('/returns', { params: { page: 1, limit: 200 } });
  const payload = data?.data;
  const items: any[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  for (const row of items) {
    if (!row?.id) continue;
    await localSaveReturn({ ...row, syncStatus: 'synced', skipStock: true, insertOnly });
  }
  return items.length;
}

async function pullServerClosings(insertOnly = false): Promise<number> {
  const { data } = await api.get('/daily-closings');
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  for (const row of items) {
    if (!row?.id) continue;
    await localSaveDailyClosing({ ...row, syncStatus: 'synced', insertOnly });
  }
  return items.length;
}

/**
 * Pull live database → local SQLite (mobile / other devices' online changes).
 * Always uses forceNetwork / direct API — never the local cache.
 */
export async function pullEverythingToSqlite(): Promise<{
  products: number;
  categories: number;
  brands: number;
  customers: number;
  sales: number;
  expenses: number;
  returns: number;
  closings: number;
  errors?: string[];
}> {
  if (!hasSqliteBridge()) throw new Error('Local database is unavailable');
  if (!navigator.onLine) throw new Error('No internet connection');

  const pullErrors: string[] = [];
  const status = await sqliteStatus();
  if (typeof status?.localOnlyCount !== 'number' || status.syncGuardVersion !== 1) {
    throw new Error('Restart the desktop app to enable safe sync');
  }
  const insertOnly = status.localOnlyCount > 0;

  // Products are critical — do not swallow failures into an empty upsert (that leaves
  // desktop missing everything created on mobile).
  // Prefer all non-deleted products (no status filter) so newly created rows are included.
  let products: Awaited<ReturnType<typeof fetchAllProducts>> = [];
  try {
    products = await fetchAllProducts({
      forceNetwork: true,
      preferFull: true,
      requireComplete: true,
    });
  } catch (err) {
    try {
      products = await fetchAllProducts({
        status: 'active',
        forceNetwork: true,
        preferFull: true,
        requireComplete: true,
      });
      pullErrors.push('Only active products could be downloaded; inactive products may be missing.');
    } catch (err2) {
      const message = apiError(err2, apiError(err, 'Could not download products'));
      pullErrors.push(message);
      console.error('[KDSPOZ] product pull failed:', err2);
    }
  }

  const [categories, brands, shop, customers, suppliers, expenseCats, units, taxGroups] = await Promise.all([
    (insertOnly
      ? api.get('/categories').then((response) => response.data?.data || [])
      : fetchCategories(undefined, { forceNetwork: true })).catch((err) => {
      pullErrors.push(apiError(err, 'Could not download categories'));
      return [];
    }),
    fetchBrands(undefined, { forceNetwork: true }).catch((err) => {
      pullErrors.push(apiError(err, 'Could not download brands'));
      return [];
    }),
    (insertOnly
      ? api.get('/shop-settings').then((response) => response.data?.data || null)
      : getShopSettings({ forceNetwork: true })).catch((err) => {
      pullErrors.push(apiError(err, 'Could not download shop settings'));
      return null;
    }),
    fetchCustomers(undefined, { forceNetwork: true })
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download customers'));
        return [];
      }),
    fetchSuppliers(undefined, { forceNetwork: true })
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download suppliers'));
        return [];
      }),
    api
      .get('/expense-categories')
      .then((r) => r.data?.data || [])
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download expense categories'));
        return [];
      }),
    api
      .get('/units')
      .then((r) => r.data?.data || [])
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download units'));
        return [];
      }),
    api
      .get('/tax-groups')
      .then((r) => r.data?.data || [])
      .catch((err) => {
        pullErrors.push(apiError(err, 'Could not download tax groups'));
        return [];
      }),
  ]);

  const supplierRows = Array.isArray(suppliers) ? suppliers : [];

  {
    const storedMap = await sqliteGetMeta(PRODUCT_ID_MAP_KEY);
    const ids: ProductIdMap = storedMap ? JSON.parse(storedMap) : {};
    const mappedProducts = new Map<string, Product>();
    for (const [localId, remoteId] of Object.entries(ids)) {
      const local = await sqliteGetProduct(localId) as Product | null;
      if (local) {
        const existing = mappedProducts.get(remoteId);
        if (existing && existing.id !== local.id) {
          throw new Error(`Multiple local products map to live product ${remoteId}; manual reconciliation is required`);
        }
        mappedProducts.set(remoteId, local);
      }
    }
    const mappedRemoteIds = new Set(Object.values(ids));
    const translatedProducts: Product[] = [];
    for (const product of products) {
      const local = mappedProducts.get(product.id)
        || ((product.variants || []).some((variant) => mappedRemoteIds.has(variant.id))
          ? await sqliteGetProduct(product.id) as Product | null
          : null);
      if (!local) {
        translatedProducts.push(product);
        continue;
      }
      const localVariantIds = new Map(
        (local.variants || []).filter((variant) => ids[variant.id])
          .map((variant) => [ids[variant.id], variant.id]),
      );
      translatedProducts.push({
        ...product,
        id: local.id,
        variants: (product.variants || []).map((variant) => ({
          ...variant,
          id: localVariantIds.get(variant.id) || variant.id,
        })),
      });
    }
    products = translatedProducts;
  }

  let catalogWritten = 0;
  let categoriesWritten = 0;
  let brandsWritten = 0;
  if (products.length || categories.length || brands.length) {
    try {
      // Chunked IPC upsert — a single huge replace often fails on Electron and
      // leaves the local catalog missing products created on mobile.
      const written = await sqliteReplaceCatalogBatched({
        products: products || [],
        categories: categories || [],
        brands: brands || [],
        clearProducts: false,
        syncStock: false,
        insertOnly,
        protectPending: true,
      });
      catalogWritten = written.products;
      categoriesWritten = written.categories;
      brandsWritten = written.brands;
    } catch (err) {
      const message = apiError(err, 'Could not save products to local database');
      pullErrors.push(message);
      console.error('[KDSPOZ] catalog replace failed:', err);
    }
  }
  if (shop && (!insertOnly || !(await sqliteReadShopSettings()))) await sqliteSaveShopSettings(shop);
  const customerRows = Array.isArray(customers)
    ? customers
    : Array.isArray((customers as { items?: unknown[] })?.items)
      ? (customers as { items: unknown[] }).items
      : [];
  let customersWritten = 0;
  if (customerRows.length) {
    try {
      const written = await sqliteReplaceCustomers(customerRows, insertOnly);
      customersWritten = written?.customers ?? 0;
    } catch (err) {
      pullErrors.push(apiError(err, 'Could not save customers locally'));
    }
  }

  const bridge = getDesktopBridge();
  if (bridge?.sqliteReplaceSuppliers) {
    const shopCode =
      useAuthStore.getState().savedLogin?.shopCode ||
      'default';
    await bridge.sqliteReplaceSuppliers({ shopCode, suppliers: supplierRows, insertOnly });
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(expenseCats) && expenseCats.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'expense_categories',
        rows: expenseCats,
        insertOnly,
      });
    }
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(units) && units.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'units',
        rows: units,
        insertOnly,
      });
    }
    if (bridge?.sqliteReplaceJsonTable && Array.isArray(taxGroups) && taxGroups.length) {
      await bridge.sqliteReplaceJsonTable({
        shopCode,
        table: 'tax_groups',
        rows: taxGroups,
        insertOnly,
      });
    }
  }

  // Bills / expenses / returns / closings created on mobile (online) → desktop local DB.
  const onPullError = (label: string) => (err: unknown) => {
    pullErrors.push(apiError(err, label));
    return 0;
  };
  const sales = await pullServerSales(5, insertOnly).catch(onPullError('Could not download bills'));
  const expenses = await pullServerExpenses(insertOnly).catch(onPullError('Could not download expenses'));
  const returns = await pullServerReturns(insertOnly).catch(onPullError('Could not download returns'));
  const closings = await pullServerClosings(insertOnly).catch(onPullError('Could not download closings'));

  // Refresh disk cache from the live pull so Billing / ProductList see new mobile rows.
  // Write then bump once (do not invalidate-first — that races listeners onto an empty cache).
  try {
    if (products.length) {
      await writeCachedProducts(products, products.length, 'replace');
    }
    if (categories.length && !insertOnly) {
      await writeCachedCategories(categories);
    }
    bumpCatalogRevision();
  } catch (err) {
    console.warn('[KDSPOZ] catalog cache refresh failed:', err);
    bumpCatalogRevision();
  }

  if (!insertOnly && products.length && catalogWritten === 0 && !pullErrors.some((e) => /local database/i.test(e))) {
    pullErrors.push(`Downloaded ${products.length} products but none were saved locally`);
  } else if (!products.length && categories.length > 0 && !pullErrors.length) {
    // Shop has categories on live but product download returned empty — likely auth/API issue.
    pullErrors.push('Downloaded 0 products from live database');
  }

  if (pullErrors.length) {
    useConnectivityStore.getState().setLastSyncError(pullErrors[0]);
  }

  await sqliteSetMeta('last_pull_at', new Date().toISOString());
  return {
    // Report what landed in SQLite (0 if download or local write failed).
    products: products.length ? catalogWritten : 0,
    categories: categoriesWritten,
    brands: brandsWritten,
    customers: customersWritten,
    sales,
    expenses,
    returns,
    closings,
    ...(pullErrors.length ? { errors: pullErrors } : {}),
  };
}

export type SyncResult = {
  synced: number;
  failed: number;
  skipped?: number;
  pulled?: {
    products: number;
    categories: number;
    brands: number;
    customers: number;
    sales?: number;
    expenses?: number;
    returns?: number;
    closings?: number;
    errors?: string[];
  };
};

/**
 * Two-way sync with live DB (mobile is online-only, so live DB may have newer masters/bills):
 * Push local changes before pulling, so a download cannot overwrite pending edits.
 */
export async function syncNow(): Promise<SyncResult> {
  if (!isDesktopOfflineCapable()) return { synced: 0, failed: 0 };
  if (useConnectivityStore.getState().syncing) return { synced: 0, failed: 0 };
  if (!navigator.onLine) {
    useConnectivityStore.getState().setOnline(false);
    useConnectivityStore.getState().setLastSyncError('No internet connection');
    return { synced: 0, failed: 1 };
  }

  useConnectivityStore.getState().setSyncing(true);
  useConnectivityStore.getState().setLastSyncError('');
  try {
    const push = await flushOutbox();
    if (push.failed) return push;
    let pulled: SyncResult['pulled'];
    if (hasSqliteBridge()) {
      pulled = await pullEverythingToSqlite();
    }
    if (pulled?.errors?.length) return { ...push, failed: push.failed + 1, pulled };
    const syncedAt = new Date().toISOString();
    await sqliteSetMeta('last_sync_at', syncedAt).catch(() => undefined);
    useConnectivityStore.getState().setLastSyncAt(syncedAt);
    return { ...push, pulled };
  } catch (err) {
    const message = apiError(err, err instanceof Error ? err.message : String(err));
    useConnectivityStore.getState().setLastSyncError(message);
    return { synced: 0, failed: 1 };
  } finally {
    useConnectivityStore.getState().setSyncing(false);
    if (hasSqliteBridge()) {
      void sqliteStatus().then((s) => {
        if (s?.pendingSales != null) {
          useConnectivityStore.getState().setPendingCount(Number(s.pendingSales) || 0);
        }
      });
    } else {
      await refreshPendingCount();
    }
  }
}

export function startOutboxSync(): () => void {
  if (!isDesktopOfflineCapable()) return () => {};
  void refreshPendingCount();
  const onOnline = () => {
    const s = useConnectivityStore.getState();
    if (s.manualOffline) return;
    s.setOnline(true);
  };
  const onOffline = () => useConnectivityStore.getState().setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
