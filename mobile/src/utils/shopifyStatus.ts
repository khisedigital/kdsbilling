import { colors } from '../theme/colors';
import type { ShopifyConnectionStatus, ShopifySyncStatus } from '../services/shopifyService';

export type Badge = { label: string; color: string; bg: string };

export const SHOPIFY_GREEN = '#5E8E3E';
export const SHOPIFY_GREEN_LIGHT = '#EEF6E7';

export function connectionBadge(status: ShopifyConnectionStatus | undefined): Badge {
  switch (status) {
    case 'connected':
      return { label: 'Connected', color: colors.success, bg: colors.successLight };
    case 'pending':
      return { label: 'Pending', color: colors.warning, bg: colors.warningLight };
    case 'error':
      return { label: 'Action needed', color: colors.error, bg: colors.errorLight };
    default:
      return { label: 'Not connected', color: colors.textMuted, bg: colors.surfaceVariant };
  }
}

export function syncBadge(status: ShopifySyncStatus | undefined): Badge {
  switch (status) {
    case 'ok':
      return { label: 'Synced', color: colors.success, bg: colors.successLight };
    case 'partial':
      return { label: 'Partial', color: colors.warning, bg: colors.warningLight };
    case 'running':
      return { label: 'Syncing', color: colors.primary, bg: colors.primaryLight };
    case 'queued':
      return { label: 'Queued', color: colors.secondary, bg: colors.secondaryLight };
    case 'error':
      return { label: 'Failed', color: colors.error, bg: colors.errorLight };
    default:
      return { label: 'Not synced', color: colors.textMuted, bg: colors.surfaceVariant };
  }
}

export function isSyncActive(status: ShopifySyncStatus | undefined): boolean {
  return status === 'queued' || status === 'running';
}
