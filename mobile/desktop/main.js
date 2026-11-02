const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, protocol, session, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { sendRaw, sendRawToSystemPrinter, listWindowsPrinters } = require('./rawPrint');

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
 * Keep real, reachable printers only (macOS / Linux via Electron/CUPS).
 * Windows uses Get-Printer instead — Electron still lists PendingDeletion queues.
 */
function isPrinterOnline(printer) {
  if (!printer) return false;
  const status = Number(printer.status) || 0;
  const options = printer.options || {};
  const reasons = String(options['printer-state-reasons'] || options['printer-state-message'] || '');
  if (/offline|shutdown|disconnected|connecting-to-device/i.test(reasons)) return false;

  const state = String(options['printer-state'] || '');
  // IPP: 3 idle, 4 processing, 5 stopped
  if (state === '5' || /stopped/i.test(state)) return false;
  if (status === 0 || status === 3 || status === 4) return true;
  if (!state || state === '3' || state === '4') return true;
  return status === 0;
}

function filterListedPrinters(printers) {
  return (printers || [])
    .filter((p) => p && (p.name || p.displayName))
    .filter((p) => !isVirtualPrinter(p))
    .filter((p) => isPrinterOnline(p));
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
      }));
    } catch (err) {
      startupLog(`listWindowsPrinters failed: ${err && err.message ? err.message : err}`);
      // Fall through to Electron list if PowerShell is blocked.
    }
  }

  const printers = await webContents.getPrintersAsync();
  return filterListedPrinters(printers).map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: Boolean(p.isDefault),
  }));
}

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
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
    const { host, port, base64 } = options || {};
    if (typeof host !== 'string' || !host.trim()) throw new Error('No network printer IP configured.');
    const portNumber = Number(port) || 9100;
    if (portNumber < 1 || portNumber > 65535) throw new Error('Invalid printer port.');
    const data = Buffer.from(String(base64 || ''), 'base64');
    if (!data.length) throw new Error('Nothing to print.');

    await sendRaw(host.trim(), portNumber, data);
  });

  /** 58/80 mm POS: raw ESC/POS to an OS printer queue (same as mobile). */
  ipcMain.handle('printers:print-raw-system', async (_event, options) => {
    const { printerName, base64 } = options || {};
    const data = Buffer.from(String(base64 || ''), 'base64');
    if (!data.length) throw new Error('Nothing to print.');
    await sendRawToSystemPrinter(printerName, data);
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

  app.whenReady().then(() => {
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
