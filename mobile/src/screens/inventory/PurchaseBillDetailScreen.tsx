import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import { fetchPurchaseBill } from '../../services/inventoryService';
import type { PurchaseBill } from '../../services/inventoryService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PurchaseBillDetail'>;

export default function PurchaseBillDetailScreen({ route }: Props) {
  const t = useT();
  const [bill, setBill] = useState<PurchaseBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setBill(await fetchPurchaseBill(route.params.billId));
    } catch (err) {
      setBill(null);
      setError(apiError(err, 'Could not load purchase bill'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [route.params.billId]);

  if (loading && !bill) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !bill) {
    return (
      <View style={[common.screen, styles.center]}>
        <Icon name="file-alert-outline" size={48} color={colors.textMuted} />
        <Text style={styles.errorText}>{error || t('Purchase bill not found')}</Text>
        <Button mode="contained" onPress={load}>{t('Retry')}</Button>
      </View>
    );
  }

  return (
    <ScrollView style={common.screen} contentContainerStyle={common.screenPad}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="file-document" size={32} color={colors.secondary} />
        </View>
        <Text style={styles.heroTitle}>{bill.bill_number}</Text>
        <Text style={styles.heroSub}>{bill.supplier?.name} · {bill.bill_date}</Text>
        <Text style={styles.total}>₹{parseFloat(String(bill.total_amount)).toFixed(2)}</Text>
      </View>

      <SectionCard title={t('Items ({{count}})', { count: bill.items?.length || 0 })} icon="package-variant">
        {bill.items?.map((item) => (
          <View key={item.id} style={styles.item}>
            <View style={common.rowBetween}>
              <Text style={typography.h3} numberOfLines={1}>{item.variant?.product?.name}</Text>
              <Text style={typography.moneySm}>
                ₹{(parseFloat(String(item.quantity)) * parseFloat(String(item.unit_cost))).toFixed(2)}
              </Text>
            </View>
            <Text style={typography.bodySm}>{item.variant?.sku}</Text>
            <Text style={typography.caption}>
              {parseFloat(String(item.quantity)).toFixed(3)} × ₹{parseFloat(String(item.unit_cost)).toFixed(2)}
            </Text>
          </View>
        ))}
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  errorText: { ...typography.bodySm, textAlign: 'center', marginVertical: spacing.md, paddingHorizontal: spacing.lg },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { ...typography.h1, fontSize: 22 },
  heroSub: { ...typography.bodySm, marginTop: spacing.xs },
  total: { ...typography.money, fontSize: 32, color: colors.secondary, marginTop: spacing.md },
  item: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
