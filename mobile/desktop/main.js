const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, protocol, session, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { sendRaw, sendRawToSystemPrinter, listWindowsPrinters } = require('./rawPrint');
const offlineDb = require('./db');

const APP_SCHEME = 'app';
const APP_HOST = 'kdspoz';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const DEV_URL = process.env.KDS_DESKTOP_DEV_URL || '';

/** Prefer .ico on Windows (taskbar/title bar); PNG elsewhere / packaged builder input. */
function resolveAppIconPath() {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(__dirname, 'build', 'icon.ico'),
          path.join(__dirname, 'build', 'icon.png'),
          path.join(process.resourcesPath || '', 'build', 'icon.ico'),
          path.join(process.resourcesPath || '', 'build', 'icon.png'),
        ]
      : [
          path.join(__dirname, 'build', 'icon.png'),
          path.join(__dirname, 'build', 'icon.ico'),
          path.join(process.resourcesPath || '', 'build', 'icon.png'),
        ];
  for (const candidate of candidates) {
    try {
      if (candidate && fsSync.existsSync(candidate)) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadAppIcon() {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return null;
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? null : image;
}

/** Virtual / document “printers” — not physical POS or office devices. */
const VIRTUAL_PRINTER_RE =
  /pdf|xps|fax|onenote|send to|document writer|print to file|microsoft print to|adobe pdf|foxit|bullzip|cutepdf|dopdf|nitro pdf|pdfcreator|primopdf|nova.?pdf|redirected|microsoft shared/i;

function isVirtualPrinter(printer) {
  const label = `${printer?.name || ''} ${printer?.displayName || ''} ${printer?.description || ''}`;
  return VIRTUAL_PRINTER_RE.test(label);
}

/**
 * Soft online check — used only as a hint. USB POS queues often sit in CUPS
 * "stopped / Unable to send data" after a RAW job; we still list them and
 * cupsenable on refresh / print so the user can pick the device again.
 */
function printerAvailability(printer) {
  if (!printer) return 'unknown';
  const options = printer.options || {};
  const reasons = String(options['printer-state-reasons'] || options['printer-state-message'] || '');
  const state = String(options['printer-state'] || '');
  if (/shutdown|disconnected/i.test(reasons)) return 'offline';
  // IPP: 5 stopped — common after USB blip; still selectable.
  if (state === '5' || /stopped/i.test(state) || /offline|connecting-to-device/i.test(reasons)) {
    return 'paused';
  }
  return 'online';
}

function filterListedPrinters(printers) {
  return (printers || [])
    .filter((p) => p && (p.name || p.displayName))
    .filter((p) => !isVirtualPrinter(p))
    .filter((p) => printerAvailability(p) !== 'offline');
}

/** Re-enable CUPS queues that RAW USB jobs left "disabled / Unable to send data". Never cancel jobs. */
async function reviveCupsQueues(printerNames) {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return;
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);
  for (const name of printerNames) {
    const queue = String(name || '').trim();
    if (!queue) continue;
    await execFileAsync('cupsaccept', [queue], { timeout: 8000 }).catch(() => null);
    await execFileAsync('cupsenable', [queue], { timeout: 8000 }).catch(() => null);
  }
}

async function listDesktopPrinters(webContents) {
  if (process.platform === 'win32') {
    try {
      const windowsList = await listWindowsPrinters();
      // Merge default flag from Chromium when available.
      let defaults = new Set();
      try {
        const electronList = await webContents.getPrintersAsync();
        for (const p of electronList || []) {
          if (p?.isDefault && p.name) defaults.add(String(p.name));
        }
      } catch {
        /* ignore */
      }
      return windowsList.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: defaults.has(p.name),
        driverName: p.driverName || '',
        rawFriendly: Boolean(p.rawFriendly),
      }));
    } catch (err) {
      startupLog(`listWindowsPrinters failed: ${err && err.message ? err.message : err}`);
      // Fall through to Electron list if PowerShell is blocked.
    }
  }

  // Wake USB POS queues before reading the list — CUPS hides them as stopped
  // after "Unable to send data", which made the app show an empty printer list.
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('lpstat', ['-a'], { timeout: 8000, maxBuffer: 512 * 1024 });
    const names = String(stdout || '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)
      .filter((name) => !VIRTUAL_PRINTER_RE.test(name));
    await reviveCupsQueues(names);
  } catch {
    /* lpstat unavailable */
  }

  const printers = await webContents.getPrintersAsync();
  return filterListedPrinters(printers).map((p) => {
    const avail = printerAvailability(p);
    const base = p.displayName || p.name;
    return {
      name: p.name,
      displayName: avail === 'paused' ? `${base} (tap to use — was paused)` : base,
      isDefault: Boolean(p.isDefault),
    };
  });
}

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  // Required for Paar / onnxruntime-web — octet-stream breaks instantiateStreaming.
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Serving the bundle from app://kdspoz gives it a stable origin the API can allow in CORS.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let mainWindow = null;

/** Real on-disk UI folder (works with asar off or asar.unpacked). */
function resolveAppDir() {
  const candidates = [
    path.join(__dirname, 'app'),
    path.join(process.resourcesPath || '', 'app', 'app'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'app'),
    path.join(process.resourcesPath || '', 'app.asar', 'app'),
  ];
  for (const dir of candidates) {
    try {
      if (dir && fsSync.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch {
      /* try next */
    }
  }
  return path.join(__dirname, 'app');
}

function startupLog(message) {
  try {
    const line = `${new Date().toISOString()} ${message}\n`;
    const logPath = path.join(app.getPath('userData'), 'kdspoz-startup.log');
    fsSync.mkdirSync(path.dirname(logPath), { recursive: true });
    fsSync.appendFileSync(logPath, line);
  } catch {
    /* ignore */
  }
}

function isInsideAppDir(appDir, candidate) {
  const root = path.resolve(appDir);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  if (!relative) return true;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return true;
}

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

/**
 * Serve UI files via Node fs + Response (not net.fetch/file://).
 * Avoids Windows asar / Chromium "Unspecified error" blank windows.
 */
function registerAppProtocol(appDir) {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname && url.hostname !== APP_HOST) {
        return new Response('Not Found', { status: 404 });
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      let filePath = path.resolve(appDir, relative);
      if (!isInsideAppDir(appDir, filePath)) {
        return new Response('Forbidden', { status: 403 });
      }
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) filePath = path.join(appDir, 'index.html');
      } catch {
        filePath = path.join(appDir, 'index.html');
      }
      if (!isInsideAppDir(appDir, filePath)) {
        return new Response('Forbidden', { status: 403 });
      }
      const data = await fs.readFile(filePath);
      // Uint8Array: some Electron/Windows builds reject raw Node Buffer bodies.
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'content-type': mimeFor(filePath),
          'cache-control': 'no-cache',
        },
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      startupLog(`protocol error: ${message}`);
      return new Response(`Failed to load: ${message}`, {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  });
}

/**
 * The KDSPOZ API only lists browser origins in its CORS config, so servers that do not yet allow app://kdspoz
 * would block every request. The API is our own backend, so the app grants itself access to it here.
 */
const API_URL_PATTERNS = ['https://khisedigital.info/kdspozr/*'];
const CORS_HEADER = /^access-control-allow-(origin|headers|methods|credentials)$/i;

/**
 * After an upgrade, drop Chromium HTTP/code caches so Windows does not keep an old
 * webpack bundle. App settings in localStorage / AsyncStorage are left alone.
 */
async function clearCachesAfterUpgrade() {
  const version = app.getVersion();
  const markerPath = path.join(app.getPath('userData'), 'kdspoz-app-version.txt');
  let previous = '';
  try {
    previous = String(await fs.readFile(markerPath, 'utf8')).trim();
  } catch {
    previous = '';
  }
  if (previous === version) return;
  startupLog(`upgrade ${previous || '(none)'} → ${version}; clearing session caches`);
  try {
    const ses = session.defaultSession;
    await ses.clearCache();
    await ses.clearCodeCaches({});
    await ses.clearStorageData({
      storages: ['shadercache', 'cachestorage', 'serviceworkers'],
    });
  } catch (err) {
    startupLog(`cache clear failed: ${err && err.message ? err.message : err}`);
  }
  try {
    await fs.writeFile(markerPath, `${version}\n`, 'utf8');
  } catch (err) {
    startupLog(`version marker write failed: ${err && err.message ? err.message : err}`);
  }
}

function allowOwnApiCors() {
  session.defaultSession.webRequest.onHeadersReceived({ urls: API_URL_PATTERNS }, (details, callback) => {
    const headers = {};
    for (const [name, value] of Object.entries(details.responseHeaders || {})) {
      if (!CORS_HEADER.test(name)) headers[name] = value;
    }
    headers['Access-Control-Allow-Origin'] = [APP_ORIGIN];
    headers['Access-Control-Allow-Credentials'] = ['true'];
    headers['Access-Control-Allow-Methods'] = ['GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS'];
    headers['Access-Control-Allow-Headers'] = ['Content-Type, Authorization'];
    callback({ responseHeaders: headers });
  });
}

function isAppUrl(url) {
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_URL && url.startsWith(DEV_URL));
}

function openExternalSafely(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function createMainWindow(appDir) {
  const appIcon = loadAppIcon();
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'KDSPOZ Retail',
    backgroundColor: '#F4F7FB',
    autoHideMenuBar: process.platform === 'win32',
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      // Sandbox + some Win32 AV stacks fail with opaque "Unspecified error".
      sandbox: process.platform !== 'win32',
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (appIcon && process.platform === 'win32') {
    try {
      mainWindow.setIcon(appIcon);
    } catch {
      /* ignore */
    }
  }

  let shown = false;
  const reveal = () => {
    if (shown || !mainWindow) return;
    shown = true;
    mainWindow.maximize();
    mainWindow.show();
  };

  mainWindow.once('ready-to-show', reveal);
  // Never leave the user staring at nothing if ready-to-show never fires.
  setTimeout(reveal, 4000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalSafely(url);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = aborted
    const detail = `${errorDescription || 'Unknown'} (${errorCode})\n${validatedURL || ''}\nApp folder: ${appDir}`;
    startupLog(`did-fail-load ${detail.replace(/\n/g, ' | ')}`);
    reveal();
    dialog.showErrorBox('KDSPOZ Retail failed to open', detail);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const startUrl = DEV_URL || `${APP_ORIGIN}/index.html`;
  startupLog(`load ${startUrl} from ${appDir}`);
  mainWindow.loadURL(startUrl).catch((err) => {
    startupLog(`loadURL failed: ${err && err.message ? err.message : err}`);
    reveal();
    dialog.showErrorBox('KDSPOZ Retail failed to open', String(err && err.message ? err.message : err));
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(DEV_URL || !app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Contact Support', click: () => shell.openExternal('mailto:info@khisedigital.in') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle('printers:list', async (event) => listDesktopPrinters(event.sender));

  ipcMain.handle('printers:print-html', async (_event, options) => {
    const {
      html,
      printerName,
      silent,
      pageWidthMm,
      pageHeightMm,
      a4,
      noMargins,
      preferCssPageSize,
    } = options || {};
    if (typeof html !== 'string' || !html) throw new Error('Nothing to print.');

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: process.platform !== 'win32',
        javascript: false,
        contextIsolation: true,
      },
    });
    // Large jobs exceed Chromium's ~2 MB URL limit, so load from a temp file.
    const tempFile = path.join(app.getPath('temp'), `kdspoz-print-${process.pid}-${Date.now()}.html`);
    try {
      await fs.writeFile(tempFile, html, 'utf8');
      await printWindow.loadFile(tempFile);
      const printOptions = {
        silent: Boolean(silent && printerName),
        printBackground: true,
        deviceName: printerName || undefined,
        preferCSSPageSize: Boolean(preferCssPageSize),
      };
      if (a4) printOptions.pageSize = 'A4';
      if (noMargins || pageWidthMm) printOptions.margins = { marginType: 'none' };
      if (pageWidthMm) {
        // Receipts: at least 60 mm so short jobs still feed.
        const heightMm = noMargins && !preferCssPageSize
          ? pageHeightMm || 25
          : Math.max(pageHeightMm || 0, 60);
        printOptions.pageSize = {
          width: Math.round(pageWidthMm * 1000),
          height: Math.round(heightMm * 1000),
        };
      }
      await new Promise((resolve, reject) => {
        printWindow.webContents.print(printOptions, (success, reason) => {
          if (success || reason === 'cancelled' || reason === 'Print job canceled') resolve();
          else {
            const tip =
              !reason || /unspecified/i.test(reason)
                ? 'Check that the printer is online, has paper, and is selected in Printer Settings.'
                : reason;
            reject(new Error(tip));
          }
        });
      });
    } finally {
      printWindow.destroy();
      fs.unlink(tempFile).catch(() => {});
    }
  });

  ipcMain.handle('printers:print-raw', async (_event, options) => {
    const { host, port, base64, copies, batchSize, jobKind } = options || {};
    if (typeof host !== 'string' || !host.trim()) throw new Error('No network printer IP configured.');
    const portNumber = Number(port) || 9100;
    if (portNumber < 1 || portNumber > 65535) throw new Error('Invalid printer port.');
    const data = Buffer.from(String(base64 || ''), 'base64');
    if (!data.length) throw new Error('Nothing to print.');

    // Same FIFO + settle as system prints — Wi‑Fi :9100 is the cross‑platform path.
    const { sendRawToNetworkPrinter } = require('./rawPrint');
    await sendRawToNetworkPrinter(host.trim(), portNumber, data, { copies, batchSize, jobKind });
  });

  /** Wake POS queue on Print click (CUPS disabled / Windows Paused·Offline·red LED). */
  ipcMain.handle('printers:prime', async (_event, options) => {
    const printerName = String(options?.printerName || '').trim();
    if (!printerName) return;
    try {
      const { unpauseSystemPrinter, isPrintQueueBusy } = require('./rawPrint');
      // Never cupsenable while a slip is in flight — that drops queued tickets.
      if (isPrintQueueBusy(printerName)) return;
      await unpauseSystemPrinter(printerName, { clearJobs: false });
    } catch {
      /* best-effort */
    }
  });

  /** 58/80 mm POS: click → lp -o raw → done (resolves when CUPS accepts the job). */
  ipcMain.handle('printers:print-raw-system', async (_event, options) => {
    const { printerName, base64, copies, batchSize, jobKind } = options || {};
    const data = Buffer.from(String(base64 || ''), 'base64');
    if (!data.length) throw new Error('Nothing to print.');
    await sendRawToSystemPrinter(printerName, data, { copies, batchSize, jobKind });
  });

  ipcMain.handle('files:save', async (event, options) => {
    const { filename, base64, text } = options || {};
    const safeName = path.basename(String(filename || 'export'));
    const ext = path.extname(safeName).replace('.', '');
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(parent, {
      defaultPath: path.join(app.getPath('downloads'), safeName),
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [],
    });
    if (result.canceled || !result.filePath) return { saved: false };

    const data = base64 !== undefined && base64 !== null ? Buffer.from(String(base64), 'base64') : String(text ?? '');
    await fs.writeFile(result.filePath, data);
    shell.showItemInFolder(result.filePath);
    return { saved: true, path: result.filePath };
  });

  /** Offline store: JSON files under userData/offline/<shopCode>/ — no MySQL on the PC. */
  function offlineRoot(shopCode) {
    const safe = String(shopCode || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'default';
    return path.join(app.getPath('userData'), 'offline', safe);
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

  ipcMain.handle('offline:read', async (_event, options) => {
    const { shopCode, key } = options || {};
    const filePath = offlinePath(shopCode, key);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return { ok: true, value: JSON.parse(raw) };
    } catch (err) {
      if (err && err.code === 'ENOENT') return { ok: true, value: null };
      throw err;
    }
  });

  ipcMain.handle('offline:write', async (_event, options) => {
    const { shopCode, key, value } = options || {};
    const filePath = offlinePath(shopCode, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value ?? null), 'utf8');
    return { ok: true };
  });

  ipcMain.handle('offline:remove', async (_event, options) => {
    const { shopCode, key } = options || {};
    const filePath = offlinePath(shopCode, key);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return { ok: true };
  });

  ipcMain.handle('offline:list', async (_event, options) => {
    const { shopCode, prefix } = options || {};
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
  });

  /** SQLite local DB (fully offline). One file per shop under userData/offline/<shop>/kdspoz.sqlite */
  function shopSqlite(shopCode) {
    const db = offlineDb.openShopDb(app.getPath('userData'), shopCode);
    // Import legacy JSON outbox once per shop process.
    const flagKey = `legacy_imported:${offlineDb.safeShop(shopCode)}`;
    if (!shopSqlite._imported) shopSqlite._imported = new Set();
    if (!shopSqlite._imported.has(flagKey)) {
      shopSqlite._imported.add(flagKey);
      try {
        offlineDb.importLegacyOutbox(db, offlineRoot(shopCode));
      } catch (err) {
        startupLog(`legacy outbox import: ${err && err.message ? err.message : err}`);
      }
    }
    return db;
  }

  ipcMain.handle('sqlite:status', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.getStatus(db) };
  });

  ipcMain.handle('sqlite:save-shop-settings', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.saveShopSettings(db, options?.settings);
    return { ok: true };
  });

  ipcMain.handle('sqlite:read-shop-settings', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, settings: offlineDb.readShopSettings(db) };
  });

  ipcMain.handle('sqlite:replace-catalog', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const result = offlineDb.replaceCatalog(db, {
      products: options?.products || [],
      categories: options?.categories || [],
      brands: options?.brands || [],
      clearProducts: options?.clearProducts === true,
      syncStock: options?.syncStock !== false,
    });
    return { ok: true, ...result };
  });

  ipcMain.handle('sqlite:list-products', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const items = offlineDb.listProducts(db, {
      search: options?.search,
      limit: options?.limit,
      offset: options?.offset,
      categoryId: options?.categoryId,
    });
    return { ok: true, items, total: offlineDb.countProducts(db) };
  });

  ipcMain.handle('sqlite:get-product', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const product = offlineDb.getProduct(db, options?.id);
    return { ok: true, product: product || null };
  });

  ipcMain.handle('sqlite:list-categories', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listCategories(db) };
  });

  ipcMain.handle('sqlite:list-brands', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listBrands(db) };
  });

  ipcMain.handle('sqlite:replace-customers', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const result = offlineDb.replaceCustomers(db, options?.customers || []);
    return { ok: true, ...result };
  });

  ipcMain.handle('sqlite:list-customers', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const items = offlineDb.listCustomers(db, {
      search: options?.search,
      limit: options?.limit,
    });
    return { ok: true, items };
  });

  ipcMain.handle('sqlite:upsert-customer', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const result = offlineDb.upsertCustomer(db, options?.customer || {});
    return { ok: true, ...result };
  });

  ipcMain.handle('sqlite:set-meta', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.setMeta(db, options?.key, options?.value);
    return { ok: true };
  });

  ipcMain.handle('sqlite:get-meta', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const value = offlineDb.getMeta(db, options?.key, options?.fallback ?? null);
    return { ok: true, value };
  });

  ipcMain.handle('sqlite:save-sale', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const result = offlineDb.saveSale(db, options?.sale || {});
    return { ok: true, ...result, pending: offlineDb.pendingSaleCount(db) };
  });

  ipcMain.handle('sqlite:list-pending-sales', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const rows = offlineDb.listPendingSales(db);
    return { ok: true, rows, pending: rows.length };
  });

  ipcMain.handle('sqlite:mark-sale-synced', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.markSaleSynced(db, options?.clientBillId, options?.serverBillId);
    return { ok: true, pending: offlineDb.pendingSaleCount(db) };
  });

  ipcMain.handle('sqlite:mark-sale-error', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.markSaleSyncError(db, options?.clientBillId, options?.message, options?.attempts);
    return { ok: true, pending: offlineDb.pendingSaleCount(db) };
  });

  ipcMain.handle('sqlite:delete-pending-sale', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const result = offlineDb.deletePendingSale(db, options?.clientBillId);
    return { ok: true, ...result, pending: offlineDb.pendingSaleCount(db) };
  });

  ipcMain.handle('sqlite:pending-count', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, pending: offlineDb.pendingSaleCount(db) };
  });

  ipcMain.handle('sqlite:save-auth-session', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.saveAuthSession(db, options?.session || {});
    return { ok: true };
  });

  ipcMain.handle('sqlite:read-auth-session', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, session: offlineDb.readAuthSession(db) };
  });

  ipcMain.handle('sqlite:list-sales', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.listSales(db, options || {}) };
  });

  ipcMain.handle('sqlite:get-sale', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, bill: offlineDb.getSale(db, options?.id) };
  });

  ipcMain.handle('sqlite:save-held-bill', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.saveHeldBill(db, options?.held || {}) };
  });

  ipcMain.handle('sqlite:list-held-bills', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listHeldBills(db) };
  });

  ipcMain.handle('sqlite:delete-held-bill', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.deleteHeldBill(db, options?.id);
    return { ok: true };
  });

  ipcMain.handle('sqlite:dashboard', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.buildDashboard(db) };
  });

  ipcMain.handle('sqlite:sales-report', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.buildSalesReport(db, options || {}) };
  });

  ipcMain.handle('sqlite:enqueue-sync', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.enqueueSync(db, options || {}) };
  });

  ipcMain.handle('sqlite:list-sync-queue', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, rows: offlineDb.listPendingSyncQueue(db) };
  });

  ipcMain.handle('sqlite:replace-json-table', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const table = String(options?.table || '');
    const allowed = new Set(['units', 'tax_groups', 'offers', 'expense_categories']);
    if (!allowed.has(table)) throw new Error(`Table not allowed: ${table}`);
    return { ok: true, ...offlineDb.replaceJsonTable(db, table, options?.rows || []) };
  });

  ipcMain.handle('sqlite:list-json-table', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    const table = String(options?.table || '');
    const allowed = new Set(['units', 'tax_groups', 'offers', 'expense_categories']);
    if (!allowed.has(table)) throw new Error(`Table not allowed: ${table}`);
    return { ok: true, items: offlineDb.listJsonTable(db, table) };
  });

  ipcMain.handle('sqlite:save-expense', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.saveExpense(db, options?.expense || {}) };
  });

  ipcMain.handle('sqlite:list-expenses', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listExpenses(db, options || {}) };
  });

  ipcMain.handle('sqlite:save-return', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.saveReturn(db, options?.row || {}) };
  });
  ipcMain.handle('sqlite:list-returns', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listReturns(db, options || {}) };
  });
  ipcMain.handle('sqlite:save-purchase', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.savePurchase(db, options?.row || {}) };
  });
  ipcMain.handle('sqlite:list-purchases', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listPurchases(db, options || {}) };
  });
  ipcMain.handle('sqlite:get-purchase', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, item: offlineDb.getPurchase(db, options?.id) };
  });
  ipcMain.handle('sqlite:replace-suppliers', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.replaceSuppliers(db, options?.suppliers || []) };
  });
  ipcMain.handle('sqlite:list-suppliers', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listSuppliers(db, options || {}) };
  });
  ipcMain.handle('sqlite:upsert-supplier', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.upsertSupplier(db, options?.supplier || {}) };
  });
  ipcMain.handle('sqlite:save-daily-closing', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.saveDailyClosing(db, options?.row || {}) };
  });
  ipcMain.handle('sqlite:list-daily-closings', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listDailyClosings(db) };
  });
  ipcMain.handle('sqlite:preview-daily-closing', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.previewDailyClosingLocal(db, options?.closingDate) };
  });
  ipcMain.handle('sqlite:upsert-product', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.upsertProductLocal(db, options?.product || {}) };
  });
  ipcMain.handle('sqlite:delete-product', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.deleteProductLocal(db, options?.id) };
  });
  ipcMain.handle('sqlite:delete-category', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.deleteCategoryLocal(db, options?.id) };
  });
  ipcMain.handle('sqlite:delete-brand', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.deleteBrandLocal(db, options?.id) };
  });
  ipcMain.handle('sqlite:delete-customer', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.deleteCustomerLocal(db, options?.id) };
  });
  ipcMain.handle('sqlite:delete-supplier', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.deleteSupplierLocal(db, options?.id) };
  });
  ipcMain.handle('sqlite:set-product-favorite', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.setProductFavoriteLocal(db, options?.id, options?.isFavorite) };
  });
  ipcMain.handle('sqlite:set-products-favorite-bulk', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return {
      ok: true,
      ...offlineDb.setProductsFavoriteBulkLocal(
        db,
        options?.categoryId,
        options?.isFavorite,
        options?.brandId,
      ),
    };
  });
  ipcMain.handle('sqlite:add-customer-ledger', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.addCustomerLedger(db, options?.entry || {}) };
  });
  ipcMain.handle('sqlite:list-customer-ledger', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listCustomerLedger(db, options?.customerId) };
  });
  ipcMain.handle('sqlite:save-stock-movement', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, ...offlineDb.saveStockMovement(db, options?.row || {}) };
  });
  ipcMain.handle('sqlite:list-stock-movements', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, items: offlineDb.listStockMovements(db, options || {}) };
  });
  ipcMain.handle('sqlite:profit-report', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.buildProfitReport(db, options || {}) };
  });
  ipcMain.handle('sqlite:gst-report', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.buildGstReport(db, options || {}) };
  });
  ipcMain.handle('sqlite:cashflow-report', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.buildCashFlowReport(db, options || {}) };
  });
  ipcMain.handle('sqlite:get-product-barcode-status', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.getProductBarcodeStatusLocal(db, options?.productId) };
  });
  ipcMain.handle('sqlite:generate-barcodes', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.generateBarcodesLocal(db, options?.variantIds) };
  });
  ipcMain.handle('sqlite:ensure-quantity-barcodes', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    return { ok: true, data: offlineDb.ensureQuantityBarcodesLocal(db, options?.items) };
  });
  ipcMain.handle('sqlite:mark-sync-queue-done', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.markSyncQueueDone(db, options?.id);
    return { ok: true };
  });
  ipcMain.handle('sqlite:mark-sync-queue-error', async (_event, options) => {
    const db = shopSqlite(options?.shopCode);
    offlineDb.markSyncQueueError(db, options?.id, options?.message, options?.attempts);
    return { ok: true };
  });

  app.on('before-quit', () => {
    try {
      offlineDb.closeAll();
    } catch {
      /* ignore */
    }
  });
}

process.on('uncaughtException', (err) => {
  startupLog(`uncaughtException: ${err && err.stack ? err.stack : err}`);
  try {
    dialog.showErrorBox('KDSPOZ Retail error', String(err && err.message ? err.message : err));
  } catch {
    /* ignore */
  }
});

// Old shop PCs often have broken GPU drivers; Chromium then fails with "Unspecified error".
if (process.platform === 'win32') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const appDir = resolveAppDir();
    startupLog(`ready packaged=${app.isPackaged} arch=${process.arch} platform=${process.platform} appDir=${appDir}`);
    if (!fsSync.existsSync(path.join(appDir, 'index.html'))) {
      const msg = `UI files missing.\nLooked in:\n${appDir}\n\nReinstall KDSPOZ Retail.`;
      startupLog(msg);
      dialog.showErrorBox('KDSPOZ Retail failed to open', msg);
      app.quit();
      return;
    }

    // Groups the taskbar entry under KDSPOZ (not generic Electron) on Windows.
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.kdspoz.retail.desktop');
    }
    const appIcon = loadAppIcon();
    if (appIcon && process.platform === 'darwin') {
      try {
        app.dock.setIcon(appIcon);
      } catch {
        /* ignore */
      }
    }
    await clearCachesAfterUpgrade();
    registerAppProtocol(appDir);
    allowOwnApiCors();
    registerIpc();
    buildMenu();
    createMainWindow(appDir);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow(appDir);
    });
  }).catch((err) => {
    startupLog(`whenReady failed: ${err && err.stack ? err.stack : err}`);
    dialog.showErrorBox('KDSPOZ Retail failed to start', String(err && err.message ? err.message : err));
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
