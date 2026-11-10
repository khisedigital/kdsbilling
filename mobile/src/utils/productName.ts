import { useLanguageStore } from '../i18n/languageStore';

/** Screen label: Marathi name when the UI is Marathi and one is set. */
export function screenProductName(name: string, nameMr?: string | null): string {
  const mr = nameMr?.trim();
  if (useLanguageStore.getState().ui === 'mr' && mr) return mr;
  return name;
}
