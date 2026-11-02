import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ProductSearchField from '../../components/ProductSearchField';
import SectionCard from '../../components/ui/SectionCard';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { fetchBranches, transferStock } from '../../services/inventoryService';
import type { Branch } from '../../services/inventoryService';
import type { SearchProductResult } from '../../services/catalogService';
import { useAuthStore } from '../../store/authStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'StockTransfer'>;

export default function StockTransferScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user);
  const currentBranchId = user?.branch?.id;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [toBranchId, setToBranchId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchBranches()
      .then((b) => {
        setBranches(b.filter((x) => x.id !== currentBranchId));
        if (b.length > 1) setToBranchId(b.find((x) => x.id !== currentBranchId)?.id || '');
      })
      .catch(() => setBranches([]));
  }, [currentBranchId]);

  const handleSelectProduct = (product: SearchProductResult) => {
    setVariantId(product.variantId);
    setSelectedLabel(`${product.productName} (${product.sku})`);
  };

  const handleSubmit = async () => {
    setError('');
    if (!toBranchId || !variantId || !quantity.trim()) {
      setError('Fill all required fields');
      return;
    }

    setLoading(true);
    try {
      await transferStock({
        toBranchId,
        items: [{ variantId, quantity: parseFloat(quantity) }],
        notes: notes.trim() || undefined,
      });
      navigation.goBack();
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message || 'Transfer failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const destBranch = branches.find((b) => b.id === toBranchId);

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>Move stock between branches</Text>

        <SurfaceCard padding style={styles.route}>
          <View style={styles.routeRow}>
            <View style={styles.routeBox}>
              <Icon name="store" size={20} color={colors.primary} />
              <Text style={styles.routeLbl}>From</Text>
              <Text style={styles.routeName}>{user?.branch?.name || 'Current'}</Text>
            </View>
            <Icon name="arrow-right" size={24} color={colors.textMuted} />
            <View style={styles.routeBox}>
              <Icon name="store-outline" size={20} color={colors.secondary} />
              <Text style={styles.routeLbl}>To</Text>
              <Text style={styles.routeName}>{destBranch?.name || 'Select'}</Text>
            </View>
          </View>
        </SurfaceCard>

        <SectionCard title="Destination branch" icon="map-marker-outline">
          {branches.length ? (
            <View style={styles.branchGrid}>
              {branches.map((b) => (
                <Button
                  key={b.id}
                  mode={toBranchId === b.id ? 'contained' : 'outlined'}
                  onPress={() => setToBranchId(b.id)}
                  style={styles.branchBtn}
                  buttonColor={toBranchId === b.id ? colors.primary : undefined}>
                  {b.name}
                </Button>
              ))}
            </View>
          ) : (
            <Text style={typography.bodySm}>
              Need another branch to transfer stock. This shop currently has only one branch.
            </Text>
          )}
        </SectionCard>

        <SectionCard title="Product & quantity" icon="package-variant">
          <ProductSearchField onSelect={handleSelectProduct} selectedLabel={selectedLabel} />
          <TextInput label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" mode="outlined" style={styles.input} />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} mode="outlined" style={styles.input} />
        </SectionCard>

        {error ? <HelperText type="error">{error}</HelperText> : null}
        <Button mode="contained" onPress={handleSubmit} loading={loading} icon="truck-delivery" style={styles.submit}>
          Transfer Stock
        </Button>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  route: { marginBottom: spacing.lg },
  routeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeBox: { flex: 1, alignItems: 'center' },
  routeLbl: { ...typography.caption, marginTop: spacing.xs },
  routeName: { ...typography.h3, marginTop: 2, textAlign: 'center' },
  branchGrid: { gap: spacing.sm },
  branchBtn: { borderRadius: radius.md },
  input: { marginTop: spacing.md, backgroundColor: colors.surface },
  submit: { marginTop: spacing.lg },
});
