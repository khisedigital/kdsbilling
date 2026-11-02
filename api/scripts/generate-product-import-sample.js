#!/usr/bin/env node
const path = require('path');
const XLSX = require('xlsx');

const headers = [
  'name',
  'sellingPrice',
  'costPrice',
  'mrp',
  'wholesalePrice',
  'reorderLevel',
  'uom',
  'category',
  'brand',
  'sku',
  'barcode',
  'taxCode',
  'description',
];

const rows = [
  ['Rice 1kg', 60, 50, 65, '', '', 'kg', 'Grocery', 'Acme', 'SKU-RICE', '8901234567890', '', 'Premium basmati rice'],
  ['Sugar 1kg', 45, 38, 50, '', '', 'kg', 'Grocery', '', '', '', '', 'White crystal sugar'],
  ['Cola 600ml', 35, 28, 40, '', '', 'ml', 'Beverages', 'Coca', 'SKU-COLA', '8901234567891', '', 'Soft drink bottle'],
  ['Notebook A4', 25, 18, 30, 22, 10, 'pcs', 'Stationery', 'Classmate', 'NB-A4', '8901234567892', '', '200 pages ruled'],
  ['Cooking Oil 1L', 120, 100, 135, '', '', 'ltr', 'Grocery', '', 'OIL-1L', '8901234567893', '', 'Refined sunflower oil'],
];

const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
sheet['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 14) }));

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'Products');

const outPath = path.join(__dirname, '../public/admin/samples/product-import-sample.xlsx');
XLSX.writeFile(workbook, outPath);
console.log('Created', outPath);
