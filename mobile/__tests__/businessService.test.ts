import api from '../src/services/api';
import { fetchBill } from '../src/services/businessService';
import { isFullyLocalMode, localGetSale } from '../src/offline/localApi';
import { isOfflineNow } from '../src/offline/connectivityStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../src/services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock('../src/offline/localApi', () => ({
  isFullyLocalMode: jest.fn(),
  localGetSale: jest.fn(),
}));

jest.mock('../src/offline/connectivityStore', () => ({
  isOfflineNow: jest.fn(),
}));

const localBill = {
  id: 'local-bill',
  bill_number: 'OFF-001',
  status: 'completed',
  subtotal: 10,
  discount_amount: 0,
  tax_amount: 0,
  total_amount: 10,
  paid_amount: 10,
  change_amount: 0,
  items: [],
  sync_status: 'pending',
};

describe('fetchBill', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isFullyLocalMode).mockReturnValue(true);
    jest.mocked(isOfflineNow).mockReturnValue(false);
  });

  it('returns an unsynced local bill while online without requesting it from the server', async () => {
    jest.mocked(localGetSale).mockResolvedValue(localBill);

    await expect(fetchBill(localBill.id)).resolves.toEqual(localBill);

    expect(api.get).not.toHaveBeenCalled();
  });

  it('returns the local bill when the server has not found its synced record yet', async () => {
    jest.mocked(localGetSale).mockResolvedValue({ ...localBill, sync_status: 'synced' });
    jest.mocked(api.get).mockRejectedValue({ response: { status: 404 } });

    await expect(fetchBill(localBill.id)).resolves.toMatchObject({
      id: localBill.id,
      bill_number: localBill.bill_number,
    });
  });
});
