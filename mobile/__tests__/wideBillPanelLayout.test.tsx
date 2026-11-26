import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { act, create } from 'react-test-renderer';
import WideBillPanel from '../src/screens/billing/WideBillPanel';
import { previewBillSmart } from '../src/offline/billPreview';
import { holdBill } from '../src/services/businessService';
import { useCartStore } from '../src/store/cartStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('react-native-paper', () => ({ Text: 'Text' }));
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), dispatch: jest.fn() }),
  CommonActions: { reset: jest.fn() },
}));
jest.mock('../src/print/receiptPrinter', () => ({ wakePrinterOnClick: jest.fn() }));
jest.mock('../src/print/printRequestQueue', () => ({ enqueueDraftPrint: jest.fn() }));
jest.mock('../src/offline/connectivityStore', () => ({
  useConnectivityStore: (selector: (state: { online: boolean }) => unknown) => selector({ online: true }),
}));
jest.mock('../src/offline/saleService', () => ({ createSale: jest.fn() }));
jest.mock('../src/offline/billPreview', () => ({
  previewBillSmart: jest.fn(async () => ({
    items: [{
      variantId: 'v1', productName: 'Tea', quantity: 1, unitPrice: 100,
      lineTotal: 110, taxes: [{ taxName: 'GST', ratePercent: 10, taxAmount: 10 }],
    }], subtotal: 100, taxAmount: 10, discountAmount: 5, exactTotal: 105, totalAmount: 105,
  })),
}));
jest.mock('../src/services/businessService', () => ({
  fetchCustomers: jest.fn(async () => ({ items: [] })),
  holdBill: jest.fn(),
  createCustomer: jest.fn(),
  deleteHeldBill: jest.fn(),
}));
const mockTranslate = (text: string) => text;
jest.mock('../src/i18n', () => ({ useT: () => mockTranslate }));

beforeEach(() => {
  useCartStore.getState().clear();
  useCartStore.getState().addItem({
    variantId: 'v1', productName: 'Tea', sku: 'TEA', quantity: 1, unitPrice: 100,
  });
});

it('keeps bill items visible and opens and closes customer and hold views from the desktop header', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<WideBillPanel fullWidth />);
  });
  expect(renderer!.root.findAllByProps({ children: 'Items' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ children: 'Product' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Customer' }).props.onPress());
  expect(renderer!.root.findAllByProps({ children: 'Use walk-in customer' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Back to bill' }).props.onPress());
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Hold bill' }).props.onPress());
  expect(renderer!.root.findAllByProps({ children: 'Hold this bill' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Back to bill' }).props.onPress());
  expect(renderer!.root.findAllByProps({ children: 'Product' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.unmount());
});

it('places totals beside payment on a wide desktop and keeps browser tabs', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<WideBillPanel fullWidth />);
  });
  const pane = renderer!.root.findAllByType(View)[0];
  await act(async () => pane.props.onLayout({ nativeEvent: { layout: { width: 900 } } }));
  const subtotal = renderer!.root.findByProps({ children: 'Subtotal' });
  const payment = renderer!.root.findByProps({ children: 'Pay with' });
  let ancestor = subtotal.parent;
  while (ancestor && !ancestor.findAll((node) => node === payment).length) ancestor = ancestor.parent;
  expect(StyleSheet.flatten(ancestor!.props.style).flexDirection).toBe('row');
  const paymentScroll = renderer!.root.findAllByType(ScrollView)
    .find((node) => node.findAll((child) => child === payment).length);
  expect(StyleSheet.flatten(paymentScroll!.props.style).flexGrow).toBe(1);
  expect(renderer!.root.findAllByProps({ children: 'Tax' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: 'Total tax' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: 'Discount' }).length).toBeGreaterThan(0);
  await act(async () => pane.props.onLayout({ nativeEvent: { layout: { width: 500 } } }));
  expect(StyleSheet.flatten(ancestor!.props.style)?.flexDirection).not.toBe('row');
  expect(renderer!.root.findAllByType(ScrollView).some((node) => node.props.horizontal)).toBe(true);
  await act(async () => renderer!.update(<WideBillPanel />));
  expect(renderer!.root.findAllByProps({ children: 'Items' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: 'Hold' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.unmount());
});

it('shows preview tax and tax-inclusive line totals, including tax-free discounted items', async () => {
  useCartStore.getState().addItem({
    variantId: 'v2', productName: 'Custom', sku: 'CUSTOM', quantity: 1, unitPrice: 30,
    discountAmount: 5, isCustom: true,
  });
  jest.mocked(previewBillSmart).mockResolvedValueOnce({
    items: [
      {
        variantId: 'v1', productName: 'Tea', quantity: 1, unitPrice: 100, lineTotal: 110,
        taxes: [
          { taxName: 'CGST', ratePercent: 5, taxAmount: 5 },
          { taxName: 'SGST', ratePercent: 5, taxAmount: 5 },
        ],
      },
      {
        variantId: 'v2', productName: 'Custom', quantity: 1, unitPrice: 30,
        discountAmount: 5, lineTotal: 25, taxes: [],
      },
    ],
    subtotal: 125, taxAmount: 10, discountAmount: 0, exactTotal: 135, totalAmount: 135,
  });
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<WideBillPanel fullWidth />);
  });
  expect(renderer!.root.findAllByProps({ children: '₹110.00' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: '₹25.00' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: '₹0.00' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: '₹10.00' }).length).toBe(2);
  expect(JSON.stringify(renderer!.toJSON())).toContain('CGST');
  await act(async () => renderer!.unmount());
});

it('does not show stale tax or line amounts while an updated preview is pending', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<WideBillPanel fullWidth />);
  });
  expect(renderer!.root.findAllByProps({ children: '₹110.00' }).length).toBeGreaterThan(0);
  let resolvePreview: (value: Awaited<ReturnType<typeof previewBillSmart>>) => void = () => {};
  jest.mocked(previewBillSmart).mockImplementationOnce(() => new Promise((resolve) => {
    resolvePreview = resolve;
  }));
  await act(async () => useCartStore.getState().updateQty('v1', 2));
  expect(renderer!.root.findAllByProps({ children: '₹110.00' })).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ children: '—' }).length).toBeGreaterThan(0);
  await act(async () => {
    resolvePreview({
      items: [{
        variantId: 'v1', productName: 'Tea', quantity: 2, unitPrice: 100,
        lineTotal: 220, taxes: [{ taxName: 'GST', ratePercent: 10, taxAmount: 20 }],
      }],
      subtotal: 200, taxAmount: 20, discountAmount: 0, exactTotal: 220, totalAmount: 220,
    });
  });
  expect(renderer!.root.findAllByProps({ children: '₹220.00' }).length).toBeGreaterThan(0);
  expect(renderer!.root.findAllByProps({ children: '₹20.00' }).length).toBe(2);
  await act(async () => renderer!.unmount());
});

it('holds the current bill from the desktop header', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<WideBillPanel fullWidth />);
  });
  await act(async () => renderer!.root.findByProps({ accessibilityLabel: 'Hold bill' }).props.onPress());
  const holdText = renderer!.root.findByProps({ children: 'Hold bill' });
  let holdButton = holdText.parent;
  while (holdButton && typeof holdButton.props.onPress !== 'function') holdButton = holdButton.parent;
  expect(holdButton).not.toBeNull();
  await act(async () => holdButton!.props.onPress());
  expect(holdBill).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ variantId: 'v1' })]) }),
    undefined,
  );
  expect(useCartStore.getState().items).toHaveLength(0);
  expect(renderer!.root.findAllByProps({ children: 'No items yet' }).length).toBeGreaterThan(0);
  await act(async () => renderer!.unmount());
});
