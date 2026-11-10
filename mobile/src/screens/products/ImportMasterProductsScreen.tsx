import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { useT } from '../../i18n';
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
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeOption[]>([]);
  const [businessTypeId, setBusinessTypeId] = useState('');
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [categoryId, setCategoryId] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
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
  const categoryOptions = useMemo(
    () =>
      [...categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => ({ id: category.id, label: category.name })),
    [categories],
  );

  useEffect(() => {
    fetchMasterCatalogBusinessTypes()
      .then((types) => {
        setBusinessTypes(types);
        const preferred = types.find((type: BusinessTypeOption) => type.isTenantDefault) || types[0];
        if (preferred) setBusinessTypeId(preferred.id);
      })
      .catch((err) => Alert.alert(tRef.current('Error'), apiError(err, tRef.current('Could not load catalogs'))))
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
        Alert.alert(tRef.current('Error'), apiError(err, tRef.current('Could not load categories')));
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
        limit: 1000,
      });
      setProducts(rows);
    } catch (err) {
      setProducts([]);
      Alert.alert(tRef.current('Error'), apiError(err, tRef.current('Could not load master products')));
    } finally {
      setLoadingProducts(false);
    }
  }, [businessTypeId, categoryId, search]);

  useEffect(() => {
    const timer = setTimeout(loadProducts, search ? 250 : 0);
    return () => clearTimeout(timer);
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
      Alert.alert(t('Select products'), t('Choose at least one master product to import'));
      return;
    }
    setImporting(true);
    try {
      const result = await importFromMasterCatalog(selectedIds);
      const errLines = (result.errors || [])
        .slice(0, 3)
        .map((e: { name?: string; message?: string }) => (e.message ? t(e.message) : e.name))
        .filter(Boolean);
      const detail = errLines.length ? `\n${errLines.join('\n')}` : '';
      Alert.alert(
        t('Import complete'),
        t('Imported {{imported}}\nSkipped {{skipped}}\nFailed {{failed}}{{detail}}', {
          imported: result.imported,
          skipped: result.skipped,
          failed: result.failed,
          detail,
        }),
        [{ text: t('OK'), onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      Alert.alert(t('Import failed'), apiError(err, t('Could not import products')));
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <View style={common.screen}>
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const activeBusinessType = businessTypes.find((type) => type.id === businessTypeId) || businessTypes[0];

  if (!businessTypes.length || !businessTypeId) {
    return (
      <View style={common.screen}>
        <EmptyState
          icon="storefront-outline"
          title={t('No catalog for this shop')}
          subtitle={t('Master products follow the business type set when the account was created.')}
        />
      </View>
    );
  }

  return (
    <View style={common.screen}>
      <View style={styles.filters}>
        {activeBusinessType ? (
          <View style={styles.typeBanner}>
            <Text style={styles.typeBannerLabel}>{t('Your business type')}</Text>
            <Text style={styles.typeBannerName}>{activeBusinessType.name}</Text>
          </View>
        ) : null}

        <AppTextInput
          mode="outlined"
          dense
          value={search}
          onChangeText={setSearch}
          placeholder={t('Search master products')}
          style={styles.search}
        />
        {categoryOptions.length ? (
          <SearchableSelect
            options={categoryOptions}
            value={categoryId || null}
            onChange={(id) => setCategoryId(id || '')}
            open={categoryOpen}
            onOpenChange={setCategoryOpen}
            placeholder="Category"
            allLabel="All categories"
            searchPlaceholder="Search categories…"
          />
        ) : null}
        <Text style={styles.hint}>
          {loadingProducts
            ? t('Loading products…')
            : t('{{count}} products', { count: products.length })}
        </Text>
        <View style={styles.actions}>
          <Button compact onPress={selectAll}>{t('Select all')}</Button>
          <Button compact onPress={clearAll}>{t('Clear')}</Button>
          <Text style={styles.count}>{t('{{count}} selected', { count: selectedIds.length })}</Text>
        </View>
      </View>

      <FlatList
        data={products}
        style={styles.list}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={products.length ? styles.listContent : styles.emptyList}
        ListEmptyComponent={
          loadingProducts ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>{t('Loading products…')}</Text>
            </View>
          ) : (
            <EmptyState
              icon="package-variant-closed"
              title={t('No master products')}
              subtitle={t('Try another category, or ask admin to add products for your business type')}
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
              <Text style={styles.meta}>
                {[
                  item.brandName,
                  item.categoryName || t('Uncategorized'),
                  (item.variants || []).map((variant) => variant.size).filter(Boolean).join(', '),
                  item.mrp != null ? `MRP ₹${item.mrp}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
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
          {selectedIds.length
            ? t('Import ({{count}})', { count: selectedIds.length })
            : t('Import')}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.xl },
  loadingText: { marginTop: spacing.sm, fontSize: 13, color: colors.textMuted },
  filters: {
    flexShrink: 0,
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
  search: { marginBottom: 2, backgroundColor: colors.surface },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  count: { marginLeft: 'auto', fontSize: 12, color: colors.textMuted },
  list: { flex: 1 },
  listContent: { paddingBottom: 100 },
  emptyList: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
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
