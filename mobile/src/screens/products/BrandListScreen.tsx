import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import {
  createBrand,
  deleteBrand,
  fetchBrands,
  updateBrand,
} from '../../services/catalogService';
import type { Brand } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { stackedNames } from '../../utils/productName';
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
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setBrands(await fetchBrands());
    } catch (err) {
      Alert.alert(tRef.current('Load failed'), apiError(err, tRef.current('Could not load brands')));
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = brands.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return b.name.toLowerCase().includes(q) || (b.name_mr || '').toLowerCase().includes(q);
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
    setNameMr(brand.name_mr || '');
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
    Alert.alert(t('Delete brand?'), t('Remove "{{name}}"?', { name: brand.name }), [
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
    ]);
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search brands...')} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
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
          const { title, other } = stackedNames(item.name, item.name_mr, ui);
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
        <Dialog visible={visible} onDismiss={() => !loading && setVisible(false)} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? t('Add Brand') : t('Edit Brand')}</Dialog.Title>
          <Dialog.Content>
            <AppTextInput label={t('Name')} value={name} onChangeText={setName} mode="outlined" />
            <AppTextInput
              label={`${t('Marathi name')} *`}
              value={nameMr}
              onChangeText={setNameMr}
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
          </Dialog.Content>
          <Dialog.Actions>
            {mode === 'edit' && editingId ? (
              <Button
                textColor={colors.error}
                onPress={() => {
                  const brand = brands.find((b) => b.id === editingId);
                  if (brand) confirmDelete(brand);
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
          </Dialog.Actions>
        </Dialog>
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
