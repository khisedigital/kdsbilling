import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import SectionCard from '../../components/ui/SectionCard';
import { useT } from '../../i18n';
import { isDesktopOfflineCapable } from '../../offline/capability';
import { useConnectivityStore } from '../../offline/connectivityStore';
import { sqliteGetMeta, sqlitePendingCount, sqliteStatus } from '../../offline/sqliteApi';
import { syncNow, type SyncResult } from '../../offline/syncEngine';
import { common, spacing, typography } from '../../theme/layout';

export default function SyncDataScreen() {
  const t = useT();
  const online = useConnectivityStore((s) => s.online);
  const syncing = useConnectivityStore((s) => s.syncing);
  const setLastSyncAt = useConnectivityStore((s) => s.setLastSyncAt);
  const setPendingCount = useConnectivityStore((s) => s.setPendingCount);

  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [localOnlyCount, setLocalOnlyCount] = useState(0);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const refreshMeta = useCallback(async () => {
    if (!isDesktopOfflineCapable()) return;
    const [at, pending, status] = await Promise.all([
      sqliteGetMeta('last_sync_at'),
      sqlitePendingCount(),
      sqliteStatus(),
    ]);
    if (at) setLastSyncAt(at);
    setPendingCount(pending);
    setPendingTotal(status?.pendingSales != null && status?.pendingQueue != null
      ? Number(status.pendingSales) + Number(status.pendingQueue)
      : pending);
    setLocalOnlyCount(status?.localOnlyCount || 0);
  }, [setLastSyncAt, setPendingCount]);

  useEffect(() => {
    void refreshMeta().catch((err) => console.error('[KDSPOZ] sync status refresh failed:', err));
  }, [refreshMeta]);

  const handleSync = async () => {
    if (syncing || !online) return;
    setLastResult(null);
    const result = await syncNow();
    setLastResult(result);
    await refreshMeta().catch((err) => console.error('[KDSPOZ] sync status refresh failed:', err));
  };

  if (!isDesktopOfflineCapable()) {
    return (
      <View style={styles.center}>
        <Text style={typography.body}>{t('Sync is available on desktop only.')}</Text>
      </View>
    );
  }

  const status: string[] = [];
  if (syncing) status.push(t('Syncing…'));
  else if (!online) status.push(t('Offline'));
  if (lastResult) {
    status.push(t('Uploaded {{synced}} change(s)', { synced: lastResult.synced }));
    status.push(t('{{failed}} failed', { failed: lastResult.failed + (lastResult.skipped || 0) }));
    if (lastResult.pulled) {
      const { products, categories, brands, customers, sales, expenses, returns, closings } = lastResult.pulled;
      const downloaded = products + categories + brands + customers
        + (sales || 0) + (expenses || 0) + (returns || 0) + (closings || 0);
      status.push(t('{{count}} downloaded', { count: downloaded }));
    }
  }
  if (pendingTotal != null) status.push(t('{{count}} pending', { count: pendingTotal }));
  if (localOnlyCount) status.push(t('{{count}} local-only', { count: localOnlyCount }));

  return (
    <ScrollView contentContainerStyle={[common.screenPad, styles.pad]}>
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
        {status.length ? <Text style={[typography.caption, styles.mt]}>{status.join(' · ')}</Text> : null}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { paddingBottom: spacing.xl * 2, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  mt: { marginTop: spacing.sm },
  btn: { alignSelf: 'flex-start', marginTop: spacing.xs },
});
