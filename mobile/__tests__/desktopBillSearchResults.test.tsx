import React from 'react';
import { act, create } from 'react-test-renderer';
import DesktopBillSearchResults, { desktopSearchKeyAction } from '../src/screens/billing/DesktopBillSearchResults';
import type { SearchProductResult } from '../src/services/catalogService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('react-native-paper', () => ({ Text: 'Text' }));
const mockTranslate = (text: string, values?: { name?: string }) =>
  text.replace('{{name}}', values?.name || '');
jest.mock('../src/i18n', () => ({ useT: () => mockTranslate }));

it('passes the complete selected pack result to the billing handler', async () => {
  const product: SearchProductResult = {
    variantId: 'v1',
    productId: 'p1',
    productName: 'Tea',
    sku: 'TEA',
    sellingPrice: 20,
    scannedQuantity: 6,
  };
  const onSelect = jest.fn();
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <DesktopBillSearchResults items={[product]} loading={false} selectedIndex={-1} onSelect={onSelect} />,
    );
  });
  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: 'Add Tea' }).props.onPress();
  });
  expect(onSelect).toHaveBeenCalledWith(product);
  expect(onSelect.mock.calls[0][0].scannedQuantity).toBe(6);
  await act(async () => renderer!.unmount());
});

it('shows search errors instead of a no-results message', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <DesktopBillSearchResults items={[]} loading={false} error="Database unavailable" selectedIndex={-1} onSelect={jest.fn()} />,
    );
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain('Database unavailable');
  expect(JSON.stringify(renderer!.toJSON())).not.toContain('No matching products');
  await act(async () => renderer!.unmount());
});

it('marks only the keyboard-selected result as selected', async () => {
  const products: SearchProductResult[] = [
    { variantId: 'v1', productId: 'p1', productName: 'Tea', sku: 'TEA', sellingPrice: 20 },
    { variantId: 'v2', productId: 'p2', productName: 'Coffee', sku: 'COFFEE', sellingPrice: 30 },
  ];
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <DesktopBillSearchResults items={products} loading={false} selectedIndex={1} onSelect={jest.fn()} />,
    );
  });
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Add Tea' }).props.accessibilityState.selected).toBe(false);
  expect(renderer!.root.findByProps({ accessibilityLabel: 'Add Coffee' }).props.accessibilityState.selected).toBe(true);
  await act(async () => renderer!.unmount());
});

it('navigates and selects available results with the keyboard', () => {
  const products: SearchProductResult[] = [
    { variantId: 'v1', productId: 'p1', productName: 'Tea', sku: 'TEA', sellingPrice: 20 },
    { variantId: 'v2', productId: 'p2', productName: 'Coffee', sku: 'COFFEE', sellingPrice: 30, scannedQuantity: 6 },
  ];
  const state = { available: true, results: products, selectedIndex: -1 };
  expect(desktopSearchKeyAction('ArrowDown', state)).toEqual({ index: 0 });
  expect(desktopSearchKeyAction('ArrowUp', state)).toEqual({ index: 1 });
  expect(desktopSearchKeyAction('ArrowDown', { ...state, selectedIndex: 1 })).toEqual({ index: 1 });
  expect(desktopSearchKeyAction('ArrowUp', { ...state, selectedIndex: 0 })).toEqual({ index: 0 });
  expect(desktopSearchKeyAction('Enter', { ...state, selectedIndex: 1 })).toEqual({ product: products[1] });
  expect(desktopSearchKeyAction('Enter', state)).toBeNull();
  expect(desktopSearchKeyAction('Enter', { ...state, available: false, selectedIndex: 0 })).toBeNull();
  expect(desktopSearchKeyAction('ArrowDown', { ...state, results: [] })).toBeNull();
});
