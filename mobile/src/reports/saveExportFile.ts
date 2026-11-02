import { Platform } from 'react-native';
import Share from 'react-native-share';
import ReactNativeBlobUtil from 'react-native-blob-util';

export type ExportFile = {
  filename: string;
  mime: string;
  title: string;
  base64?: string;
  text?: string;
};

export function isShareCancelled(err: unknown) {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /User did not share|User cancelled|canceled|cancel/i.test(message);
}

/** Writes the file to the app cache and opens the share sheet */
export async function saveExportFile(file: ExportFile): Promise<void> {
  const dirs = ReactNativeBlobUtil.fs.dirs;
  const cacheDir = dirs.CacheDir || dirs.DocumentDir;
  const path = `${cacheDir}/${file.filename}`;

  if (file.base64 !== undefined) {
    await ReactNativeBlobUtil.fs.writeFile(path, file.base64, 'base64');
  } else {
    await ReactNativeBlobUtil.fs.writeFile(path, file.text ?? '', 'utf8');
  }

  const fileUrl = path.startsWith('file://') ? path : `file://${path}`;
  await Share.open({
    title: file.title,
    subject: file.title,
    url: Platform.OS === 'ios' ? path : fileUrl,
    type: file.mime,
    filename: file.filename,
    failOnCancel: false,
    showAppsToView: true,
  });
}
