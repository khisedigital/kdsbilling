import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useT } from '../../i18n';
import type { SearchProductResult } from '../../services/catalogService';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import { screenProductName } from '../../utils/productName';
import { variantLabel } from '../../utils/variantLabel';

export function desktopSearchKeyAction(
  key: string,
  state: { available: boolean; results: SearchProductResult[]; selectedIndex: number },
): { index: number } | { product: SearchProductResult } | null {
  if (!state.available || !state.results.length) return null;
  if (key === 'ArrowDown') {
    return { index: Math.min(state.selectedIndex + 1, state.results.length - 1) };
  }
  if (key === 'ArrowUp') {
    return { index: state.selectedIndex < 0 ? state.results.length - 1 : Math.max(state.selectedIndex - 1, 0) };
  }
  if ((key === 'Enter' || key === 'NumpadEnter') && state.selectedIndex >= 0) {
    const product = state.results[state.selectedIndex];
    return product ? { product } : null;
  }
  return null;
}

type Props = {
  items: SearchProductResult[];
  loading: boolean;
  error?: string;
  selectedIndex: number;
  onSelect: (product: SearchProductResult) => void;
};

export default function DesktopBillSearchResults({ items, loading, error, selectedIndex, onSelect }: Props) {
  const t = useT();
  const listRef = useRef<FlatList<SearchProductResult>>(null);
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < items.length) {
      listRef.current?.scrollToIndex({ index: selectedIndex, animated: false });
    }
  }, [items.length, selectedIndex]);
  return (
    <View style={styles.results}>
      {loading && !items.length ? (
        <View style={styles.message}><ActivityIndicator size="small" color={colors.primary} /></View>
      ) : error ? (
        <View style={styles.message}><Text>{error}</Text></View>
      ) : !items.length ? (
        <View style={styles.message}><Text>{t('No matching products')}</Text></View>
      ) : (
        <FlatList
          ref={listRef}
          data={items}
          extraData={selectedIndex}
          keyExtractor={(item) => item.variantId}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
          }}
          renderItem={({ item, index }) => {
            const name = screenProductName(item.productName, item.productNameMr);
            const variant = variantLabel(item.size, item.color);
            return (
              <Pressable
                onPress={() => onSelect(item)}
                accessibilityRole="button"
                accessibilityLabel={t('Add {{name}}', { name })}
                accessibilityState={{ selected: index === selectedIndex }}
                style={({ pressed }) => [styles.row, index === selectedIndex && styles.selected, pressed && styles.pressed]}>
                <View style={styles.details}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}{variant ? ` · ${variant}` : ''}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[item.sku, item.uom?.code].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.price}>₹{Number(item.sellingPrice).toFixed(2)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  results: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    zIndex: 20,
    maxHeight: 320,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  selected: { backgroundColor: colors.primaryLight },
  pressed: { opacity: 0.75 },
  details: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12 },
  price: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  message: { padding: spacing.md, alignItems: 'center' },
});
