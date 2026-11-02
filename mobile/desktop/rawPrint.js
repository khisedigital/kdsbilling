const tcp = require('net');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

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
      return {
        name,
        displayName: name,
        isDefault: false,
        status,
        portName,
        driverName,
      };
    })
    .filter(Boolean);
}

/**
 * Sends raw bytes (ESC/POS) to a network printer, usually port 9100.
 * Many printers never close their side, so success is "all data written", not "connection closed".
 */
function sendRaw(host, port, data, { connectTimeoutMs = 8000, idleTimeoutMs = 15000, lingerMs = 1500 } = {}) {
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
    // Discard status bytes some printers send back; unread input turns the close into a reset.
    socket.on('data', () => {});
    socket.once('connect', () => {
      socket.setTimeout(idleTimeoutMs);
      socket.end(data, () => {
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
async function sendRawUnix(printerName, data) {
  const tempFile = path.join(os.tmpdir(), `kdspoz-escpos-${process.pid}-${Date.now()}.bin`);
  await fs.writeFile(tempFile, data);
  try {
    await execFileAsync('lp', ['-d', printerName, '-o', 'raw', tempFile], {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim();
    throw new Error(
      `Could not send to “${printerName}”. Use a POS thermal printer queue (Generic/Text or the vendor driver). ${detail}`,
    );
  } finally {
    fs.unlink(tempFile).catch(() => {});
  }
}

/**
 * Windows: Win32 StartDocPrinter RAW job via PowerShell (no native addon).
 * Uses Unicode (W) APIs — Ansi OpenPrinterA fails on many Win32 locales / names
 * and surfaces as Chromium/PowerShell "Unspecified error".
 */
async function sendRawWindows(printerName, data) {
  const tempFile = path.join(os.tmpdir(), `kdspoz-escpos-${process.pid}-${Date.now()}.bin`);
  const psFile = path.join(os.tmpdir(), `kdspoz-escpos-${process.pid}-${Date.now()}.ps1`);
  await fs.writeFile(tempFile, data);

  // Escape for single-quoted PowerShell strings.
  const q = (s) => String(s).replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class KdsRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode, ExactSpelling=true, CallingConvention=CallingConvention.StdCall)]
  public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
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
  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
      throw new Exception(WinErr("OpenPrinter"));
    try {
      DOCINFOW di = new DOCINFOW();
      di.pDocName = "KDSPOZ Receipt";
      di.pDataType = "RAW";
      if (StartDocPrinter(hPrinter, 1, di) == 0)
        throw new Exception(WinErr("StartDocPrinter"));
      try {
        if (!StartPagePrinter(hPrinter))
          throw new Exception(WinErr("StartPagePrinter"));
        try {
          IntPtr p = Marshal.AllocHGlobal(bytes.Length);
          try {
            Marshal.Copy(bytes, 0, p, bytes.Length);
            int written;
            if (!WritePrinter(hPrinter, p, bytes.Length, out written))
              throw new Exception(WinErr("WritePrinter"));
          } finally { Marshal.FreeHGlobal(p); }
        } finally { EndPagePrinter(hPrinter); }
      } finally { EndDocPrinter(hPrinter); }
    } finally { ClosePrinter(hPrinter); }
  }
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${q(tempFile)}')
[KdsRawPrinter]::SendBytes('${q(printerName)}', $bytes)
`;
  await fs.writeFile(psFile, script, 'utf8');
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
  } catch (err) {
    const detail = String(err?.stderr || err?.stdout || err?.message || err).trim();
    const friendly = /unspecified/i.test(detail)
      ? 'Printer rejected the job. Use a POS/thermal queue (Generic/Text Only) and confirm the exact printer name in Printer Settings.'
      : detail;
    throw new Error(`Could not send to “${printerName}”. ${friendly}`);
  } finally {
    fs.unlink(tempFile).catch(() => {});
    fs.unlink(psFile).catch(() => {});
  }
}

/**
 * Send ESC/POS bytes to an OS-installed printer (USB / BT / driver queue).
 * Same command language as mobile — avoids HTML paper-size issues for 58/80 mm.
 */
async function sendRawToSystemPrinter(printerName, data) {
  const name = assertPrinterName(printerName);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (!buf.length) throw new Error('Nothing to print.');

  if (process.platform === 'win32') {
    await sendRawWindows(name, buf);
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'linux') {
    await sendRawUnix(name, buf);
    return;
  }
  throw new Error(`Raw POS printing is not supported on ${process.platform}.`);
}

module.exports = { sendRaw, sendRawToSystemPrinter, listWindowsPrinters };
