/// <reference lib="dom" />
export type PickedImage = {
  uri: string;
  fileName: string;
  type: string;
  file?: Blob;
};

/** Opens the system file chooser; resolves null if the user cancels */
export function pickImage(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.style.display = 'none';

    const finish = (value: PickedImage | null) => {
      input.remove();
      resolve(value);
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      finish({
        uri: URL.createObjectURL(file),
        fileName: file.name || 'logo.jpg',
        type: file.type || 'image/jpeg',
        file,
      });
    });
    input.addEventListener('cancel', () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}
