import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ListRow from '../../components/ui/ListRow';
import * as shopifyService from '../../services/shopifyService';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';
import { SHOPIFY_GREEN, SHOPIFY_GREEN_LIGHT, connectionBadge } from '../../utils/shopifyStatus';

type Props = NativeStackScreenProps<MainStackParamList, 'Integrations'>;

export default function IntegrationsScreen({ navigation }: Props) {
  const [shopify, setShopify] = useState<shopifyService.ShopifyStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setShopify(await shopifyService.getShopifyStatus());
    } catch {
      setShopify(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const subtitle = shopify?.connected
    ? shopify.shopName || shopify.shopDomain || 'Connected'
    : 'Sync products, stock and online orders';

  return (
    <ScrollView
      style={common.screen}
      contentContainerStyle={common.screenPad}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
      <Text style={styles.title}>Integrations</Text>
      <Text style={styles.subtitle}>Connect your POS with online sales channels</Text>

      <Text style={styles.section}>Sales channels</Text>
      <ListRow
        title="Shopify"
        subtitle={subtitle}
        icon="shopping"
        iconColor={SHOPIFY_GREEN}
        iconBg={SHOPIFY_GREEN_LIGHT}
        badge={shopify ? connectionBadge(shopify.status) : undefined}
        onPress={() => navigation.navigate('ShopifyIntegration')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySm, marginBottom: spacing.lg },
  section: { ...typography.label, marginBottom: spacing.sm },
});
