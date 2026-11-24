const tcp = require('net');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execFileAsync = promisify(execFile);

/** Win32 PrinterStatus flags (Get-Printer). */
const WIN_PRINTER_PENDING_DELETION = 0x00000004;
const WIN_PRINTER_OFFLINE = 0x00000080;
const WIN_PRINTER_NOT_AVAILABLE = 0x00001000;

/** Ports that are never a physical POS / office printer. */
const VIRTUAL_PORT_RE = /^(PORTPROMPT:|FILE:|NUL:|SHRFAX:|Fax:)/i;

const VIRTUAL_PRINTER_RE =
  /pdf|xps|fax|onenote|send to|document writer|print to file|microsoft print to|adobe pdf|foxit|bullzip|cutepdf|dopdf|nitro pdf|pdfcreator|primopdf|nova.?pdf|redirected|microsoft shared/i;

/**
 * Windows source of truth for installed printers.
 * Electron getPrintersAsync still returns queues marked PendingDeletion after removal.
 */
async function listWindowsPrinters() {
  const script =
    'Get-Printer | Select-Object Name,PrinterStatus,PortName,DriverName,WorkOffline | ConvertTo-Json -Compress';
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 20000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
  );
  const raw = String(stdout || '').trim();
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((row) => {
      const name = String(row?.Name || '').trim();
      if (!name) return null;
      const status = Number(row?.PrinterStatus) || 0;
      const portName = String(row?.PortName || '');
      const driverName = String(row?.DriverName || '');
      const workOffline = Boolean(row?.WorkOffline);
      const label = `${name} ${driverName}`;
      if (VIRTUAL_PRINTER_RE.test(label) || VIRTUAL_PORT_RE.test(portName)) return null;
      // Still list paused/offline USB POS queues — RAW jobs often flip these flags
      // and hiding them made the app show an empty printer list after a few prints.
      if (status & WIN_PRINTER_PENDING_DELETION) return null;
      void workOffline;
      const rawFriendly = /generic|text only|raw/i.test(`${name} ${driverName}`);
      return {
        name,
        displayName: driverName ? `${name} · ${driverName}` : name,
        isDefault: false,
        status,
        portName,
        driverName,
        rawFriendly,
      };
    })
    .filter(Boolean);
}

function normalizeCopies(copies) {
  const n = Math.floor(Number(copies) || 1);
  return Math.max(1, Math.min(999, n));
}

/** 0 = send payload once as-is. 1–10 = repeat unit buffer in batches of that size. */
function normalizeBatchSize(batchSize) {
  const n = Math.floor(Number(batchSize) || 0);
  if (n <= 0) return 0;
  return Math.max(1, Math.min(10, n));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tempPath(ext) {
  return path.join(
    os.tmpdir(),
    `kdspoz-escpos-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`,
  );
}

function resolvePrintOpts(copiesOrOpts) {
  if (copiesOrOpts && typeof copiesOrOpts === 'object') {
    return {
      copies: normalizeCopies(copiesOrOpts.copies),
      batchSize: normalizeBatchSize(copiesOrOpts.batchSize),
      lingerMs: copiesOrOpts.lingerMs,
    };
  }
  return { copies: normalizeCopies(copiesOrOpts), batchSize: 0 };
}

/**
 * TCP :9100 — the portable POS standard (Mac / Windows / phone on same LAN).
 * Success = all bytes written + linger, not “socket closed” (many heads never close).
 */
function sendRawOnce(
  host,
  port,
  data,
  { connectTimeoutMs = 8000, idleTimeoutMs = 20000, lingerMs = 400 } = {},
) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return new Promise((resolve, reject) => {
    let settled = false;
    let lingerTimer = null;
    const socket = tcp.createConnection({ host, port });

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(lingerTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(connectTimeoutMs);
    socket.on('data', () => {});
    socket.once('connect', () => {
      socket.setTimeout(idleTimeoutMs);
      socket.end(buf, () => {
        lingerTimer = setTimeout(() => finish(), lingerMs);
      });
    });
    socket.once('timeout', () => {
      finish(
        new Error(
          socket.connecting
            ? `Printer ${host}:${port} did not respond. Check the IP, port and that the printer is on.`
            : `Printer ${host}:${port} stopped accepting data. Check paper and cover.`,
        ),
      );
    });
    socket.once('error', (err) => finish(new Error(`Cannot reach printer ${host}:${port} (${err.message})`)));
    socket.once('close', () => finish());
  });
}

/**
 * One write at a time per host:port. Same mutex rules as USB/system so 3 clicks
 * cannot overlap ESC @ on the wire.
 */
async function sendRaw(host, port, data, options = {}) {
  const { copies, batchSize } = resolvePrintOpts(options);
  const key = `net:${String(host || '').trim()}:${Number(port) || 9100}`;
  const unit = Buffer.isBuffer(data) ? data : Buffer.from(data);

  const sendPayload = async (payload) => {
    const body = prepareChainedPayload(key, payload);
    // Short linger only — head settle runs in the pump *after* UI unlocks.
    console.log('[KDSPOZ] net write', key, 'bytes=', body.length);
    await sendRawOnce(host, port, body, { lingerMs: 500 });
    markSlipSent(key);
  };

  if (!batchSize) {
    for (let i = 0; i < copies; i += 1) {
      await sendPayload(unit);
    }
    return;
  }

  let remaining = copies;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const payload = n === 1 ? unit : Buffer.concat(Array.from({ length: n }, () => unit));
    remaining -= n;
    await sendPayload(payload);
  }
}

/**
 * Queue a job. Resolves as soon as bytes are accepted by the printer/driver,
 * or rejects if the printer is offline/cover open/out of paper.
 */
function enqueueRawJob(queueName, jobFields) {
  const q = getPrintQueue(queueName);
  const seq = (printSeq += 1);
  return new Promise((resolve, reject) => {
    q.jobs.push({
      seq,
      ...jobFields,
      resolve,
      reject,
    });
    console.log(
      '[KDSPOZ] enqueue',
      `#${seq}`,
      queueName,
      'bytes=',
      jobFields.buf && jobFields.buf.length,
      'depth=',
      q.jobs.length,
      'busy=',
      q.busy,
    );
    setImmediate(() => pumpPrintQueue(queueName));
  });
}

function isLabelJob(copiesOrOpts) {
  const opts = copiesOrOpts && typeof copiesOrOpts === 'object' ? copiesOrOpts : {};
  return String(opts.jobKind || opts.kind || '').toLowerCase() === 'label';
}

/** FIFO for network printers (shared with system queue map by key). */
async function sendRawToNetworkPrinter(host, port, data, copiesOrOpts = 1) {
  const h = String(host || '').trim();
  if (!h) throw new Error('No network printer IP configured.');
  const p = Number(port) || 9100;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) throw new Error('Nothing to print.');
  // Labels: direct write (gapLabel already paces ×2). Do not use bill FIFO.
  if (isLabelJob(copiesOrOpts)) {
    await sendRaw(
      h,
      p,
      buf,
      copiesOrOpts && typeof copiesOrOpts === 'object' ? copiesOrOpts : {},
    );
    return;
  }
  return enqueueRawJob(`net:${h}:${p}`, {
    buf: Buffer.from(buf),
    copiesOrOpts:
      copiesOrOpts && typeof copiesOrOpts === 'object' ? { ...copiesOrOpts } : copiesOrOpts,
    _net: { host: h, port: p },
  });
}

function assertPrinterName(printerName) {
  const name = String(printerName || '').trim();
  if (!name) {
    throw new Error(
      'Select your POS thermal printer in Printer Settings. 58/80 mm needs a named printer (not “Ask every time”).',
    );
  }
  return name;
}

/** How many jobs are still in the OS queue (printing or waiting). */
async function countQueuedJobs(printerName) {
  const name = String(printerName || '').trim();
  if (!name) return 0;
  try {
    if (process.platform === 'win32') {
      const q = (s) => String(s).replace(/'/g, "''");
      const script = `@(Get-PrintJob -PrinterName '${q(name)}' -ErrorAction SilentlyContinue).Count`;
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 10000, windowsHide: true, maxBuffer: 64 * 1024 },
      );
      const n = parseInt(String(stdout || '').trim(), 10);
      return Number.isFinite(n) ? Math.max(0, n) : 0;
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      const { stdout } = await execFileAsync('lpstat', ['-o', name], {
        timeout: 8000,
        maxBuffer: 512 * 1024,
      });
      return String(stdout || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && /[0-9]/.test(line.split(/\s+/)[0] || '')).length;
    }
  } catch {
    return 0;
  }
  return 0;
}

/**
 * Re-enable a CUPS queue left "disabled / Unable to send data".
 * Never cancel -a here — that deleted the next bill when the user clicked Print
 * several times (4 clicks → 2 slips).
 */
async function reviveUnixPrinter(printerName, { quick = false } = {}) {
  const name = String(printerName || '').trim();
  if (!name || (process.platform !== 'darwin' && process.platform !== 'linux')) return;
  // Quick path: one cupsenable so the first click is not delayed by 3 process spawns.
  await execFileAsync('cupsenable', [name], { timeout: 5000 }).catch(() => null);
  if (quick) return;
  await execFileAsync('cupsaccept', [name], { timeout: 5000 }).catch(() => null);
  await execFileAsync('cupsenable', ['-E', name], { timeout: 5000 }).catch(() => null);
}

/**
 * Industry POS pattern (same idea as escpos-direct / retail-print-kit / most shop apps):
 *   1. One mutex per device — never overlap two writes
 *   2. Write ALL bytes to the device (not “spooler accepted”)
 *   3. Hold the lock for a content-based settle so the head finishes
 *   4. Then release — only then may the next slip’s ESC @ run
 *
 * Prefer: TCP :9100 > USB bulk/backend > Windows RAW > CUPS `lp` (last resort).
 * CUPS alone is why 1 works, 2 dies at 2 lines, 3 works — “accepted” ≠ paper done.
 */
const printQueues = new Map();
/** Last time we finished a slip on this printer (for ESC @ chaining). */
const lastSlipAt = new Map();
let printSeq = 0;

function getPrintQueue(printerName) {
  const name = String(printerName || '').trim();
  let q = printQueues.get(name);
  if (!q) {
    q = { jobs: [], busy: false };
    printQueues.set(name, q);
  }
  return q;
}

function isPrintQueueBusy(printerName) {
  const q = printQueues.get(String(printerName || '').trim());
  return Boolean(q && (q.busy || q.jobs.length));
}

/**
 * Gap before the next job in the shared FIFO.
 * We print via CUPS `lp` now — the spooler already serializes USB traffic.
 * Long settles (2–3.5s) made the *next* Print click sit in queue (“starts late”).
 */
function estimateHeadFlushMs(byteLength, copiesOrOpts) {
  void byteLength;
  const opts = copiesOrOpts && typeof copiesOrOpts === 'object' ? copiesOrOpts : {};
  const kind = String(opts.jobKind || opts.kind || '').toLowerCase();
  const batchSize = normalizeBatchSize(opts.batchSize);
  const isLabel = kind === 'label' || batchSize > 0;
  // Tiny yield only so setImmediate can pick up a click that arrived mid-write.
  return isLabel ? 50 : 100;
}

/**
 * Back-to-back slips: drop leading ESC @ so the next job cannot wipe the one
 * still in the head buffer (that looked like “one print missing”).
 */
function prepareChainedPayload(printerName, payload) {
  const name = String(printerName || '').trim();
  const buf = Buffer.isBuffer(payload) ? Buffer.from(payload) : Buffer.from(payload);
  const gapMs = Date.now() - (lastSlipAt.get(name) || 0);
  if (gapMs < 120000 && buf.length >= 2 && buf[0] === 0x1b && buf[1] === 0x40) {
    console.log('[KDSPOZ] chain slip — skip ESC @ (gap', gapMs, 'ms)');
    return Buffer.concat([Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]), buf.subarray(2)]);
  }
  return buf;
}

/** USB burst path: never send ESC @ per slip — init runs once when the cable is claimed. */
function stripEscInit(payload) {
  const buf = Buffer.isBuffer(payload) ? Buffer.from(payload) : Buffer.from(payload);
  if (buf.length >= 2 && buf[0] === 0x1b && buf[1] === 0x40) {
    return Buffer.concat([Buffer.from([0x0a, 0x0a, 0x0a, 0x0a]), buf.subarray(2)]);
  }
  return buf;
}

function markSlipSent(printerName) {
  lastSlipAt.set(String(printerName || '').trim(), Date.now());
}

async function checkUnixPrinterStatus(printerName) {
  const name = String(printerName || '').trim();
  if (!name || (process.platform !== 'darwin' && process.platform !== 'linux')) return null;
  try {
    const { stdout: pOut } = await execFileAsync('lpstat', ['-p', name, '-l'], {
      timeout: 3000,
      maxBuffer: 512 * 1024,
    });
    const text = String(pOut || '');
    if (/door[\s_-]*open|cover[\s_-]*open/i.test(text)) {
      return 'Printer cover/door is open. Please close the cover.';
    }
    if (/media[\s_-]*empty|paper[\s_-]*out|out[\s_-]*of[\s_-]*paper/i.test(text)) {
      return 'Printer is out of paper. Please reload paper.';
    }
    if (/offline|unreachable|unable[\s_-]*to[\s_-]*send[\s_-]*data/i.test(text)) {
      return 'Printer is offline or disconnected.';
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Check for explicit printer faults while CUPS processes the accepted job.
 * Queue presence alone is not a failure: some printers take longer than a few
 * seconds to finish a receipt, and cancelling an active job can truncate it.
 */
async function verifyCupsJobNotStuck(printerName, jobId, byteLength) {
  const name = String(printerName || '').trim();
  if (!name || !jobId) return;

  const maxWaitMs = 3000;
  const started = Date.now();
  await sleep(200);

  while (Date.now() - started < maxWaitMs) {
    try {
      // 1. Check printer status line for immediate door-open or paper-empty
      const { stdout: pOut } = await execFileAsync('lpstat', ['-p', name, '-l'], {
        timeout: 2500,
        maxBuffer: 512 * 1024,
      }).catch(() => ({ stdout: '' }));
      const pText = String(pOut || '');
      if (/door[\s_-]*open|cover[\s_-]*open/i.test(pText)) {
        await execFileAsync('cancel', [jobId], { timeout: 3000 }).catch(() => null);
        throw new Error('Printer cover/door is open. Please close the cover.');
      }
      if (/media[\s_-]*empty|paper[\s_-]*out|out[\s_-]*of[\s_-]*paper/i.test(pText)) {
        await execFileAsync('cancel', [jobId], { timeout: 3000 }).catch(() => null);
        throw new Error('Printer is out of paper. Please reload paper.');
      }

      // 2. Check open jobs queue
      const { stdout: oOut } = await execFileAsync('lpstat', ['-o', name], {
        timeout: 2500,
        maxBuffer: 512 * 1024,
      }).catch(() => ({ stdout: '' }));
      const oText = String(oOut || '');
      const lines = oText.split('\n').map((l) => l.trim()).filter(Boolean);
      const isJobStillOpen = lines.some((l) => l.startsWith(jobId) || l.includes(jobId));
      if (!isJobStillOpen) {
        // Job successfully handed off to printer and printed!
        return;
      }

      // If still open, check if the job line has specific errors
      const jobLine = lines.find((l) => l.startsWith(jobId) || l.includes(jobId)) || '';
      if (/door[\s_-]*open|cover[\s_-]*open/i.test(jobLine)) {
        await execFileAsync('cancel', [jobId], { timeout: 3000 }).catch(() => null);
        throw new Error('Printer cover/door is open. Please close the cover.');
      }
      if (/media[\s_-]*empty|paper[\s_-]*out/i.test(jobLine)) {
        await execFileAsync('cancel', [jobId], { timeout: 3000 }).catch(() => null);
        throw new Error('Printer is out of paper. Please reload paper.');
      }
    } catch (err) {
      if (err.message && /cover|door|paper|offline/i.test(err.message)) {
        throw err;
      }
    }
    await sleep(250);
  }

  // `lp` already accepted the job. Do not infer a hardware failure from a
  // job that is still listed: valid receipts may take longer than this window.
}

/** Check an accepted CUPS job for explicit printer faults. */
async function waitCupsJobGone(printerName, jobId, byteLength) {
  return verifyCupsJobNotStuck(printerName, jobId, byteLength);
}

async function deliverSystemPrint(printerName, buf, copiesOrOpts) {
  if (process.platform === 'win32') {
    await sendRawWindows(printerName, buf, copiesOrOpts);
    return { via: 'windows' };
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return sendRawUnix(printerName, buf, copiesOrOpts);
  }
  throw new Error(`Raw POS printing is not supported on ${process.platform}.`);
}

async function canUseUsbBackend(printerName) {
  // Disabled: cupsdisable/claim left queues Paused (EPSON TM-T82, etc.) when the
  // app exited or release lagged. Bills use CUPS `lp -o raw` via the FIFO instead.
  void printerName;
  return false;
}

/**
 * Thermal USB on Mac: keep the cable claimed across bursts.
 * Logs showed release after every 2 prints → reclaim → “lines then restart”.
 */
const usbHeld = new Map();
const usbReleaseTimers = new Map();

async function claimUsbPrinter(printerName) {
  await execFileAsync('cupsenable', [printerName], { timeout: 5000 }).catch(() => null);
  await execFileAsync('cupsaccept', [printerName], { timeout: 5000 }).catch(() => null);
  await execFileAsync('cupsdisable', [printerName], { timeout: 5000 }).catch(() => null);
  // Short claim pause — 500ms made the first sticker feel laggy after USB release.
  await sleep(150);
  console.log('[KDSPOZ] usb claimed', printerName);
}

async function releaseUsbPrinter(printerName) {
  await execFileAsync('cupsenable', [printerName], { timeout: 5000 }).catch(() => null);
  await execFileAsync('cupsaccept', [printerName], { timeout: 5000 }).catch(() => null);
  console.log('[KDSPOZ] usb released', printerName);
}

/** One ESC @ when we first take the cable — never again per slip. */
async function sendUsbInit(printerName) {
  const init = Buffer.from([0x1b, 0x40, 0x0a, 0x0a]);
  const tempFile = tempPath('bin');
  await fs.writeFile(tempFile, init);
  try {
    await writeUsbBackendOnce(printerName, tempFile, init.length);
    await sleep(80);
  } finally {
    fs.unlink(tempFile).catch(() => {});
  }
}

async function ensureUsbHeld(printerName) {
  const name = String(printerName || '').trim();
  const existing = usbReleaseTimers.get(name);
  if (existing) clearTimeout(existing);
  if (usbHeld.get(name)) {
    console.log('[KDSPOZ] usb already held', name);
    return true;
  }
  await claimUsbPrinter(name);
  await sendUsbInit(name);
  usbHeld.set(name, true);
  return true;
}

function scheduleUsbRelease(printerName) {
  const name = String(printerName || '').trim();
  const prev = usbReleaseTimers.get(name);
  if (prev) clearTimeout(prev);
  // Keep cable for 45s after the last slip so 2–3 clicks do not reclaim mid-paper.
  const timer = setTimeout(() => {
    void (async () => {
      const q = getPrintQueue(name);
      if (q.busy || q.jobs.length) {
        scheduleUsbRelease(name);
        return;
      }
      usbHeld.delete(name);
      usbReleaseTimers.delete(name);
      await releaseUsbPrinter(name).catch(() => null);
    })();
  }, 45000);
  usbReleaseTimers.set(name, timer);
}

async function pumpPrintQueue(printerName) {
  const q = getPrintQueue(printerName);
  if (q.busy) return;
  q.busy = true;
  let useUsb = false;
  try {
    // Do not await cupsenable here — it delayed the first lp by hundreds of ms.
    // reviveUnixPrinter still runs if lp fails.
    if (await canUseUsbBackend(printerName)) {
      await ensureUsbHeld(printerName);
      useUsb = true;
    }
    while (q.jobs.length) {
      const job = q.jobs.shift();
      const tag = `#${job.seq || '?'}`;
      try {
        let delivered;
        if (job._net) {
          await sendRaw(job._net.host, job._net.port, job.buf, job.copiesOrOpts);
          delivered = { via: 'net' };
        } else if (useUsb) {
          await sendUsbBurstWrite(printerName, job.buf, job.copiesOrOpts);
          delivered = { via: 'usb' };
        } else {
          delivered = await deliverSystemPrint(printerName, job.buf, job.copiesOrOpts);
        }
        console.log(
          '[KDSPOZ] sent raw job',
          tag,
          printerName,
          'bytes=',
          job.buf.length,
          'via=',
          (delivered && delivered.via) || 'unknown',
          'queuedLeft=',
          q.jobs.length,
        );
        // Unlock Print button as soon as bytes are on the wire.
        if (typeof job.resolve === 'function') job.resolve();
        // Hold the device/gap before the *next* job only (UI already free).
        const settleMs = estimateHeadFlushMs(job.buf.length, job.copiesOrOpts);
        console.log('[KDSPOZ] head settle', settleMs, 'ms (ui already unlocked)');
        await sleep(settleMs);
      } catch (err) {
        console.error('[KDSPOZ] print failed', tag, ':', err && err.message ? err.message : err);
        if (typeof job.reject === 'function') {
          job.reject(err || new Error('Print failed.'));
        }
      }
    }
  } finally {
    if (useUsb) scheduleUsbRelease(printerName);
    q.busy = false;
    if (q.jobs.length) setImmediate(() => pumpPrintQueue(printerName));
  }
}

/**
 * Windows/CUPS often mark a thermal queue "Paused" after a RAW ESC/POS job.
 * One gentle resume — hammering cupsenable in a loop raced with the next job.
 * @param {{ clearJobs?: boolean }} [opts]
 */
async function unpauseSystemPrinter(printerName, opts = {}) {
  const name = String(printerName || '').trim();
  if (!name) return;
  const clearJobs = opts.clearJobs === true;
  try {
    if (process.platform === 'win32') {
      const q = (s) => String(s).replace(/'/g, "''");
      const script = `
$ErrorActionPreference = 'SilentlyContinue'
$name = '${q(name)}'
$clearJobs = $${clearJobs ? 'true' : 'false'}
try {
  $p = Get-Printer -Name $name -ErrorAction SilentlyContinue
  if ($p -and $p.WorkOffline) { Set-Printer -Name $name -WorkOffline $false }
  if (Get-Command Resume-Printer -ErrorAction SilentlyContinue) {
    Resume-Printer -Name $name -ErrorAction SilentlyContinue
  }
  if ($clearJobs) {
    Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue |
      Where-Object { $_.JobStatus -match 'Error|Paused|Retained|Blocked|UserIntervention' } |
      ForEach-Object { Remove-PrintJob -InputObject $_ -ErrorAction SilentlyContinue }
  }
  $safe = $name.Replace("'","''")
  $w = Get-CimInstance Win32_Printer -Filter ("Name='$safe'") -ErrorAction SilentlyContinue
  if ($w) {
    if ($w.WorkOffline) {
      $w.WorkOffline = $false
      $w.Put() | Out-Null
    }
    Invoke-CimMethod -InputObject $w -MethodName ResumePrinter -ErrorAction SilentlyContinue | Out-Null
  }
} catch {}
`;
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
      );
      return;
    }
    if (process.platform === 'darwin' || process.platform === 'linux') {
      await execFileAsync('cupsaccept', [name], { timeout: 10000 }).catch(() => null);
      await execFileAsync('cupsenable', [name], { timeout: 10000 }).catch(() => null);
      if (clearJobs) {
        // NEVER `cancel -a` — kills the active slip mid-header.
        try {
          const { stdout } = await execFileAsync('lpstat', ['-o', name], {
            timeout: 8000,
            maxBuffer: 512 * 1024,
          });
          for (const line of String(stdout || '').split('\n')) {
            const job = line.trim().split(/\s+/)[0];
            if (!job || !/[0-9]/.test(job)) continue;
            if (!/held|stopped|error|paused/i.test(line)) continue;
            await execFileAsync('cancel', [job], { timeout: 5000 }).catch(() => null);
          }
        } catch {
          /* no jobs */
        }
      }
    }
  } catch {
    /* best-effort */
  }
}

function parseLpJobId(stdout) {
  const m = String(stdout || '').match(/request id is\s+(\S+)/i);
  return m ? m[1].replace(/\(.*$/, '').trim() : null;
}

function cupsUsbBackendPath() {
  const { existsSync } = require('fs');
  const candidates = [
    '/usr/libexec/cups/backend/usb',
    '/usr/lib/cups/backend/usb',
    '/opt/homebrew/libexec/cups/backend/usb',
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

async function getPrinterDeviceUri(printerName) {
  const name = String(printerName || '').trim();
  if (!name) return '';
  try {
    const { stdout } = await execFileAsync('lpstat', ['-v', name], {
      timeout: 5000,
      maxBuffer: 256 * 1024,
    });
    const m = String(stdout || '').match(/device\s+for\s+[^:]+:\s+(\S+)/i);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Write while the pump already holds USB (cupsdisable). Do not enable/disable here.
 */
async function writeUsbBackendOnce(printerName, filePath, byteLength) {
  const backend = cupsUsbBackendPath();
  if (!backend) throw new Error('CUPS USB backend not found');
  const uri = await getPrinterDeviceUri(printerName);
  if (!/^usb:\/\//i.test(uri)) {
    throw new Error(`Printer “${printerName}” is not a USB device (${uri || 'no uri'})`);
  }

  const env = {
    ...process.env,
    DEVICE_URI: uri,
    PRINTER: printerName,
    LANG: 'C',
  };
  const args = [
    String(process.pid),
    process.env.USER || 'mac',
    'KDSPOZ',
    '1',
    '',
    filePath,
  ];

  const runOnce = async () => {
    let stderr = '';
    try {
      const result = await execFileAsync(backend, args, {
        timeout: 90000,
        maxBuffer: 2 * 1024 * 1024,
        env,
      });
      stderr = `${result.stdout || ''}\n${result.stderr || ''}`;
    } catch (err) {
      stderr = `${err?.stdout || ''}\n${err?.stderr || ''}\n${err?.message || ''}`;
    }
    const wrote = Number((stderr.match(/Wrote\s+(\d+)\s+bytes/i) || [])[1] || 0);
    const sent = Number((stderr.match(/Sent\s+(\d+)\s+bytes/i) || [])[1] || 0);
    return Math.max(wrote, sent);
  };

  let lastGot = await runOnce();
  // 0 bytes = device not ready yet (safe to retry once — nothing reached the head).
  if (lastGot === 0) {
    await sleep(700);
    lastGot = await runOnce();
  }
  if (lastGot < byteLength) {
    throw new Error(
      `USB wrote ${lastGot}/${byteLength} bytes to “${printerName}”. Check cable/paper.`,
    );
  }
  console.log('[KDSPOZ] usb wrote', lastGot, 'bytes to', printerName);
}

/** One thermal slip while USB is already claimed for the burst. */
async function sendUsbBurstWrite(printerName, data, copiesOrOpts = 1) {
  const { copies, batchSize } = resolvePrintOpts(copiesOrOpts);
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);

  const sendOnce = async (payload) => {
    // Always strip ESC @ on USB — init was sent once when the cable was claimed.
    const body = stripEscInit(payload);
    const tempFile = tempPath('bin');
    await fs.writeFile(tempFile, body);
    try {
      await writeUsbBackendOnce(printerName, tempFile, body.length);
      markSlipSent(printerName);
      // Head settle is done in pump *after* resolve so Print stops loading quickly.
    } finally {
      fs.unlink(tempFile).catch(() => {});
    }
  };

  if (!batchSize) {
    for (let i = 0; i < copies; i += 1) await sendOnce(raw);
    return;
  }
  let remaining = copies;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const payload = n === 1 ? raw : Buffer.concat(Array.from({ length: n }, () => raw));
    await sendOnce(payload);
    remaining -= n;
  }
}

/**
 * Feed RAW bytes to `lp` on stdin. Do NOT use a temp file — CUPS often still
 * needs the path after `lp` returns "accepted", and unlinking it drops the
 * *next* job (success → skip → success → skip).
 */
function lpRawStdin(printerName, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return new Promise((resolve, reject) => {
    const child = spawn(
      'lp',
      ['-d', printerName, '-o', 'raw', '-o', 'job-sheets=none', '--', '-'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, out) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(out || '');
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      finish(new Error(`lp timed out for “${printerName}”.`));
    }, 60000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) finish(null, stdout);
      else finish(new Error(String(stderr || stdout || `lp exit ${code}`).trim()));
    });
    child.stdin.on('error', () => {
      /* lp may close early after buffering — ignore broken pipe */
    });
    child.stdin.end(buf);
  });
}

/**
 * macOS/Linux: `lp -o raw` via stdin + head settle.
 *
 * Direct CUPS-USB backend was writing 0 bytes on every *alternate* job on
 * HaoYin (claim → write OK → release → next claim gets 0). Other shop apps that
 * look “USB direct” use libusb; the cupsdisable backend toggle is not safe here.
 * Keep one mutex (pump) + settle so the next ESC @ cannot cut the previous slip.
 */
async function sendRawUnix(printerName, data, copiesOrOpts = 1) {
  const { copies, batchSize } = resolvePrintOpts(copiesOrOpts);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  const sendOnceLp = async (payload) => {
    const preStatus = await checkUnixPrinterStatus(printerName);
    if (preStatus) {
      throw new Error(preStatus);
    }
    const body = prepareChainedPayload(printerName, payload);
    let stdout = '';
    try {
      stdout = await lpRawStdin(printerName, body);
    } catch (err) {
      await reviveUnixPrinter(printerName, { quick: true });
      try {
        stdout = await lpRawStdin(printerName, body);
      } catch (err2) {
        const detail = String(err2?.stderr || err2?.message || err?.message || err2);
        throw new Error(`lp failed for “${printerName}”: ${detail}`);
      }
    }
    const id = parseLpJobId(stdout);
    console.log('[KDSPOZ] lp accepted', id || '(none)', 'bytes=', body.length);
    markSlipSent(printerName);
    if (id) {
      await verifyCupsJobNotStuck(printerName, id, body.length);
    }
  };

  if (!batchSize) {
    for (let i = 0; i < copies; i += 1) {
      await sendOnceLp(buf);
    }
    return { via: 'lp' };
  }

  let remaining = copies;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const payload = n === 1 ? buf : Buffer.concat(Array.from({ length: n }, () => buf));
    await sendOnceLp(payload);
    remaining -= n;
  }
  return { via: 'lp' };
}

/**
 * Windows RAW via winspool:
 * - DOCINFOW as struct + ref (LPStruct/class marshaling fails on some PCs)
 * - Verify WritePrinter byte count
 * - One sticker (or small batch) per StartDoc so vendor/Generic drivers stay in sync
 * - Fallback: copy /b to the local printer share if WritePrinter rejects RAW
 *
 * Always one buffer = one StartDoc for receipts (no line-chunk pacing — that
 * printed ~2 lines then looked like a restart from the header).
 */
async function sendRawWindows(printerName, data, copiesOrOpts = 1) {
  const { copies, batchSize } = resolvePrintOpts(copiesOrOpts);
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const buf = prepareChainedPayload(printerName, raw);

  const tempFile = tempPath('bin');
  const psFile = tempPath('ps1');
  await fs.writeFile(tempFile, buf);

  const q = (s) => String(s).replace(/'/g, "''");
  // batchSize 0 → send the buffer once as-is (continuous multi-label payload).
  // batchSize N → treat buffer as one sticker; send N stickers per job, wait, repeat.
  const useBatches = batchSize > 0;
  const effectiveBatch = useBatches ? batchSize : 1;
  const typeName = `KdsRawPrinter${crypto.randomBytes(4).toString('hex')}`;
  // Seznik needs the head to finish ~3 stickers before the next USB burst (~1.1s/label).
  // Receipts: CUPS/Win can report idle while the head still prints — ESC @ on the
  // next job then wipes it (3 clicks → 1 slip).
  const pauseMs = useBatches
    ? Math.max(900, effectiveBatch * 1100)
    : estimateHeadFlushMs(buf.length, copiesOrOpts);

  const script = `
$ErrorActionPreference = 'Stop'
function Wait-KdsPrinterIdle([string]$name, [int]$minPauseMs, [int]$timeoutSec = 4) {
  if ($minPauseMs -gt 0) { Start-Sleep -Milliseconds $minPauseMs }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do {
    $jobs = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue)
    if ($jobs.Count -eq 0) { return }
    foreach ($j in $jobs) {
      $st = [string]$j.JobStatus
      if ($st -match 'DoorOpen|CoverOpen') {
        Remove-PrintJob -PrinterName $name -ID $j.ID -ErrorAction SilentlyContinue
        throw 'Printer cover/door is open.'
      }
      if ($st -match 'PaperOut|PaperProblem') {
        Remove-PrintJob -PrinterName $name -ID $j.ID -ErrorAction SilentlyContinue
        throw 'Printer is out of paper.'
      }
      if ($st -match 'Error|Offline|UserIntervention') {
        Remove-PrintJob -PrinterName $name -ID $j.ID -ErrorAction SilentlyContinue
        throw 'Printer offline or error.'
      }
    }
    Start-Sleep -Milliseconds 250
  } while ($sw.Elapsed.TotalSeconds -lt $timeoutSec)
  $remaining = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue)
  if ($remaining.Count -gt 0) {
    foreach ($j in $remaining) {
      Remove-PrintJob -PrinterName $name -ID $j.ID -ErrorAction SilentlyContinue
    }
    throw 'Printer offline / Door open or out of paper — job did not complete.'
  }
}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${typeName} {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW di);
  [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
  static string WinErr(string step) {
    int code = Marshal.GetLastWin32Error();
    return step + " failed (Win32 " + code + ")";
  }
  static void WriteAll(IntPtr hPrinter, byte[] payload) {
    IntPtr p = Marshal.AllocHGlobal(payload.Length);
    try {
      Marshal.Copy(payload, 0, p, payload.Length);
      // One WritePrinter for the whole job. Sleeping between 512-byte chunks
      // split GS v 0 bitmaps mid-command → head prints the shop line, stalls,
      // spooler retries and the slip restarts from ==== / shop name.
      int offset = 0;
      while (offset < payload.Length) {
        int chunk = payload.Length - offset;
        int written;
        if (!WritePrinter(hPrinter, IntPtr.Add(p, offset), chunk, out written) || written <= 0)
          throw new Exception(WinErr("WritePrinter"));
        offset += written;
      }
    } finally { Marshal.FreeHGlobal(p); }
  }
  public static void SendOnce(string printerName, byte[] payload) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception(WinErr("OpenPrinter"));
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "KDSPOZ Label";
      di.pOutputFile = null;
      di.pDataType = "RAW";
      int job = StartDocPrinter(hPrinter, 1, ref di);
      if (job <= 0) throw new Exception(WinErr("StartDocPrinter"));
      try {
        if (!StartPagePrinter(hPrinter)) throw new Exception(WinErr("StartPagePrinter"));
        try { WriteAll(hPrinter, payload); }
        finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
  public static void SendBatched(string printerName, byte[] unit, int copies, int batchSize) {
    int remaining = copies;
    while (remaining > 0) {
      int batch = remaining < batchSize ? remaining : batchSize;
      byte[] payload = batch == 1 ? unit : new byte[checked(unit.Length * batch)];
      if (batch > 1) {
        for (int i = 0; i < batch; i++)
          Buffer.BlockCopy(unit, 0, payload, i * unit.Length, unit.Length);
      }
      SendOnce(printerName, payload);
      remaining -= batch;
      // Caller waits for spooler idle between bursts (Seznik buffer ~3 labels).
    }
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${q(tempFile)}')
$printer = '${q(printerName)}'
try {
  if (${useBatches ? '$true' : '$false'}) {
    $remaining = ${copies}
    $batchSize = ${effectiveBatch}
    while ($remaining -gt 0) {
      $batch = [Math]::Min($batchSize, $remaining)
      [${typeName}]::SendBatched($printer, $bytes, $batch, $batch)
      $remaining -= $batch
      if ($remaining -gt 0) { Wait-KdsPrinterIdle $printer ${pauseMs} }
    }
  } else {
    [${typeName}]::SendOnce($printer, $bytes)
  }
} catch {
  $rawErr = $_.Exception.Message
  $share = '\\\\' + $env:COMPUTERNAME + '\\${q(printerName)}'
  if (${useBatches ? '$true' : '$false'}) {
    $remaining = ${copies}
    while ($remaining -gt 0) {
      cmd.exe /c "copy /b \`"${q(tempFile)}\`" \`"$share\`"" | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "RAW failed ($rawErr). copy /b fallback also failed. Reinstall this printer with Windows driver Generic / Text Only, then select that queue."
      }
      $remaining -= 1
      if ($remaining -gt 0) { Wait-KdsPrinterIdle $printer ${pauseMs} }
    }
  } else {
    cmd.exe /c "copy /b \`"${q(tempFile)}\`" \`"$share\`"" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "RAW failed ($rawErr). copy /b fallback also failed. Reinstall this printer with Windows driver Generic / Text Only, then select that queue."
    }
  }
}
`;
  await fs.writeFile(psFile, script, 'utf8');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { timeout: 300000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    markSlipSent(printerName);
  } catch (err) {
    await unpauseSystemPrinter(printerName, { clearJobs: false }).catch(() => null);
    const detail = String(err?.stderr || err?.stdout || err?.message || err).trim();
    const friendly = /unspecified|StartDocPrinter|WritePrinter|data type|datatype/i.test(detail)
      ? 'RAW print failed. On this PC install the label printer again with driver “Generic / Text Only” (not the DeTong/Xprinter graphics driver), then select that queue in KDSPOZ.'
      : detail;
    throw new Error(`Could not send to “${printerName}”. ${friendly}`);
  } finally {
    fs.unlink(tempFile).catch(() => {});
    fs.unlink(psFile).catch(() => {});
  }
}

/**
 * Queue a RAW thermal job. Resolves as soon as the job is accepted into the
 * FIFO (Print button clears). The pump writes and settles in the background
 * so bill slips do not collide.
 *
 * Labels (jobKind=label) skip this path entirely — they use direct lp/Windows
 * RAW like before, while gapLabel.ts paces Batched ×2. The bill USB-claim FIFO
 * is what made DeTong stickers crawl.
 */
async function sendRawToSystemPrinter(printerName, data, copiesOrOpts = 1) {
  const name = assertPrinterName(printerName);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) throw new Error('Nothing to print.');
  if (isLabelJob(copiesOrOpts)) {
    return deliverSystemPrint(name, buf, copiesOrOpts);
  }
  return enqueueRawJob(name, {
    buf: Buffer.from(buf),
    copiesOrOpts:
      copiesOrOpts && typeof copiesOrOpts === 'object' ? { ...copiesOrOpts } : copiesOrOpts,
  });
}

module.exports = {
  sendRaw,
  sendRawToSystemPrinter,
  sendRawToNetworkPrinter,
  listWindowsPrinters,
  reviveUnixPrinter,
  unpauseSystemPrinter,
  isPrintQueueBusy,
};
