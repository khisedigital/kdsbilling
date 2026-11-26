jest.mock('../src/services/businessService', () => ({ createBill: jest.fn() }));
jest.mock('../src/services/catalogCache', () => ({
  applyCatalogPricePatches: jest.fn(), readCachedProducts: jest.fn(),
}));
jest.mock('../src/offline/capability', () => ({ isDesktopOfflineCapable: () => true }));
jest.mock('../src/offline/connectivityStore', () => ({
  isOfflineNow: () => true,
  useConnectivityStore: { getState: () => ({ setOnline: jest.fn() }) },
}));
jest.mock('../src/offline/outbox', () => ({ saveOutboxSale: jest.fn() }));
jest.mock('../src/offline/sqliteApi', () => ({
  hasSqliteBridge: () => true,
  sqliteGetMeta: jest.fn(),
}));

import { createSale } from '../src/offline/saleService';
import { saveOutboxSale } from '../src/offline/outbox';
import { sqliteGetMeta } from '../src/offline/sqliteApi';

const billId = '11111111-1111-4111-8111-111111111111';
const input = {
  items: [{ variantId: 'v1', productName: 'Tea', quantity: 1, unitPrice: 10 }],
  payments: [{ mode: 'cash', amount: 10 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(global, 'crypto', { value: { randomUUID: () => billId }, configurable: true });
});

it('saves the bill UUID, original number and stable device ID together', async () => {
  jest.mocked(sqliteGetMeta).mockResolvedValue('device-1');
  const result = await createSale(input);
  expect(result.bill).toEqual(expect.objectContaining({ id: billId, device_id: 'device-1' }));
  expect(result.bill.bill_number).toMatch(/^OFF-/);
  expect(saveOutboxSale).toHaveBeenCalledWith(expect.objectContaining({
    clientBillId: billId,
    bill: expect.objectContaining({ id: billId, bill_number: result.bill.bill_number, device_id: 'device-1' }),
  }));
});

it('does not save a desktop bill without a device identity', async () => {
  jest.mocked(sqliteGetMeta).mockResolvedValue(null);
  await expect(createSale(input)).rejects.toThrow('Restart the desktop app');
  expect(saveOutboxSale).not.toHaveBeenCalled();
});
