import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { useT } from '../../i18n';
import SectionCard from '../../components/ui/SectionCard';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { holdBill } from '../../services/businessService';
import { useCartStore } from '../../store/cartStore';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'HoldBill'>;

export default function HoldBillScreen({ navigation }: Props) {
  const t = useT();
  const items = useCartStore((s) => s.items);
  const customerId = useCartStore((s) => s.customerId);
  const customerName = useCartStore((s) => s.customerName);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const handleHold = async () => {
    setLoading(true);
    try {
      await holdBill(
        name || t('Hold {{time}}', { time: Date.now() }),
        {
          items,
          customerId,
          customerName,
          billDiscountAmount: useCartStore.getState().billDiscountAmount,
          billDiscountPercent: useCartStore.getState().billDiscountPercent,
          offerId: useCartStore.getState().offerId,
        },
        customerId || undefined,
      );
      useCartStore.getState().clear();
      navigation.navigate('Billing');
    } catch (err) {
      Alert.alert(t('Hold failed'), apiError(err, 'Could not hold bill'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon name="pause-circle" size={32} color={colors.warning} />
          </View>
          <Text style={styles.heroTitle}>{t('Hold Bill')}</Text>
          <Text style={styles.heroSub}>{t('Save this cart and resume billing later')}</Text>
        </View>

        <SurfaceCard padding style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={typography.bodySm}>{t('Items')}</Text>
            <Text style={typography.h3}>{items.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={typography.bodySm}>{t('Estimated total')}</Text>
            <Text style={typography.moneySm}>₹{total.toFixed(2)}</Text>
          </View>
          {customerName ? (
            <View style={styles.summaryRow}>
              <Text style={typography.bodySm}>{t('Customer')}</Text>
              <Text style={typography.h3}>{customerName}</Text>
            </View>
          ) : null}
        </SurfaceCard>

        <SectionCard title={t('Hold name')} icon="tag-outline" subtitle={t('Optional label to find this bill later')}>
          <AppTextInput
            label={t('Name')}
            value={name}
            onChangeText={setName}
            mode="outlined"
            placeholder={t('e.g. Table 3, Rajesh')}
            style={styles.input}
          />
        </SectionCard>

        <Button
          mode="contained"
          onPress={handleHold}
          loading={loading}
          disabled={!items.length}
          icon="pause"
          style={styles.btn}
          contentStyle={styles.btnContent}>
          {t('Hold Bill ({{count}} items)', { count: items.length })}
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.warningLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { ...typography.h1, fontSize: 22 },
  heroSub: { ...typography.bodySm, marginTop: spacing.xs, textAlign: 'center' },
  summary: { marginBottom: spacing.lg },
  summaryRow: { ...common.rowBetween, marginBottom: spacing.sm },
  input: { backgroundColor: colors.surface },
  btn: { marginTop: spacing.md },
  btnContent: { paddingVertical: spacing.sm },
});
