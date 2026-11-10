import { useCallback } from 'react';
import { mr as mrBase, mrPatterns } from './mr';
import { mrExtra } from './mrExtra';
import { useLanguageStore, type AppLanguage } from './languageStore';

const mr: Record<string, string> = { ...mrBase, ...mrExtra };

export type { AppLanguage };
export { useLanguageStore };

type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value));
  }
  return out;
}

export function translate(lang: AppLanguage, text: string, vars?: Vars): string {
  if (!text) return text;
  if (lang !== 'mr') return fill(text, vars);
  const exact = mr[text];
  if (exact) return fill(exact, vars);
  for (const [pattern, template] of mrPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const replaced = template.replace(/\$(\d+)/g, (_, index) => match[Number(index)] ?? '');
    return fill(replaced, vars);
  }
  return fill(text, vars);
}

/** Current screen language. Safe in event handlers. */
export function t(text: string, vars?: Vars): string {
  return translate(useLanguageStore.getState().ui, text, vars);
}

/** Printed bill language, independent of the screen. */
export function billT(text: string, vars?: Vars): string {
  return translate(useLanguageStore.getState().bill, text, vars);
}

/** Subscribe the component so it refreshes when the screen language changes. */
export function useT() {
  const ui = useLanguageStore((s) => s.ui);
  return useCallback((text: string, vars?: Vars) => translate(ui, text, vars), [ui]);
}

export function useBillLanguage() {
  return useLanguageStore((s) => s.bill);
}

const PAYMENT_KEYS: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  credit: 'Credit',
  store_credit: 'Wallet',
};

export function paymentLabel(mode: string | null | undefined, tr: (text: string) => string = t): string {
  const raw = String(mode || '').toLowerCase();
  const key = PAYMENT_KEYS[raw];
  if (key) return tr(key);
  if (!raw) return tr('Paid');
  return raw.replace(/_/g, ' ');
}
