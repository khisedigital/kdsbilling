import { t } from '../i18n';
import { colors } from '../theme/colors';

export type StatusConfig = { label: string; color: string; bg: string; icon: string };

export const BILL_STATUS: Record<string, StatusConfig> = {
  completed: { label: 'Completed', color: colors.secondary, bg: colors.secondaryLight, icon: 'check-circle' },
  partially_returned: { label: 'Partially returned', color: colors.warning, bg: colors.warningLight, icon: 'undo-variant' },
  fully_returned: { label: 'Fully returned', color: colors.primary, bg: colors.primaryLight, icon: 'backup-restore' },
  void: { label: 'Voided', color: colors.error, bg: colors.errorLight, icon: 'close-circle' },
  held: { label: 'On hold', color: colors.warning, bg: colors.warningLight, icon: 'pause-circle' },
  draft: { label: 'Draft', color: colors.textMuted, bg: colors.surfaceVariant, icon: 'file-document-outline' },
};

export function getBillStatus(status: string): StatusConfig {
  const found = BILL_STATUS[status];
  if (!found) {
    return { label: t(status), color: colors.textMuted, bg: colors.surfaceVariant, icon: 'receipt' };
  }
  return { ...found, label: t(found.label) };
}

/** Bill can accept another return — driven by remaining item qty. */
export function itemRemainingQty(item?: {
  quantity?: string | number;
  returned_quantity?: string | number;
  returnedQuantity?: string | number;
} | null): number {
  if (!item) return 0;
  const sold = parseFloat(String(item.quantity ?? 0)) || 0;
  const returned = parseFloat(String(item.returned_quantity ?? item.returnedQuantity ?? 0)) || 0;
  return Math.max(0, Math.round((sold - returned) * 1000) / 1000);
}

export function canProcessReturn(bill?: {
  status?: string;
  is_returnable?: boolean;
  items?: Array<{
    quantity?: string | number;
    returned_quantity?: string | number;
    returnedQuantity?: string | number;
  }>;
} | null): boolean {
  if (!bill) return false;

  // Server flag is authoritative when present.
  if (typeof bill.is_returnable === 'boolean') {
    return bill.is_returnable;
  }

  const status = String(bill.status || '').toLowerCase();
  if (status === 'void' || status === 'fully_returned') return false;
  if (status !== 'completed' && status !== 'partially_returned') return false;

  const items = bill.items;
  if (Array.isArray(items)) {
    if (!items.length) return false;
    return items.some((item) => itemRemainingQty(item) > 0.0005);
  }

  // List rows without items — status only.
  return true;
}
