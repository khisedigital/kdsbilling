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
1. **Push** pending sales + sync_queue in local creation order (this PC → live DB). Before a sale or retry-safe stock movement, verify its product and variant identities; a referenced product may be created first.
2. **Pull** products, brands, categories, customers, suppliers, shop settings, recent bills/expenses/returns (live DB → this PC, upsert)  
Mobile stays online-only; its changes live on the server and come down on pull.  
Header dot is status only.

## Notes
- A record rejected by the live server or one that cannot be safely mapped stays on this PC as **local-only**. Other records continue syncing; live stock and balances may therefore differ. Some records may have partially reached the server before failing. Connection, login, rate-limit and server failures stop sync and remain pending for retry. Bills with a client bill ID skipped specifically for a missing variant are retried on the next sync. Identity conflicts are not retried automatically, and manual reconciliation is not yet available.
- The sync screen shows counts rather than error details; recorded sync errors remain available internally.
- New offline bills keep their UUID, displayed bill number and per-shop device ID when uploaded. Different devices may have the same displayed number. The server rejects a reused UUID with different data and refuses a bill when the live calculation differs from the original offline totals. Bills uploaded by an older sync implementation with a different server identity require manual reconciliation.
- New manual stock movements and their queue entries are saved in one SQLite transaction. The live server applies each movement once using its client ID; an interrupted acknowledgment can be retried. Older queued movements lack this guarantee and remain local-only for manual review rather than being uploaded blindly.
- Product and bulk edits containing absolute stock quantities are kept local-only rather than overwriting live stock. Automatic conversion of these edits to movements is not yet implemented.
- Catalog downloads preserve existing local stock quantities and retain local product IDs. Consequently, live stock changes are not automatically reflected in an existing local balance; separate live-stock display and stock reconciliation are not yet implemented. Pending local changes force catalog downloads into add-only mode.
- While local-only records exist, downloads only add missing records and do not overwrite existing local data. Barcode conflicts are reported rather than replacing local barcodes.
- Live purchase and stock-movement history is not downloaded; bill, expense and return downloads are limited to recent records. Catalog downloads are still full snapshots, not an incremental change feed.
- Product creation and bill/stock preflight use server-recorded device, local and live product/variant identities. Creation, identity records, barcodes and known opening stock are committed together; retrying an interrupted request does not apply the opening movement twice. A legacy client mapping is verified using product name, unit, variant options, SKU and barcode rather than trusted solely because IDs match. Conflicts are retained for review; pack barcodes are preserved. When the original opening stock is unknown, a newly created variant starts at zero and stock must be checked and adjusted manually.
- A newly created product whose variants are added or removed before its first sync cannot yet be synced safely; sync reports an error instead of risking incorrect stock.
- Variants added locally to an existing product may still require manual reconciliation if their live IDs cannot be matched.
- Desktop spreadsheet bulk import is unavailable; the online master-product import remains available.
- GST report uses bill tax totals (not full HSN breakup until tax lines are stored locally).  
- Customer ledger sync is stored locally; server push is best-effort / no-op if API has no ledger endpoint.  
- Deploy the updated API and all tenant migrations, including the client bill ID, stock movement ID, offline bill identity and catalog sync identity migrations. Rebuild the desktop UI and fully restart Electron to load the database bridge changes. Identity migrations must not be rolled back after recording sync identities. Existing SQLite mappings are still stored in metadata; other queued operations have not all been migrated to the new server identity protocol.
