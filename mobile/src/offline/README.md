# Full local shop (desktop)

## Rule
SQLite is the live DB. Cloud updates **only when user taps Sync**.
The master-product import screen remains online and uses the existing live catalog.
Desktop product and pack searches read SQLite directly; product changes notify open screens to reload.

## Local modules
- Login (offline unlock after first online login)
- Billing, sales list/detail, hold/resume
- Customers + **credit / wallet ledger**
- Categories, brands, **product create/edit/delete**, price edits (queued)
- Purchases, suppliers, stock in/out/adjust
- Returns
- Expenses
- Daily closing preview + save
- Dashboard, sales / stock / **profit / GST / cash-flow** reports
- Sync queue for customers, expenses, holds, returns, purchases, products, stock, closings

## Sync (Settings → Sync Data) — two-way
1. **Push** pending sales + sync_queue in local creation order (this PC → live DB)
2. **Pull** products, brands, categories, customers, suppliers, shop settings, recent bills/expenses/returns (live DB → this PC, upsert)  
Mobile stays online-only; its changes live on the server and come down on pull.  
Header dot is status only.

## Notes
- A record rejected by the live server or one that cannot be safely mapped stays on this PC as **local-only**. Other records continue syncing; live stock and balances may therefore differ. Some records may have partially reached the server before failing. Connection, login, rate-limit and server failures stop sync and remain pending for retry. Bills with a client bill ID skipped specifically for a missing variant are retried on the next sync. Identity conflicts are not retried automatically, and manual reconciliation is not yet available.
- While local-only records exist, downloads only add missing records and do not overwrite existing local data. Barcode conflicts are reported rather than replacing local barcodes.
- Live purchase and stock-movement history is not downloaded; bill, expense and return downloads are limited to recent records.
- If a bill refers to a missing live variant, sync creates the variant and, if necessary, its product before retrying the bill. Stable IDs make creation retry-safe. Existing products are matched by identity or by matching product name, unit, variant options, SKU and barcode; conflicts are reported rather than merged. Pack barcodes are preserved. When the original opening stock is unknown, the newly created variant starts at zero; uploaded bills can make live stock negative and stock must be checked and adjusted manually.
- A newly created product whose variants are added or removed before its first sync cannot yet be synced safely; sync reports an error instead of risking incorrect stock.
- Variants added locally to an existing product may still require manual reconciliation if their live IDs cannot be matched.
- Desktop spreadsheet bulk import is unavailable; the online master-product import remains available.
- GST report uses bill tax totals (not full HSN breakup until tax lines are stored locally).  
- Customer ledger sync is stored locally; server push is best-effort / no-op if API has no ledger endpoint.  
- Deploy the updated API, including the unique client bill ID migration, before using missing-variant recovery. Rebuild the desktop UI and fully restart Electron to load the database bridge changes.
