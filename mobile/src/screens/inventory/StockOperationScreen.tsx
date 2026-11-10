import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ProductSearchField from '../../components/ProductSearchField';
import EmptyState from '../../components/ui/EmptyState';
import SurfaceCard from '../../components/ui/SurfaceCard';
import { fetchStockHistory, postStockMovement } from '../../services/inventoryService';
import type { StockLedgerEntry } from '../../services/inventoryService';
import { useT } from '../../i18n';
import {
  fetchProduct,
  productVariantToSearchResult,
  type SearchProductResult,
} from '../../services/catalogService';
import { apiError } from '../../utils/apiError';
import { formatQuantity } from '../../utils/quantity';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type VariantQtyRow = SearchProductResult & { quantity: string };

type Props = NativeStackScreenProps<MainStackParamList, 'StockOperation'>;
type Mode = 'opening' | 'in' | 'out' | 'adjust' | 'damage';

type ModeMeta = {
  value: Mode;
  label: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bg: string;
  cta: string;
  qtyLabel: string;
  qtyHint: string;
};

const MODE_META: Record<Mode, ModeMeta> = {
  in: {
    value: 'in',
    label: 'Add',
    title: 'Add stock',
    subtitle: 'Increase inventory for a product',
    icon: 'plus-circle',
    color: colors.secondary,
    bg: colors.secondaryLight,
    cta: 'Add to stock',
    qtyLabel: 'Quantity to add',
    qtyHint: 'How many units are coming in?',
  },
  out: {
    value: 'out',
    label: 'Remove',
    title: 'Remove stock',
    subtitle: 'Decrease inventory (manual out)',
    icon: 'minus-circle',
    color: colors.error,
    bg: colors.errorLight,
    cta: 'Remove from stock',
    qtyLabel: 'Quantity to remove',
    qtyHint: 'How many units to take out?',
  },
  adjust: {
    value: 'adjust',
    label: 'Adjust',
    title: 'Adjust stock',
    subtitle: 'Correction — use + or − change',
    icon: 'tune-vertical',
    color: colors.primary,
    bg: colors.primaryLight,
    cta: 'Apply adjustment',
    qtyLabel: 'Adjustment (+/−)',
    qtyHint: 'Example: 5 to add, -3 to reduce',
  },
  damage: {
    value: 'damage',
    label: 'Damage',
    title: 'Damaged stock',
    subtitle: 'Write off damaged / unsellable units',
    icon: 'alert-octagon',
    color: colors.warning,
    bg: colors.warningLight,
    cta: 'Record damage',
    qtyLabel: 'Damaged quantity',
    qtyHint: 'Units to write off from stock',
  },
  opening: {
    value: 'opening',
    label: 'Opening',
    title: 'Opening stock',
    subtitle: 'Set starting stock for a product',
    icon: 'archive-plus',
    color: colors.primary,
    bg: colors.primaryLight,
    cta: 'Save opening stock',
    qtyLabel: 'Opening quantity',
    qtyHint: 'Starting stock for this product',
  },
};

const TYPE_LABELS: Record<string, string> = {
  OPENING: 'Opening',
  STOCK_IN: 'Added',
  STOCK_OUT: 'Removed',
  ADJUSTMENT: 'Adjusted',
  DAMAGE: 'Damaged',
  SALE: 'Sold',
  PURCHASE_IN: 'Purchase',
};

const QUICK_QTY = ['1', '5', '10', '20', '50'];

export default function StockOperationScreen({ route, navigation }: Props) {
  const t = useT();
  const initialMode = (route.params?.mode || 'in') as Mode;
  const isOpening = initialMode === 'opening';
  const [mode, setMode] = useState<Mode>(initialMode);

  const [selected, setSelected] = useState<SearchProductResult | null>(null);
  const [variantRows, setVariantRows] = useState<VariantQtyRow[]>([]);
  const [productTitle, setProductTitle] = useState('');
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [history, setHistory] = useState<StockLedgerEntry[]>([]);

  const meta = MODE_META[mode] || MODE_META.in;
  const isMultiVariant = variantRows.length > 0;

  useEffect(() => {
    const p = route.params;
    if (!p?.variantId || !p.productName) return;
    setSelected({
      variantId: p.variantId,
      productId: p.productId || '',
      productName: p.productName,
      sku: p.sku || '',
      size: p.size,
      color: p.color,
      sellingPrice: 0,
      stockQty: p.stockQty ?? 0,
      uom: p.uomCode ? { code: p.uomCode } : null,
    });
    setVariantRows([]);
    setProductTitle(p.productName);
  }, [route.params]);

  const loadHistory = useCallback(async (variantId?: string) => {
    try {
      const r = await fetchStockHistory({ page: 1, variantId: variantId || undefined });
      setHistory(r.items.slice(0, 8));
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    loadHistory(selected?.variantId);
  }, [loadHistory, selected?.variantId]);

  const applySingle = (product: SearchProductResult) => {
    setSelected(product);
    setVariantRows([]);
    setProductTitle(product.productName);
    if (mode === 'adjust') {
      setQuantity('');
    } else if (!quantity) {
      setQuantity('1');
    }
  };

  const onSelect = async (product: SearchProductResult) => {
    setError('');
    setSuccess('');
    if (!product.productId) {
      applySingle(product);
      return;
    }

    setLoadingVariants(true);
    setProductTitle(product.productName);
    try {
      const full = await fetchProduct(product.productId);
      const variants = (full.variants || [])
        .filter((v) => v?.id && (!v.status || v.status === 'active'))
        .map((v) => productVariantToSearchResult(full, v));
      const hasMulti =
        Boolean(full.has_variants)
        || variants.length > 1
        || variants.some((v) => Boolean(v.size || v.color));

      if (hasMulti && variants.length) {
        setSelected(null);
        setQuantity('');
        setVariantRows(
          variants.map((v) => ({
            ...v,
            quantity: '',
          })),
        );
        setProductTitle(full.name || product.productName);
        loadHistory();
      } else {
        applySingle(variants[0] || product);
      }
    } catch {
      applySingle(product);
    } finally {
      setLoadingVariants(false);
    }
  };

  const clearProduct = () => {
    setSelected(null);
    setVariantRows([]);
    setProductTitle('');
    setQuantity('');
    setSuccess('');
    loadHistory();
  };

  const updateVariantQty = (variantId: string, value: string) => {
    setVariantRows((prev) =>
      prev.map((row) => (row.variantId === variantId ? { ...row, quantity: value } : row)),
    );
    setError('');
    setSuccess('');
  };

  const normalizeQty = (raw: number) => {
    if (mode === 'out' || mode === 'damage') return Math.abs(raw);
    if ((mode === 'in' || mode === 'opening') && raw < 0) return Math.abs(raw);
    return raw;
  };

  const nextStockFor = (current: number, qty: number) => {
    if (mode === 'adjust') return current + qty;
    if (mode === 'out' || mode === 'damage') return current - Math.abs(qty);
    return current + Math.abs(qty);
  };

  const previewAfter = useMemo(() => {
    if (!selected || !quantity.trim()) return null;
    const current = selected.stockQty ?? 0;
    const raw = parseFloat(quantity);
    if (Number.isNaN(raw) || raw === 0) return null;
    if (mode === 'in' || mode === 'opening') return current + Math.abs(raw);
    if (mode === 'out' || mode === 'damage') return current - Math.abs(raw);
    return current + raw;
  }, [selected, quantity, mode]);

  const save = async () => {
    setError('');
    setSuccess('');

    if (isMultiVariant) {
      const filled = variantRows
        .map((row) => {
          const raw = parseFloat(row.quantity);
          if (Number.isNaN(raw) || raw === 0) return null;
          return { row, qty: normalizeQty(raw) };
        })
        .filter(Boolean) as { row: VariantQtyRow; qty: number }[];

      if (!filled.length) {
        setError(
          mode === 'adjust'
            ? t('Enter a non-zero adjustment for at least one size')
            : t('Enter quantity for at least one size'),
        );
        return;
      }

      const endpoint = mode === 'opening' ? 'opening' : mode;
      setLoading(true);
      try {
        await postStockMovement(endpoint, {
          items: filled.map(({ row, qty }) => ({ variantId: row.variantId, quantity: qty })),
          notes: notes.trim() || undefined,
        });

        setVariantRows((prev) =>
          prev.map((row) => {
            const hit = filled.find((f) => f.row.variantId === row.variantId);
            if (!hit) return { ...row, quantity: '' };
            const next = Math.max(0, nextStockFor(row.stockQty ?? 0, hit.qty));
            return { ...row, stockQty: next, quantity: '' };
          }),
        );
        setSuccess(
          t(
            filled.length > 1
              ? '{{action}} saved · {{count}} sizes updated for {{product}}'
              : '{{action}} saved · {{count}} size updated for {{product}}',
            { action: t(meta.label), count: filled.length, product: productTitle },
          ),
        );
        setNotes('');
        await loadHistory();
      } catch (err) {
        setError(apiError(err, 'Could not update stock'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!selected) {
      setError(t('Search and select a product first'));
      return;
    }
    if (!quantity.trim()) {
      setError(t('Enter a quantity'));
      return;
    }

    let qty = parseFloat(quantity);
    if (Number.isNaN(qty) || qty === 0) {
      setError(mode === 'adjust' ? t('Enter a non-zero adjustment') : t('Enter a valid quantity'));
      return;
    }
    qty = normalizeQty(qty);

    const endpoint = mode === 'opening' ? 'opening' : mode;
    setLoading(true);
    try {
      await postStockMovement(endpoint, {
        items: [{ variantId: selected.variantId, quantity: qty }],
        notes: notes.trim() || undefined,
      });

      const nextStock = Math.max(0, nextStockFor(selected.stockQty ?? 0, qty));

      setSuccess(
        t('{{action}} saved · {{product}} now {{qty}}', {
          action: t(meta.label),
          product: selected.productName,
          qty: formatQuantity(
            Math.round(nextStock * 1000) / 1000,
            selected.uom || undefined,
          ),
        }),
      );
      setSelected({ ...selected, stockQty: nextStock });
      setQuantity(mode === 'adjust' ? '' : '1');
      setNotes('');
      await loadHistory(selected.variantId);
    } catch (err) {
      setError(apiError(err, 'Could not update stock'));
    } finally {
      setLoading(false);
    }
  };

  const size = selected ? variantLabel(selected.size, selected.color) : '';
  const hasProduct = Boolean(selected || isMultiVariant);

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={common.screenPad}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {!isOpening ? (
          <View style={styles.modeGrid}>
            {([MODE_META.in, MODE_META.out, MODE_META.adjust, MODE_META.damage] as ModeMeta[]).map((item) => {
              const on = mode === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => {
                    setMode(item.value);
                    setError('');
                    setSuccess('');
                  }}
                  style={[styles.modeCard, on && { borderColor: item.color, backgroundColor: item.bg }]}>
                  <Icon name={item.icon} size={22} color={on ? item.color : colors.textMuted} />
                  <Text style={[styles.modeLabel, on && { color: item.color }]}>{t(item.label)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.sectionLabel}>{t('1. Product')}</Text>
        <SurfaceCard>
          <ProductSearchField
            onSelect={onSelect}
            groupByProduct
            selectedLabel={
              isMultiVariant
                ? t('{{name}} · {{count}} sizes', { name: productTitle, count: variantRows.length })
                : selected
                  ? `${selected.productName}${size ? ` · ${size}` : ''} (${selected.sku})`
                  : undefined
            }
          />
          {loadingVariants ? (
            <View style={styles.variantLoading}>
              <ActivityIndicator color={meta.color} />
              <Text style={styles.fieldHint}>{t('Loading sizes…')}</Text>
            </View>
          ) : null}
          {isMultiVariant ? (
            <View style={styles.productCard}>
              <View style={styles.productTop}>
                <View style={[styles.productIcon, { backgroundColor: meta.bg }]}>
                  <Icon name="package-variant" size={22} color={meta.color} />
                </View>
                <View style={styles.productBody}>
                  <Text style={styles.productName} numberOfLines={2}>{productTitle}</Text>
                  <Text style={styles.productMeta}>
                    {t('{{count}} sizes · enter qty for each', { count: variantRows.length })}
                  </Text>
                </View>
                <Pressable onPress={clearProduct} hitSlop={10} style={styles.clearBtn}>
                  <Icon name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {selected ? (
            <View style={styles.productCard}>
              <View style={styles.productTop}>
                <View style={[styles.productIcon, { backgroundColor: meta.bg }]}>
                  <Icon name="package-variant" size={22} color={meta.color} />
                </View>
                <View style={styles.productBody}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {selected.productName}
                    {size ? ` · ${size}` : ''}
                  </Text>
                  <Text style={styles.productMeta}>
                    {selected.sku}
                    {selected.uom?.code ? ` · ${selected.uom.code}` : ''}
                  </Text>
                </View>
                <Pressable onPress={clearProduct} hitSlop={10} style={styles.clearBtn}>
                  <Icon name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>
              <View style={styles.stockRow}>
                <View>
                  <Text style={styles.stockLbl}>{t('Current stock')}</Text>
                  <Text style={styles.stockVal}>
                    {formatQuantity(selected.stockQty ?? 0, selected.uom || undefined)}
                  </Text>
                </View>
                {previewAfter != null ? (
                  <View style={styles.afterBox}>
                    <Text style={styles.stockLbl}>{t('After save')}</Text>
                    <Text style={[styles.stockVal, { color: meta.color }]}>
                      {formatQuantity(Math.max(0, Math.round(previewAfter * 1000) / 1000), selected.uom || undefined)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}
        </SurfaceCard>

        <Text style={styles.sectionLabel}>{t('2. Quantity')}</Text>
        <SurfaceCard>
          {isMultiVariant ? (
            <>
              <Text style={styles.fieldHint}>
                {t(meta.qtyHint)} {t('Leave a size blank to skip it.')}
              </Text>
              {variantRows.map((row) => {
                const rowSize = variantLabel(row.size, row.color) || t('Default');
                const raw = parseFloat(row.quantity);
                const after =
                  !Number.isNaN(raw) && raw !== 0
                    ? Math.max(0, nextStockFor(row.stockQty ?? 0, normalizeQty(raw)))
                    : null;
                return (
                  <View key={row.variantId} style={styles.variantRow}>
                    <View style={styles.variantInfo}>
                      <Text style={styles.variantSize}>{rowSize}</Text>
                      <Text style={styles.variantSku}>{row.sku}</Text>
                      <Text style={styles.variantStock}>
                        {t('Stock {{qty}}', { qty: formatQuantity(row.stockQty ?? 0, row.uom || undefined) })}
                        {after != null
                          ? ` → ${formatQuantity(Math.round(after * 1000) / 1000, row.uom || undefined)}`
                          : ''}
                      </Text>
                    </View>
                    <AppTextInput
                      label={mode === 'adjust' ? '+/−' : t('Qty')}
                      value={row.quantity}
                      onChangeText={(v) => updateVariantQty(row.variantId, v)}
                      keyboardType="numbers-and-punctuation"
                      mode="outlined"
                      dense
                      style={styles.variantQty}
                      outlineColor={colors.border}
                      activeOutlineColor={meta.color}
                    />
                  </View>
                );
              })}
            </>
          ) : (
            <>
              <Text style={styles.fieldHint}>{t(meta.qtyHint)}</Text>
              <AppTextInput
                label={t(meta.qtyLabel)}
                value={quantity}
                onChangeText={(v) => {
                  setQuantity(v);
                  setError('');
                  setSuccess('');
                }}
                keyboardType="numbers-and-punctuation"
                mode="outlined"
                style={styles.input}
                left={<TextInput.Icon icon="numeric" />}
                outlineColor={colors.border}
                activeOutlineColor={meta.color}
              />
              {mode !== 'adjust' ? (
                <View style={styles.quickRow}>
                  {QUICK_QTY.map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => setQuantity(q)}
                      style={[styles.quickChip, quantity === q && { backgroundColor: meta.bg, borderColor: meta.color }]}>
                      <Text style={[styles.quickText, quantity === q && { color: meta.color }]}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <View style={styles.quickRow}>
                  {['-10', '-5', '-1', '+1', '+5', '+10'].map((q) => (
                    <Pressable
                      key={q}
                      onPress={() => setQuantity(q)}
                      style={[styles.quickChip, quantity === q && { backgroundColor: meta.bg, borderColor: meta.color }]}>
                      <Text style={[styles.quickText, quantity === q && { color: meta.color }]}>{q}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
          <AppTextInput
            label={t('Notes (optional)')}
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            style={styles.input}
            left={<TextInput.Icon icon="note-text-outline" />}
            outlineColor={colors.border}
            activeOutlineColor={meta.color}
          />
        </SurfaceCard>

        {success ? (
          <View style={styles.okBanner}>
            <Icon name="check-circle" size={20} color={colors.secondary} />
            <Text style={styles.okText}>{success}</Text>
          </View>
        ) : null}
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <Button
          mode="contained"
          onPress={save}
          loading={loading}
          disabled={loading || loadingVariants || !hasProduct}
          icon={meta.icon}
          buttonColor={meta.color}
          style={styles.saveBtn}
          contentStyle={styles.saveContent}
          labelStyle={styles.saveLabel}>
          {t(meta.cta)}
        </Button>

        <View style={styles.historyHeader}>
          <Text style={styles.sectionLabel}>{t('Recent movements')}</Text>
          <Button compact onPress={() => navigation.navigate('StockHistory')} textColor={colors.primary}>
            {t('See all')}
          </Button>
        </View>
        <SurfaceCard>
          {history.length === 0 ? (
            <EmptyState icon="history" title={t('No history yet')} subtitle={t('Stock changes will show here')} />
          ) : (
            history.map((h, i) => {
              const ch = parseFloat(String(h.quantity_change));
              const name = h.variant?.product?.name || t('Product');
              const sku = h.variant?.sku;
              const when = h.created_at
                ? new Date(h.created_at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';
              return (
                <View key={h.id} style={[styles.histRow, i > 0 && styles.histBorder]}>
                  <View
                    style={[
                      styles.histIcon,
                      { backgroundColor: ch >= 0 ? colors.secondaryLight : colors.errorLight },
                    ]}>
                    <Icon
                      name={ch >= 0 ? 'arrow-up-bold' : 'arrow-down-bold'}
                      size={16}
                      color={ch >= 0 ? colors.secondary : colors.error}
                    />
                  </View>
                  <View style={styles.histBody}>
                    <Text style={styles.histName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.histMeta}>
                      {[t(TYPE_LABELS[h.movement_type] || h.movement_type), sku, when].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={[styles.histQty, { color: ch >= 0 ? colors.secondary : colors.error }]}>
                    {ch >= 0 ? '+' : ''}
                    {Number.isInteger(ch) ? ch : ch.toFixed(2)}
                  </Text>
                </View>
              );
            })
          )}
        </SurfaceCard>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modeCard: {
    width: '48%',
    flexGrow: 1,
    minWidth: '46%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  productCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.border,
  },
  productTop: { flexDirection: 'row', alignItems: 'flex-start' },
  productIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  productBody: { flex: 1, minWidth: 0 },
  productName: { fontSize: 15, fontWeight: '700', color: colors.text },
  productMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  clearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  stockLbl: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  stockVal: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2 },
  afterBox: { alignItems: 'flex-end' },
  fieldHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  quickChip: {
    minWidth: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  quickText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  okBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryLight,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  okText: { flex: 1, color: colors.secondaryDark, fontWeight: '600', fontSize: 13, lineHeight: 18 },
  saveBtn: { borderRadius: radius.md, marginTop: spacing.sm, marginBottom: spacing.xl },
  saveContent: { minHeight: 52 },
  saveLabel: { fontSize: 16, fontWeight: '700' },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  histBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  histIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  histBody: { flex: 1, minWidth: 0 },
  histName: { fontSize: 14, fontWeight: '600', color: colors.text },
  histMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  histQty: { fontSize: 15, fontWeight: '700' },
  variantLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  variantInfo: { flex: 1, minWidth: 0 },
  variantSize: { fontSize: 15, fontWeight: '700', color: colors.text },
  variantSku: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  variantStock: { fontSize: 12, color: colors.textSecondary, marginTop: 4, fontWeight: '600' },
  variantQty: { width: 96, backgroundColor: colors.surface },
});
