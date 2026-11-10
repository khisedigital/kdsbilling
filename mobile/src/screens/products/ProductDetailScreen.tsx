import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, HelperText, Portal, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { useT } from '../../i18n';
import { fetchProduct, mainBarcodeOf, plainBarcodesOf, quantityBarcodesOf } from '../../services/catalogService';
import { postStockMovement } from '../../services/inventoryService';
import type { Product, ProductVariant } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { formatQuantity } from '../../utils/quantity';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography, dialogCard} from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen({ route, navigation }: Props) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [stockVisible, setStockVisible] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetchProduct(route.params.productId)
      .then(setProduct)
      .catch((err) => {
        setProduct(null);
        setLoadError(apiError(err, tRef.current('Could not load product')));
      })
      .finally(() => setLoading(false));
  }, [route.params.productId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const openAddStock = (variant?: ProductVariant) => {
    const target = variant || product?.variants?.[0] || null;
    if (!target) {
      Alert.alert(t('No variant'), t('This product has no variant to stock.'));
      return;
    }
    setSelectedVariant(target);
    setQuantity('');
    setNotes('');
    setFormError('');
    setStockVisible(true);
  };

  const saveStock = async () => {
    if (!selectedVariant) return;
    const qty = parseFloat(quantity);
    if (!quantity.trim() || Number.isNaN(qty) || qty <= 0) {
      setFormError(t('Enter a valid quantity greater than 0'));
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await postStockMovement('in', {
        items: [{ variantId: selectedVariant.id, quantity: qty }],
        notes: notes.trim() || undefined,
      });
      setStockVisible(false);
      load();
      Alert.alert(
        t('Stock added'),
        t('Added {{qty}} to {{name}}.', { qty, name: product?.name || t('product') }),
      );
    } catch (err) {
      setFormError(apiError(err, t('Could not add stock')));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !product) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[common.screen, styles.center]}>
        <Text style={typography.bodySm}>{loadError || t('Product not found')}</Text>
        <Button mode="contained" onPress={load} style={{ marginTop: 12 }}>{t('Retry')}</Button>
      </View>
    );
  }

  const primaryVariant = product.variants?.[0];
  const sellPrice = primaryVariant ? parseFloat(String(primaryVariant.selling_price)) : 0;
  const stockQty = product.stockQty ?? product.variants?.reduce((s, v) => s + (v.stockQty || 0), 0) ?? 0;
  const stockLabel = formatQuantity(stockQty, product.uom ? { code: product.uom.code, type: product.uom.type } : { code: 'pcs', type: 'count' });
  const lowStock = stockQty <= 0;

  return (
    <ScrollView style={common.screen} contentContainerStyle={common.screenPad}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="package-variant" size={36} color={colors.primary} />
        </View>
        <Text style={styles.heroTitle}>{product.name}</Text>
        {product.name_mr ? <Text style={styles.heroSub}>{product.name_mr}</Text> : null}
        <Text style={styles.heroSub}>
          {product.category?.name || t('No category')} · {product.brand?.name || t('No brand')}
        </Text>
        <Text style={styles.price}>₹{sellPrice.toFixed(2)}</Text>
      </View>

      <SurfaceCard padding style={styles.stockCard}>
        <View style={styles.stockTop}>
          <View style={[styles.stockIcon, lowStock && styles.stockIconLow]}>
            <Icon name="warehouse" size={22} color={lowStock ? colors.warning : colors.secondary} />
          </View>
          <View style={styles.stockBody}>
            <Text style={styles.stockLbl}>
              {(product.variants?.length || 0) > 1 ? t('Total stock (all variants)') : t('Available stock')}
            </Text>
            <Text style={[styles.stockVal, lowStock && { color: colors.warning }]}>{stockLabel}</Text>
          </View>
        </View>
        <View style={styles.stockActions}>
          <Button
            mode="contained"
            icon="plus-circle"
            onPress={() => openAddStock()}
            buttonColor={colors.secondary}
            style={styles.stockActionBtn}
            contentStyle={styles.addStockContent}>
            {t('Add stock')}
          </Button>
          <Button
            mode="outlined"
            icon="history"
            onPress={() =>
              navigation.navigate('StockHistory', {
                productId: product.id,
                productName: product.name,
              })
            }
            textColor={colors.primary}
            style={styles.stockActionBtn}
            contentStyle={styles.addStockContent}>
            {t('History')}
          </Button>
        </View>
      </SurfaceCard>

      <SurfaceCard padding style={styles.metaCard}>
        <View style={styles.metaRow}>
          <Text style={typography.bodySm}>{t('Unit')}</Text>
          <Text style={typography.h3}>{product.uom?.name || '—'}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={typography.bodySm}>{t('Tax group')}</Text>
          <Text style={typography.h3}>
            {product.taxGroup
              ? `${product.taxGroup.name} (${parseFloat(String(product.taxGroup.total_rate))}%)`
              : t('No tax (0%)')}
          </Text>
        </View>
        {product.is_weight_based ? (
          <View style={styles.weightTag}>
            <Icon name="scale" size={14} color={colors.secondary} />
            <Text style={styles.weightText}>{t('Weight based')}</Text>
          </View>
        ) : null}
      </SurfaceCard>

      {product.description ? (
        <SectionCard title={t('Description')} icon="text-box-outline" noPadding>
          <Text style={styles.desc}>{product.description}</Text>
        </SectionCard>
      ) : null}

      <SectionCard title={t('Variants ({{count}})', { count: product.variants?.length || 0 })} icon="shape-outline">
        {product.variants?.map((v) => {
          const vStock = v.stockQty ?? 0;
          const uomInfo = product.uom ? { code: product.uom.code, type: product.uom.type } : { code: 'pcs', type: 'count' as const };
          const plainCodes = plainBarcodesOf(v);
          const mainCode = plainCodes[0] || mainBarcodeOf(v);
          const extraCodes = plainCodes.slice(1);
          const qtyCodes = quantityBarcodesOf(v);
          return (
            <View key={v.id} style={styles.variant}>
              <View style={styles.variantHead}>
                <Text style={typography.h3}>{v.sku}</Text>
                <Text style={typography.moneySm}>₹{parseFloat(String(v.selling_price)).toFixed(2)}</Text>
              </View>
              <Text style={typography.bodySm}>
                {[v.size, v.color].filter(Boolean).join(' · ') || t('Default variant')}
              </Text>
              <Text style={typography.caption}>
                {t('Stock {{qty}}', { qty: formatQuantity(vStock, uomInfo) })}
                {' · '}
                {t('Cost ₹{{amount}}', { amount: parseFloat(String(v.cost_price)).toFixed(2) })}
                {mainCode ? ` · ${mainCode}` : ''}
              </Text>
              {extraCodes.map((code) => (
                <Text key={code} style={typography.caption}>
                  {code}
                </Text>
              ))}
              {qtyCodes.map((b) => (
                <Text key={b.barcode} style={typography.caption}>
                  {t('{{barcode}} · scans as {{qty}}', {
                    barcode: b.barcode,
                    qty: formatQuantity(b.quantity, uomInfo),
                  })}
                </Text>
              ))}
              {(product.variants?.length || 0) > 1 ? (
                <Button
                  compact
                  mode="outlined"
                  icon="plus"
                  onPress={() => openAddStock(v)}
                  style={styles.variantStockBtn}>
                  {t('Add stock')}
                </Button>
              ) : null}
            </View>
          );
        })}
      </SectionCard>

      <Button
        mode="contained"
        icon="pencil-outline"
        onPress={() => navigation.navigate('ProductForm', { productId: product.id })}
        style={styles.editBtn}>
        {t('Edit Product')}
      </Button>

      <Portal>
        <Dialog visible={stockVisible} onDismiss={() => !saving && setStockVisible(false)} style={styles.dialog}>
          <Dialog.Title>{t('Add stock')}</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.dialogProduct}>{product.name}</Text>
            <Text style={styles.dialogSku}>{selectedVariant?.sku}</Text>
            <AppTextInput
              label={t('Quantity *')}
              value={quantity}
              onChangeText={(v) => { setQuantity(v); setFormError(''); }}
              keyboardType="decimal-pad"
              mode="outlined"
              style={styles.input}
              autoFocus
            />
            <AppTextInput
              label={t('Notes (optional)')}
              value={notes}
              onChangeText={setNotes}
              mode="outlined"
              style={styles.input}
            />
            {formError ? <HelperText type="error" visible>{formError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setStockVisible(false)} disabled={saving}>{t('Cancel')}</Button>
            <Button onPress={saveStock} loading={saving} disabled={saving}>
              {t('Add')}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { ...typography.h1, fontSize: 22, textAlign: 'center' },
  heroSub: { ...typography.bodySm, marginTop: spacing.xs, textAlign: 'center' },
  price: { ...typography.money, fontSize: 32, color: colors.secondary, marginTop: spacing.md },
  stockCard: { marginBottom: spacing.lg },
  stockTop: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  stockIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.secondaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stockIconLow: { backgroundColor: colors.warningLight },
  stockBody: { flex: 1 },
  stockLbl: { ...typography.caption },
  stockVal: { ...typography.h1, fontSize: 24, color: colors.secondary, marginTop: 2 },
  stockActions: { flexDirection: 'row', gap: spacing.sm },
  stockActionBtn: { flex: 1, borderRadius: radius.md },
  addStockContent: { minHeight: 44 },
  metaCard: { marginBottom: spacing.lg },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  weightTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.secondaryLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    marginTop: spacing.sm,
  },
  weightText: { fontSize: 12, fontWeight: '600', color: colors.secondary },
  desc: { ...typography.body, lineHeight: 22 },
  variant: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  variantHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  variantStockBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  editBtn: { marginTop: spacing.md },
  dialog: { ...dialogCard },
  dialogProduct: { ...typography.h3, marginBottom: 2 },
  dialogSku: { ...typography.caption, marginBottom: spacing.md },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
});
