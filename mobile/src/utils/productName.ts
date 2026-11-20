import { useLanguageStore, type AppLanguage } from '../i18n/languageStore';

/** Screen label: Marathi name when the UI is Marathi and one is set. */
export function screenProductName(name: string, nameMr?: string | null): string {
  const mr = nameMr?.trim();
  if (useLanguageStore.getState().ui === 'mr' && mr) return mr;
  return name;
}

/**
 * Printed bill / saved line name follows Shop → Bill language.
 * Marathi bill → Marathi name when set, otherwise English.
 */
export function billProductName(name: string, nameMr?: string | null): string {
  const english = String(name || '').trim();
  const marathi = String(nameMr || '').trim();
  if (useLanguageStore.getState().bill === 'mr' && marathi) return marathi;
  return english || marathi;
}

function withVariantSuffix(base: string, size?: string | null, color?: string | null): string {
  const name = String(base || '').trim();
  const parts = [size, color].map((p) => String(p || '').trim()).filter(Boolean);
  if (!name) return parts.join(' · ') || '-';
  // Avoid doubling if the API already appended "(size)".
  if (parts.length && name.includes(`(${parts.join(' · ')})`)) return name;
  return parts.length ? `${name} (${parts.join(' · ')})` : name;
}

/**
 * Name for a printed bill line from cart (+ optional preview name from API).
 * Uses bill language, not screen language — so Marathi on the bill when bill lang is mr.
 */
export function printedCartLineName(
  cart: {
    productName?: string | null;
    productNameMr?: string | null;
    size?: string | null;
    color?: string | null;
  } | null | undefined,
  previewName?: string | null,
): string {
  const english = String(cart?.productName || previewName || '').trim();
  const marathi = String(cart?.productNameMr || '').trim();
  const base = billProductName(english, marathi);
  // If preview already localized the full line (Marathi + size), keep it when bill is mr.
  const preview = String(previewName || '').trim();
  if (
    useLanguageStore.getState().bill === 'mr'
    && marathi
    && preview
    && preview.includes(marathi)
  ) {
    return preview;
  }
  return withVariantSuffix(base, cart?.size, cart?.color);
}

type NameMrSource = string | null | undefined | { name_mr?: string | null; nameMr?: string | null };

/** Accept plain Marathi string, or snake_case / camelCase fields from API. */
export function resolveNameMr(source?: NameMrSource): string {
  if (source == null) return '';
  if (typeof source === 'string') return source.trim();
  return String(source.name_mr ?? source.nameMr ?? '').trim();
}

/** Selected language on top, the other name underneath. One line when they match. */
export function stackedNames(
  name: string,
  nameMr: NameMrSource,
  ui: AppLanguage,
): { title: string; other: string } {
  const english = name?.trim() || '';
  const marathi = resolveNameMr(nameMr);
  const same =
    !!marathi && english.localeCompare(marathi, undefined, { sensitivity: 'accent' }) === 0;
  // Selected UI language always leads when that translation exists.
  const title = ui === 'mr' ? (marathi || english) : (english || marathi);
  const other = !marathi || !english || same
    ? ''
    : ui === 'mr'
      ? english
      : marathi;
  return { title, other };
}

/** Single-line label in the active UI language (for pickers / filters). */
export function localizedLabel(
  name: string,
  nameMr: NameMrSource,
  ui: AppLanguage,
): string {
  return stackedNames(name, nameMr, ui).title;
}
