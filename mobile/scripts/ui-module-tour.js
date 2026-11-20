'use strict';

/**
 * UI tour of every main module via Electron CDP.
 * Prefer __kdsNavigateMain (injected by app); fall back to sidebar click.
 *
 * Start: electron . --remote-debugging-port=9222
 */
async function getPageWsUrl() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) throw new Error('No Electron page on :9222');
  return page.webSocketDebuggerUrl;
}

function createCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    const consoleLogs = [];
    ws.onopen = () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = nextId++;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        });
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data));
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) rej(new Error(msg.error.message || JSON.stringify(msg.error)));
          else res(msg.result);
          return;
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
          const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          consoleLogs.push({ type: msg.params.type, text: args });
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails || {};
          consoleLogs.push({
            type: 'exception',
            text: d.exception?.description || d.text || 'Uncaught',
          });
        }
      };
      resolve({ ws, send, consoleLogs });
    };
    ws.onerror = (e) => reject(e);
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'evaluate failed',
    );
  }
  return result.result?.value;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const MODULES = [
  { label: 'New Bill', screen: 'Billing', params: { fresh: true }, expect: [/bill|product|search|₹|loading|catalog/i] },
  { label: 'Sales', screen: 'SalesList', expect: [/sales|bills|revenue|bill|no sales/i] },
  { label: 'Held Bills', screen: 'HeldBills', expect: [/held|hold|empty|no /i] },
  { label: 'Returns', screen: 'ReturnsList', expect: [/return|credit|empty|no /i] },
  { label: 'Products', screen: 'ProductList', expect: [/product|search|import|empty/i] },
  { label: 'Price Management', screen: 'PriceManagement', expect: [/price|product|search|mrp|₹/i] },
  { label: 'Categories', screen: 'CategoryList', expect: [/categor|type|add|empty/i] },
  { label: 'Brands', screen: 'BrandList', expect: [/brand|add|empty|search/i] },
  { label: 'Stock', screen: 'StockList', expect: [/stock|qty|quantity|sku|empty|warehouse/i] },
  { label: 'Stock History', screen: 'StockHistory', expect: [/history|stock|movement|empty|no /i] },
  { label: 'Opening Stock', screen: 'StockOperation', params: { mode: 'opening' }, expect: [/opening|stock|product|save|variant|search/i] },
  { label: 'Purchase Bills', screen: 'PurchaseBillList', expect: [/purchase|supplier|bill|empty|add/i] },
  { label: 'Suppliers', screen: 'SupplierList', expect: [/supplier|add|empty|phone|name/i] },
  { label: 'Customers', screen: 'CustomerList', expect: [/customer|add|empty|phone|name/i] },
  { label: 'Reports', screen: 'Reports', expect: [/report|sales|stock|gst|profit|cash/i] },
  { label: 'Expenses', screen: 'Expenses', expect: [/expense|amount|add|empty|category|₹/i] },
  { label: 'Close Register', screen: 'DailyClosing', expect: [/close|register|cash|opening|sales|day/i] },
  { label: 'My Profile', screen: 'Profile', expect: [/profile|name|mobile|password|save|email/i] },
  { label: 'Shop & Bill Settings', screen: 'ShopSettings', expect: [/shop|address|gst|footer|save|logo|bill/i] },
  { label: 'Sync Data', screen: 'SyncData', expect: [/sync|last sync|online|offline|live|pending/i] },
  { label: 'Billing Printer', screen: 'PrinterSettings', expect: [/printer|paper|bluetooth|usb|test|save/i] },
  { label: 'Barcode label', screen: 'BarcodeLabel', expect: [/barcode|label|print|product|size/i] },
  { label: 'Integrations', screen: 'Integrations', expect: [/integration|shopify|connect|coming|api/i] },
];

async function main() {
  const wsUrl = await getPageWsUrl();
  const cdp = await createCdp(wsUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await sleep(1000);

  const hasNav = await evaluate(cdp, `typeof globalThis.__kdsNavigateMain === 'function'`);
  console.log(`Navigation hook: ${hasNav ? 'yes' : 'no (sidebar click fallback)'}`);

  const results = [];

  for (const mod of MODULES) {
    const started = Date.now();
    cdp.consoleLogs.length = 0;
    try {
      if (hasNav) {
        await evaluate(
          cdp,
          `Promise.resolve(globalThis.__kdsNavigateMain(${JSON.stringify(mod.screen)}, ${JSON.stringify(mod.params || null)}))`,
        );
      } else {
        const click = await evaluate(
          cdp,
          `(function(label){
            const want=String(label).trim();
            const nodes=[...document.querySelectorAll('div,span,button,a,p')];
            for (const el of nodes) {
              if ((el.textContent||'').trim()!==want) continue;
              if (el.childElementCount>2) continue;
              const target=el.closest('[role=button]')||el.parentElement||el;
              target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
              target.click();
              return true;
            }
            return false;
          })(${JSON.stringify(mod.label)})`,
        );
        if (!click) throw new Error('menu item not found');
      }
    } catch (e) {
      results.push({ module: mod.label, pass: false, detail: `navigate: ${e.message}` });
      console.error(`FAIL  ${mod.label} — navigate: ${e.message}`);
      continue;
    }

    await sleep(1400);
    let snap;
    try {
      snap = await evaluate(
        cdp,
        `(() => {
          const body = document.body ? document.body.innerText : '';
          const lower = body.toLowerCase();
          return {
            title: document.title || '',
            bodyPreview: body.replace(/\\n+/g, ' | ').trim().slice(0, 450),
            bodyLen: body.length,
            loadFailed: /load failed|could not load|something went wrong|unique constraint/.test(lower),
          };
        })()`,
      );
    } catch (e) {
      results.push({ module: mod.label, pass: false, detail: `snapshot: ${e.message}` });
      console.error(`FAIL  ${mod.label} — snapshot`);
      continue;
    }

    const text = `${snap.title} ${snap.bodyPreview}`;
    const expectOk = mod.expect.some((re) => re.test(text));
    const errors = cdp.consoleLogs.filter(
      (l) =>
        (l.type === 'error' || l.type === 'exception') &&
        !/Warning:|Download the React DevTools|third-party cookie/i.test(l.text),
    );
    // Ignore benign network failures for online-only subcalls if screen still rendered.
    const hardErrors = errors.filter((l) =>
      /TypeError|ReferenceError|is not a function|Cannot read|Unique constraint|Uncaught/i.test(l.text),
    );
    const pass = expectOk && !snap.loadFailed && hardErrors.length === 0;
    const detail = pass
      ? `${snap.bodyLen} chars, ${Date.now() - started}ms`
      : [
          !expectOk ? 'unexpected content' : null,
          snap.loadFailed ? 'load-failed text' : null,
          hardErrors[0] ? hardErrors[0].text.split('\n')[0].slice(0, 140) : null,
          snap.bodyPreview.slice(0, 140),
        ]
          .filter(Boolean)
          .join(' | ');

    results.push({ module: mod.label, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${mod.label} — ${detail}`);
  }

  if (hasNav) {
    try {
      await evaluate(cdp, `globalThis.__kdsNavigateMain('Dashboard')`);
    } catch {
      /* ignore */
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n=== UI TOUR RESULT ===');
  console.log(`${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed) {
    for (const r of results.filter((x) => !x.pass)) console.log(`  - ${r.module}: ${r.detail}`);
  }
  cdp.ws.close();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
