/**
 * Builds KDSPOZ-User-Guide.docx with feature screenshots.
 * Run: node build-user-guide.js
 */
const fs = require('fs');
const path = require('path');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
  AlignmentType,
  PageBreak,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
} = require('docx');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'screenshots');
const OUT = path.join(ROOT, 'KDSPOZ-User-Guide.docx');

function img(file, width = 540, height = 304) {
  const full = path.join(SHOTS, file);
  if (!fs.existsSync(full)) throw new Error(`Missing screenshot: ${file}`);
  return new ImageRun({
    type: 'jpg',
    data: fs.readFileSync(full),
    transformation: { width, height },
    altText: { title: file, description: file, name: file },
  });
}

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 280, after: 160 },
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 120 },
  });
}

function p(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 22, font: 'Calibri' })],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 80 },
    indent: { left: 360 },
    children: [new TextRun({ text: `•  ${text}`, size: 22, font: 'Calibri' })],
  });
}

function caption(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 200 },
    children: [new TextRun({ text, italics: true, size: 18, color: '666666', font: 'Calibri' })],
  });
}

function shot(file, captionText) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [img(file)],
    }),
    caption(captionText),
  ];
}

function tip(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: '0F766E' },
    },
    indent: { left: 120 },
    children: [
      new TextRun({ text: 'Tip: ', bold: true, size: 22, color: '0F766E', font: 'Calibri' }),
      new TextRun({ text, size: 22, font: 'Calibri' }),
    ],
  });
}

async function main() {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 120 },
      children: [new TextRun({ text: 'KDSPOZ', bold: true, size: 56, color: '0F766E', font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({ text: 'Retail Billing & Inventory', size: 28, color: '334155', font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: 'User Guide', bold: true, size: 40, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `Version 1.0  ·  ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          size: 20,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: 'How to use billing, purchase, stock, products and barcode labels',
          size: 20,
          color: '64748B',
          font: 'Calibri',
        }),
      ],
    }),

    new Paragraph({ children: [new PageBreak()] }),

    h1('1. Introduction'),
    p('KDSPOZ is a retail point-of-sale and inventory system for shops. This guide explains the main day-to-day features with screenshots.'),
    p('You can use KDSPOZ on:'),
    bullet('Desktop app (recommended for billing printers and label printers)'),
    bullet('Android / tablet for counter billing and stock'),
    p('Main modules covered in this guide:'),
    bullet('Login'),
    bullet('Billing (sales)'),
    bullet('Purchase Entry'),
    bullet('Add Stock'),
    bullet('Products & variants'),
    bullet('Barcode label printing'),
    bullet('Printer setup'),

    h1('2. Login'),
    p('Open the KDSPOZ app and sign in with your shop user account.'),
    bullet('Enter your phone / username and password'),
    bullet('Tap Login'),
    bullet('After login you land on the dashboard / menu'),
    ...shot('01-login.jpg', 'Figure 1 — Login screen'),
    tip('If login fails, check internet / server connection and ask the admin to reset your password.'),

    h1('3. Billing (Sales)'),
    h2('3.1 Open Billing'),
    p('From the menu open Billing. On a wide desktop screen you see products on the left and the bill panel on the right.'),
    ...shot('02-billing.jpg', 'Figure 2 — Billing screen with product grid and bill panel'),

    h2('3.2 Add products to the bill'),
    bullet('Search by name, SKU or scan a barcode'),
    bullet('Tap a product tile to add it'),
    bullet('For weight / decimal items, enter the quantity when asked'),
    bullet('Items appear in the bill table: Product | Rate | Qty | Amount'),

    h2('3.3 Edit quantity inline'),
    p('You do not need a popup to change qty. In the Qty column:'),
    bullet('Tap − or + to step the quantity'),
    bullet('Or type the quantity directly in the box and press Enter / leave the field'),
    ...shot('03-billing-qty.jpg', 'Figure 3 — Inline quantity editing on the bill table'),
    tip('Quantity is saved when you finish typing (blur). This keeps payment split / round-off stable while you type.'),

    h2('3.4 Take payment'),
    bullet('Choose payment mode: Cash, UPI, Card, Credit, etc.'),
    bullet('Optional: bill discount, round off, or split payment'),
    bullet('Tap Print for a receipt (if a billing printer is set)'),
    bullet('Tap Complete to save the sale and clear the cart'),

    h1('4. Purchase Entry'),
    p('Use Purchase Entry when you buy stock from a supplier. Stock increases for each purchased size/variant.'),
    ...shot('04-purchase.jpg', 'Figure 4 — Purchase Entry overview'),

    h2('4.1 Select supplier'),
    bullet('Choose an existing supplier chip, or tap Add to create one'),

    h2('4.2 Add products (with variants)'),
    bullet('Search the product by name / SKU / barcode'),
    bullet('If the product has sizes, all active variants open inline (no popup)'),
    bullet('Enter Qty and Purchase ₹ for each size you are buying (leave 0 to skip)'),
    bullet('Tap Add to purchase'),
    ...shot('05-purchase-variants.jpg', 'Figure 5 — Inline variant qty & purchase price'),

    h2('4.3 Add a new size while purchasing'),
    bullet('On the inline variant panel tap Add variant'),
    bullet('Enter Size (required), optional Colour, Selling price, Qty and Purchase ₹'),
    bullet('Add to purchase — the new size is marked New'),
    bullet('When you Save purchase, KDSPOZ creates that size on the product, then posts stock'),
    tip('Existing stock of other sizes is not split or changed when you add a new size from purchase.'),

    h2('4.4 Save purchase'),
    bullet('Review purchase items and totals'),
    bullet('Tap Save purchase & stock in'),
    bullet('Stock movements (PURCHASE_IN) are created per variant'),

    h1('5. Add Stock'),
    p('Use Add Stock for manual stock-in without a purchase bill (opening, damage, adjust, remove).'),
    ...shot('06-add-stock.jpg', 'Figure 6 — Add Stock with per-size quantities'),
    bullet('Choose mode: Add / Remove / Adjust / Damage (or Opening)'),
    bullet('Search and select a product'),
    bullet('If it has variants, all active sizes appear with qty fields'),
    bullet('Enter qty only for sizes you want to change, then save'),
    tip('Printing labels never changes stock. Only stock / purchase / sale screens do.'),

    h1('6. Products & variants'),
    p('Create or edit products from the Products menu.'),
    ...shot('07-product-form.jpg', 'Figure 7 — Product form with multiple sizes'),
    bullet('Enter product name, category, brand, unit'),
    bullet('Enable multiple sizes / variants when needed'),
    bullet('For each size enter selling price, optional MRP, cost and barcode'),
    bullet('When multiple sizes exist, pricing and stock are kept per size — not on the parent product'),
    tip('Every sellable size should have its own barcode for billing and labels.'),

    h1('7. Barcode label printing'),
    p('Open Barcode Labels to print 50 × 25 mm sticker labels.'),
    ...shot('08-barcode-labels.jpg', 'Figure 8 — Label screen with variant barcode status'),

    h2('7.1 Select product & variants'),
    bullet('Search and select a product'),
    bullet('All active variants are listed with barcode status: Available / Missing / Duplicate'),
    bullet('Select the sizes to print (Select all / Select none)'),
    bullet('Set Labels quantity per size'),
    bullet('Preview updates live — barcodes are never auto-created during preview'),

    h2('7.2 Generate missing barcodes'),
    bullet('If some sizes show Missing, or a barcode starts with KDSPOZ, tap Generate number barcodes'),
    bullet('KDSPOZ creates unique number-only barcodes (EAN-13) for missing sizes so scanners can read them'),
    bullet('Existing manufacturer barcodes are never overwritten'),

    h2('7.3 Print'),
    bullet('Connect / select the Label printer (separate from the billing printer)'),
    bullet('Tap Print — one label is printed per selected size using that size’s barcode'),
    bullet('Use Reprint last labels if you need the same job again'),
    tip('Label printing does not change inventory or prices.'),

    h1('8. Printers'),
    p('KDSPOZ keeps billing and label printers separate so receipt and sticker jobs do not mix.'),
    ...shot('09-printers.jpg', 'Figure 9 — Billing printer vs Label printer'),
    bullet('Billing printer — receipts from the Billing screen'),
    bullet('Label printer — 50×25 mm stickers from Barcode Labels'),
    bullet('On desktop, choose the USB / system printer for each role'),
    bullet('On Android, pair the Bluetooth label printer for labels'),

    h1('9. Quick checklist'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        headerRow(['Task', 'Where']),
        row(['Sell items & edit qty', 'Billing']),
        row(['Buy stock from supplier', 'Purchase Entry']),
        row(['Add a new size while buying', 'Purchase → Add variant → Save']),
        row(['Manual stock adjust', 'Add Stock']),
        row(['Create product with sizes', 'Products']),
        row(['Print price / barcode stickers', 'Barcode Labels']),
        row(['Set receipt vs sticker printer', 'Printer settings / Label screen']),
      ],
    }),

    h1('10. Support notes'),
    bullet('Always finish an open variant panel on Purchase before saving the bill'),
    bullet('Inactive sizes do not appear in normal label / purchase selection'),
    bullet('If a barcode shows Duplicate, fix the product barcode before printing that size'),
    bullet('For training, practice on a test product before using live stock'),
  ];

  const doc = new Document({
    creator: 'KDSPOZ',
    title: 'KDSPOZ User Guide',
    description: 'End-user guide for KDSPOZ billing, purchase, stock and label printing',
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(OUT, buffer);
  console.log(`Wrote ${OUT}`);
}

function headerRow(cells) {
  return new TableRow({
    children: cells.map(
      (text) =>
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.CLEAR, fill: '0F766E' },
          children: [
            new Paragraph({
              children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 20, font: 'Calibri' })],
            }),
          ],
        }),
    ),
  });
}

function row(cells) {
  return new TableRow({
    children: cells.map(
      (text) =>
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [new TextRun({ text, size: 20, font: 'Calibri' })],
            }),
          ],
        }),
    ),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
