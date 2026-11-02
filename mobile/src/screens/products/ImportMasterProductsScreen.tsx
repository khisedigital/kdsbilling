import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Checkbox, Text, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import {
  fetchMasterCatalogBusinessTypes,
  fetchMasterCatalogCategories,
  fetchMasterCatalogProducts,
  importFromMasterCatalog,
  type MasterCatalogProduct,
} from '../../services/catalogService';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ImportMasterProducts'>;

type BusinessTypeOption = {
  id: string;
  name: string;
  productCount: number;
  isTenantDefault?: boolean;
};

export default function ImportMasterProductsScreen({ navigation }: Props) {
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeOption[]>([]);
  const [businessTypeId, setBusinessTypeId] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<MasterCatalogProduct[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [importing, setImporting] = useState(false);

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected],
  );

  useEffect(() => {
    fetchMasterCatalogBusinessTypes()
      .then((types) => {
        setBusinessTypes(types);
        const preferred = types.find((t: BusinessTypeOption) => t.isTenantDefault) || types[0];
        if (preferred) setBusinessTypeId(preferred.id);
      })
      .catch((err) => Alert.alert('Error', apiError(err, 'Could not load catalogs')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!businessTypeId) {
      setCategories([]);
      return;
    }
    fetchMasterCatalogCategories({ businessTypeId })
      .then(setCategories)
      .catch((err) => {
        setCategories([]);
        Alert.alert('Error', apiError(err, 'Could not load categories'));
      });
    setCategoryId('');
  }, [businessTypeId]);

  const loadProducts = useCallback(async () => {
    if (!businessTypeId) {
      setProducts([]);
      return;
    }
    setLoadingProducts(true);
    try {
      const rows = await fetchMasterCatalogProducts({
        businessTypeId,
        categoryId: categoryId || undefined,
        search: search.trim() || undefined,
        limit: 500,
      });
      setProducts(rows);
    } catch (err) {
      setProducts([]);
      Alert.alert('Error', apiError(err, 'Could not load master products'));
    } finally {
      setLoadingProducts(false);
    }
  }, [businessTypeId, categoryId, search]);

  useEffect(() => {
    const t = setTimeout(loadProducts, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [loadProducts, search]);

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAll = () => {
    setSelected((prev) => {
      const next = { ...prev };
      products.forEach((p) => {
        next[p.id] = true;
      });
      return next;
    });
  };

  const clearAll = () => setSelected({});

  const onImport = async () => {
    if (!selectedIds.length) {
      Alert.alert('Select products', 'Choose at least one master product to import');
      return;
    }
    setImporting(true);
    try {
      const result = await importFromMasterCatalog(selectedIds);
      const errLines = (result.errors || [])
        .slice(0, 3)
        .map((e: { name?: string; message?: string }) => e.message || e.name)
        .filter(Boolean);
      const detail = errLines.length ? `\n${errLines.join('\n')}` : '';
      Alert.alert(
        'Import complete',
        `Imported ${result.imported}\nSkipped ${result.skipped}\nFailed ${result.failed}${detail}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert('Import failed', apiError(err, 'Could not import products'));
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const activeBusinessType = businessTypes.find((t) => t.id === businessTypeId) || businessTypes[0];

  if (!businessTypes.length || !businessTypeId) {
    return (
      <View style={common.screen}>
        <EmptyState
          icon="storefront-outline"
          title="No catalog for this shop"
          subtitle="Master products follow the business type set when the account was created."
        />
      </View>
    );
  }

  return (
    <View style={common.screen}>
      <View style={styles.filters}>
        {activeBusinessType ? (
          <View style={styles.typeBanner}>
            <Text style={styles.typeBannerLabel}>Your business type</Text>
            <Text style={styles.typeBannerName}>{activeBusinessType.name}</Text>
          </View>
        ) : null}

        {categories.length ? (
          <>
            <Text style={styles.label}>Category</Text>
            <View style={styles.chipRow}>
              <Pressable
                onPress={() => setCategoryId('')}
                style={[styles.chip, !categoryId && styles.chipOn]}>
                <Text style={[styles.chipText, !categoryId && styles.chipTextOn]}>All</Text>
              </Pressable>
              {categories.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategoryId(c.id)}
                  style={[styles.chip, categoryId === c.id && styles.chipOn]}>
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>
                    {c.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <TextInput
          mode="outlined"
          dense
          value={search}
          onChangeText={setSearch}
          placeholder="Search master products"
          style={styles.search}
        />
        <Text style={styles.hint}>
          Showing products for your business type only. Price starts at ₹0 — set selling price after import.
        </Text>
        <View style={styles.actions}>
          <Button compact onPress={selectAll}>Select all</Button>
          <Button compact onPress={clearAll}>Clear</Button>
          <Text style={styles.count}>{selectedIds.length} selected</Text>
        </View>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        contentContainerStyle={products.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          loadingProducts ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Loading products…</Text>
            </View>
          ) : (
            <EmptyState
              icon="package-variant-closed"
              title="No master products"
              subtitle="Try another category, or ask admin to add products for your business type"
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => toggle(item.id)}>
            <Checkbox
              status={selected[item.id] ? 'checked' : 'unchecked'}
              onPress={() => toggle(item.id)}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.categoryName || 'Uncategorized'} · ₹0</Text>
            </View>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <Button
          mode="contained"
          loading={importing}
          disabled={importing || !selectedIds.length}
          onPress={onImport}
          buttonColor={colors.secondary}>
          Import {selectedIds.length ? `(${selectedIds.length})` : ''}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.textMuted },
  filters: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  typeBanner: {
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primaryLight,
  },
  typeBannerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  typeBannerName: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipTextOn: { color: colors.textOnPrimary },
  search: { marginBottom: 6, backgroundColor: colors.surface },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  count: { marginLeft: 'auto', fontSize: 12, color: colors.textMuted },
  list: { paddingBottom: 100 },
  emptyList: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
