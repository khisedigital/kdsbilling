import { useLanguageStore, type AppLanguage } from '../i18n/languageStore';

/** Screen label: Marathi name when the UI is Marathi and one is set. */
export function screenProductName(name: string, nameMr?: string | null): string {
  const mr = nameMr?.trim();
  if (useLanguageStore.getState().ui === 'mr' && mr) return mr;
  return name;
}

/** Selected language on top, the other name underneath. One line when they match. */
export function stackedNames(
  name: string,
  nameMr: string | null | undefined,
  ui: AppLanguage,
): { title: string; other: string } {
  const english = name?.trim() || '';
  const marathi = nameMr?.trim() || '';
  const same =
    !!marathi && english.localeCompare(marathi, undefined, { sensitivity: 'accent' }) === 0;
  const title = ui === 'mr' && marathi ? marathi : english;
  const other = !marathi || same ? '' : ui === 'mr' ? english : marathi;
  return { title, other };
}
