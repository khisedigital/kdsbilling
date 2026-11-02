/// <reference lib="dom" />
import { getDesktopBridge } from '../desktop/bridge';

export type ExportFile = {
  filename: string;
  mime: string;
  title: string;
  base64?: string;
  text?: string;
};

export function isShareCancelled(_err: unknown) {
  return false;
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Desktop: native "Save as" dialog. Browser: regular download. */
export async function saveExportFile(file: ExportFile): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge) {
    await bridge.saveFile({ filename: file.filename, mime: file.mime, base64: file.base64, text: file.text });
    return;
  }

  const data = file.base64 !== undefined ? base64ToBytes(file.base64) : file.text ?? '';
  const url = URL.createObjectURL(new Blob([data], { type: file.mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
