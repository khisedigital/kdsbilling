export type ReportType =
  | 'daily_sales'
  | 'product_sales'
  | 'category_sales'
  | 'brand_sales'
  | 'profit'
  | 'purchase'
  | 'stock'
  | 'low_stock'
  | 'customer'
  | 'supplier'
  | 'gst'
  | 'expense'
  | 'cash_flow';

export type ReportConfig = {
  id: ReportType;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bg: string;
  group: 'Sales' | 'Inventory' | 'Finance' | 'People';
};

export const REPORTS: ReportConfig[] = [
  { id: 'daily_sales', title: 'Sales Report', subtitle: 'Bills, revenue & most sold product', icon: 'point-of-sale', color: '#5B6CFF', bg: '#EEF0FF', group: 'Sales' },
  { id: 'product_sales', title: 'Top Products', subtitle: 'Most sold products by quantity', icon: 'trophy-outline', color: '#0EA5A4', bg: '#E6FAFA', group: 'Sales' },
  { id: 'profit', title: 'Profit & Loss', subtitle: 'Revenue, cost, expenses & net profit', icon: 'chart-timeline-variant', color: '#10B981', bg: '#ECFDF5', group: 'Finance' },
  { id: 'category_sales', title: 'Category Sales', subtitle: 'Sales by product category', icon: 'folder-outline', color: '#F59E0B', bg: '#FEF7E6', group: 'Sales' },
  { id: 'brand_sales', title: 'Brand Sales', subtitle: 'Sales by brand', icon: 'tag-outline', color: '#8B5CF6', bg: '#F3E8FF', group: 'Sales' },
  { id: 'purchase', title: 'Purchase Report', subtitle: 'Supplier purchase bills', icon: 'truck-check', color: '#0EA5A4', bg: '#E6FAFA', group: 'Inventory' },
  { id: 'stock', title: 'Stock Report', subtitle: 'Current stock levels', icon: 'warehouse', color: '#5B6CFF', bg: '#EEF0FF', group: 'Inventory' },
  { id: 'low_stock', title: 'Low Stock Report', subtitle: 'Items at or below reorder level', icon: 'alert-outline', color: '#EF4444', bg: '#FEF2F2', group: 'Inventory' },
  { id: 'customer', title: 'Customer Report', subtitle: 'Top customers by spend', icon: 'account-group', color: '#5B6CFF', bg: '#EEF0FF', group: 'People' },
  { id: 'supplier', title: 'Supplier Report', subtitle: 'Purchases by supplier', icon: 'truck', color: '#0EA5A4', bg: '#E6FAFA', group: 'People' },
  { id: 'gst', title: 'GST Report', subtitle: 'Tax collected by type', icon: 'percent', color: '#F59E0B', bg: '#FEF7E6', group: 'Finance' },
  { id: 'expense', title: 'Expense Report', subtitle: 'Shop expenses by category', icon: 'cash-minus', color: '#EF4444', bg: '#FEF2F2', group: 'Finance' },
  { id: 'cash_flow', title: 'Cash Flow Report', subtitle: 'Money in vs money out', icon: 'swap-horizontal', color: '#10B981', bg: '#ECFDF5', group: 'Finance' },
];

export function getReportConfig(id: ReportType) {
  return REPORTS.find((report) => report.id === id);
}
