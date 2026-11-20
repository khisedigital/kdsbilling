import type { BillDetail } from '../services/businessService';
import { useConnectivityStore } from './connectivityStore';
import { offlineList, offlineRead, offlineRemove, offlineWrite } from './storage';
import {
  hasSqliteBridge,
  sqliteListPendingSales,
  sqliteMarkSaleError,
  sqliteMarkSaleSynced,
  sqlitePendingCount,
  sqliteSaveSale,
} from './sqliteApi';

export type OutboxSale = {
  clientBillId: string;
  createdAt: string;
  payload: Record<string, unknown>;
  bill: BillDetail;
  syncAttempts: number;
  lastError?: string;
};

function keyFor(clientBillId: string) {
  return `outbox/${clientBillId}`;
}

export async function listOutboxSales(): Promise<OutboxSale[]> {
  if (hasSqliteBridge()) {
    const rows = await sqliteListPendingSales();
    const mapped: OutboxSale[] = rows.map((row) => ({
      clientBillId: row.clientBillId,
      createdAt: row.createdAt,
      payload: row.payload,
      bill: row.bill as BillDetail,
      syncAttempts: row.syncAttempts || 0,
      lastError: row.lastError,
    }));
    useConnectivityStore.getState().setPendingCount(mapped.length);
    return mapped;
  }

  const keys = await offlineList('outbox');
  const rows: OutboxSale[] = [];
  for (const key of keys) {
    const row = await offlineRead<OutboxSale>(key);
    if (row?.clientBillId) rows.push(row);
  }
  rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  useConnectivityStore.getState().setPendingCount(rows.length);
  return rows;
}

export async function saveOutboxSale(sale: OutboxSale): Promise<void> {
  if (hasSqliteBridge()) {
    await sqliteSaveSale({
      clientBillId: sale.clientBillId,
      createdAt: sale.createdAt,
      payload: sale.payload,
      bill: sale.bill,
      syncStatus: 'pending',
      syncAttempts: sale.syncAttempts || 0,
      lastError: sale.lastError,
      skipStock: (sale.syncAttempts || 0) > 0, // stock already applied on first save
    });
    await refreshPendingCount();
    return;
  }
  await offlineWrite(keyFor(sale.clientBillId), sale);
  await listOutboxSales();
}

export async function removeOutboxSale(clientBillId: string, serverBillId?: string | null): Promise<void> {
  if (hasSqliteBridge()) {
    await sqliteMarkSaleSynced(clientBillId, serverBillId);
    await refreshPendingCount();
    return;
  }
  await offlineRemove(keyFor(clientBillId));
  await listOutboxSales();
}

export async function markOutboxSaleError(
  sale: OutboxSale,
  message: string,
): Promise<void> {
  const attempts = (sale.syncAttempts || 0) + 1;
  if (hasSqliteBridge()) {
    await sqliteMarkSaleError(sale.clientBillId, message, attempts);
    await refreshPendingCount();
    return;
  }
  await saveOutboxSale({ ...sale, syncAttempts: attempts, lastError: message });
}

export async function refreshPendingCount(): Promise<number> {
  if (hasSqliteBridge()) {
    const n = await sqlitePendingCount();
    useConnectivityStore.getState().setPendingCount(n);
    return n;
  }
  const rows = await listOutboxSales();
  return rows.length;
}
