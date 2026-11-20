# Full local shop (desktop)

## Rule
SQLite is the live DB. Cloud updates **only when user taps Sync**.

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
1. **Push** pending sales + sync_queue (this PC → live DB)  
2. **Pull** products, brands, categories, customers, suppliers, shop settings, recent bills/expenses/returns (live DB → this PC, upsert)  
Mobile stays online-only; its changes live on the server and come down on pull.  
Header dot is status only.

## Notes
- GST report uses bill tax totals (not full HSN breakup until tax lines are stored locally).  
- Customer ledger sync is stored locally; server push is best-effort / no-op if API has no ledger endpoint.  
- Rebuild UI + restart Electron to load these changes.  
