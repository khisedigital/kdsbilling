export type DesktopPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
  /** Windows: spooler driver name (e.g. Generic / Text Only). */
  driverName?: string;
  /** Windows: driver looks safe for RAW ESC/POS. */
  rawFriendly?: boolean;
};

export type DesktopPrintHtmlOptions = {
  html: string;
  /** Installed printer name; empty shows the system print dialog */
  printerName?: string;
  silent?: boolean;
  /** Page width in millimetres for roll (thermal) paper */
  pageWidthMm?: number;
  pageHeightMm?: number;
  /** Force A4 paper */
  a4?: boolean;
  /** Exact page size with no printer margins (thermal receipts) */
  noMargins?: boolean;
  /** Prefer CSS @page size from the HTML (roll width from Paper size setting) */
  preferCssPageSize?: boolean;
};

export type DesktopSaveFileOptions = {
  filename: string;
  mime: string;
  base64?: string;
  text?: string;
};

export type DesktopBridge = {
  isDesktop: true;
  platform: string;
  listPrinters: () => Promise<DesktopPrinter[]>;
  printHtml: (options: DesktopPrintHtmlOptions) => Promise<void>;
  printRaw: (options: {
    host: string;
    port: number;
    base64: string;
    copies?: number;
    /** Gap labels: stickers per OS write (e.g. 3). */
    batchSize?: number;
    /** Short FIFO settle for stickers; longer for bills. */
    jobKind?: 'label' | 'receipt';
  }) => Promise<void>;
  /** ESC/POS to an OS-installed POS printer (58/80 mm). Optional on older desktop builds. */
  printRawSystem?: (options: {
    printerName: string;
    base64: string;
    /** How many times to send the unit buffer (one sticker). */
    copies?: number;
    /** Stickers per spool write — keeps DeTong gap aligned (use 3). */
    batchSize?: number;
    /** Short FIFO settle for stickers; longer for bills. */
    jobKind?: 'label' | 'receipt';
  }) => Promise<void>;
  /** Enable CUPS/Win queue now so paper can move as soon as bytes are ready. */
  primePrinter?: (options: { printerName: string }) => Promise<void>;
  saveFile: (options: DesktopSaveFileOptions) => Promise<{ saved: boolean; path?: string }>;
  /** Desktop offline file store (userData/offline/<shop>/…). Optional on older builds. */
  offlineRead?: (options: { shopCode: string; key: string }) => Promise<{ ok: boolean; value: unknown }>;
  offlineWrite?: (options: { shopCode: string; key: string; value: unknown }) => Promise<{ ok: boolean }>;
  offlineRemove?: (options: { shopCode: string; key: string }) => Promise<{ ok: boolean }>;
  offlineList?: (options: { shopCode: string; prefix?: string }) => Promise<{ ok: boolean; keys: string[] }>;
  /** Local SQLite — fully offline catalog + sales. */
  sqliteStatus?: (options: { shopCode: string }) => Promise<{
    ok: boolean;
    schemaVersion?: number;
    catalogUpdatedAt?: string | null;
    catalogProductCount?: number;
    pendingSales?: number;
  }>;
  sqliteSaveShopSettings?: (options: { shopCode: string; settings: unknown }) => Promise<{ ok: boolean }>;
  sqliteReadShopSettings?: (options: { shopCode: string }) => Promise<{ ok: boolean; settings: unknown }>;
  sqliteReplaceCatalog?: (options: {
    shopCode: string;
    products?: unknown[];
    categories?: unknown[];
    brands?: unknown[];
    clearProducts?: boolean;
    syncStock?: boolean;
  }) => Promise<{ ok: boolean; products?: number }>;
  sqliteListProducts?: (options: {
    shopCode: string;
    search?: string;
    limit?: number;
    offset?: number;
    categoryId?: string | null;
  }) => Promise<{ ok: boolean; items: unknown[]; total: number }>;
  sqliteListCategories?: (options: { shopCode: string }) => Promise<{ ok: boolean; items: unknown[] }>;
  sqliteListBrands?: (options: { shopCode: string }) => Promise<{ ok: boolean; items: unknown[] }>;
  sqliteReplaceCustomers?: (options: {
    shopCode: string;
    customers?: unknown[];
  }) => Promise<{ ok: boolean; customers?: number }>;
  sqliteListCustomers?: (options: {
    shopCode: string;
    search?: string;
    limit?: number;
  }) => Promise<{ ok: boolean; items: unknown[] }>;
  sqliteUpsertCustomer?: (options: {
    shopCode: string;
    customer: unknown;
  }) => Promise<{ ok: boolean; id?: string }>;
  sqliteSetMeta?: (options: {
    shopCode: string;
    key: string;
    value: string;
  }) => Promise<{ ok: boolean }>;
  sqliteGetMeta?: (options: {
    shopCode: string;
    key: string;
    fallback?: string | null;
  }) => Promise<{ ok: boolean; value: string | null }>;
  sqliteSaveSale?: (options: { shopCode: string; sale: unknown }) => Promise<{ ok: boolean; pending?: number }>;
  sqliteListPendingSales?: (options: { shopCode: string }) => Promise<{
    ok: boolean;
    rows: Array<{
      clientBillId: string;
      createdAt: string;
      payload: Record<string, unknown>;
      bill: unknown;
      syncAttempts: number;
      lastError?: string;
    }>;
    pending: number;
  }>;
  sqliteMarkSaleSynced?: (options: {
    shopCode: string;
    clientBillId: string;
    serverBillId?: string | null;
  }) => Promise<{ ok: boolean; pending?: number }>;
  sqliteMarkSaleError?: (options: {
    shopCode: string;
    clientBillId: string;
    message: string;
    attempts: number;
  }) => Promise<{ ok: boolean; pending?: number }>;
  sqliteDeletePendingSale?: (options: {
    shopCode: string;
    clientBillId: string;
  }) => Promise<{ ok: boolean; deleted?: boolean; pending?: number }>;
  sqlitePendingCount?: (options: { shopCode: string }) => Promise<{ ok: boolean; pending: number }>;
  sqliteSaveAuthSession?: (options: { shopCode: string; session: unknown }) => Promise<{ ok: boolean }>;
  sqliteReadAuthSession?: (options: { shopCode: string }) => Promise<{ ok: boolean; session: any }>;
  sqliteListSales?: (options: Record<string, unknown>) => Promise<{
    ok: boolean;
    items: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>;
  sqliteGetSale?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; bill: any }>;
  sqliteSaveHeldBill?: (options: { shopCode: string; held: unknown }) => Promise<{ ok: boolean; id?: string }>;
  sqliteListHeldBills?: (options: { shopCode: string }) => Promise<{ ok: boolean; items: any[] }>;
  sqliteDeleteHeldBill?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean }>;
  sqliteDashboard?: (options: { shopCode: string }) => Promise<{ ok: boolean; data: any }>;
  sqliteSalesReport?: (options: Record<string, unknown>) => Promise<{ ok: boolean; data: any }>;
  sqliteEnqueueSync?: (options: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;
  sqliteListSyncQueue?: (options: { shopCode: string }) => Promise<{ ok: boolean; rows: any[] }>;
  sqliteReplaceJsonTable?: (options: {
    shopCode: string;
    table: string;
    rows: unknown[];
  }) => Promise<{ ok: boolean }>;
  sqliteListJsonTable?: (options: { shopCode: string; table: string }) => Promise<{ ok: boolean; items: any[] }>;
  sqliteSaveExpense?: (options: { shopCode: string; expense: unknown }) => Promise<{ ok: boolean }>;
  sqliteListExpenses?: (options: Record<string, unknown>) => Promise<{ ok: boolean; items: any[] }>;
  sqliteDeleteProduct?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; deleted?: boolean }>;
  sqliteDeleteCategory?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; deleted?: boolean; id?: string }>;
  sqliteDeleteBrand?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; deleted?: boolean; id?: string }>;
  sqliteDeleteCustomer?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; deleted?: boolean; id?: string }>;
  sqliteDeleteSupplier?: (options: { shopCode: string; id: string }) => Promise<{ ok: boolean; deleted?: boolean; id?: string }>;
  sqliteSetProductFavorite?: (options: { shopCode: string; id: string; isFavorite: boolean }) => Promise<{ ok: boolean; id: string; isFavorite: boolean }>;
  sqliteSetProductsFavoriteBulk?: (options: { shopCode: string; categoryId: string; isFavorite: boolean; brandId?: string | null }) => Promise<{ ok: boolean; updated: number; isFavorite: boolean }>;
  sqliteGetProductBarcodeStatus?: (options: { shopCode: string; productId: string }) => Promise<{ ok: boolean; data: any }>;
  sqliteGenerateBarcodes?: (options: { shopCode: string; variantIds: string[] }) => Promise<{ ok: boolean; data: any[] }>;
  sqliteEnsureQuantityBarcodes?: (options: { shopCode: string; items: { variantId: string; quantity: number }[] }) => Promise<{ ok: boolean; data: any[] }>;
  /** Extra local entity / report / sync-queue IPC (desktop offline). */
  [key: string]: any;
};

/** Present only inside the Electron app (exposed by desktop/preload.js) */
export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as { kdsDesktop?: DesktopBridge }).kdsDesktop;
  return bridge?.isDesktop ? bridge : null;
}
