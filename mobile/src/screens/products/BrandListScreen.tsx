import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { createBrand, deleteBrand, fetchBrands, updateBrand } from '../../services/catalogService';
import type { Brand } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'BrandList'>;

type DialogMode = 'add' | 'edit';

export default function BrandListScreen({}: Props) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DialogMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setBrands(await fetchBrands());
    } catch (err) {
      Alert.alert('Load failed', apiError(err, 'Could not load brands'));
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = brands.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return b.name.toLowerCase().includes(q);
  });

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setError('');
    setVisible(true);
  };

  const openEdit = (brand: Brand) => {
    setMode('edit');
    setEditingId(brand.id);
    setName(brand.name);
    setError('');
    setVisible(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (mode === 'add') {
        await createBrand({ name: name.trim() });
      } else if (editingId) {
        await updateBrand(editingId, { name: name.trim() });
      }
      setVisible(false);
      await load();
    } catch (err) {
      setError(apiError(err, mode === 'add' ? 'Could not add brand' : 'Could not update brand'));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (brand: Brand) => {
    Alert.alert(
      'Delete brand?',
      `Remove "${brand.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBrand(brand.id);
              await load();
            } catch (err) {
              Alert.alert('Delete failed', apiError(err, 'Could not delete brand'));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search brands..." />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[colors.primary]} />}
        ListEmptyComponent={
          <EmptyState
            icon="tag-outline"
            title={search.trim() ? 'No matching brands' : 'No brands yet'}
            subtitle={search.trim() ? 'Try a different search' : 'Add brands to group your products'}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            icon="tag"
            iconColor={colors.secondary}
            iconBg={colors.secondaryLight}
            onPress={() => openEdit(item)}
            onLongPress={() => confirmDelete(item)}
          />
        )}
      />
      <FAB icon="plus" style={common.fab} color={colors.textOnPrimary} onPress={openAdd} />
      <Portal>
        <Dialog visible={visible} onDismiss={() => !loading && setVisible(false)} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? 'Add Brand' : 'Edit Brand'}</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Name" value={name} onChangeText={setName} mode="outlined" />
            {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            {mode === 'edit' && editingId ? (
              <Button textColor={colors.error} onPress={() => {
                const brand = brands.find((b) => b.id === editingId);
                if (brand) confirmDelete(brand);
              }}>Delete</Button>
            ) : null}
            <Button onPress={() => setVisible(false)} disabled={loading}>Cancel</Button>
            <Button loading={loading} onPress={handleSave} disabled={!name.trim()}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  dialog: { borderRadius: radius.lg },
});
