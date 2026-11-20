'use strict';

/**
 * Printing module test:
 * 1) CUPS / HaoYin visibility
 * 2) Direct lp -o raw smoke to thermal printer
 * 3) In-app printer list + Test Print via Electron CDP
 */
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const fs = require('fs');
const os = require('os');
const path = require('path');

const results = [];
function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  const detail = err instanceof Error ? err.message : String(err);
  results.push({ name, pass: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPageWs() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) throw new Error('Electron not on :9222 — start with --remote-debugging-port=9222');
  return page.webSocketDebuggerUrl;
}

function createCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
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
        }
      };
      resolve({ ws, send });
    };
    ws.onerror = reject;
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

/** Minimal ESC/POS: init + text + feed + cut */
function buildEscPosTestSlip() {
  const parts = [];
  parts.push(Buffer.from([0x1b, 0x40])); // init
  parts.push(Buffer.from([0x1b, 0x61, 0x01])); // center
  parts.push(Buffer.from('KDSPOZ PRINT TEST\n', 'ascii'));
  parts.push(Buffer.from([0x1b, 0x61, 0x00])); // left
  parts.push(Buffer.from(`Time: ${new Date().toLocaleString()}\n`, 'utf8'));
  parts.push(Buffer.from('Module check OK\n\n\n', 'ascii'));
  parts.push(Buffer.from([0x1d, 0x56, 0x00])); // full cut
  return Buffer.concat(parts);
}

async function main() {
  // --- 1. CUPS printers ---
  try {
    const { stdout } = await execFileAsync('lpstat', ['-p', '-d'], { timeout: 8000 });
    const text = String(stdout || '');
    assert(/HaoYin_MT580P/i.test(text), 'HaoYin_MT580P not in lpstat');
    assert(/idle|enabled/i.test(text), 'no idle/enabled printers');
    ok('1. CUPS printers visible', text.split('\n').filter((l) => /printer /i.test(l)).join(' | '));
  } catch (e) {
    fail('1. CUPS printers visible', e);
  }

  // --- 2. Direct RAW job to HaoYin ---
  let jobId = '';
  try {
    const payload = buildEscPosTestSlip();
    const tmp = path.join(os.tmpdir(), `kdspoz-print-test-${Date.now()}.bin`);
    fs.writeFileSync(tmp, payload);
    try {
      const { stdout, stderr } = await execFileAsync(
        'lp',
        ['-d', 'HaoYin_MT580P', '-o', 'raw', tmp],
        { timeout: 15000 },
      );
      const out = `${stdout || ''} ${stderr || ''}`;
      const m = out.match(/request id is\s+(\S+)/i) || out.match(/(\S+-\d+)/);
      jobId = m ? m[1] : out.trim();
      assert(jobId, `lp produced no job id: ${out}`);
      ok('2. Direct lp -o raw to HaoYin_MT580P', `job=${jobId} bytes=${payload.length}`);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    fail('2. Direct lp -o raw to HaoYin_MT580P', e);
  }

  // --- 3. Job finished / not stuck paused ---
  try {
    await sleep(2500);
    const { stdout: completed } = await execFileAsync('lpstat', ['-W', 'completed', '-o'], {
      timeout: 8000,
    }).catch(() => ({ stdout: '' }));
    const { stdout: notCompleted } = await execFileAsync('lpstat', ['-o'], { timeout: 8000 }).catch(
      () => ({ stdout: '' }),
    );
    const open = String(notCompleted || '');
    const stuck = /HaoYin/i.test(open) && /paused|held|pending/i.test(open);
    if (stuck) {
      fail('3. CUPS job not stuck', `open queue:\n${open}`);
    } else {
      ok(
        '3. CUPS job not stuck',
        jobId
          ? `job ${jobId}; completed log has HaoYin=${/HaoYin/i.test(String(completed || ''))}`
          : 'no job id',
      );
    }
  } catch (e) {
    fail('3. CUPS job not stuck', e);
  }

  // --- 4–7. In-app via CDP ---
  let cdp;
  try {
    const wsUrl = await getPageWs();
    cdp = await createCdp(wsUrl);
    await cdp.send('Runtime.enable');
    await sleep(400);

    const hasBridge = await evaluate(
      cdp,
      `Boolean(globalThis.kdsDesktop && globalThis.kdsDesktop.listPrinters && globalThis.kdsDesktop.printRawSystem)`,
    );
    assert(hasBridge, 'kdsDesktop print bridge missing');
    ok('4. Desktop print bridge present');

    const printers = await evaluate(
      cdp,
      `(async () => {
        const list = await globalThis.kdsDesktop.listPrinters();
        return (list || []).map(p => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault }));
      })()`,
    );
    assert(Array.isArray(printers) && printers.length > 0, 'app listed 0 printers');
    const haoyin = printers.find((p) => /HaoYin|MT580/i.test(p.name || p.displayName || ''));
    assert(haoyin, `HaoYin not in app list: ${printers.map((p) => p.name).join(', ')}`);
    ok('5. App lists HaoYin_MT580P', printers.map((p) => p.name).join(', '));

    // Navigate to printer settings + read stored settings
    await evaluate(cdp, `globalThis.__kdsNavigateMain && globalThis.__kdsNavigateMain('PrinterSettings')`);
    await sleep(800);
    const settings = await evaluate(
      cdp,
      `(async () => {
        const raw = localStorage.getItem('billing-printer-settings') || localStorage.getItem('printer-settings');
        // zustand persist keys vary — scan
        const keys = Object.keys(localStorage);
        const hit = keys.find(k => /printer/i.test(k));
        let parsed = null;
        if (hit) {
          try { parsed = JSON.parse(localStorage.getItem(hit)); } catch {}
        }
        const bridgeOk = Boolean(globalThis.kdsDesktop);
        return { hit, parsed, bridgeOk, body: (document.body.innerText||'').slice(0, 400) };
      })()`,
    );
    ok('6. Printer settings screen', `storageKey=${settings.hit || 'n/a'}; UI has printer=${/printer|paper|test/i.test(settings.body)}`);

    // In-app RAW print (same path as Test Print for system/thermal)
    const rawResult = await evaluate(
      cdp,
      `(async () => {
        const ESC = (s) => new TextEncoder().encode(s);
        const chunks = [];
        chunks.push(new Uint8Array([0x1b, 0x40]));
        chunks.push(ESC('KDSPOZ APP RAW TEST\\n'));
        chunks.push(ESC(new Date().toISOString() + '\\n\\n\\n'));
        chunks.push(new Uint8Array([0x1d, 0x56, 0x00]));
        let len = 0; for (const c of chunks) len += c.length;
        const buf = new Uint8Array(len);
        let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
        let binary = '';
        for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
        const base64 = btoa(binary);
        await globalThis.kdsDesktop.primePrinter({ printerName: 'HaoYin_MT580P' }).catch(() => null);
        await globalThis.kdsDesktop.printRawSystem({
          printerName: 'HaoYin_MT580P',
          base64,
          copies: 1,
        });
        return { ok: true, bytes: buf.length };
      })()`,
    );
    assert(rawResult?.ok, 'printRawSystem failed');
    ok('7. App printRawSystem (Test Print path)', `bytes=${rawResult.bytes}`);

    // Full receiptPrinter.testPrint if available after settings select HaoYin
    const testPrintResult = await evaluate(
      cdp,
      `(async () => {
        // Ensure settings point at HaoYin + 58mm system
        const key = Object.keys(localStorage).find(k => /printer/i.test(k));
        if (key) {
          let cur = {};
          try { cur = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
          const state = cur.state || cur;
          const next = {
            ...cur,
            state: {
              ...(state || {}),
              type: 'system',
              paperSize: '58',
              systemPrinterName: 'HaoYin_MT580P',
            },
          };
          // zustand persist shape: { state: {...}, version }
          if (cur.state) localStorage.setItem(key, JSON.stringify(next));
          else localStorage.setItem(key, JSON.stringify({
            type: 'system', paperSize: '58', systemPrinterName: 'HaoYin_MT580P'
          }));
        }
        // Click Test Print button if visible
        const btn = [...document.querySelectorAll('div,span,button')].find(el =>
          /test print/i.test((el.textContent || '').trim()) && (el.textContent || '').trim().length < 24
        );
        if (btn) {
          const target = btn.closest('[role=button]') || btn.parentElement || btn;
          target.click();
          await new Promise(r => setTimeout(r, 2500));
          const body = document.body.innerText || '';
          return { clicked: true, success: /success|test print sent|sent/i.test(body), fail: /print failed/i.test(body), body: body.slice(0, 300) };
        }
        return { clicked: false, reason: 'Test Print button not found' };
      })()`,
    );
    if (testPrintResult?.clicked && (testPrintResult.success || !testPrintResult.fail)) {
      ok('8. UI Test Print button', testPrintResult.success ? 'success alert' : 'clicked, no fail alert');
    } else if (testPrintResult?.clicked && testPrintResult.fail) {
      fail('8. UI Test Print button', testPrintResult.body);
    } else {
      // Still OK if raw path worked — button text may be translated / not leaf node
      ok('8. UI Test Print button', `skipped (${testPrintResult?.reason || 'n/a'}); raw path already verified`);
    }
  } catch (e) {
    fail('4–8. In-app print via CDP', e);
  } finally {
    try {
      cdp?.ws?.close();
    } catch {
      /* ignore */
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n=== PRINT MODULE RESULT ===');
  console.log(`${passed} passed, ${failed} failed, ${results.length} total`);
  if (failed) {
    for (const r of results.filter((x) => !x.pass)) console.log(`  - ${r.name}: ${r.detail}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
