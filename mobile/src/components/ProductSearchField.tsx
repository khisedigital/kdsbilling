import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../i18n';
import { plainBarcodesOf, quantityBarcodesOf, searchProducts, type SearchProductResult } from '../services/catalogService';
import { useLocalCatalogRevision } from '../offline/useLocalCatalogRevision';
import type { Product } from '../types/catalog';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { variantLabel } from '../utils/variantLabel';

type ProductGroup = {
  productId: string;
  productName: string;
  variants: SearchProductResult[];
};

type Props = {
  label?: string;
  onSelect: (product: SearchProductResult) => void;
  selectedLabel?: string;
  /** Called when user taps Clear on the selected chip. */
  onClear?: () => void;
  minChars?: number;
  /** Limit search hits to this category when set. */
  categoryId?: string | null;
  /** Show one row per product; selecting loads that product (caller can expand variants). */
  groupByProduct?: boolean;
  /**
   * When search is empty, show favorites / recent products to tap
   * (much friendlier for barcode labels than “type 2 letters”).
   */
  browseWhenEmpty?: boolean;
  /** Larger result list (label / purchase screens). */
  largeResults?: boolean;
  /** Show selling price + barcode in each row. */
  showPriceAndBarcode?: boolean;
  autoFocus?: boolean;
};

function groupSearchResults(items: SearchProductResult[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const item of items) {
    const key = item.productId || item.variantId;
    const existing = map.get(key);
    if (existing) {
      if (!existing.variants.some((v) => v.variantId === item.variantId)) {
        existing.variants.push(item);
      }
    } else {
      map.set(key, {
        productId: item.productId || '',
        productName: item.productName,
        variants: [item],
      });
    }
  }
  return Array.from(map.values());
}

function productToSearchRows(product: Product): SearchProductResult[] {
  const rows: SearchProductResult[] = [];
  const categoryId =
    (product as { categoryId?: string | null }).categoryId ??
    (product as { category_id?: string | null }).category_id ??
    null;
  for (const v of product.variants || []) {
    if (!v?.id) continue;
    const vv = v as {
      id: string;
      sku?: string;
      size?: string | null;
      color?: string | null;
      sellingPrice?: number;
      selling_price?: number;
      barcode?: string;
      barcodes?: Array<string | { barcode?: string; code?: string }>;
      stockQty?: number;
      stock_qty?: number;
    };
    const barcodes = plainBarcodesOf(v);
    rows.push({
      variantId: vv.id,
      productId: product.id,
      productName: product.name || '',
      productNameMr: product.name_mr ?? product.nameMr ?? null,
      isFavorite: !!(product.is_favorite || (product as { isFavorite?: boolean }).isFavorite),
      sku: vv.sku || '',
      size: vv.size ?? null,
      color: vv.color ?? null,
      sellingPrice: Number(vv.sellingPrice ?? vv.selling_price) || 0,
      barcodes,
      quantityBarcodes: quantityBarcodesOf(v),
      stockQty: Number(vv.stockQty ?? vv.stock_qty) || 0,
      categoryId,
    });
  }
  return rows;
}

export default function ProductSearchField({
  label = 'Search by name, SKU or barcode',
  onSelect,
  selectedLabel,
  onClear,
  minChars = 2,
  categoryId = null,
  groupByProduct = false,
  browseWhenEmpty = false,
  largeResults = false,
  showPriceAndBarcode = false,
  autoFocus = false,
}: Props) {
  const t = useT();
  const localCatalogRevision = useLocalCatalogRevision();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [browse, setBrowse] = useState<SearchProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [focused, setFocused] = useState(false);
  const [changing, setChanging] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const focusAfterChange = useRef(false);
  const searchRequest = useRef(0);
  const browseRequest = useRef(0);

  // Once a product is chosen, hide the search until Change — cleaner for label printing.
  const showSearchUi = !selectedLabel || changing;

  const filteredResults = useMemo(() => {
    if (!categoryId) return results;
    return results.filter((item) => item.categoryId === categoryId);
  }, [categoryId, results]);

  const productGroups = useMemo(
    () => (groupByProduct ? groupSearchResults(filteredResults) : []),
    [groupByProduct, filteredResults],
  );

  const browseGroups = useMemo(
    () => (groupByProduct ? groupSearchResults(browse) : []),
    [groupByProduct, browse],
  );

  const loadBrowse = useCallback(async () => {
    if (!browseWhenEmpty) return;
    const request = ++browseRequest.current;
    setLoadingBrowse(true);
    try {
      const { shouldUseLocalCatalog, readSqliteBillingCatalog } = await import(
        '../offline/localCatalog'
      );
      if (shouldUseLocalCatalog()) {
        const page = await readSqliteBillingCatalog({
          limit: 50,
          categoryId: categoryId || null,
        });
        const rows: SearchProductResult[] = [];
        for (const p of page?.items || []) {
          rows.push(...productToSearchRows(p));
        }
        // Favorites first (billing catalog already orders by favorite)
        if (request === browseRequest.current) setBrowse(rows.slice(0, 40));
        return;
      }
      // Online / phone: light name search fallback — empty browse
      if (request === browseRequest.current) setBrowse([]);
    } catch {
      if (request === browseRequest.current) setBrowse([]);
    } finally {
      if (request === browseRequest.current) setLoadingBrowse(false);
    }
  }, [browseWhenEmpty, categoryId]);

  useEffect(() => {
    if (browseWhenEmpty) void loadBrowse();
    return () => { browseRequest.current += 1; };
  }, [browseWhenEmpty, loadBrowse, localCatalogRevision]);

  const runSearch = useCallback(
    async (query: string) => {
      const request = ++searchRequest.current;
      const q = query.trim();
      if (q.length < minChars) {
        setResults([]);
        setSearchError('');
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError('');
      try {
        const found = await searchProducts(q, { categoryId });
        if (request !== searchRequest.current) return;
        setResults(found);
        if (!found.length) setSearchError(t('No product found for "{{query}}"', { query: q }));
      } catch (err: unknown) {
        if (request !== searchRequest.current) return;
        setResults([]);
        const axiosErr = err as {
          response?: { data?: { error?: { message?: string } } };
          message?: string;
        };
        const message = axiosErr?.response?.data?.error?.message || axiosErr?.message;
        setSearchError(message ? t(message) : t('Search failed'));
      } finally {
        if (request === searchRequest.current) setSearching(false);
      }
    },
    [categoryId, minChars, t],
  );

  useEffect(() => {
    searchRequest.current += 1;
    if (!search.trim()) {
      setResults([]);
      setSearchError('');
      setSearching(false);
      return;
    }
    const timer = setTimeout(() => runSearch(search), 280);
    return () => {
      searchRequest.current += 1;
      clearTimeout(timer);
    };
  }, [search, runSearch, localCatalogRevision]);

  useEffect(() => {
    if (!search.trim() || !results.length || searching) return;
    if (categoryId && !results.some((item) => item.categoryId === categoryId)) {
      setSearchError(t('No product found for "{{query}}"', { query: search.trim() }));
    } else if (results.length) {
      setSearchError('');
    }
  }, [categoryId, results, search, searching, t]);

  const handleSelect = (product: SearchProductResult) => {
    onSelect(product);
    setSearch('');
    setResults([]);
    setSearchError('');
    setFocused(false);
    setChanging(false);
  };

  const handleSelectGroup = (group: ProductGroup) => {
    handleSelect(group.variants[0]);
  };

  const qLen = search.trim().length;
  const showSearchResults = qLen >= minChars && (searching || filteredResults.length > 0 || !!searchError);
  // Favorites show as soon as the search UI is open (no need to focus first).
  const showBrowse =
    browseWhenEmpty &&
    qLen < minChars &&
    !showSearchResults &&
    (loadingBrowse || browse.length > 0);

  const showPanel = showSearchResults || showBrowse;

  const renderResultRow = (item: SearchProductResult, key: string, onPress: () => void, metaRight?: string) => {
    const barcode = (item.barcodes && item.barcodes[0]) || '';
    const variant = variantLabel(item.size, item.color);
    return (
      <Pressable
        key={key}
        onPress={onPress}
        style={({ pressed }) => [styles.resultRow, pressed && styles.resultPressed]}>
        <View style={styles.avatar}>
          <Icon
            name={item.isFavorite ? 'star' : 'package-variant'}
            size={20}
            color={item.isFavorite ? colors.accent : colors.primary}
          />
        </View>
        <View style={styles.resultInfo}>
          <Text style={styles.resultName} numberOfLines={2}>
            {item.productName}
            {variant ? ` · ${variant}` : ''}
          </Text>
          <Text style={styles.resultMeta} numberOfLines={1}>
            {[item.sku, item.uom?.code, showPriceAndBarcode && barcode ? barcode : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {showPriceAndBarcode && Number(item.sellingPrice) > 0 ? (
          <Text style={styles.resultPrice}>₹{item.sellingPrice}</Text>
        ) : metaRight ? (
          <Text style={styles.resultAdd}>{metaRight}</Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.wrap}>
      {selectedLabel ? (
        <View style={styles.selectedCard}>
          <View style={styles.selectedIcon}>
            <Icon name="check-circle" size={26} color={colors.success} />
          </View>
          <View style={styles.selectedText}>
            <Text style={styles.selectedLabel}>{t('Selected product')}</Text>
            <Text style={styles.selectedName} numberOfLines={2}>
              {selectedLabel}
            </Text>
          </View>
          <View style={styles.selectedActions}>
            <Pressable
              onPress={() => {
                focusAfterChange.current = true;
                setChanging(true);
                setSearch('');
                setFocused(true);
                setSearchKey((k) => k + 1);
              }}
              style={styles.selectedBtn}
              hitSlop={6}>
              <Icon name="swap-horizontal" size={18} color={colors.primary} />
              <Text style={styles.selectedBtnText}>{t('Change')}</Text>
            </Pressable>
            {onClear ? (
              <Pressable
                onPress={() => {
                  setChanging(false);
                  setSearch('');
                  setResults([]);
                  onClear();
                }}
                style={styles.selectedBtnGhost}
                hitSlop={6}>
                <Icon name="close" size={18} color={colors.textMuted} />
                <Text style={styles.selectedBtnGhostText}>{t('Clear')}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {showSearchUi ? (
        <>
      <Searchbar
        key={searchKey}
        placeholder={t(label)}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => runSearch(search)}
        onIconPress={() => runSearch(search)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // Delay so row press can fire first
          setTimeout(() => setFocused(false), 180);
        }}
        style={[styles.search, selectedLabel ? styles.searchAfterSelected : null]}
        inputStyle={styles.searchInput}
        loading={searching}
        iconColor={colors.primary}
        autoFocus={autoFocus || focusAfterChange.current}
        onLayout={() => {
          if (focusAfterChange.current) focusAfterChange.current = false;
        }}
      />

      {!showPanel && !browseWhenEmpty ? (
        <View style={styles.hintRow}>
          <Icon name="magnify" size={16} color={colors.textMuted} />
          <Text style={styles.hintText}>
            {t('Type at least {{count}} characters to search', { count: minChars })}
          </Text>
        </View>
      ) : null}
      {browseWhenEmpty && !showPanel && !loadingBrowse ? (
        <View style={styles.hintRow}>
          <Icon name="magnify" size={16} color={colors.textMuted} />
          <Text style={styles.hintText}>
            {t('No favorites yet — type a product name, SKU or barcode to search.')}
          </Text>
        </View>
      ) : null}

      {showPanel ? (
        <View style={[styles.resultsBox, largeResults && styles.resultsBoxLarge]}>
          {showBrowse && !showSearchResults ? (
            <>
              <View style={styles.panelHeader}>
                <Icon name="star-outline" size={16} color={colors.accent} />
                <Text style={styles.panelHeaderText}>{t('Favorites & quick picks')}</Text>
              </View>
              {loadingBrowse ? (
                <View style={styles.resultsLoading}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={styles.resultsHint}>{t('Loading…')}</Text>
                </View>
              ) : groupByProduct ? (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  style={largeResults ? styles.resultsListLarge : styles.resultsList}
                  nestedScrollEnabled>
                  {browseGroups.map((group) => {
                    const first = group.variants[0];
                    const multi = group.variants.length > 1;
                    return renderResultRow(
                      first,
                      group.productId || first.variantId,
                      () => handleSelectGroup(group),
                      multi
                        ? t('{{count}} options', { count: group.variants.length })
                        : t('Select'),
                    );
                  })}
                </ScrollView>
              ) : (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  style={largeResults ? styles.resultsListLarge : styles.resultsList}
                  nestedScrollEnabled>
                  {browse.map((item) =>
                    renderResultRow(item, item.variantId, () => handleSelect(item)),
                  )}
                </ScrollView>
              )}
            </>
          ) : searching ? (
            <View style={styles.resultsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.resultsHint}>{t('Searching…')}</Text>
            </View>
          ) : searchError ? (
            <View style={styles.noResult}>
              <Icon name="package-variant-closed" size={28} color={colors.textMuted} />
              <Text style={styles.noResultText}>{searchError}</Text>
              <Text style={styles.noResultHint}>{t('Try another spelling, SKU or scan the barcode.')}</Text>
            </View>
          ) : groupByProduct ? (
            <>
              <View style={styles.panelHeader}>
                <Icon name="magnify" size={16} color={colors.primary} />
                <Text style={styles.panelHeaderText}>
                  {t('{{count}} products found', { count: productGroups.length })}
                </Text>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={largeResults ? styles.resultsListLarge : styles.resultsList}
                nestedScrollEnabled>
                {productGroups.map((group) => {
                  const first = group.variants[0];
                  const multi = group.variants.length > 1;
                  return renderResultRow(
                    { ...first, productName: group.productName },
                    group.productId || first.variantId,
                    () => handleSelectGroup(group),
                    multi ? t('{{count}} options', { count: group.variants.length }) : t('Select'),
                  );
                })}
              </ScrollView>
            </>
          ) : (
            <>
              <View style={styles.panelHeader}>
                <Icon name="magnify" size={16} color={colors.primary} />
                <Text style={styles.panelHeaderText}>
                  {t('{{count}} products found', { count: filteredResults.length })}
                </Text>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                style={largeResults ? styles.resultsListLarge : styles.resultsList}
                nestedScrollEnabled>
                {filteredResults.map((item) =>
                  renderResultRow(item, item.variantId, () => handleSelect(item)),
                )}
              </ScrollView>
            </>
          )}
        </View>
      ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
  },
  searchAfterSelected: { marginTop: spacing.sm },
  searchInput: { fontSize: 16 },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: spacing.sm,
    paddingHorizontal: 2,
  },
  hintText: { flex: 1, fontSize: 13, color: colors.textMuted, lineHeight: 18 },

  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.successLight,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.success,
  },
  selectedIcon: { paddingTop: 2 },
  selectedText: { flex: 1, minWidth: 0 },
  selectedLabel: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  selectedName: { fontSize: 16, color: colors.text, fontWeight: '700', marginTop: 2 },
  selectedActions: { gap: 6, alignItems: 'stretch' },
  selectedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  selectedBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  selectedBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  selectedBtnGhostText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },

  resultsBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 240,
    overflow: 'hidden',
  },
  resultsBoxLarge: { maxHeight: 480 },
  resultsList: { maxHeight: 220 },
  resultsListLarge: { maxHeight: 440 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  panelHeaderText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  resultsLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.lg },
  resultsHint: { color: colors.textMuted },
  noResult: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  noResultText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  noResultHint: { color: colors.textMuted, textAlign: 'center', fontSize: 12 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultPressed: { backgroundColor: colors.primaryLight },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultInfo: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 15, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultPrice: { fontSize: 15, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
  resultAdd: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
});
