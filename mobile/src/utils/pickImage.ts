import { launchImageLibrary, type PhotoQuality } from 'react-native-image-picker';

export type PickedImage = {
  uri: string;
  fileName: string;
  type: string;
  /** Set on desktop, where uploads need the actual file */
  file?: Blob;
};

/** Returns null when the user cancels; throws with a readable message on picker errors */
export async function pickImage(): Promise<PickedImage | null> {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: 1,
    quality: 0.85 as PhotoQuality,
    maxWidth: 1200,
    maxHeight: 1200,
  });

  if (result.didCancel) return null;
  if (result.errorCode) throw new Error(result.errorMessage || result.errorCode);

  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error('No image selected');

  return {
    uri: asset.uri,
    fileName: asset.fileName || 'logo.jpg',
    type: asset.type || 'image/jpeg',
  };
}
