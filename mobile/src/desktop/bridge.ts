export type DesktopPrinter = {
  name: string;
  displayName: string;
  isDefault: boolean;
  /** Windows: spooler driver name (e.g. Generic / Text Only). */
  driverName?: string;
  /** Windows: driver looks safe for RAW ESC/POS. */
  rawFriendly?: boolean;
};

export type DesktopPrintHtmlOptions = {
  html: string;
  /** Installed printer name; empty shows the system print dialog */
  printerName?: string;
  silent?: boolean;
  /** Page width in millimetres for roll (thermal) paper */
  pageWidthMm?: number;
  pageHeightMm?: number;
  /** Force A4 paper */
  a4?: boolean;
  /** Exact page size with no printer margins (thermal receipts) */
  noMargins?: boolean;
  /** Prefer CSS @page size from the HTML (roll width from Paper size setting) */
  preferCssPageSize?: boolean;
};

export type DesktopSaveFileOptions = {
  filename: string;
  mime: string;
  base64?: string;
  text?: string;
};

export type DesktopBridge = {
  isDesktop: true;
  platform: string;
  listPrinters: () => Promise<DesktopPrinter[]>;
  printHtml: (options: DesktopPrintHtmlOptions) => Promise<void>;
  printRaw: (options: {
    host: string;
    port: number;
    base64: string;
    copies?: number;
    /** Gap labels: stickers per OS write (e.g. 3). */
    batchSize?: number;
  }) => Promise<void>;
  /** ESC/POS to an OS-installed POS printer (58/80 mm). Optional on older desktop builds. */
  printRawSystem?: (options: {
    printerName: string;
    base64: string;
    /** How many times to send the unit buffer (one sticker). */
    copies?: number;
    /** Stickers per spool write — keeps DeTong gap aligned (use 3). */
    batchSize?: number;
  }) => Promise<void>;
  saveFile: (options: DesktopSaveFileOptions) => Promise<{ saved: boolean; path?: string }>;
};

/** Present only inside the Electron app (exposed by desktop/preload.js) */
export function getDesktopBridge(): DesktopBridge | null {
  const bridge = (globalThis as { kdsDesktop?: DesktopBridge }).kdsDesktop;
  return bridge?.isDesktop ? bridge : null;
}
