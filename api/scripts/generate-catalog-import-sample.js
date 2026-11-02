#!/usr/bin/env node
const path = require('path');
const XLSX = require('xlsx');

const headers = [
  'name',
  'sellingPrice',
  'costPrice',
  'mrp',
  'uom',
  'category',
  'sku',
  'barcode',
  'description',
  'sortOrder',
  'businessTypeCode',
];

const rows = [
  ['Wheat Flour 1kg', 42, 35, 48, 'kg', 'Grocery', 'KIR-FLOUR-1KG', '8901001002001', 'Whole wheat atta', 5, 'kirana'],
  ['Tea 250g', 120, 95, 140, 'pcs', 'Grocery', 'KIR-TEA-250', '8901001002002', 'Premium leaf tea', 6, 'kirana'],
  ['Mineral Water 1L', 20, 14, 25, 'pcs', 'Beverages', 'KIR-WATER-1L', '8901001002003', 'Packaged drinking water', 7, 'kirana'],
  ['Idli Sambar', 60, 30, 70, 'pcs', 'Food Items', 'RST-IDLI', '', 'South Indian combo', 3, 'restaurant'],
  ['Paneer Butter Masala', 220, 130, 250, 'pcs', 'Food Items', 'RST-PBM', '', 'North Indian curry', 4, 'restaurant'],
];

const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
sheet['!cols'] = headers.map((h) => ({ wch: Math.max(h.length, 16) }));

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, 'CatalogProducts');

const outPath = path.join(__dirname, '../public/admin/samples/catalog-product-import-sample.xlsx');
XLSX.writeFile(workbook, outPath);
console.log('Created', outPath);
