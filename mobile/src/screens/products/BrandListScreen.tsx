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
  createBrand,
  deleteBrand,
  fetchBrands,
  syncCatalogFromMaster,
  updateBrand,
} from '../../services/catalogService';
import type { Brand } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { resolveNameMr, stackedNames } from '../../utils/productName';
import { colors } from '../../theme/colors';
import { common, dialogCard } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'BrandList'>;

type DialogMode = 'add' | 'edit';

export default function BrandListScreen({}: Props) {
  const t = useT();
  const ui = useLanguageStore((s) => s.ui);
  const tRef = useRef(t);
  tRef.current = t;
  const [brands, setBrands] = useState<Brand[]>([]);
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

  const load = useCallback(async (opts?: { syncMaster?: boolean; forceSync?: boolean }) => {
    try {
      setBrands(await fetchBrands());
      if (opts?.syncMaster === false) return;
      // Throttled background sync — reload list when master creates/updates brands.
      void syncCatalogFromMaster({ force: opts?.forceSync === true })
        .then(async (result) => {
          const changed = (result?.brandsCreated || 0) + (result?.brandsUpdated || 0) > 0;
          if (!changed && !opts?.forceSync) return;
          try {
            setBrands(await fetchBrands());
          } catch {
            /* keep current list */
          }
        })
        .catch(() => null);
    } catch (err) {
      Alert.alert(tRef.current('Load failed'), apiError(err, tRef.current('Could not load brands')));
    }
  }, []);
  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = brands.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return b.name.toLowerCase().includes(q)
      || resolveNameMr(b).toLowerCase().includes(q);
  });

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setNameMr('');
    setError('');
    setVisible(true);
  };

  const openEdit = (brand: Brand) => {
    setMode('edit');
    setEditingId(brand.id);
    setName(brand.name);
    setNameMr(resolveNameMr(brand));
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
        await createBrand({ name: name.trim(), nameMr: nameMr.trim() });
      } else if (editingId) {
        await updateBrand(editingId, { name: name.trim(), nameMr: nameMr.trim() });
      }
      setVisible(false);
      await load();
    } catch (err) {
      setError(apiError(err, mode === 'add' ? t('Could not add brand') : t('Could not update brand')));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (brand: Brand) => {
    Alert.alert(
      t('Delete brand?'),
      t('Remove "{{name}}"? Linked products will be unassigned.', { name: brand.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBrand(brand.id);
              setVisible(false);
              await load();
            } catch (err) {
              Alert.alert(t('Delete failed'), apiError(err, t('Could not delete brand')));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search brands...')} />
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
              try {
                await syncCatalogFromMaster({ force: true });
              } catch {
                /* still reload local brands */
              }
              await load({ syncMaster: false });
              setRefreshing(false);
            }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="tag-outline"
            title={search.trim() ? t('No matching brands') : t('No brands yet')}
            subtitle={search.trim() ? t('Try a different search') : t('Add brands for your products')}
          />
        }
        renderItem={({ item }) => {
          const { title, other } = stackedNames(item.name, item, ui);
          return (
            <ListRow
              title={title}
              subtitle={other || undefined}
              icon="tag"
              iconColor={colors.secondary}
              iconBg={colors.secondaryLight}
              onPress={() => openEdit(item)}
              onLongPress={() => confirmDelete(item)}
            />
          );
        }}
      />

      <FAB icon="plus" style={styles.fabMain} color={colors.textOnPrimary} onPress={openAdd} />

      <Portal>
        <AppDialog visible={visible} onDismiss={() => !loading && setVisible(false)} style={styles.dialog}>
          <AppDialog.Title>{mode === 'add' ? t('Add Brand') : t('Edit Brand')}</AppDialog.Title>
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
                  const brand = brands.find((b) => b.id === editingId);
                  if (!brand) return;
                  // Close edit dialog first so the confirm alert is not hidden behind it (desktop/web).
                  setVisible(false);
                  setTimeout(() => confirmDelete(brand), 50);
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
