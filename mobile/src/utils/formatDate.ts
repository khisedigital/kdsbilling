import { useLanguageStore } from '../i18n';

function appLocale(): string {
  return useLanguageStore.getState().ui === 'mr' ? 'mr-IN' : 'en-IN';
}

/** Normalize API timestamps (snake_case or camelCase). */
export function getCreatedAt(row?: {
  created_at?: string | Date | null;
  createdAt?: string | Date | null;
} | null): string | Date | null | undefined {
  if (!row) return null;
  return row.created_at ?? row.createdAt ?? null;
}

export function parseApiDate(value?: string | Date | null): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatBillListDate(value?: string | Date | null): string {
  const d = parseApiDate(value);
  if (!d) return '—';
  const locale = appLocale();
  return `${d.toLocaleDateString(locale)} · ${d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function formatDateTime(value?: string | Date | null): string {
  const d = parseApiDate(value);
  if (!d) return '—';
  return d.toLocaleString(appLocale());
}
