# Billing POS

Multi-tenant SaaS billing and POS platform for kirana shops, textile stores, and similar retail businesses.

## Stack

| Layer | Technology |
|---|---|
| Mobile | React Native CLI (Android, iOS) |
| UI | React Native Paper (Material Design 3) |
| API | Express.js |
| ORM | Sequelize |
| Database | MySQL 8 (master + per-tenant DB) |
| Auth | JWT (shop code + email + password) |

## Project Structure

```
billing-poz/
├── api/          Express API + Sequelize (standalone)
├── mobile/       React Native app (standalone)
└── docs/         Deployment guide
```

`api` and `mobile` are **independent projects**. Each has its own `package.json` and `node_modules`. There is no shared npm workspace at the root.

## Prerequisites

- Node.js 20+
- MySQL 8.0
- React Native dev environment (Android Studio / Xcode)
- CocoaPods (iOS)

## Setup

### 1. Install dependencies

```bash
cd api && npm install
cd ../mobile && npm install
cd ../mobile/ios && pod install   # iOS only
```

### 2. Configure API environment

```bash
cp api/.env.example api/.env
# Edit api/.env with your MySQL credentials
```

### 3. Create master database

```bash
cd api && npm run setup:master-db
```

Or manually:

```bash
mysql -u root -p -e "CREATE DATABASE billing_master CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 4. Run master migrations

```bash
cd api && npm run migrate:master
```

### 5. Provision demo tenant

```bash
cd api && npm run provision:tenant
```

This creates:
- Tenant DB: `billing_tenant_demo_kirana`
- Shop code: `demo-kirana`
- Email: `owner@demo.com`
- Password: `Owner@123`
- PIN: `1234`

### 6. Start API

```bash
cd api && npm run dev
```

API runs at `http://localhost:3000`

### 7. Start mobile app

```bash
cd mobile && npm start
# In another terminal:
cd mobile && npm run android
# or
cd mobile && npm run ios
```

### Upgrade existing tenant (Phase 2+)

If you already provisioned a tenant before Phase 2:

```bash
cd api
TENANT_DB_NAME=billing_tenant_demo_kirana npm run migrate:tenant
TENANT_DB_NAME=billing_tenant_demo_kirana npm run seed:tenant
```

Phase 3 adds migration `20260103000001-create-inventory-tables.js` — run migrate after Phase 2.

Phase 4–8 adds migration `20260104000001-create-billing-business-tables.js` and seeder `20260104000001-default-business-data.js`.

## API Endpoints

### Auth (Phase 1)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/v1/auth/login` | Login with shop code |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Logout |
| POST | `/api/v1/auth/pin-verify` | Verify user PIN |
| GET | `/api/v1/auth/me` | Current user (auth required) |

### Platform Admin API

All routes require header `x-platform-key: <PLATFORM_ADMIN_PASSWORD>`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/v1/platform/auth/verify` | Verify platform key |
| GET | `/api/v1/platform/dashboard` | Tenant stats |
| GET | `/api/v1/platform/tenants` | List tenants |
| POST | `/api/v1/platform/tenants` | Create tenant |
| GET | `/api/v1/platform/tenants/:id` | Tenant detail |
| PATCH | `/api/v1/platform/tenants/:id` | Update status, plan, subscription |
| GET | `/api/v1/platform/tenants/:id/catalog-meta` | Units, categories for product form |
| GET | `/api/v1/platform/tenants/:id/products` | List tenant products |
| POST | `/api/v1/platform/tenants/:id/products` | Create product in tenant |
| PATCH | `/api/v1/platform/tenants/:id/products/:productId` | Update product |
| DELETE | `/api/v1/platform/tenants/:id/products/:productId` | Delete product |

## Platform Admin Panel (Web)

Browser UI to manage tenants, subscriptions, and products.

1. Start API: `cd api && npm run dev`
2. Run master migration (once): `npm run migrate:master`
3. Open: **http://localhost:3000/admin** (production: **https://khisedigital.info/kdspozr/admin**)
4. Sign in with platform key from `api/.env` → `PLATFORM_ADMIN_PASSWORD` (default: `Admin@123`)

**What you can do:**
- **Dashboard** — tenant counts by status and plan
- **Tenants** — create shops, set status (trial/active/suspended), plan (free/basic/standard/premium/enterprise), trial & subscription end dates, limits
- **Products** — pick a tenant, list/add/delete their catalog products

### Catalog (Phase 2)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/units` | List units of measure |
| GET | `/api/v1/tax-groups` | List global tax groups |
| GET/POST | `/api/v1/categories` | List / create categories |
| PUT/DELETE | `/api/v1/categories/:id` | Update / delete category |
| GET/POST | `/api/v1/brands` | List / create brands |
| PUT/DELETE | `/api/v1/brands/:id` | Update / delete brand |
| GET | `/api/v1/products` | List products (paginated) |
| POST | `/api/v1/products` | Create product + variants |
| GET | `/api/v1/products/:id` | Product detail |
| PUT | `/api/v1/products/:id` | Update product |
| DELETE | `/api/v1/products/:id` | Soft delete product |
| GET | `/api/v1/products/search?q=` | Search by name, SKU, barcode |
| POST | `/api/v1/products/bulk-import` | Bulk import JSON rows |
| POST | `/api/v1/products/:id/images` | Upload product image |
| DELETE | `/api/v1/products/:id/images/:imageId` | Delete image |

### Inventory (Phase 3)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/branches` | List active branches |
| GET | `/api/v1/stock/balances` | Stock balances by branch |
| GET | `/api/v1/stock/history` | Stock ledger history |
| POST | `/api/v1/stock/opening` | Opening stock entry |
| POST | `/api/v1/stock/in` | Manual stock in |
| POST | `/api/v1/stock/out` | Manual stock out |
| POST | `/api/v1/stock/adjust` | Stock adjustment (+/-) |
| POST | `/api/v1/stock/damage` | Damaged stock write-off |
| POST | `/api/v1/stock/transfer` | Inter-branch transfer |
| GET | `/api/v1/stock/transfers` | List transfers |
| GET/POST | `/api/v1/suppliers` | Supplier CRUD |
| GET/POST | `/api/v1/purchases/bills` | Purchase bills (auto stock in) |
| GET/POST | `/api/v1/purchases/orders` | Purchase orders |
| POST | `/api/v1/purchases/orders/:id/receive` | Receive PO → bill + stock |

### Stock movement example

```bash
curl -X POST http://localhost:3000/api/v1/stock/opening \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "variantId": "<variant-uuid>", "quantity": 100, "unitCost": 80 }
    ],
    "notes": "Opening stock Jan 2026"
  }'
```

### Login example

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "shopCode": "demo-kirana",
    "email": "owner@demo.com",
    "password": "Owner@123"
  }'
```

### Bulk import example

```bash
curl -X POST http://localhost:3000/api/v1/products/bulk-import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "rows": [
      {
        "name": "Basmati Rice",
        "category": "Grocery",
        "brand": "India Gate",
        "uom": "kg",
        "isWeightBased": true,
        "costPrice": 80,
        "sellingPrice": 95,
        "barcode": "8901001001001"
      },
      {
        "name": "Cotton Shirt",
        "category": "Textile",
        "uom": "pcs",
        "sellingPrice": 599,
        "variants": [
          { "size": "M", "color": "Blue", "sellingPrice": 599, "barcode": "SHIRT-M-BLU" },
          { "size": "L", "color": "Blue", "sellingPrice": 599, "barcode": "SHIRT-L-BLU" }
        ]
      }
    ]
  }'
```

### Provision new tenant

```bash
curl -X POST http://localhost:3000/api/v1/platform/tenants \
  -H "Content-Type: application/json" \
  -H "x-platform-key: Admin@123" \
  -d '{
    "name": "Mumbai Textiles",
    "slug": "mumbai-textiles",
    "ownerName": "Rajesh",
    "ownerEmail": "rajesh@textiles.com",
    "ownerPassword": "Owner@123",
    "countryCode": "IN",
    "currencyCode": "INR"
  }'
```

## Multi-Tenant Architecture

- **Master DB** (`billing_master`): tenant registry, login routing
- **Tenant DB** (`billing_tenant_<slug>`): branches, users, products, bills, stock
- **Single login URL**: shop code identifies the tenant database
- **JWT** carries `tenantId`, `branchId`, `role`, `permissions`

## Phase 1 Delivered

- [x] Monorepo structure
- [x] Express API with Sequelize
- [x] Master + tenant database separation
- [x] Tenant provisioning script
- [x] Auth (login, logout, refresh, PIN verify)
- [x] RBAC roles & permissions seeded
- [x] Multi-branch support
- [x] Units of measure (weight/volume/count/length)
- [x] React Native CLI app with login + dashboard

## Phase 2 Delivered

- [x] Global tax system (jurisdictions, tax groups, components)
- [x] Categories (hierarchical) & brands CRUD
- [x] Products with variants (size, color, SKU)
- [x] Barcode per variant
- [x] Cost price, selling price, MRP, wholesale price
- [x] Weight-based / decimal quantity flags
- [x] Product search (name, SKU, barcode)
- [x] Bulk import API
- [x] Product image upload (local storage)
- [x] Mobile: product list, add form, categories, brands

## Phase 3 Delivered

- [x] Immutable stock ledger (all movement types)
- [x] Stock balances per branch + variant
- [x] Opening stock, stock in/out, adjustment, damage
- [x] Inter-branch stock transfer
- [x] Suppliers CRUD
- [x] Purchase bills with automatic stock in
- [x] Purchase orders with receive flow
- [x] Low stock filter on balances
- [x] Mobile: stock list, history, operations, transfer, purchases

## Phase 4 Delivered — Billing

- [x] Bill preview with global tax calculation
- [x] Create bill with stock deduction (SALE movement)
- [x] Split payments (cash, UPI, card, credit, store credit)
- [x] Item & bill discounts, offers
- [x] Hold / resume bills
- [x] Void bill with stock reversal
- [x] Print receipts (58mm, 80mm, A4 templates)
- [x] Bill number sequencing per branch/day
- [x] Mobile: billing screen, payment, held bills, sales list

## Phase 5 Delivered — Customers

- [x] Customer CRUD
- [x] Loyalty points (earn on sale)
- [x] Store credit balance & ledger
- [x] Purchase history
- [x] Mobile: customer list

## Phase 6 Delivered — Returns

- [x] Return against original bill
- [x] Cash refund or store credit
- [x] Stock restock on return
- [x] Mobile: return screen from sales

## Phase 7 Delivered — Reports & Dashboard

- [x] Live dashboard (today/month sales, orders, profit, low stock)
- [x] Sales report
- [x] Product sales report
- [x] GST/tax report
- [x] Stock report
- [x] Expense report
- [x] Mobile: dashboard stats, reports screen

## Phase 8 Delivered — Expenses, Offers, Closing

- [x] Expense categories (seeded)
- [x] Daily expense entry
- [x] Offers (percent/flat off, seeded)
- [x] Daily cash closing with variance
- [x] Printer config table (58mm/80mm/A4)
- [x] Mobile: expenses, daily closing

## All Phases Complete

The MVP billing POS is feature-complete across all 8 phases.

## Mobile API URL

- **Development:** Android emulator `10.0.2.2:3000`, iOS `localhost:3000`
- **Production:** `https://khisedigital.info/kdspozr/api/v1` (`PRODUCTION_API_URL` in `mobile/src/config/env.ts`)
- **Per-device override:** App → Printer Settings → Server URL

## Bluetooth Printing

1. Pair thermal printer in device Bluetooth settings
2. App → **Printer Settings** → Scan Bluetooth → select printer
3. Choose **58mm** or **80mm** paper
4. **Test Print** to verify
5. Receipts auto-print after payment (or Reprint from Sales)

Uses ESC/POS via `react-native-thermal-receipt-printer`.

## Barcode Scanner

- Billing screen → barcode FAB opens camera scanner
- Supports EAN-13, EAN-8, Code 128, Code 39, UPC, QR
- Scanned code looks up product and adds to cart

Requires camera permission (configured in AndroidManifest / Info.plist).

## Network & A4 Printing

| Type | How |
|---|---|
| **Network thermal** | Printer Settings → Network → `IP:9100` |
| **Server network print** | Register printer via `POST /api/v1/printers`, API sends ESC/POS |
| **A4** | Printer Settings → A4 → share HTML to system print / AirPrint |

## Production Deployment

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for full guide:

- MySQL setup
- PM2 cluster (`pm2 start ecosystem.config.js` from repo root)
- Nginx + SSL (`deploy/nginx.conf.example`)
- Environment template (`api/.env.production.example`)
- Android/iOS release builds
- Backup scripts

Quick start:

```bash
cp api/.env.production.example api/.env
cd api && npm install && npm run migrate:master
pm2 start ecosystem.config.js
```
