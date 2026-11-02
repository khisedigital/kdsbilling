import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import * as shopifyService from '../../services/shopifyService';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';
import { apiError } from '../../utils/apiError';
import { formatDateTime } from '../../utils/formatDate';
import {
  SHOPIFY_GREEN,
  SHOPIFY_GREEN_LIGHT,
  connectionBadge,
  isSyncActive,
  syncBadge,
  type Badge,
} from '../../utils/shopifyStatus';

type Props = NativeStackScreenProps<MainStackParamList, 'ShopifyIntegration'>;

const POLL_MS = 4000;
const AUTH_WAIT_MS = 5 * 60 * 1000;

function BadgePill({ badge }: { badge: Badge }) {
  return (
    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
      <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
    </View>
  );
}

function SyncRow({
  icon,
  label,
  detail,
  status,
  last,
}: {
  icon: string;
  label: string;
  detail?: string;
  status: shopifyService.ShopifySyncStatus;
  last: string | null;
}) {
  return (
    <View style={styles.syncRow}>
      <View style={styles.syncIcon}>
        <Icon name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.syncBody}>
        <Text style={styles.syncLabel}>{label}</Text>
        <Text style={styles.syncMeta}>
          {detail ? `${detail} · ` : ''}
          {last ? formatDateTime(last) : 'Never'}
        </Text>
      </View>
      <BadgePill badge={syncBadge(status)} />
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export default function ShopifyIntegrationScreen({}: Props) {
  const [status, setStatus] = useState<shopifyService.ShopifyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [domain, setDomain] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const authStartedAt = useRef<number | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (showErrors = false) => {
    try {
      const next = await shopifyService.getShopifyStatus();
      if (!alive.current) return;
      setStatus(next);
      if (next.connected) authStartedAt.current = null;
      if (next.shopDomain) setDomain((d) => d || next.shopDomain || '');
    } catch (err) {
      if (showErrors && alive.current) Alert.alert('Error', apiError(err, 'Could not load Shopify status'));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    load(true);
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      if (url.includes('integrations/shopify')) load();
    });
    return () => {
      alive.current = false;
      appSub.remove();
      linkSub.remove();
    };
  }, [load]);

  const awaitingAuth =
    authStartedAt.current !== null && Date.now() - authStartedAt.current < AUTH_WAIT_MS && !status?.connected;
  const syncActive =
    !!status?.connected &&
    (status.syncInProgress ||
      isSyncActive(status.productSync.status) ||
      isSyncActive(status.inventorySync.status) ||
      isSyncActive(status.orderSync.status));

  useEffect(() => {
    if (!awaitingAuth && !syncActive) return undefined;
    const timer = setInterval(() => load(), POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingAuth, syncActive, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const handleConnect = async () => {
    const value = domain.trim();
    if (!value) {
      Alert.alert('Store required', 'Enter your Shopify store domain, e.g. mystore.myshopify.com');
      return;
    }
    setConnecting(true);
    try {
      const { authUrl } = await shopifyService.startShopifyConnect(value);
      authStartedAt.current = Date.now();
      await Linking.openURL(authUrl);
      load();
    } catch (err) {
      Alert.alert('Could not connect', apiError(err, 'Could not start Shopify connection'));
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      setStatus(await shopifyService.syncShopifyNow());
    } catch (err) {
      Alert.alert('Sync failed', apiError(err, 'Could not start sync'));
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Shopify',
      'Stock and orders will stop syncing. Your POS products and sales stay as they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setDisconnecting(true);
            try {
              setStatus(await shopifyService.disconnectShopify());
            } catch (err) {
              Alert.alert('Error', apiError(err, 'Could not disconnect'));
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const connected = !!status?.connected;
  const needsReconnect = status?.status === 'error';
  const badge = connectionBadge(status?.status);

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={common.screenPad}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="shopping" size={28} color={SHOPIFY_GREEN} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.title}>Shopify</Text>
          <Text style={styles.subtitle}>Sync products, stock and online orders with your POS</Text>
        </View>
        <BadgePill badge={badge} />
      </View>

      {status && !status.configured ? (
        <View style={styles.notice}>
          <Icon name="information-outline" size={18} color={colors.warning} />
          <Text style={styles.noticeText}>
            Shopify integration is not enabled on the server yet. Please contact support.
          </Text>
        </View>
      ) : null}

      {!connected ? (
        <SectionCard
          title={needsReconnect ? 'Reconnect Shopify' : 'Connect Shopify'}
          subtitle="You will approve access on Shopify, then return here"
          icon="link-variant"
          iconColor={SHOPIFY_GREEN}
          iconBg={SHOPIFY_GREEN_LIGHT}>
          {needsReconnect && status?.lastError ? (
            <Text style={styles.errorText}>{status.lastError}</Text>
          ) : null}
          <TextInput
            label="Store domain"
            mode="outlined"
            value={domain}
            onChangeText={setDomain}
            placeholder="mystore.myshopify.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
          <Button
            mode="contained"
            icon="open-in-new"
            onPress={handleConnect}
            loading={connecting}
            disabled={connecting || !status?.configured}
            buttonColor={SHOPIFY_GREEN}>
            {needsReconnect ? 'Reconnect Shopify' : 'Connect Shopify'}
          </Button>
          {awaitingAuth ? (
            <View style={styles.waiting}>
              <ActivityIndicator size="small" color={SHOPIFY_GREEN} />
              <Text style={styles.waitingText}>Waiting for Shopify approval…</Text>
            </View>
          ) : null}
        </SectionCard>
      ) : null}

      {connected && status ? (
        <>
          <SectionCard title="Connected store" icon="store-check-outline" iconColor={SHOPIFY_GREEN} iconBg={SHOPIFY_GREEN_LIGHT}>
            <InfoLine label="Store" value={status.shopName || status.shopDomain || '—'} />
            <InfoLine label="Domain" value={status.shopDomain || '—'} />
            <InfoLine label="Shopify location" value={status.locationName || '—'} />
            <InfoLine label="POS branch" value={status.branchName || '—'} />
            <InfoLine label="Connected" value={formatDateTime(status.connectedAt)} />
          </SectionCard>

          <SectionCard
            title="Sync status"
            subtitle={`Last sync: ${status.lastSyncAt ? formatDateTime(status.lastSyncAt) : 'Never'}`}
            icon="sync">
            <SyncRow
              icon="package-variant"
              label="Products"
              detail={`${status.productSync.mappedCount} linked`}
              status={status.productSync.status}
              last={status.productSync.lastSyncAt}
            />
            <SyncRow
              icon="warehouse"
              label="Inventory"
              status={status.inventorySync.status}
              last={status.inventorySync.lastSyncAt}
            />
            <SyncRow
              icon="receipt"
              label="Orders"
              detail={`${status.orderSync.orderCount} imported`}
              status={status.orderSync.status}
              last={status.orderSync.lastSyncAt}
            />
            {status.productSync.summary ? (
              <Text style={styles.summary}>
                Last product sync: {status.productSync.summary.matched} matched,{' '}
                {status.productSync.summary.created} created, {status.productSync.summary.updated} updated
                {status.productSync.summary.errors ? `, ${status.productSync.summary.errors} failed` : ''}
              </Text>
            ) : null}
            {status.lastError ? <Text style={styles.errorText}>{status.lastError}</Text> : null}
            <Button
              mode="contained"
              icon="sync"
              onPress={handleSync}
              loading={syncing || syncActive}
              disabled={syncing || syncActive}
              style={styles.btn}>
              {syncActive ? 'Syncing…' : 'Sync Now'}
            </Button>
          </SectionCard>

          <Text style={styles.hint}>
            POS is the stock source of truth: POS sales update Shopify, and Shopify orders reduce POS stock for the
            linked branch automatically.
          </Text>

          <Button
            mode="outlined"
            icon="link-variant-off"
            onPress={handleDisconnect}
            loading={disconnecting}
            disabled={disconnecting}
            textColor={colors.error}
            style={styles.disconnect}>
            Disconnect
          </Button>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: SHOPIFY_GREEN_LIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  heroText: { flex: 1, marginRight: spacing.sm },
  title: { ...typography.h1, marginBottom: 2 },
  subtitle: { ...typography.bodySm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: { ...typography.bodySm, flex: 1 },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  waitingText: { ...typography.bodySm },
  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  infoLabel: { ...typography.bodySm },
  infoValue: { ...typography.body, fontWeight: '600', flexShrink: 1, marginLeft: spacing.md, textAlign: 'right' },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  syncIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  syncBody: { flex: 1, minWidth: 0 },
  syncLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  syncMeta: { ...typography.caption, marginTop: 2 },
  summary: { ...typography.caption, marginTop: spacing.md },
  errorText: {
    ...typography.bodySm,
    color: colors.error,
    backgroundColor: colors.errorLight,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  btn: { marginTop: spacing.md },
  hint: { ...typography.caption, marginBottom: spacing.lg, lineHeight: 18 },
  disconnect: { borderColor: colors.error },
});
