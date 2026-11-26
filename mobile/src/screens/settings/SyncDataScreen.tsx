import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import SectionCard from '../../components/ui/SectionCard';
import { useT } from '../../i18n';
import { isDesktopOfflineCapable } from '../../offline/capability';
import { useConnectivityStore } from '../../offline/connectivityStore';
import { sqliteGetMeta, sqlitePendingCount, sqliteStatus } from '../../offline/sqliteApi';
import { syncNow, type SyncResult } from '../../offline/syncEngine';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';

function formatSyncAt(iso: string | null | undefined, neverLabel: string): string {
  if (!iso) return neverLabel;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return neverLabel;
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function SyncDataScreen() {
  const t = useT();
  const online = useConnectivityStore((s) => s.online);
  const syncing = useConnectivityStore((s) => s.syncing);
  const pendingCount = useConnectivityStore((s) => s.pendingCount);
  const lastSyncError = useConnectivityStore((s) => s.lastSyncError);
  const lastSyncAt = useConnectivityStore((s) => s.lastSyncAt);
  const setLastSyncAt = useConnectivityStore((s) => s.setLastSyncAt);
  const setPendingCount = useConnectivityStore((s) => s.setPendingCount);

  const [loadingMeta, setLoadingMeta] = useState(true);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [localOnlyCount, setLocalOnlyCount] = useState(0);
  const [localOnlyRecords, setLocalOnlyRecords] = useState<Array<{
    type: string; id: string; label: string | null; error: string | null;
  }>>([]);

  const refreshMeta = useCallback(async () => {
    if (!isDesktopOfflineCapable()) {
      setLoadingMeta(false);
      return;
    }
    try {
      const [at, pending, status] = await Promise.all([
        sqliteGetMeta('last_sync_at'),
        sqlitePendingCount().catch(() => 0),
        sqliteStatus(),
      ]);
      if (at) setLastSyncAt(at);
      setPendingCount(pending);
      setLocalOnlyCount(status?.localOnlyCount || 0);
      setLocalOnlyRecords(status?.localOnlyRecords || []);
    } finally {
      setLoadingMeta(false);
    }
  }, [setLastSyncAt, setPendingCount]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  const handleSync = async () => {
    if (syncing || !online) return;
    setLastResult(null);
    const result = await syncNow();
    setLastResult(result);
    await refreshMeta();
  };

  if (!isDesktopOfflineCapable()) {
    return (
      <View style={styles.center}>
        <Text style={typography.body}>{t('Sync is available on desktop only.')}</Text>
      </View>
    );
  }

  const statusLabel = syncing
    ? t('Syncing…')
    : !online
      ? t('Offline')
      : pendingCount > 0
        ? t('Online · {{count}} pending', { count: pendingCount })
        : t('Online');

  const statusColor = !online ? colors.warning : syncing ? colors.primary : colors.success;

  return (
    <ScrollView contentContainerStyle={[common.screenPad, styles.pad]}>
      <SectionCard title={t('Connection')}>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={typography.body}>{statusLabel}</Text>
        </View>
        <Text style={[typography.caption, styles.muted]}>
          {t('Green = online. Orange = offline. Blue pulse while syncing.')}
        </Text>
      </SectionCard>

      <SectionCard title={t('Last sync')}>
        {loadingMeta ? (
          <ActivityIndicator />
        ) : (
          <Text style={typography.body}>
            {formatSyncAt(lastSyncAt, t('Never synced'))}
          </Text>
        )}
        <Text style={[typography.caption, styles.muted, styles.mt]}>
          {localOnlyCount > 0
            ? t('Upload pending changes, then add missing live records without overwriting existing local data.')
            : t('Two-way sync: upload this PC’s pending changes, then download live data (including updates made on mobile).')}
        </Text>
        <Text style={[typography.caption, styles.muted, styles.mt]}>
          {t('Downloads include the catalog and recent bills, expenses and returns; purchase and stock-movement history is not downloaded.')}
        </Text>
        {localOnlyCount > 0 ? (
          <View style={styles.mt}>
            <Text style={[typography.caption, styles.warn]}>
              {t('{{count}} record(s) are local-only. Previously skipped missing-variant bills will be retried; other records stay local. Live stock and balances may differ. Only missing live records are downloaded.', { count: localOnlyCount })}
            </Text>
            <Text style={[typography.caption, styles.muted]}>{t('Latest local-only records (up to 20)')}</Text>
            {localOnlyRecords.map((record) => (
              <Text key={`${record.type}:${record.id}`} style={[typography.caption, styles.warn]}>
                {record.type}: {record.label || record.id}{record.error ? ` — ${record.error}` : ''}
              </Text>
            ))}
          </View>
        ) : null}
        <Text style={[typography.caption, styles.muted, styles.mt]}>
          {t('Tip: log in once online so this PC can unlock offline later.')}
        </Text>
      </SectionCard>

      <SectionCard title={t('Sync with live database')}>
        <Button
          mode="contained"
          icon="cloud-sync"
          onPress={() => void handleSync()}
          loading={syncing}
          disabled={syncing || !online}
          style={styles.btn}>
          {t('Sync now')}
        </Button>
        {!online ? (
          <Text style={[typography.caption, styles.warn, styles.mt]}>
            {t('Connect to the internet to sync.')}
          </Text>
        ) : null}
        {lastSyncError ? (
          <Text style={[typography.caption, styles.err, styles.mt]}>{lastSyncError}</Text>
        ) : null}
        {lastResult ? (
          <View style={styles.mt}>
            <Text style={typography.caption}>
              {t('Uploaded {{synced}} change(s)', { synced: lastResult.synced })}
              {lastResult.failed > 0
                ? ` · ${t('{{failed}} failed', { failed: lastResult.failed })}`
                : ''}
              {lastResult.skipped
                ? ` · ${t('{{count}} local-only', { count: lastResult.skipped })}`
                : ''}
            </Text>
            {lastResult.pulled ? (
              <Text style={[typography.caption, styles.muted]}>
                {t('Downloaded')}:{' '}
                {t('{{products}} products, {{categories}} categories, {{brands}} brands, {{customers}} customers', {
                  products: lastResult.pulled.products,
                  categories: lastResult.pulled.categories,
                  brands: lastResult.pulled.brands,
                  customers: lastResult.pulled.customers,
                })}
                {typeof lastResult.pulled.sales === 'number'
                  ? ` · ${t('{{count}} bills', { count: lastResult.pulled.sales })}`
                  : ''}
              </Text>
            ) : null}
          </View>
        ) : null}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: spacing.xl * 2, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  muted: { color: colors.textMuted, marginTop: 4 },
  warn: { color: colors.warning },
  err: { color: colors.error },
  mt: { marginTop: spacing.sm },
  btn: { alignSelf: 'flex-start', marginTop: spacing.xs },
});
