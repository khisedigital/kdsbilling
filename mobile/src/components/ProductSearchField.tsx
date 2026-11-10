import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../i18n';
import { searchProducts, type SearchProductResult } from '../services/catalogService';
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
  minChars?: number;
  /** Show one row per product; selecting loads that product (caller can expand variants). */
  groupByProduct?: boolean;
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

export default function ProductSearchField({
  label = 'Search by name, SKU or barcode',
  onSelect,
  selectedLabel,
  minChars = 2,
  groupByProduct = false,
}: Props) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const productGroups = useMemo(
    () => (groupByProduct ? groupSearchResults(results) : []),
    [groupByProduct, results],
  );

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    if (q.length < minChars) {
      setResults([]);
      setSearchError('');
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      const found = await searchProducts(q);
      setResults(found);
      if (!found.length) setSearchError(t('No product found for "{{query}}"', { query: q }));
    } catch (err: unknown) {
      setResults([]);
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      const message = axiosErr?.response?.data?.error?.message || axiosErr?.message;
      setSearchError(message ? t(message) : t('Search failed'));
    } finally {
      setSearching(false);
    }
  }, [minChars, t]);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setSearchError('');
      return;
    }
    const timer = setTimeout(() => runSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search, runSearch]);

  const handleSelect = (product: SearchProductResult) => {
    onSelect(product);
    setSearch('');
    setResults([]);
    setSearchError('');
  };

  const handleSelectGroup = (group: ProductGroup) => {
    handleSelect(group.variants[0]);
  };

  const showResults = search.trim().length >= minChars && (searching || results.length > 0 || !!searchError);

  return (
    <View style={styles.wrap}>
      <Searchbar
        placeholder={t(label)}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => runSearch(search)}
        onIconPress={() => runSearch(search)}
        style={styles.search}
        inputStyle={styles.searchInput}
        loading={searching}
        iconColor={colors.primary}
      />

      {selectedLabel ? (
        <View style={styles.selectedChip}>
          <Icon name="check-circle" size={18} color={colors.secondary} />
          <View style={styles.selectedText}>
            <Text style={styles.selectedLabel}>{t('Selected product')}</Text>
            <Text style={styles.selectedName} numberOfLines={1}>{selectedLabel}</Text>
          </View>
        </View>
      ) : null}

      {showResults ? (
        <View style={styles.resultsBox}>
          {searching ? (
            <View style={styles.resultsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text variant="bodySmall" style={styles.resultsHint}>{t('Searching...')}</Text>
            </View>
          ) : searchError ? (
            <View style={styles.noResult}>
              <Icon name="package-variant-closed" size={28} color={colors.textMuted} />
              <Text style={styles.noResultText}>{searchError}</Text>
            </View>
          ) : groupByProduct ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.resultsList}
              nestedScrollEnabled>
              {productGroups.map((group) => {
                const multi = group.variants.length > 1
                  || Boolean(group.variants[0]?.size || group.variants[0]?.color);
                const first = group.variants[0];
                const meta = multi
                  ? (group.variants.length > 1
                    ? t('{{count}} sizes', { count: group.variants.length })
                    : variantLabel(first?.size, first?.color) || t('sizes'))
                  : first?.sku;
                return (
                  <Pressable
                    key={group.productId || first.variantId}
                    onPress={() => handleSelectGroup(group)}
                    style={({ pressed }) => [styles.resultRow, pressed && styles.resultPressed]}>
                    <View style={styles.avatar}>
                      <Icon name="package-variant" size={20} color={colors.primary} />
                    </View>
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultName}>{group.productName}</Text>
                      <Text style={styles.resultMeta}>
                        {[meta, first?.uom?.code].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <Text style={styles.resultAdd}>{multi ? t('Sizes') : t('Select')}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.resultsList}
              nestedScrollEnabled>
              {results.map((item) => (
                <Pressable
                  key={item.variantId}
                  onPress={() => handleSelect(item)}
                  style={({ pressed }) => [styles.resultRow, pressed && styles.resultPressed]}>
                  <View style={styles.avatar}>
                    <Icon name="package-variant" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.resultInfo}>
                    <Text style={styles.resultName}>
                      {item.productName}
                      {variantLabel(item.size, item.color) ? ` · ${variantLabel(item.size, item.color)}` : ''}
                    </Text>
                    <Text style={styles.resultMeta}>
                      {item.sku}
                      {item.uom?.code ? ` · ${item.uom.code}` : ''}
                    </Text>
                  </View>
                  {item.sellingPrice != null ? (
                    <Text style={styles.resultPrice}>₹{item.sellingPrice}</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 0,
  },
  searchInput: { fontSize: 15 },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.secondary,
  },
  selectedText: { flex: 1 },
  selectedLabel: { fontSize: 11, color: colors.secondaryDark, fontWeight: '600', textTransform: 'uppercase' },
  selectedName: { fontSize: 14, color: colors.text, fontWeight: '600', marginTop: 2 },
  resultsBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: 220,
    overflow: 'hidden',
  },
  resultsList: { maxHeight: 220 },
  resultsLoading: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: spacing.lg },
  resultsHint: { color: colors.textMuted },
  noResult: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm },
  noResultText: { color: colors.textMuted, textAlign: 'center' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultPressed: { backgroundColor: colors.primaryLight },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  resultInfo: { flex: 1 },
  resultName: { fontSize: 15, fontWeight: '600', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultPrice: { fontSize: 15, fontWeight: '700', color: colors.secondary },
  resultAdd: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
});
