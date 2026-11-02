const { contextBridge, ipcRenderer } = require('electron');

function call(channel, payload) {
  return ipcRenderer.invoke(channel, payload).catch((err) => {
    const message = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    throw new Error(message);
  });
}

contextBridge.exposeInMainWorld('kdsDesktop', {
  isDesktop: true,
  platform: process.platform,
  listPrinters: () => call('printers:list'),
  printHtml: (options) => call('printers:print-html', options),
  printRaw: (options) => call('printers:print-raw', options),
  printRawSystem: (options) => call('printers:print-raw-system', options),
  saveFile: (options) => call('files:save', options),
});
