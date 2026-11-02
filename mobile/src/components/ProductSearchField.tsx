import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { searchProducts, type SearchProductResult } from '../services/catalogService';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/layout';
import { variantLabel } from '../utils/variantLabel';

type Props = {
  label?: string;
  onSelect: (product: SearchProductResult) => void;
  selectedLabel?: string;
  minChars?: number;
};

export default function ProductSearchField({
  label = 'Search by name, SKU or barcode',
  onSelect,
  selectedLabel,
  minChars = 2,
}: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

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
      if (!found.length) setSearchError(`No product found for "${q}"`);
    } catch (err: unknown) {
      setResults([]);
      const axiosErr = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setSearchError(axiosErr?.response?.data?.error?.message || axiosErr?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  }, [minChars]);

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

  const showResults = search.trim().length >= minChars && (searching || results.length > 0 || !!searchError);

  return (
    <View style={styles.wrap}>
      <Searchbar
        placeholder={label}
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
            <Text style={styles.selectedLabel}>Selected product</Text>
            <Text style={styles.selectedName} numberOfLines={1}>{selectedLabel}</Text>
          </View>
        </View>
      ) : null}

      {showResults ? (
        <View style={styles.resultsBox}>
          {searching ? (
            <View style={styles.resultsLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text variant="bodySmall" style={styles.resultsHint}>Searching...</Text>
            </View>
          ) : searchError ? (
            <View style={styles.noResult}>
              <Icon name="package-variant-closed" size={28} color={colors.textMuted} />
              <Text style={styles.noResultText}>{searchError}</Text>
            </View>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
});
