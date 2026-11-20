/** Native (Android/iOS): no on-device model — use glossary / cache / online instead. */
export async function translateWithOfflineModel(_text: string): Promise<string | null> {
  return null;
}

export function prefetchOfflineModel(): void {
  /* no-op on native */
}
