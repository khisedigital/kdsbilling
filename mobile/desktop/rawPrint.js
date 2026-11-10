const tcp = require('net');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
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
      if (workOffline) return null;
      if (status & (WIN_PRINTER_PENDING_DELETION | WIN_PRINTER_OFFLINE | WIN_PRINTER_NOT_AVAILABLE)) {
        return null;
      }
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
 * Sends raw bytes (ESC/POS) to a network printer, usually port 9100.
 * Many printers never close their side, so success is "all data written", not "connection closed".
 */
function sendRawOnce(
  host,
  port,
  data,
  { connectTimeoutMs = 8000, idleTimeoutMs = 15000, lingerMs = 400 } = {},
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

/** Optional batchSize: concat unit × batch per write so gap heads do not overrun. */
async function sendRaw(host, port, data, options = {}) {
  const { copies, batchSize, lingerMs = 400 } = resolvePrintOpts(options);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (!batchSize) {
    for (let i = 0; i < copies; i += 1) {
      await sendRawOnce(host, port, buf, {
        lingerMs: i + 1 < copies ? 80 : lingerMs,
      });
    }
    return;
  }

  let remaining = copies;
  while (remaining > 0) {
    const n = Math.min(batchSize, remaining);
    const payload = n === 1 ? buf : Buffer.concat(Array.from({ length: n }, () => buf));
    remaining -= n;
    await sendRawOnce(host, port, payload, {
      lingerMs: remaining > 0 ? 120 : lingerMs,
    });
  }
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

/** macOS / Linux: CUPS raw queue — same ESC/POS bytes as mobile Bluetooth. */
async function sendRawUnix(printerName, data, copiesOrOpts = 1) {
  const { copies, batchSize } = resolvePrintOpts(copiesOrOpts);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  const printFile = async (filePath) => {
    await execFileAsync('lp', ['-d', printerName, '-o', 'raw', filePath], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
  };

  try {
    if (!batchSize) {
      const tempFile = tempPath('bin');
      await fs.writeFile(tempFile, buf);
      try {
        for (let i = 0; i < copies; i += 1) {
          await printFile(tempFile);
        }
      } finally {
        fs.unlink(tempFile).catch(() => {});
      }
      return;
    }

    // One sticker unit on disk; each CUPS job is unit × batch (≤3).
    const unitFile = tempPath('bin');
    await fs.writeFile(unitFile, buf);
    try {
      let remaining = copies;
      while (remaining > 0) {
        const n = Math.min(batchSize, remaining);
        const payload = n === 1 ? buf : Buffer.concat(Array.from({ length: n }, () => buf));
        const batchFile = tempPath('bin');
        await fs.writeFile(batchFile, payload);
        try {
          await printFile(batchFile);
        } finally {
          fs.unlink(batchFile).catch(() => {});
        }
        remaining -= n;
        if (remaining > 0) await sleep(200);
      }
    } finally {
      fs.unlink(unitFile).catch(() => {});
    }
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim();
    throw new Error(
      `Could not send to “${printerName}”. Use a POS thermal printer queue (Generic/Text or the vendor driver). ${detail}`,
    );
  }
}

/**
 * Windows RAW via winspool:
 * - DOCINFOW as struct + ref (LPStruct/class marshaling fails on some PCs)
 * - Verify WritePrinter byte count
 * - One sticker (or small batch) per StartDoc so vendor/Generic drivers stay in sync
 * - Fallback: copy /b to the local printer share if WritePrinter rejects RAW
 */
async function sendRawWindows(printerName, data, copiesOrOpts = 1) {
  const { copies, batchSize } = resolvePrintOpts(copiesOrOpts);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
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
  const pauseMs = useBatches ? Math.max(900, effectiveBatch * 1100) : 0;

  const script = `
$ErrorActionPreference = 'Stop'
function Wait-KdsPrinterIdle([string]$name, [int]$minPauseMs, [int]$timeoutSec = 180) {
  if ($minPauseMs -gt 0) { Start-Sleep -Milliseconds $minPauseMs }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do {
    $jobs = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue)
    if ($jobs.Count -eq 0) { return }
    Start-Sleep -Milliseconds 250
  } while ($sw.Elapsed.TotalSeconds -lt $timeoutSec)
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
      int offset = 0;
      while (offset < payload.Length) {
        int chunk = Math.Min(4096, payload.Length - offset);
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
  } catch (err) {
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
 * Send ESC/POS bytes to an OS-installed printer (USB / BT / driver queue).
 * Pass `{ copies, batchSize }` for gap labels (unit buffer × batches).
 */
async function sendRawToSystemPrinter(printerName, data, copiesOrOpts = 1) {
  const name = assertPrinterName(printerName);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) throw new Error('Nothing to print.');

  if (process.platform === 'win32') {
    await sendRawWindows(name, buf, copiesOrOpts);
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    await sendRawUnix(name, buf, copiesOrOpts);
    return;
  }
  throw new Error(`Raw POS printing is not supported on ${process.platform}.`);
}

module.exports = { sendRaw, sendRawToSystemPrinter, listWindowsPrinters };
