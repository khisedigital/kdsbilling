jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  enqueueDraftPrint,
  enqueueSavedPrint,
  getFailedPrintCount,
  getFailedPrintJobs,
  retryFailedPrints,
  clearFailedPrints,
  setPromptHandlerForTest,
  subscribePrintQueue,
} from '../src/print/printRequestQueue';
import * as receiptPrinter from '../src/print/receiptPrinter';
import type { BillDetail } from '../src/services/businessService';

jest.mock('../src/print/receiptPrinter', () => ({
  printDraftReceipt: jest.fn(),
  printReceipt: jest.fn(),
}));

const mockDraftBill: BillDetail = {
  id: 'bill-123',
  bill_number: 'BILL-001',
  customer_id: null,
  customer_name: 'Walk-in',
  customer_phone: null,
  subtotal: 100,
  tax_amount: 5,
  discount_amount: 0,
  round_off: 0,
  total_amount: 105,
  payment_mode: 'cash',
  status: 'completed',
  created_at: new Date().toISOString(),
  items: [
    {
      id: 'item-1',
      variant_id: 'v1',
      product_name: 'Chai',
      quantity: 2,
      unit_price: 50,
      total_amount: 100,
      tax_rate: 5,
      tax_amount: 5,
      discount_amount: 0,
    },
  ],
  payments: [{ mode: 'cash', amount: 105 }],
};

describe('printRequestQueue Thermal Print Failure Recovery', () => {
  beforeEach(() => {
    clearFailedPrints();
    setPromptHandlerForTest(null);
    jest.clearAllMocks();
  });

  it('prints successfully without adding to failed queue', async () => {
    (receiptPrinter.printDraftReceipt as jest.Mock).mockResolvedValueOnce({ ok: true });

    await enqueueDraftPrint(mockDraftBill);

    expect(receiptPrinter.printDraftReceipt).toHaveBeenCalledTimes(1);
    expect(getFailedPrintCount()).toBe(0);
  });

  it('retains failed slip in retry queue when cashier chooses "later"', async () => {
    (receiptPrinter.printDraftReceipt as jest.Mock).mockRejectedValueOnce(
      new Error('Printer out of paper'),
    );

    let promptCalled = false;
    setPromptHandlerForTest(async (_job, err) => {
      promptCalled = true;
      expect((err as Error).message).toBe('Printer out of paper');
      return 'later';
    });

    await enqueueDraftPrint(mockDraftBill);

    expect(promptCalled).toBe(true);
    expect(getFailedPrintCount()).toBe(1);
    const failedList = getFailedPrintJobs();
    expect(failedList[0].kind).toBe('draft');
    expect(failedList[0].error).toBe('Printer out of paper');
    expect(failedList[0].bill?.bill_number).toBe('BILL-001');
  });

  it('retries and succeeds when cashier chooses "retry"', async () => {
    let callCount = 0;
    (receiptPrinter.printDraftReceipt as jest.Mock).mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Bluetooth disconnected');
      }
      return { ok: true };
    });

    let retryPromptCount = 0;
    setPromptHandlerForTest(async () => {
      retryPromptCount += 1;
      return 'retry';
    });

    await enqueueDraftPrint(mockDraftBill);

    expect(callCount).toBe(2);
    expect(retryPromptCount).toBe(1);
    // After successful retry, the job should not remain in failed queue
    expect(getFailedPrintCount()).toBe(0);
  });

  it('re-attempts failed slips when retryFailedPrints() is called', async () => {
    // First, let print fail and be postponed
    (receiptPrinter.printReceipt as jest.Mock).mockRejectedValueOnce(
      new Error('Thermal head open'),
    );

    setPromptHandlerForTest(async () => 'later');

    await enqueueSavedPrint('bill-saved-999');

    expect(getFailedPrintCount()).toBe(1);
    expect(getFailedPrintJobs()[0].billId).toBe('bill-saved-999');

    // Now printer is fixed: mock resolves
    (receiptPrinter.printReceipt as jest.Mock).mockResolvedValueOnce({ ok: true });

    await retryFailedPrints();

    expect(getFailedPrintCount()).toBe(0);
  });

  it('clears failed slips on clearFailedPrints()', async () => {
    (receiptPrinter.printDraftReceipt as jest.Mock).mockRejectedValueOnce(
      new Error('Paper jam'),
    );

    setPromptHandlerForTest(async () => 'later');
    await enqueueDraftPrint(mockDraftBill);

    expect(getFailedPrintCount()).toBe(1);
    clearFailedPrints();
    expect(getFailedPrintCount()).toBe(0);
  });

  it('notifies subscribers on pending and failed count changes', async () => {
    const subscriber = jest.fn();
    const unsub = subscribePrintQueue(subscriber);

    (receiptPrinter.printDraftReceipt as jest.Mock).mockRejectedValueOnce(
      new Error('Cover open'),
    );
    setPromptHandlerForTest(async () => 'later');

    await enqueueDraftPrint(mockDraftBill);

    expect(subscriber).toHaveBeenCalled();
    unsub();
  });
});
