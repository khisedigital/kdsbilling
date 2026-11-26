# Bill Printing Improvements - Implementation Summary

> Historical notes below are superseded for payment QR and spacing. Receipts now use
> the existing shop UPI ID (`upiId`, subject to `showUpi`) and the bill total.
> QR codes are generated locally for A4 and thermal printing, without an external
> QR service or new QR settings. No migration is needed for this feature.
> Zero, negative, and invalid totals do not produce a payment QR. Wide thermal
> receipts have spacing around the tax/total rows; 58 mm separates the grand total,
> and A4 totals have increased padding.

## Overview
Implemented comprehensive bill printing enhancements for the KDSPOZ retail billing system including improved tax display, logo handling, QR code support, and optimized spacing.

## Changes Implemented

### 1. ✅ Tax Alignment Below Product Name
**Files Modified:**
- `mobile/src/print/buildReceipt.ts`

**Changes:**
- Modified `tableRows()` function to accept optional `taxLines` parameter
- Added `formatItemTaxLines()` function to format tax details with proper indentation
- Tax lines now appear indented below product name instead of inline
- Tax details show as: `  Tax: GST (5%) Rs.50.00`

**Impact:**
- Cleaner receipt layout
- Tax information clearly associated with each item
- Improved readability on thermal printers

---

### 2. ✅ Remove Duplicate GST Percent
**Files Modified:**
- `mobile/src/print/buildReceipt.ts`

**Changes:**
- `itemTaxDetails()` function creates tax label with rate percentage included once
- Example: `GST (5%)` - percentage shown in label only, not repeated
- Prevents duplicate tax rate information on bills

**Impact:**
- Cleaner tax display
- No redundant information
- Professional appearance

---

### 3. ✅ Optimized & Standard Spacing
**Files Modified:**
- `mobile/src/print/buildReceipt.ts`

**Changes:**
- Removed inconsistent blank lines between sections on 48+ width printers
- Standardized spacing in totals section:
  - Subtotal
  - Discount (if applicable)
  - Tax
  - Round-off (if applicable)
  - TOTAL (with separator line)
- Payments section follows after totals line
- Consistent indentation for wrapped text

**Impact:**
- Professional bill appearance
- Better paper utilization
- Standard formatting across all paper sizes (58mm, 80mm, A4)

---

### 4. ✅ Logo Printing Based on Settings
**Files Modified:**
- `mobile/src/services/shopSettingsService.ts`
- `mobile/src/print/buildReceipt.ts`
- `api/src/models/tenant/index.js`
- `api/src/services/printService.js`

**Changes:**
- Added `showLogo` field to ShopSettings interface
- Added `show_logo` column to branches table (default: true)
- Updated buildA4Receipt to check `showLogo` flag before displaying logo
- Updated API's buildReceiptPayload to conditionally set logoUrl based on showLogo flag
- Logo display logic: `${showLogo && logoUrl ? ... : ''}`

**Database Migration:**
- Created: `20261125000001-add-bill-print-settings.js`
- Adds `show_logo` boolean column to branches table

**Impact:**
- Control logo visibility per branch
- Flexible bill customization
- UI can toggle logo on/off in settings

---

### 5. ✅ QR Code Printing Based on Settings
**Files Modified:**
- `mobile/src/print/qrCodeGenerator.ts` (NEW)
- `mobile/src/print/buildReceipt.ts`
- `api/src/models/tenant/index.js`
- `api/src/services/printService.js`
- `mobile/src/services/shopSettingsService.ts`

**Changes:**
- Added new `qrCodeGenerator.ts` utility with:
  - `generateQrCodeUrl()` - generates QR code using QR server API
  - `generatePaymentQrCode()` - creates payment QR with dynamic amount
  - `generateBillQrCode()` - creates bill reference QR
- Added configuration fields to ShopSettings:
  - `billQrCodeType`: 'none' | 'upi' | 'bill' | 'both'
  - `enablePaymentQr`: boolean
  - `paymentQrUpiId`: string
- Updated A4 receipt to display payment QR code when enabled
- Payment QR includes:
  - UPI ID from settings
  - Merchant name (shop name)
  - **Dynamic amount** (actual bill total)
  - Bill number as transaction note

**Database Changes:**
- Added columns to branches table:
  - `bill_qr_code_type` (ENUM: 'none', 'upi', 'bill', 'both')
  - `enable_payment_qr` (BOOLEAN, default: false)
  - `payment_qr_upi_id` (STRING)

**QR Code Implementation:**
- Uses free QR code API (api.qrserver.com)
- No additional npm dependencies required
- Supports dynamic amount for payment QR
- UPI format: `upi://pay?pa=UPI_ID&pn=SHOP_NAME&am=AMOUNT&tn=BILL_NO`

**Impact:**
- Customers can quickly scan to pay
- Amount is dynamic based on actual bill
- Flexible QR code configuration per branch

---

### 6. ✅ Dynamic Payment QR for Amount
**Files Modified:**
- `api/src/services/printService.js`
- `mobile/src/print/buildReceipt.ts`
- `mobile/src/print/qrCodeGenerator.ts`

**Changes:**
- Payment QR code now includes:
  - `am={bill.total_amount}` - dynamic amount from current bill
  - Calculations: `Math.round(parseFloat(bill.total_amount) * 100) / 100`
- Backend generates UPI string with amount: `paymentQrData` field in payload
- Mobile generates QR code URL with dynamic amount
- UPI payment string format includes:
  - Merchant UPI ID
  - Merchant name
  - **Exact bill amount**
  - Bill number for reference

**QR Generation:**
```javascript
// Mobile/API example
const amount = 450.75; // Actual bill total
const upiUrl = `upi://pay?pa=merchant@bank&pn=Shop%20Name&am=450.75&tn=INV-001`;
const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}`;
```

**Impact:**
- Customers pay exact bill amount
- No manual amount entry needed
- Reduces payment errors
- Professional payment experience

---

## Database Migration

**File:** `api/src/migrations/tenant/20261125000001-add-bill-print-settings.js`

**New Columns in `branches` table:**
```sql
- secondary_phone (STRING)
- show_logo (BOOLEAN, default: true)
- bill_qr_code_type (ENUM: 'none', 'upi', 'bill', 'both')
- enable_payment_qr (BOOLEAN, default: false)
- payment_qr_upi_id (STRING)
```

**Backward Compatible:**
- All new columns have sensible defaults
- Existing bills unaffected
- Migration is non-destructive

---

## UI Integration Points

The following settings need to be added to Shop Settings UI:

1. **Logo Display**
   - Toggle: "Show logo on bills"
   - Default: Enabled
   - Type: Boolean checkbox

2. **QR Code Type**
   - Dropdown: "Bill QR Code Type"
   - Options: None, UPI Payment, Bill Reference, Both
   - Default: None
   - Type: Select

3. **Payment QR Configuration**
   - Toggle: "Enable Payment QR Code"
   - Default: Disabled
   - Type: Boolean checkbox
   - UPI ID Input: "Payment UPI ID"
   - Placeholder: "merchant@bank"
   - Type: Text input
   - Conditional display: Show only when "Enable Payment QR" is true

---

## Technical Implementation Details

### Mobile (React Native/TypeScript)
- Uses `api.qrserver.com` for QR code generation
- No additional dependencies
- Synchronous QR URL generation
- Renders in A4 HTML template

### API (Node.js)
- Payment QR data prepared server-side
- Passed to client via receipt payload
- Backward compatible with existing integrations

### Print Formats Supported
- **58mm Thermal:** Text-based layout (QR code text reference)
- **80mm Thermal:** Enhanced text layout
- **A4/Office:** Full HTML with embedded QR code image

---

## Testing Recommendations

1. **Tax Alignment:**
   - Print bill with multiple tax items
   - Verify taxes appear below product name
   - Check 58mm and 80mm formats

2. **Logo Visibility:**
   - Toggle logo setting on/off
   - Print bills and verify display
   - Test with and without logo URL

3. **Payment QR:**
   - Set UPI ID and enable payment QR
   - Print bill at different amounts
   - Scan QR code and verify:
     - Correct UPI ID
     - Correct amount (dynamic)
     - Correct shop name
     - Correct bill reference

4. **Spacing:**
   - Print on all paper sizes (58mm, 80mm, A4)
   - Verify consistent formatting
   - Check totals section alignment

---

## Files Modified Summary

```
Mobile (React Native/TypeScript):
├── src/print/buildReceipt.ts ✅
├── src/print/qrCodeGenerator.ts ✅ (NEW)
└── src/services/shopSettingsService.ts ✅

API (Node.js):
├── src/services/printService.js ✅
├── src/models/tenant/index.js ✅
└── src/migrations/tenant/20261125000001-add-bill-print-settings.js ✅ (NEW)
```

---

## Deployment Checklist

- [ ] Run database migration: `npm run migrate:tenant`
- [ ] Update API services
- [ ] Deploy mobile app
- [ ] Update Shop Settings UI
- [ ] Test all print formats
- [ ] Verify QR code generation
- [ ] Test on actual printers (thermal and office)
- [ ] Document new settings in user guide

---

## Future Enhancements

1. **Local QR Generation:** Add `qrcode` npm package for offline QR generation
2. **Bill QR Code:** Generate QR linking to bill details page
3. **Barcode Format:** Support EAN/CODE128 barcodes
4. **Custom Fonts:** Support custom fonts for Marathi text on thermal printers
5. **Receipt Templates:** Allow custom receipt template design per business

---

## Notes

- All changes are backward compatible
- Existing bills continue to work without modification
- New settings default to maintain existing behavior
- QR code generation uses free API (no authentication required)
- No additional npm dependencies added to mobile or API
