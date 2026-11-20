'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');

/** Mirrors mobile/desktop/main.js offline path helpers for a file-store smoke test. */
function makeOfflineStore(rootBase) {
  function offlineRoot(shopCode) {
    const safe = String(shopCode || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
    return path.join(rootBase, 'offline', safe);
  }

  function offlinePath(shopCode, key) {
    const safeKey = String(key || '')
      .replace(/\.\./g, '')
      .replace(/[^a-zA-Z0-9_./-]/g, '_')
      .replace(/^\/+/, '');
    if (!safeKey) throw new Error('Missing offline key.');
    const root = offlineRoot(shopCode);
    const filePath = path.resolve(root, `${safeKey}.json`);
    if (!filePath.startsWith(path.resolve(root))) throw new Error('Invalid offline path.');
    return filePath;
  }

  return {
    async write(shopCode, key, value) {
      const filePath = offlinePath(shopCode, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(value ?? null), 'utf8');
      return { ok: true };
    },
    async read(shopCode, key) {
      const filePath = offlinePath(shopCode, key);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        return { ok: true, value: JSON.parse(raw) };
      } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, value: null };
        throw err;
      }
    },
    async remove(shopCode, key) {
      const filePath = offlinePath(shopCode, key);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
      return { ok: true };
    },
    async list(shopCode, prefix = '') {
      const root = offlineRoot(shopCode);
      const prefixSafe = String(prefix || '').replace(/\.\./g, '').replace(/^\/+/, '');
      const dir = prefixSafe ? path.resolve(root, prefixSafe) : root;
      if (!dir.startsWith(path.resolve(root))) throw new Error('Invalid offline path.');
      try {
        const names = await fs.readdir(dir);
        return {
          ok: true,
          keys: names
            .filter((name) => name.endsWith('.json'))
            .map((name) => (prefixSafe ? `${prefixSafe}/${name.slice(0, -5)}` : name.slice(0, -5))),
        };
      } catch (err) {
        if (err && err.code === 'ENOENT') return { ok: true, keys: [] };
        throw err;
      }
    },
  };
}

describe('desktop offline file store (IPC shape)', () => {
  let root;
  let store;

  beforeEach(() => {
    root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'kdspoz-offline-'));
    store = makeOfflineStore(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes, lists, reads, and removes an outbox sale', async () => {
    const sale = {
      clientBillId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      createdAt: new Date().toISOString(),
      bill: { bill_number: 'OFF-20260101-120000', total_amount: 42 },
      payload: { clientBillId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', items: [] },
      syncAttempts: 0,
    };

    await store.write('demo_shop', `outbox/${sale.clientBillId}`, sale);
    const listed = await store.list('demo_shop', 'outbox');
    expect(listed.keys).toContain(`outbox/${sale.clientBillId}`);

    const read = await store.read('demo_shop', `outbox/${sale.clientBillId}`);
    expect(read.value.bill.total_amount).toBe(42);

    await store.remove('demo_shop', `outbox/${sale.clientBillId}`);
    const after = await store.list('demo_shop', 'outbox');
    expect(after.keys).toEqual([]);
  });

  it('neutralizes path traversal so files stay under the shop root', async () => {
    await store.write('demo_shop', '../escape', { x: 1 });
    const under = path.resolve(root, 'offline', 'demo_shop');
    const files = [];
    async function walk(dir) {
      for (const name of await fs.readdir(dir)) {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        if (st.isDirectory()) await walk(full);
        else files.push(full);
      }
    }
    await walk(path.join(root, 'offline'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.startsWith(under + path.sep) || file === under).toBe(true);
    }
  });

  it('keeps shops isolated', async () => {
    await store.write('shop_a', 'shop-settings', { shopName: 'A' });
    await store.write('shop_b', 'shop-settings', { shopName: 'B' });
    const a = await store.read('shop_a', 'shop-settings');
    const b = await store.read('shop_b', 'shop-settings');
    expect(a.value.shopName).toBe('A');
    expect(b.value.shopName).toBe('B');
  });
});
