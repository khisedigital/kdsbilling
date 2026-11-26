# Bill Print Improvements - Test Plan

> Historical test cases below for QR settings and QR service are obsolete. Set the
> existing shop UPI ID, print and scan A4, 58 mm, and 80 mm receipts, and verify
> the ID and exact bill total. Repeat with a different total, no ID, `showUpi`
> disabled, and zero/invalid totals. QR generation must work offline. Test physical
> printers as well as print previews.

## 1. Tax Alignment Below Product Name Test

### Test Case 1.1: Single Tax Item
**Setup:**
- Product: "Coffee" (₹100)
- Tax: GST 5% (₹5)
- Paper sizes: 58mm, 80mm, A4

**Expected Output:**
```
COFFEE                     1    100.00    100.00
  Tax: GST (5%) Rs.5.00
```

**Verification:**
- [ ] Tax appears on separate indented line
- [ ] Tax is below product name, not on same line
- [ ] All paper sizes display correctly
- [ ] Mobile app: Verify buildThermalReceipt output
- [ ] API: Verify backend print service output

---

### Test Case 1.2: Multiple Tax Items
**Setup:**
- Product: "Electronics" (₹1000)
- Taxes:
  - CGST 9% (₹90)
  - SGST 9% (₹90)

**Expected Output:**
```
ELECTRONICS              1   1000.00  1000.00
  Tax: CGST (9%) Rs.90.00
  Tax: SGST (9%) Rs.90.00
```

**Verification:**
- [ ] Multiple taxes display correctly
- [ ] Each tax on separate indented line
- [ ] No duplicate GST percentage
- [ ] Proper wrapping on narrow paper

---

### Test Case 1.3: Tax Wrapping
**Setup:**
- Product: Very long product name
- Paper: 58mm (narrow)
- Multiple taxes

**Expected Output:**
```
PROD                     1    100.00    100.00
NAME CONT
INUED
  Tax: GST (5%) Rs.5.00
```

**Verification:**
- [ ] Product name wraps properly
- [ ] Tax appears after all wrapped lines
- [ ] No text overlap

---

## 2. Remove Duplicate GST Percent Test

### Test Case 2.1: GST Display Format
**Setup:**
- Product: "Shirt" (₹500)
- Tax: GST 18% (₹90)

**Expected Output (CORRECT):**
```
Tax: GST (18%) Rs.90.00
```

**NOT Expected (WRONG):**
```
Tax: GST (18%) 18% Rs.90.00  ❌ Duplicate percent
Tax: GST 18% (18%) Rs.90.00  ❌ Duplicate percent
```

**Verification:**
- [ ] Percentage shown exactly once in tax label
- [ ] Format: "Tax: NAME (PERCENT%) Rs.AMOUNT"
- [ ] No duplicate percentages anywhere on bill

---

### Test Case 2.2: Multiple Taxes No Duplication
**Setup:**
- Product with 2 taxes: CGST 9%, SGST 9%

**Expected Output:**
```
Tax: CGST (9%) Rs.45.00
Tax: SGST (9%) Rs.45.00
```

**Verification:**
- [ ] Each tax shows percent once only
- [ ] No redundant percentage displays

---

## 3. Optimized & Standard Spacing Test

### Test Case 3.1: Totals Section Spacing (80mm+)
**Setup:**
- Full bill with discount and round-off
- Paper: 80mm

**Expected Output:**
```
Subtotal                                  1000.00
Discount                                   -100.00
Tax                                         162.00
Round off                                     +0.50
==================================================
TOTAL                                     1062.50
--------------------------------------------------
```

**Verification:**
- [ ] No blank lines between subtotal and discount
- [ ] No blank lines between discount and tax
- [ ] Single blank line after tax totals section
- [ ] Clean separator before TOTAL
- [ ] Consistent spacing across all sections

---

### Test Case 3.2: Payment Section Spacing
**Setup:**
- Multiple payment modes (Cash + Card)
- UPI ID configured

**Expected Output:**
```
--------------------------------------------------
CASH                                       600.00
CARD                                       462.50
UPI ID                           merchant@bank
--------------------------------------------------
Total saving                                 50.00
==================================================
```

**Verification:**
- [ ] Proper spacing between sections
- [ ] Payment modes clearly separated
- [ ] No excessive blank lines

---

### Test Case 3.3: Narrow Paper (58mm) Spacing
**Setup:**
- Paper: 58mm
- Full bill

**Expected Output:**
```
Subtotal           1000.00
Discount           -100.00
Tax                 162.00
Round off            +0.50
=============================
TOTAL             1062.50
-----------------------------
```

**Verification:**
- [ ] Text fits without wrapping awkwardly
- [ ] Values right-aligned properly
- [ ] No excessive spacing in narrow format

---

## 4. Logo Printing Based on Settings Test

### Test Case 4.1: Logo Display ON
**Setup:**
- Logo URL set
- showLogo = true (default)

**Expected Output:**
- Logo appears at top of receipt
- Logo size: max 56px height, 200px width
- Logo centered

**Verification:**
- [ ] Mobile: `buildA4Receipt` shows logo
- [ ] API: `showLogo` field is true in payload
- [ ] Logo dimensions correct
- [ ] A4 format displays logo
- [ ] No logo on 58/80mm thermal (text only)

---

### Test Case 4.2: Logo Display OFF
**Setup:**
- Logo URL set
- showLogo = false (disabled in settings)

**Expected Output:**
- Logo NOT displayed
- Receipt starts with shop name instead

**Verification:**
- [ ] Mobile: Check `showLogo !== false` logic
- [ ] API: Check conditional logoUrl setting
- [ ] Logo completely hidden
- [ ] No space reserved for logo

---

### Test Case 4.3: No Logo URL
**Setup:**
- Logo URL not configured
- showLogo = true (default)

**Expected Output:**
- No logo displayed
- No error
- Receipt displays normally

**Verification:**
- [ ] No broken image placeholder
- [ ] No errors in console
- [ ] Receipt layout unaffected

---

## 5. QR Code Printing Based on Settings Test

### Test Case 5.1: Payment QR Enabled
**Setup:**
- enablePaymentQr = true
- paymentQrUpiId = "merchant@bank"
- Paper: A4

**Expected Output:**
- Payment QR code appears above footer
- QR size: 150x150px
- Label: "Pay Now"
- Border around QR

**Verification:**
- [ ] QR visible on A4 format
- [ ] QR image loads correctly
- [ ] QR has border styling
- [ ] "Pay Now" label present
- [ ] QR appears after payment section

---

### Test Case 5.2: Payment QR Disabled
**Setup:**
- enablePaymentQr = false (default)

**Expected Output:**
- No QR code displayed
- No space reserved
- Normal footer

**Verification:**
- [ ] No QR code on receipt
- [ ] No "Pay Now" label
- [ ] Bill displays normally

---

### Test Case 5.3: QR Type Selection
**Setup:**
- billQrCodeType = 'upi' (payment only)
- billQrCodeType = 'bill' (bill reference - future)
- billQrCodeType = 'both' (both types - future)

**Current Implementation (UPI only):**
- [ ] 'upi' and 'both' types show payment QR
- [ ] 'none' and 'bill' types hide QR

---

## 6. Dynamic Payment QR for Amount Test

### Test Case 6.1: Correct Amount Encoding
**Setup:**
- Bill total: ₹450.75
- UPI ID: merchant@bank
- Shop name: "Retail Store"

**Expected QR Data:**
```
upi://pay?pa=merchant%40bank&pn=Retail%20Store&am=450.75&tn=INV-001
```

**Verification:**
- [ ] Amount in QR matches bill total exactly
- [ ] Amount precision: 2 decimal places
- [ ] UPI ID properly encoded
- [ ] Shop name URL-encoded
- [ ] Bill number included as transaction note

---

### Test Case 6.2: Different Amounts Generate Different QR
**Setup:**
- Bill 1: ₹100.00
- Bill 2: ₹250.50
- Bill 3: ₹1000.00

**Verification:**
- [ ] Each bill generates unique QR
- [ ] QR code visually different for different amounts
- [ ] Scanning each QR shows correct amount

---

### Test Case 6.3: QR Scannability
**Setup:**
- Print receipt with payment QR
- Use mobile phone to scan

**Verification:**
- [ ] QR code scans successfully
- [ ] UPI app opens (or payment prompt)
- [ ] Amount pre-filled in UPI app
- [ ] Merchant name displayed
- [ ] Transaction note shows bill number

---

### Test Case 6.4: Rounding Calculations
**Setup:**
- Bill amounts with various decimals:
  - 100.149 → 100.15
  - 100.145 → 100.15 (banker's rounding)
  - 100.4999 → 100.50

**Expected QR:**
- Properly rounded amount in UPI string
- 2 decimal places maximum
- Banker's rounding applied

**Verification:**
- [ ] Amount rounding correct
- [ ] No floating-point errors
- [ ] API and Mobile QR match

---

## 7. Integration Tests

### Test Case 7.1: Complete Receipt Flow
**Setup:**
- Multi-item bill with:
  - 2 products with different taxes
  - Discount applied
  - Multiple payment modes
  - All settings enabled (logo, payment QR)

**Verification:**
- [ ] Tax alignment correct
- [ ] No duplicate percentages
- [ ] Proper spacing throughout
- [ ] Logo displays
- [ ] Payment QR with correct amount
- [ ] All sections visible and readable

---

### Test Case 7.2: Cross-Format Consistency
**Setup:**
- Same bill printed in 3 formats:
  - 58mm thermal
  - 80mm thermal
  - A4

**Verification:**
- [ ] Tax alignment correct in all
- [ ] Spacing consistent
- [ ] Logo visible on A4, hidden on thermal
- [ ] QR visible on A4, hidden on thermal
- [ ] Text wrapping appropriate for each format

---

### Test Case 7.3: Marathi Bill
**Setup:**
- Bill language: Marathi
- Same test setup as 7.1

**Verification:**
- [ ] Marathi text displays correctly
- [ ] Tax labels in Marathi
- [ ] QR code works with Marathi shop name
- [ ] Spacing unchanged

---

## 8. Edge Cases

### Test Case 8.1: Very Long Product Name
**Setup:**
- Product: "Very long product description that exceeds typical width"
- 58mm paper

**Verification:**
- [ ] Product name wraps properly
- [ ] Tax indentation maintained
- [ ] No text overlap

---

### Test Case 8.2: Zero Tax
**Setup:**
- Product: Exempt item (₹100, tax ₹0)

**Expected Output:**
```
EXEMPT ITEM              1    100.00    100.00
```

**Verification:**
- [ ] No tax line displayed for zero tax
- [ ] No "Tax: Rs.0.00" appears

---

### Test Case 8.3: Large Bill Amount
**Setup:**
- Bill total: ₹99,999.99

**Expected QR:**
```
...&am=99999.99&...
```

**Verification:**
- [ ] Amount encodes correctly
- [ ] QR scans successfully
- [ ] UPI app handles large amount

---

### Test Case 8.4: Special Characters in Shop Name
**Setup:**
- Shop name: "Joe's & Co. Limited"

**Expected QR:**
```
...&pn=Joe%27s%20%26%20Co.%20Limited&...
```

**Verification:**
- [ ] Special characters URL-encoded
- [ ] QR encodes correctly
- [ ] UPI app displays shop name correctly

---

## 9. Browser Testing (A4 Format)

### Test Case 9.1: Print Preview
**Setup:**
- Open bill print preview in browser
- Use print dialog

**Verification:**
- [ ] Logo displays in preview
- [ ] QR code visible in preview
- [ ] Spacing correct in preview
- [ ] No formatting issues

---

### Test Case 9.2: PDF Generation
**Setup:**
- Print to PDF from browser

**Verification:**
- [ ] PDF contains all elements
- [ ] Logo embedded in PDF
- [ ] QR code embedded in PDF
- [ ] PDF readable and printable

---

## 10. Performance Tests

### Test Case 10.1: QR Generation Performance
**Setup:**
- Print 10 bills rapidly
- Measure QR code generation time

**Verification:**
- [ ] No significant delay in bill printing
- [ ] QR API responds quickly
- [ ] Fallback if API unavailable

---

### Test Case 10.2: Large Bill Processing
**Setup:**
- Bill with 50+ items
- Multiple tax lines per item

**Verification:**
- [ ] Bill renders completely
- [ ] No formatting breaks
- [ ] QR still displays correctly

---

## Sign-off Checklist

**Development:**
- [ ] All code changes reviewed
- [ ] No syntax errors
- [ ] No breaking changes
- [ ] Backward compatible

**Testing:**
- [ ] All test cases pass
- [ ] Cross-platform verified (Android, iOS, Web, Desktop)
- [ ] All paper sizes tested
- [ ] Both English and Marathi verified

**QA:**
- [ ] Regression testing passed
- [ ] No new issues introduced
- [ ] Performance acceptable
- [ ] User documentation updated

**Deployment:**
- [ ] Database migration reviewed
- [ ] Migration script tested on staging
- [ ] Rollback plan documented
- [ ] Release notes prepared

---

## Notes

- QR code generation uses public API (api.qrserver.com)
- No additional dependencies required
- All changes backward compatible
- Mobile app can function offline except for QR code generation
- API changes don't affect existing bill records
