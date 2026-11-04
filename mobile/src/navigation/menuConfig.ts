import { Platform } from 'react-native';
import type { MainStackParamList } from './MainNavigator';

export type MenuScreen = keyof MainStackParamList;

export interface MenuItem {
  label: string;
  icon: string;
  screen: MenuScreen;
  params?: MainStackParamList[MenuScreen];
  highlight?: boolean;
  /** When set, item is only shown on these platforms. */
  platforms?: Array<'android' | 'ios' | 'web' | 'macos' | 'windows'>;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

/** Gap-label: Android Microlan Bluetooth, or desktop USB ESC/POS. */
const LABEL_PLATFORMS: MenuItem['platforms'] = ['android', 'web'];

const rawMenuSections: MenuSection[] = [
  {
    title: 'Billing',
    items: [
      { label: 'New Bill', icon: 'point-of-sale', screen: 'Billing', params: { fresh: true } },
      { label: 'Sales', icon: 'receipt', screen: 'SalesList' },
      { label: 'Held Bills', icon: 'pause-circle-outline', screen: 'HeldBills' },
      { label: 'Returns', icon: 'keyboard-return', screen: 'ReturnsList' },
    ],
  },
  {
    title: 'Catalog',
    items: [
      { label: 'Products', icon: 'package-variant', screen: 'ProductList' },
      { label: 'Categories', icon: 'shape-outline', screen: 'CategoryList' },
      { label: 'Brands', icon: 'tag-outline', screen: 'BrandList' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Stock', icon: 'warehouse', screen: 'StockList' },
      { label: 'Stock History', icon: 'history', screen: 'StockHistory' },
      { label: 'Opening Stock', icon: 'archive-plus-outline', screen: 'StockOperation', params: { mode: 'opening' } },
      { label: 'Purchase Bills', icon: 'file-document-outline', screen: 'PurchaseBillList' },
      { label: 'Suppliers', icon: 'truck-delivery-outline', screen: 'SupplierList' },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Customers', icon: 'account-group-outline', screen: 'CustomerList' },
      { label: 'Reports', icon: 'chart-bar', screen: 'Reports' },
      { label: 'Expenses', icon: 'cash-minus', screen: 'Expenses' },
      { label: 'Daily Closing', icon: 'calendar-check-outline', screen: 'DailyClosing' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'My Profile', icon: 'account-circle-outline', screen: 'Profile' },
      { label: 'Shop & Bill Settings', icon: 'storefront-outline', screen: 'ShopSettings' },
      { label: 'Billing Printer', icon: 'printer-outline', screen: 'PrinterSettings' },
      { label: 'Barcode label', icon: 'barcode', screen: 'BarcodeLabel', platforms: LABEL_PLATFORMS },
      // Hidden for now — older Android gap-label screen; Barcode label covers desktop + Android.
      // { label: 'Print Label', icon: 'barcode', screen: 'PrintLabel', platforms: ['android'] },
      { label: 'Integrations', icon: 'puzzle-outline', screen: 'Integrations' },
    ],
  },
];

function isItemVisible(item: MenuItem): boolean {
  if (!item.platforms?.length) return true;
  return item.platforms.includes(Platform.OS as NonNullable<MenuItem['platforms']>[number]);
}

export const menuSections: MenuSection[] = rawMenuSections
  .map((section) => ({
    ...section,
    items: section.items.filter(isItemVisible),
  }))
  .filter((section) => section.items.length > 0);

export const allMenuItems = menuSections.flatMap((section) => section.items);
