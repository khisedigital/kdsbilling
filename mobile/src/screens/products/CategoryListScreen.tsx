import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, FAB, HelperText, Portal } from 'react-native-paper';
import AppDialog from '../../components/ui/AppDialog';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import { useAutoMarathi } from '../../hooks/useAutoMarathi';
import {
  isCatalogCacheEnabled,
  readCachedCategories,
} from '../../services/catalogCache';
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  syncCatalogFromMaster,
  updateCategory,
} from '../../services/catalogService';
import type { Category } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { localizedLabel, resolveNameMr, stackedNames } from '../../utils/productName';
import { colors } from '../../theme/colors';
import { common, dialogCard } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'CategoryList'>;

type DialogMode = 'add' | 'edit';

export default function CategoryListScreen({}: Props) {
  const t = useT();
  const ui = useLanguageStore((s) => s.ui);
  const tRef = useRef(t);
  tRef.current = t;
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DialogMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nameMr, setNameMr] = useState('');
  const { translating: translatingMr, onMarathiChange } = useAutoMarathi(name, nameMr, setNameMr);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const hydratedFromCacheRef = useRef(false);
  const hasCategoriesRef = useRef(false);

  const load = useCallback(async (opts?: {
    silent?: boolean;
    syncMaster?: boolean;
    forceSync?: boolean;
  }) => {
    try {
      if (isCatalogCacheEnabled() && !hydratedFromCacheRef.current) {
        const cached = await readCachedCategories();
        if (cached?.length) {
          setCategories(cached);
          hasCategoriesRef.current = true;
          hydratedFromCacheRef.current = true;
        }
      }
      // Fast path: categories only. Relink is heavy — pull-to-refresh with force.
      const rows = await fetchCategories();
      setCategories(rows);
      hasCategoriesRef.current = rows.length > 0;
      hydratedFromCacheRef.current = true;
      if (opts?.syncMaster === false) return;
      void syncCatalogFromMaster({ force: opts?.forceSync === true })
        .then(async (result) => {
          const changed = (result?.categoriesCreated || 0) + (result?.categoriesUpdated || 0) > 0;
          if (!changed && !opts?.forceSync) return;
          try {
            const next = await fetchCategories();
            setCategories(next);
            hasCategoriesRef.current = next.length > 0;
          } catch {
            /* keep current list */
          }
        })
        .catch(() => null);
    } catch (err) {
      if (!opts?.silent || !hasCategoriesRef.current) {
        Alert.alert(tRef.current('Load failed'), apiError(err, tRef.current('Could not load categories')));
      }
    }
  }, []);

  React.useEffect(() => {
    void load({ silent: true });
  }, [load]);

  const filtered = categories.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const mr = resolveNameMr(c);
    return c.name.toLowerCase().includes(q)
      || mr.toLowerCase().includes(q)
      || (c.parent?.name || '').toLowerCase().includes(q)
      || resolveNameMr(c.parent).toLowerCase().includes(q);
  });

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setNameMr('');
    setError('');
    setVisible(true);
  };

  const openEdit = (category: Category) => {
    setMode('edit');
    setEditingId(category.id);
    setName(category.name);
    setNameMr(resolveNameMr(category));
    setError('');
    setVisible(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('Name is required'));
      return;
    }
    if (!nameMr.trim()) {
      setError(t('Marathi name is required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (mode === 'add') {
        await createCategory({ name: name.trim(), nameMr: nameMr.trim() });
      } else if (editingId) {
        await updateCategory(editingId, { name: name.trim(), nameMr: nameMr.trim() });
      }
      setVisible(false);
      await load();
    } catch (err) {
      setError(
        apiError(err, mode === 'add' ? t('Could not add category') : t('Could not update category')),
      );
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (category: Category) => {
    Alert.alert(
      t('Delete category?'),
      t('Remove "{{name}}"? Linked products will be unassigned.', { name: category.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(category.id);
              setVisible(false);
              await load();
            } catch (err) {
              Alert.alert(t('Delete failed'), apiError(err, t('Could not delete category')));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search categories...')} />
      <FlatList
        data={filtered}
        extraData={ui}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              // Relink only on explicit pull-to-refresh (fills missing product.category_id).
              await syncCatalogFromMaster({ relinkProducts: true, force: true }).catch(() => null);
              await load({ syncMaster: false });
              setRefreshing(false);
            }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="folder-outline"
            title={search.trim() ? t('No matching categories') : t('No categories yet')}
            subtitle={
              search.trim()
                ? t('Try a different search')
                : t('Add categories for your products')
            }
          />
        }
        renderItem={({ item }) => {
          const { title, other } = stackedNames(item.name, item, ui);
          const parentName = item.parent
            ? localizedLabel(item.parent.name, item.parent, ui)
            : '';
          const parent = parentName ? t('Parent: {{name}}', { name: parentName }) : '';
          return (
            <ListRow
              title={title}
              subtitle={[other, parent].filter(Boolean).join(' · ') || undefined}
              icon="folder"
              iconColor={colors.accent}
              iconBg={colors.accentLight}
              onPress={() => openEdit(item)}
              onLongPress={() => confirmDelete(item)}
            />
          );
        }}
      />

      <FAB icon="plus" style={styles.fabMain} color={colors.textOnPrimary} onPress={openAdd} />

      <Portal>
        <AppDialog visible={visible} onDismiss={() => !loading && setVisible(false)} style={styles.dialog}>
          <AppDialog.Title>{mode === 'add' ? t('Add Category') : t('Edit Category')}</AppDialog.Title>
          <AppDialog.Content>
            <AppTextInput label={t('Name')} value={name} onChangeText={setName} mode="outlined" />
            <AppTextInput
              label={translatingMr ? `${t('Marathi name')} · ${t('translating…')} *` : `${t('Marathi name')} *`}
              value={nameMr}
              onChangeText={onMarathiChange}
              mode="outlined"
              placeholder={t('मराठी नाव')}
              maxLength={150}
              style={styles.nameMr}
            />
            {error ? (
              <HelperText type="error" visible>
                {error}
              </HelperText>
            ) : null}
          </AppDialog.Content>
          <AppDialog.Actions>
            {mode === 'edit' && editingId ? (
              <Button
                textColor={colors.error}
                onPress={() => {
                  const category = categories.find((c) => c.id === editingId);
                  if (!category) return;
                  // Close edit dialog first so the confirm alert is not hidden behind it (desktop/web).
                  setVisible(false);
                  setTimeout(() => confirmDelete(category), 50);
                }}>
                {t('Delete')}
              </Button>
            ) : null}
            <Button onPress={() => setVisible(false)} disabled={loading}>
              {t('Cancel')}
            </Button>
            <Button loading={loading} onPress={handleSave} disabled={!name.trim() || !nameMr.trim()}>
              {t('Save')}
            </Button>
          </AppDialog.Actions>
        </AppDialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  dialog: { ...dialogCard },
  nameMr: { marginTop: 12 },
  fabMain: { ...common.fab, backgroundColor: colors.primary },
});
