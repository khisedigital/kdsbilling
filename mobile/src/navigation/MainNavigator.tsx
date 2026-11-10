import React from 'react';
import { Platform, StatusBar } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { colors } from '../theme/colors';
import { getReportConfig, type ReportType } from '../reports/reportConfig';
import AppHeader from './AppHeader';
import DashboardScreen from '../screens/DashboardScreen';
import ProductListScreen from '../screens/products/ProductListScreen';
import ImportMasterProductsScreen from '../screens/products/ImportMasterProductsScreen';
import ProductDetailScreen from '../screens/products/ProductDetailScreen';
import ProductFormScreen from '../screens/products/ProductFormScreen';
import PriceManagementScreen from '../screens/products/PriceManagementScreen';
import CategoryListScreen from '../screens/products/CategoryListScreen';
import BrandListScreen from '../screens/products/BrandListScreen';
import StockListScreen from '../screens/inventory/StockListScreen';
import StockHistoryScreen from '../screens/inventory/StockHistoryScreen';
import StockOperationScreen from '../screens/inventory/StockOperationScreen';
import StockTransferScreen from '../screens/inventory/StockTransferScreen';
import SupplierListScreen from '../screens/inventory/SupplierListScreen';
import PurchaseBillListScreen from '../screens/inventory/PurchaseBillListScreen';
import PurchaseBillDetailScreen from '../screens/inventory/PurchaseBillDetailScreen';
import PurchaseBillFormScreen from '../screens/inventory/PurchaseBillFormScreen';
import BillingScreen from '../screens/billing/BillingScreen';
import PaymentScreen from '../screens/billing/PaymentScreen';
import HoldBillScreen from '../screens/billing/HoldBillScreen';
import HeldBillsScreen from '../screens/billing/HeldBillsScreen';
import SalesListScreen from '../screens/billing/SalesListScreen';
import SaleDetailScreen from '../screens/billing/SaleDetailScreen';
import CustomerListScreen from '../screens/customers/CustomerListScreen';
import ReportsScreen from '../screens/reports/ReportsScreen';
import ReportDetailScreen from '../screens/reports/ReportDetailScreen';
import ExpensesScreen from '../screens/expenses/ExpensesScreen';
import DailyClosingScreen from '../screens/closing/DailyClosingScreen';
import ReturnScreen from '../screens/returns/ReturnScreen';
import ReturnsListScreen from '../screens/returns/ReturnsListScreen';
import BarcodeScannerScreen from '../screens/billing/BarcodeScannerScreen';
import PrinterSettingsScreen from '../screens/settings/PrinterSettingsScreen';
import PrintLabelScreen from '../screens/labels/PrintLabelScreen';
import BarcodeLabelScreen from '../screens/labels/BarcodeLabelScreen';
import ProfileScreen from '../screens/settings/ProfileScreen';
import ShopSettingsScreen from '../screens/settings/ShopSettingsScreen';
import IntegrationsScreen from '../screens/settings/IntegrationsScreen';
import ShopifyIntegrationScreen from '../screens/settings/ShopifyIntegrationScreen';

export type MainStackParamList = {
  Dashboard: undefined;
  Billing: { fresh?: boolean } | undefined;
  BarcodeScanner: undefined;
  Profile: undefined;
  ShopSettings: undefined;
  PrinterSettings: undefined;
  PrintLabel: undefined;
  BarcodeLabel: undefined;
  Integrations: undefined;
  ShopifyIntegration: undefined;
  Payment: undefined;
  HoldBill: undefined;
  HeldBills: undefined;
  SalesList: undefined;
  SaleDetail: { billId: string; fromSale?: boolean };
  ReturnsList: undefined;
  Return: { billId?: string };
  ProductList: undefined;
  ImportMasterProducts: undefined;
  ProductDetail: { productId: string };
  ProductForm: { productId?: string } | undefined;
  PriceManagement: undefined;
  CategoryList: undefined;
  BrandList: undefined;
  StockList: undefined;
  StockHistory: { productId?: string; productName?: string } | undefined;
  StockOperation: {
    mode?: 'opening' | 'in' | 'out' | 'adjust' | 'damage';
    variantId?: string;
    productId?: string;
    productName?: string;
    sku?: string;
    size?: string | null;
    color?: string | null;
    stockQty?: number;
    uomCode?: string;
  };
  StockTransfer: undefined;
  SupplierList: undefined;
  PurchaseBillList: undefined;
  PurchaseBillDetail: { billId: string };
  PurchaseBillForm: { supplierId?: string };
  CustomerList: { pickForBill?: boolean } | undefined;
  Reports: undefined;
  ReportDetail: { reportType: ReportType };
  Expenses: undefined;
  DailyClosing: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

const screenTitles: Partial<Record<keyof MainStackParamList, string>> = {
  Dashboard: 'Dashboard',
  Billing: 'New Bill',
  BarcodeScanner: 'Scan Barcode',
  Profile: 'My Profile',
  ShopSettings: 'Shop & Bill Settings',
  PrinterSettings: 'Billing Printer',
  PrintLabel: 'Print Label',
  BarcodeLabel: 'Barcode label',
  Integrations: 'Integrations',
  ShopifyIntegration: 'Shopify',
  Payment: 'Payment',
  HoldBill: 'Hold Bill',
  HeldBills: 'Held Bills',
  SalesList: 'Sales',
  SaleDetail: 'Bill Detail',
  ReturnsList: 'Credit notes',
  Return: 'New return',
  CustomerList: 'Customers',
  Reports: 'Reports',
  ReportDetail: 'Report',
  Expenses: 'Expenses',
  DailyClosing: 'Close Register',
  ProductList: 'Products',
  ImportMasterProducts: 'Import products',
  ProductDetail: 'Product Details',
  ProductForm: 'Add Product',
  PriceManagement: 'Price Management',
  CategoryList: 'Categories',
  BrandList: 'Brands',
  StockList: 'Stock',
  StockHistory: 'Stock History',
  StockOperation: 'Stock Operation',
  StockTransfer: 'Transfer Stock',
  SupplierList: 'Suppliers',
  PurchaseBillList: 'Purchase Bills',
  PurchaseBillDetail: 'Purchase Detail',
  PurchaseBillForm: 'Purchase Entry',
};

export default function MainNavigator() {
  return (
    <>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={colors.surface}
        translucent={Platform.OS === 'android'}
      />
      <Stack.Navigator
        screenOptions={({ route }) => {
          const params = route.params as {
            productId?: string;
            reportType?: ReportType;
            fromSale?: boolean;
            mode?: string;
            pickForBill?: boolean;
          } | undefined;
          const title =
            route.name === 'ProductForm'
              ? (params?.productId ? 'Edit Product' : 'Add Product')
              : route.name === 'ReportDetail'
                ? (getReportConfig(params?.reportType as ReportType)?.title || 'Report')
              : route.name === 'SaleDetail' && params?.fromSale
                ? 'Bill preview'
              : route.name === 'StockOperation'
                ? (params?.mode === 'opening' ? 'Opening Stock' : 'Stock Operation')
              : route.name === 'StockHistory' && params?.productName
                ? 'Product history'
              : route.name === 'CustomerList' && params?.pickForBill
                ? 'Select customer'
              : screenTitles[route.name as keyof MainStackParamList] || route.name;
          return {
            header: () => <AppHeader title={title} />,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          };
        }}>
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Billing" component={BillingScreen} />
        <Stack.Screen name="BarcodeScanner" component={BarcodeScannerScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="ShopSettings" component={ShopSettingsScreen} />
        <Stack.Screen name="PrinterSettings" component={PrinterSettingsScreen} />
        {/* Labels: Android Microlan Bluetooth, or desktop USB ESC/POS. */}
        {Platform.OS === 'android' ? (
          <Stack.Screen name="PrintLabel" component={PrintLabelScreen} />
        ) : null}
        {Platform.OS === 'android' || Platform.OS === 'web' ? (
          <Stack.Screen name="BarcodeLabel" component={BarcodeLabelScreen} />
        ) : null}
        <Stack.Screen name="Integrations" component={IntegrationsScreen} />
        <Stack.Screen name="ShopifyIntegration" component={ShopifyIntegrationScreen} />
        <Stack.Screen name="Payment" component={PaymentScreen} />
        <Stack.Screen name="HoldBill" component={HoldBillScreen} />
        <Stack.Screen name="HeldBills" component={HeldBillsScreen} />
        <Stack.Screen name="SalesList" component={SalesListScreen} />
        <Stack.Screen name="SaleDetail" component={SaleDetailScreen} />
        <Stack.Screen name="ReturnsList" component={ReturnsListScreen} />
        <Stack.Screen name="Return" component={ReturnScreen} />
        <Stack.Screen name="CustomerList" component={CustomerListScreen} />
        <Stack.Screen name="Reports" component={ReportsScreen} />
        <Stack.Screen name="ReportDetail" component={ReportDetailScreen} />
        <Stack.Screen name="Expenses" component={ExpensesScreen} />
        <Stack.Screen name="DailyClosing" component={DailyClosingScreen} />
        <Stack.Screen name="ProductList" component={ProductListScreen} />
        <Stack.Screen name="ImportMasterProducts" component={ImportMasterProductsScreen} />
        <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
        <Stack.Screen
          name="ProductForm"
          component={ProductFormScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="PriceManagement" component={PriceManagementScreen} />
        <Stack.Screen name="CategoryList" component={CategoryListScreen} />
        <Stack.Screen name="BrandList" component={BrandListScreen} />
        <Stack.Screen name="StockList" component={StockListScreen} />
        <Stack.Screen name="StockHistory" component={StockHistoryScreen} />
        <Stack.Screen name="StockOperation" component={StockOperationScreen} />
        <Stack.Screen name="StockTransfer" component={StockTransferScreen} />
        <Stack.Screen name="SupplierList" component={SupplierListScreen} />
        <Stack.Screen name="PurchaseBillList" component={PurchaseBillListScreen} />
        <Stack.Screen name="PurchaseBillDetail" component={PurchaseBillDetailScreen} />
        <Stack.Screen name="PurchaseBillForm" component={PurchaseBillFormScreen} />
      </Stack.Navigator>
    </>
  );
}
