import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import CategoryPickerSheet from '../../components/ui/CategoryPickerSheet';
import EmptyState from '../../components/ui/EmptyState';
import { useT } from '../../i18n';
import {
  bulkUpdateVariantPricing,
  fetchBrands,
  fetchCategories,
  fetchProducts,
  mainBarcodeOf,
  plainBarcodesOf,
  type PriceBulkItem,
} from '../../services/catalogService';
import type { Brand, Category, Product } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, shadow, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PriceManagement'>;

type PriceRow = {
  key: string;
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  categoryId: string | null;
  categoryName: string;
  brandId: string | null;
  brandName: string;
  costPrice: string;
  mrp: string;
  sellingPrice: string;
  barcode: string;
  extraBarcodes: string[];
  stockQty: string;
  original: {
    name: string;
    costPrice: string;
    mrp: string;
    sellingPrice: string;
    barcode: string;
    extraBarcodes: string[];
    stockQty: string;
  };
};

type StockFilter = 'all' | 'in_stock' | 'low' | 'out';
type IssueFilter = 'all' | 'missing_mrp' | 'below_cost' | 'no_barcode';
type ViewMode = 'products' | 'variants';
type PickerKind = 'category' | 'brand' | null;
type FocusField = 'name' | 'cost' | 'mrp' | 'selling' | 'barcode' | 'stock' | null;

type ProductGroup = {
  productId: string;
  name: string;
  categoryName: string;
  brandName: string;
  variants: PriceRow[];
};

function moneyStr(value: string | number | null | undefined): string {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return '';
  return String(n);
}

function toRows(products: Product[]): PriceRow[] {
  const rows: PriceRow[] = [];
  for (const product of products) {
    for (const variant of product.variants || []) {
      const costPrice = moneyStr(variant.cost_price);
      const mrp = moneyStr(variant.mrp);
      const sellingPrice = moneyStr(variant.selling_price);
      const plains = plainBarcodesOf(variant);
      const barcode = plains[0] || mainBarcodeOf(variant) || '';
      const extraBarcodes = plains.slice(1);
      const stockQty = moneyStr(variant.stockQty ?? 0) || '0';
      const name = product.name || '';
      const label = variantLabel(variant.size, variant.color) || 'Default';
      rows.push({
        key: variant.id,
        productId: product.id,
        variantId: variant.id,
        name,
        variantLabel: label,
        categoryId: product.category_id || product.category?.id || null,
        categoryName: product.category?.name || '',
        brandId: product.brand_id || product.brand?.id || null,
        brandName: product.brand?.name || '',
        costPrice,
        mrp,
        sellingPrice,
        barcode,
        extraBarcodes,
        stockQty,
        original: { name, costPrice, mrp, sellingPrice, barcode, extraBarcodes: [...extraBarcodes], stockQty },
      });
    }
  }
  return rows;
}

function sameExtras(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((code, i) => code === b[i]);
}

function isDirty(row: PriceRow): boolean {
  const o = row.original;
  return (
    row.name !== o.name
    || row.costPrice !== o.costPrice
    || row.mrp !== o.mrp
    || row.sellingPrice !== o.sellingPrice
    || row.barcode !== o.barcode
    || !sameExtras(row.extraBarcodes || [], o.extraBarcodes || [])
    || row.stockQty !== o.stockQty
  );
}

function moneyRange(values: string[]) {
  const nums = values
    .map((v) => parseFloat(v))
    .filter((n) => !Number.isNaN(n) && n > 0);
  if (!nums.length) return '—';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return `₹${min.toFixed(2)}`;
  return `₹${min.toFixed(0)}–${max.toFixed(0)}`;
}

function groupByProduct(rows: PriceRow[]): ProductGroup[] {
  const order: string[] = [];
  const map = new Map<string, ProductGroup>();
  for (const row of rows) {
    let group = map.get(row.productId);
    if (!group) {
      group = {
        productId: row.productId,
        name: row.name,
        categoryName: row.categoryName,
        brandName: row.brandName,
        variants: [],
      };
      map.set(row.productId, group);
      order.push(row.productId);
    }
    group.variants.push(row);
    group.name = row.name;
  }
  return order.map((id) => map.get(id)!);
}

function Field({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  align = 'left',
  prefix,
  focused,
  onFocus,
  onBlur,
  mono,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  align?: 'left' | 'right';
  prefix?: string;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  mono?: boolean;
}) {
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      {prefix ? <Text style={styles.fieldPrefix}>{prefix}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
        onFocus={onFocus}
        onBlur={onBlur}
        numberOfLines={1}
        style={[
          styles.fieldInput,
          align === 'right' && styles.fieldRight,
          mono && styles.fieldMono,
        ]}
      />
    </View>
  );
}

function FilterPill({
  label,
  active,
  tone = 'default',
  onPress,
}: {
  label: string;
  active: boolean;
  tone?: 'default' | 'warn' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active && styles.pillOn,
        active && tone === 'warn' && styles.pillWarn,
        active && tone === 'danger' && styles.pillDanger,
      ]}>
      <Text
        style={[
          styles.pillText,
          active && styles.pillTextOn,
          active && tone === 'warn' && styles.pillTextWarn,
          active && tone === 'danger' && styles.pillTextDanger,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function PriceManagementScreen(_props: Props) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('products');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<PickerKind>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<FocusField>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const skipNextFocus = useRef(true);

  const loadMeta = useCallback(async () => {
    const [cats, brandList] = await Promise.all([
      fetchCategories().catch(() => [] as Category[]),
      fetchBrands().catch(() => [] as Brand[]),
    ]);
    setCategories(cats || []);
    setBrands(brandList || []);
  }, []);

  const load = useCallback(async (query = '') => {
    const result = await fetchProducts({
      page: 1,
      limit: 500,
      search: query.trim() || undefined,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      status: 'active',
    });
    setRows(toRows(result?.items || []));
  }, [categoryId, brandId]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const run = () => {
      load(search)
        .catch((err) => {
          if (!cancelled) {
            setRows([]);
            setToast({ type: 'err', text: apiError(err, tRef.current('Could not load products')) });
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    if (!search.trim()) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, search]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load(search).catch(() => {});
    }, [load, search]),
  );

  const dirtyCount = useMemo(() => rows.filter(isDirty).length, [rows]);

  const stats = useMemo(() => {
    let belowCost = 0;
    let noBarcode = 0;
    let out = 0;
    const productIds = new Set<string>();
    for (const row of rows) {
      productIds.add(row.productId);
      const cost = parseFloat(row.costPrice) || 0;
      const selling = parseFloat(row.sellingPrice) || 0;
      const stock = parseFloat(row.stockQty) || 0;
      if (selling > 0 && cost > 0 && selling < cost) belowCost += 1;
      if (!row.barcode.trim()) noBarcode += 1;
      if (stock <= 0) out += 1;
    }
    return {
      products: productIds.size,
      variants: rows.length,
      belowCost,
      noBarcode,
      out,
      dirty: dirtyCount,
    };
  }, [rows, dirtyCount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (categoryId && row.categoryId !== categoryId) return false;
      if (brandId && row.brandId !== brandId) return false;

      const stock = parseFloat(row.stockQty) || 0;
      if (stockFilter === 'in_stock' && stock <= 0) return false;
      if (stockFilter === 'out' && stock > 0) return false;
      if (stockFilter === 'low' && !(stock > 0 && stock <= 5)) return false;

      const cost = parseFloat(row.costPrice) || 0;
      const selling = parseFloat(row.sellingPrice) || 0;
      if (issueFilter === 'missing_mrp' && row.mrp.trim()) return false;
      if (issueFilter === 'no_barcode' && row.barcode.trim()) return false;
      if (issueFilter === 'below_cost' && !(selling > 0 && cost > 0 && selling < cost)) return false;

      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q)
        || row.variantLabel.toLowerCase().includes(q)
        || row.barcode.toLowerCase().includes(q)
        || row.categoryName.toLowerCase().includes(q)
        || row.brandName.toLowerCase().includes(q)
      );
    });
  }, [rows, search, categoryId, brandId, stockFilter, issueFilter]);

  const productGroups = useMemo(() => groupByProduct(filtered), [filtered]);

  const toggleExpanded = useCallback((productId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (viewMode !== 'products') return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const group of productGroups) {
        if (group.variants.length <= 1) continue;
        const hit = group.variants.some((row) => (
          row.variantLabel.toLowerCase().includes(q)
          || row.barcode.toLowerCase().includes(q)
        ));
        if (hit && !next.has(group.productId)) {
          next.add(group.productId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [search, productGroups, viewMode]);

  const categoryLabel = categoryId
    ? categories.find((c) => c.id === categoryId)?.name || t('Category')
    : t('Category');
  const brandLabel = brandId
    ? brands.find((b) => b.id === brandId)?.name || t('Brand')
    : t('Brand');

  const patchRow = (key: string, patch: Partial<PriceRow>) => {
    setRows((prev) => {
      const target = prev.find((row) => row.key === key);
      if (!target) return prev;
      return prev.map((row) => {
        if (row.key === key) return { ...row, ...patch };
        if (patch.name !== undefined && row.productId === target.productId) {
          return { ...row, name: patch.name };
        }
        return row;
      });
    });
  };

  const discardChanges = () => {
    setRows((prev) => prev.map((row) => ({
      ...row,
      name: row.original.name,
      costPrice: row.original.costPrice,
      mrp: row.original.mrp,
      sellingPrice: row.original.sellingPrice,
      barcode: row.original.barcode,
      extraBarcodes: [...(row.original.extraBarcodes || [])],
      stockQty: row.original.stockQty,
    })));
    setToast(null);
  };

  const saveChanges = async () => {
    const dirty = rows.filter(isDirty);
    if (!dirty.length) return;
    const items: PriceBulkItem[] = [];
    for (const row of dirty) {
      const selling = parseFloat(row.sellingPrice);
      if (!(selling > 0)) {
        setToast({ type: 'err', text: t('Selling price required · {{name}}', { name: row.name }) });
        return;
      }
      const stock = parseFloat(row.stockQty);
      if (Number.isNaN(stock) || stock < 0) {
        setToast({ type: 'err', text: t('Invalid stock · {{name}}', { name: row.name }) });
        return;
      }
      const barcodes = [
        row.barcode.trim(),
        ...(row.extraBarcodes || []).map((c) => c.trim()).filter(Boolean),
      ].filter(Boolean);
      items.push({
        variantId: row.variantId,
        productId: row.productId,
        name: row.name.trim(),
        sellingPrice: selling,
        costPrice: parseFloat(row.costPrice) || 0,
        mrp: row.mrp.trim() === '' ? null : (parseFloat(row.mrp) || 0),
        barcode: barcodes[0] || undefined,
        barcodes: barcodes.length ? barcodes : undefined,
        stockQty: stock,
      });
    }

    setSaving(true);
    setToast(null);
    try {
      await bulkUpdateVariantPricing(items);
      await load(search);
      setToast({
        type: 'ok',
        text: items.length === 1
          ? t('Saved {{count}} update', { count: items.length })
          : t('Saved {{count}} updates', { count: items.length }),
      });
    } catch (err) {
      setToast({ type: 'err', text: apiError(err, t('Save failed')) });
    } finally {
      setSaving(false);
    }
  };

  const confirmDiscard = () => {
    if (!dirtyCount) return;
    Alert.alert(
      t('Discard edits?'),
      dirtyCount === 1
        ? t('{{count}} unsaved change will be lost.', { count: dirtyCount })
        : t('{{count}} unsaved changes will be lost.', { count: dirtyCount }),
      [
        { text: t('Keep editing'), style: 'cancel' },
        { text: t('Discard'), style: 'destructive', onPress: discardChanges },
      ],
    );
  };

  const onRefresh = async () => {
    const run = async () => {
      setRefreshing(true);
      try {
        await Promise.all([loadMeta(), load(search)]);
      } finally {
        setRefreshing(false);
      }
    };
    if (dirtyCount) {
      Alert.alert(t('Unsaved changes'), t('Refresh will discard edits.'), [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Refresh'), style: 'destructive', onPress: run },
      ]);
      return;
    }
    await run();
  };

  const focus = (key: string, field: FocusField) => {
    setFocusKey(key);
    setFocusField(field);
  };
  const blur = () => {
    setFocusKey(null);
    setFocusField(null);
  };

  const renderVariantRow = (
    item: PriceRow,
    index: number,
    opts?: { indented?: boolean; hideProductName?: boolean },
  ) => {
    const dirty = isDirty(item);
    const stock = parseFloat(item.stockQty) || 0;
    const cost = parseFloat(item.costPrice) || 0;
    const selling = parseFloat(item.sellingPrice) || 0;
    const belowCost = selling > 0 && cost > 0 && selling < cost;
    const focused = focusKey === item.key;
    const indented = opts?.indented;
    const hideProductName = opts?.hideProductName;

    return (
      <View
        key={item.key}
        style={[
          styles.row,
          index % 2 === 1 && styles.rowAlt,
          dirty && styles.rowDirty,
          focused && styles.rowFocused,
          indented && styles.rowVariant,
        ]}>
        <View style={styles.colProduct}>
          {hideProductName ? (
            <View style={styles.variantTitleRow}>
              <Icon name="subdirectory-arrow-right" size={16} color={colors.textMuted} />
              <View style={styles.variantBadge}>
                <Text style={styles.variantBadgeText} numberOfLines={1}>
                  {item.variantLabel === 'Default' ? t('Default') : item.variantLabel}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <Field
                value={item.name}
                onChangeText={(name) => patchRow(item.key, { name })}
                placeholder={t('Product name')}
                focused={focused && focusField === 'name'}
                onFocus={() => focus(item.key, 'name')}
                onBlur={blur}
              />
              <View style={styles.productMeta}>
                {item.variantLabel && item.variantLabel !== 'Default' ? (
                  <View style={styles.variantBadge}>
                    <Text style={styles.variantBadgeText} numberOfLines={1}>
                      {item.variantLabel === 'Default' ? t('Default') : item.variantLabel}
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.meta} numberOfLines={1}>
                  {[item.categoryName, item.brandName].filter(Boolean).join(' · ') || '—'}
                </Text>
              </View>
            </>
          )}
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.costPrice}
            onChangeText={(costPrice) => patchRow(item.key, { costPrice })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'cost'}
            onFocus={() => focus(item.key, 'cost')}
            onBlur={blur}
          />
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.mrp}
            onChangeText={(mrp) => patchRow(item.key, { mrp })}
            placeholder="—"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'mrp'}
            onFocus={() => focus(item.key, 'mrp')}
            onBlur={blur}
          />
        </View>

        <View style={styles.colMoney}>
          <Field
            value={item.sellingPrice}
            onChangeText={(sellingPrice) => patchRow(item.key, { sellingPrice })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            prefix="₹"
            focused={focused && focusField === 'selling'}
            onFocus={() => focus(item.key, 'selling')}
            onBlur={blur}
          />
          {belowCost ? <Text style={styles.hintWarn}>{t('Below cost')}</Text> : null}
        </View>

        <View style={styles.colBarcode}>
          <Field
            value={item.barcode}
            onChangeText={(barcode) => patchRow(item.key, {
              barcode: barcode.replace(/\D/g, '').slice(0, 18),
            })}
            placeholder={t('Barcode')}
            keyboardType="number-pad"
            mono
            focused={focused && focusField === 'barcode'}
            onFocus={() => focus(item.key, 'barcode')}
            onBlur={blur}
          />
          {(item.extraBarcodes || []).map((code, index) => (
            <View key={`${item.key}-extra-${index}`} style={styles.extraBarcodeRow}>
              <View style={styles.extraBarcodeField}>
                <Field
                  value={code}
                  onChangeText={(value) => {
                    const next = [...(item.extraBarcodes || [])];
                    next[index] = value.replace(/\D/g, '').slice(0, 18);
                    patchRow(item.key, { extraBarcodes: next });
                  }}
                  placeholder={t('Barcode {{n}}', { n: index + 2 })}
                  keyboardType="number-pad"
                  mono
                  focused={focused && focusField === 'barcode'}
                  onFocus={() => focus(item.key, 'barcode')}
                  onBlur={blur}
                />
              </View>
              <Pressable
                onPress={() => {
                  const next = (item.extraBarcodes || []).filter((_, i) => i !== index);
                  patchRow(item.key, { extraBarcodes: next });
                }}
                hitSlop={6}
                style={styles.extraRemove}>
                <Icon name="close" size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => patchRow(item.key, { extraBarcodes: [...(item.extraBarcodes || []), ''] })}
            hitSlop={6}
            style={styles.moreBarcodes}>
            <Text style={styles.moreBarcodesText}>{t('+ Add barcode')}</Text>
          </Pressable>
        </View>

        <View style={styles.colStock}>
          <Field
            value={item.stockQty}
            onChangeText={(stockQty) => patchRow(item.key, { stockQty })}
            placeholder="0"
            keyboardType="decimal-pad"
            align="right"
            focused={focused && focusField === 'stock'}
            onFocus={() => focus(item.key, 'stock')}
            onBlur={blur}
          />
          {stock <= 0 ? <Text style={styles.hintWarn}>{t('Out')}</Text> : null}
        </View>
      </View>
    );
  };

  const shownLabel = viewMode === 'products'
    ? (productGroups.length === 1
      ? t('{{count}} product', { count: productGroups.length })
      : t('{{count}} products', { count: productGroups.length }))
    : (filtered.length === 1
      ? t('{{count}} variant', { count: filtered.length })
      : t('{{count}} variants', { count: filtered.length }));

  return (
    <View style={common.screen}>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={18} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('Search product, barcode, size…')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Icon name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>

        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setPicker('category');
          }}
          style={[styles.selectBtn, categoryId ? styles.selectBtnOn : null]}>
          <Icon
            name="shape-outline"
            size={16}
            color={categoryId ? colors.textOnPrimary : colors.primary}
          />
          <Text
            style={[styles.selectText, categoryId ? styles.selectTextOn : null]}
            numberOfLines={1}>
            {categoryLabel}
          </Text>
          {categoryId ? (
            <Pressable
              onPress={() => setCategoryId(null)}
              hitSlop={8}
              accessibilityLabel={t('Clear category')}>
              <Icon name="close" size={14} color={colors.textOnPrimary} />
            </Pressable>
          ) : (
            <Icon name="chevron-down" size={16} color={colors.primary} />
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setPicker('brand');
          }}
          style={[styles.selectBtn, brandId ? styles.selectBtnOn : null]}>
          <Icon
            name="tag-outline"
            size={16}
            color={brandId ? colors.textOnPrimary : colors.primary}
          />
          <Text
            style={[styles.selectText, brandId ? styles.selectTextOn : null]}
            numberOfLines={1}>
            {brandLabel}
          </Text>
          {brandId ? (
            <Pressable onPress={() => setBrandId(null)} hitSlop={8} accessibilityLabel={t('Clear brand')}>
              <Icon name="close" size={14} color={colors.textOnPrimary} />
            </Pressable>
          ) : (
            <Icon name="chevron-down" size={16} color={colors.primary} />
          )}
        </Pressable>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{stats.products}</Text>
          <Text style={styles.statLbl}>{t('Products')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statNum}>{stats.variants}</Text>
          <Text style={styles.statLbl}>{t('Variants')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, stats.dirty ? styles.statAccent : null]}>{stats.dirty}</Text>
          <Text style={styles.statLbl}>{t('Edited')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, stats.belowCost ? styles.statWarn : null]}>{stats.belowCost}</Text>
          <Text style={styles.statLbl}>{t('Below cost')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, stats.noBarcode ? styles.statMuted : null]}>{stats.noBarcode}</Text>
          <Text style={styles.statLbl}>{t('No barcode')}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, stats.out ? styles.statWarn : null]}>{stats.out}</Text>
          <Text style={styles.statLbl}>{t('Out of stock')}</Text>
        </View>
      </View>

      <View style={styles.filterBlock}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
          <FilterPill
            label={t('Products')}
            active={viewMode === 'products'}
            onPress={() => setViewMode('products')}
          />
          <FilterPill
            label={t('All variants')}
            active={viewMode === 'variants'}
            onPress={() => setViewMode('variants')}
          />
          <View style={styles.pillSep} />
          <FilterPill label={t('All stock')} active={stockFilter === 'all'} onPress={() => setStockFilter('all')} />
          <FilterPill label={t('In stock')} active={stockFilter === 'in_stock'} onPress={() => setStockFilter('in_stock')} />
          <FilterPill label={t('Low ≤5')} active={stockFilter === 'low'} tone="warn" onPress={() => setStockFilter('low')} />
          <FilterPill label={t('Out')} active={stockFilter === 'out'} tone="danger" onPress={() => setStockFilter('out')} />
          <View style={styles.pillSep} />
          <FilterPill label={t('All issues')} active={issueFilter === 'all'} onPress={() => setIssueFilter('all')} />
          <FilterPill label={t('No MRP')} active={issueFilter === 'missing_mrp'} onPress={() => setIssueFilter('missing_mrp')} />
          <FilterPill label={t('Below cost')} active={issueFilter === 'below_cost'} tone="warn" onPress={() => setIssueFilter('below_cost')} />
          <FilterPill label={t('No barcode')} active={issueFilter === 'no_barcode'} onPress={() => setIssueFilter('no_barcode')} />
        </ScrollView>
      </View>

      {toast ? (
        <Pressable
          onPress={() => setToast(null)}
          style={[styles.toast, toast.type === 'ok' ? styles.toastOk : styles.toastErr]}>
          <Icon
            name={toast.type === 'ok' ? 'check-circle' : 'alert-circle'}
            size={16}
            color={toast.type === 'ok' ? colors.success : colors.error}
          />
          <Text style={styles.toastText}>{toast.text}</Text>
        </Pressable>
      ) : null}

      <View style={styles.tableCard}>
        <View style={styles.head}>
          <Text style={[styles.headCell, styles.colProduct]}>{t('PRODUCTS')}</Text>
          <Text style={[styles.headCell, styles.colMoney, styles.headRight]}>{t('COST')}</Text>
          <Text style={[styles.headCell, styles.colMoney, styles.headRight]}>{t('MRP')}</Text>
          <Text style={[styles.headCell, styles.colMoney, styles.headRight]}>{t('SELLING')}</Text>
          <Text style={[styles.headCell, styles.colBarcode]}>{t('BARCODE')}</Text>
          <Text style={[styles.headCell, styles.colStock, styles.headRight]}>{t('STOCK')}</Text>
        </View>

        <ScrollView
          style={styles.tableBody}
          contentContainerStyle={
            !productGroups.length && !loading ? styles.emptyGrow : undefined
          }
          keyboardShouldPersistTaps="handled"
          refreshControl={(
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />
          )}>
          {loading && !rows.length ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>{t('Loading catalog…')}</Text>
            </View>
          ) : null}

          {!loading && !productGroups.length ? (
            <EmptyState
              icon="currency-inr"
              title={t('No matching products')}
              subtitle={t('Clear filters or try another search')}
            />
          ) : null}

          {viewMode === 'variants'
            ? filtered.map((item, index) => renderVariantRow(item, index))
            : productGroups.map((group, groupIndex) => {
              const multi = group.variants.length > 1;
              const expanded = expandedIds.has(group.productId);
              const anyDirty = group.variants.some(isDirty);
              const first = group.variants[0];

              if (!multi) {
                return renderVariantRow(first, groupIndex);
              }

              const totalStock = group.variants.reduce(
                (sum, row) => sum + (parseFloat(row.stockQty) || 0),
                0,
              );
              const sellingSummary = moneyRange(group.variants.map((row) => row.sellingPrice));
              const costSummary = moneyRange(group.variants.map((row) => row.costPrice));
              const mrpSummary = moneyRange(group.variants.map((row) => row.mrp));
              const focused = focusKey === `product:${group.productId}`;

              return (
                <View key={group.productId}>
                  <View
                    style={[
                      styles.row,
                      styles.rowProduct,
                      groupIndex % 2 === 1 && styles.rowAlt,
                      anyDirty && styles.rowDirty,
                      expanded && styles.rowExpanded,
                    ]}>
                    <View style={styles.colProduct}>
                      <View style={styles.productTitleRow}>
                        <Pressable
                          onPress={() => toggleExpanded(group.productId)}
                          style={styles.expandHit}
                          hitSlop={8}
                          accessibilityLabel={expanded ? t('Hide variants') : t('Show variants')}>
                          <Icon
                            name={expanded ? 'chevron-down' : 'chevron-right'}
                            size={20}
                            color={colors.primary}
                          />
                        </Pressable>
                        <View style={styles.productTitleBody}>
                          <Field
                            value={group.name}
                            onChangeText={(name) => patchRow(first.key, { name })}
                            placeholder={t('Product name')}
                            focused={focused && focusField === 'name'}
                            onFocus={() => focus(`product:${group.productId}`, 'name')}
                            onBlur={blur}
                          />
                          <Pressable
                            onPress={() => toggleExpanded(group.productId)}
                            style={styles.productMeta}>
                            <View style={styles.variantBadge}>
                              <Text style={styles.variantBadgeText}>
                                {t('{{count}} variants', { count: group.variants.length })}
                              </Text>
                            </View>
                            <Text style={styles.meta} numberOfLines={1}>
                              {[group.categoryName, group.brandName].filter(Boolean).join(' · ') || '—'}
                            </Text>
                            <Text style={styles.expandHint}>
                              {expanded ? t('Hide variants') : t('Show variants')}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>

                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {costSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {mrpSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colMoney}>
                      <Text style={[styles.summaryValue, styles.summaryAccent, styles.alignRight]} numberOfLines={1}>
                        {sellingSummary}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colBarcode}>
                      <Text style={styles.summaryMuted} numberOfLines={1}>
                        {t('Select to edit each')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleExpanded(group.productId)}
                      style={styles.colStock}>
                      <Text style={[styles.summaryValue, styles.alignRight]} numberOfLines={1}>
                        {totalStock}
                      </Text>
                      {totalStock <= 0 ? <Text style={styles.hintWarn}>{t('Out')}</Text> : null}
                    </Pressable>
                  </View>

                  {expanded
                    ? group.variants.map((item, index) => (
                      renderVariantRow(item, index, { indented: true, hideProductName: true })
                    ))
                    : null}
                </View>
              );
            })}
        </ScrollView>
      </View>

      <View style={[styles.footer, dirtyCount ? styles.footerActive : null]}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerCount}>
            {shownLabel}
            {dirtyCount ? t(' · {{count}} edited', { count: dirtyCount }) : ''}
          </Text>
          {dirtyCount ? (
            <Pressable onPress={confirmDiscard} disabled={saving} hitSlop={6}>
              <Text style={styles.discardLink}>{t('Discard')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.footerHint}>
              {viewMode === 'products'
                ? t('Select a product to edit variants')
                : t('Edit cells, then save')}
            </Text>
          )}
        </View>
        <Pressable
          onPress={saveChanges}
          disabled={!dirtyCount || saving}
          style={[styles.saveBtn, (!dirtyCount || saving) && styles.saveBtnDisabled]}>
          {saving ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Icon name="content-save-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.saveText}>
                {dirtyCount ? t('Save {{count}}', { count: dirtyCount }) : t('Save')}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <CategoryPickerSheet
        visible={picker === 'category'}
        options={categories.map((c) => ({ id: c.id, label: c.name }))}
        value={categoryId}
        allLabel={t('All categories')}
        onSelect={setCategoryId}
        onClose={() => setPicker(null)}
      />
      <CategoryPickerSheet
        visible={picker === 'brand'}
        options={brands.map((b) => ({ id: b.id, label: b.name }))}
        value={brandId}
        allLabel={t('All brands')}
        onSelect={setBrandId}
        onClose={() => setPicker(null)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  searchBox: {
    flex: 1,
    minWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
    ...Platform.select({ web: { outlineStyle: 'none' } as object, default: {} }),
  },
  selectBtn: {
    maxWidth: 160,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectBtnOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  selectText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  selectTextOn: { color: colors.textOnPrimary },

  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    ...shadow.sm,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.borderLight },
  statNum: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  statLbl: { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  statAccent: { color: colors.primary },
  statWarn: { color: colors.warning },
  statMuted: { color: colors.textSecondary },

  filterBlock: { paddingBottom: spacing.sm },
  pillRow: {
    paddingHorizontal: spacing.lg,
    gap: 6,
    alignItems: 'center',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOn: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  pillWarn: {
    backgroundColor: colors.warningLight,
    borderColor: colors.warning,
  },
  pillDanger: {
    backgroundColor: colors.errorLight,
    borderColor: colors.error,
  },
  pillText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  pillTextOn: { color: colors.primary },
  pillTextWarn: { color: colors.warning },
  pillTextDanger: { color: colors.error },
  pillSep: {
    width: 1,
    height: 18,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },

  toast: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastOk: { backgroundColor: colors.successLight },
  toastErr: { backgroundColor: colors.errorLight },
  toastText: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.text },

  tableCard: {
    flex: 1,
    width: '100%',
    marginBottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tableBody: { flex: 1, width: '100%' },
  emptyGrow: { flexGrow: 1 },
  head: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    ...Platform.select({
      web: {
        display: 'grid' as unknown as 'flex',
        gridTemplateColumns: 'minmax(0, 2.6fr) repeat(3, minmax(96px, 1fr)) minmax(140px, 1.5fr) minmax(88px, 0.9fr)',
        gap: 12,
      } as object,
      default: {},
    }),
  },
  headCell: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.7,
  },
  headRight: { textAlign: 'right' },
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...Platform.select({
      web: {
        display: 'grid' as unknown as 'flex',
        gridTemplateColumns: 'minmax(0, 2.6fr) repeat(3, minmax(96px, 1fr)) minmax(140px, 1.5fr) minmax(88px, 0.9fr)',
        gap: 12,
      } as object,
      default: {},
    }),
  },
  rowAlt: { backgroundColor: '#FAFBFD' },
  rowDirty: {
    backgroundColor: colors.primaryLight,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.lg - 3,
  },
  rowFocused: {
    backgroundColor: '#F0F6FF',
  },
  rowProduct: {
    backgroundColor: '#F7F9FC',
  },
  rowExpanded: {
    borderBottomColor: colors.primaryLight,
  },
  rowVariant: {
    backgroundColor: colors.surface,
    paddingLeft: spacing.xl,
  },
  productTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    minWidth: 0,
  },
  productTitleBody: {
    flex: 1,
    minWidth: 0,
  },
  expandHit: {
    width: 28,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
  },
  expandHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },
  summaryValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    paddingVertical: 8,
  },
  summaryAccent: { color: colors.secondary },
  summaryMuted: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    paddingVertical: 8,
  },
  alignRight: { textAlign: 'right' },
  colProduct: {
    flexGrow: 2.6,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  colMoney: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  colBarcode: {
    flexGrow: 1.5,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  moreBarcodes: { marginTop: 4 },
  moreBarcodesText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  extraBarcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  extraBarcodeField: { flex: 1, minWidth: 0 },
  extraRemove: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colStock: {
    flexGrow: 0.9,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: 'hidden',
    ...Platform.select({ web: { width: 'auto', minWidth: 0, maxWidth: '100%' } as object, default: {} }),
  },
  productMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    minHeight: 22,
    minWidth: 0,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: colors.textMuted,
  },
  variantBadge: {
    flexShrink: 0,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  variantBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  hintWarn: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: '700',
    color: colors.warning,
    textAlign: 'right',
  },
  field: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxSizing: 'border-box' } as object,
      default: {},
    }),
  },
  fieldFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    ...shadow.sm,
  },
  fieldPrefix: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    marginRight: 2,
  },
  fieldInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    width: '100%',
    maxWidth: '100%',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    paddingVertical: Platform.OS === 'web' ? 8 : 6,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      } as object,
      default: {},
    }),
  },
  fieldRight: { textAlign: 'right' },
  fieldMono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontWeight: '500',
    letterSpacing: 0.3,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 320,
  },
  loadingText: { fontSize: 13, color: colors.textMuted },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerActive: {
    ...shadow.md,
  },
  footerLeft: { flex: 1, gap: 2 },
  footerCount: { fontSize: 13, fontWeight: '700', color: colors.text },
  footerHint: { fontSize: 12, color: colors.textMuted },
  discardLink: { fontSize: 13, fontWeight: '600', color: colors.error, marginTop: 2 },
  saveBtn: {
    minWidth: 120,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: spacing.lg,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveText: { fontSize: 14, fontWeight: '700', color: colors.textOnPrimary },
});
