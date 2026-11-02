import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { createCategory, deleteCategory, fetchCategories, updateCategory } from '../../services/catalogService';
import type { Category } from '../../types/catalog';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'CategoryList'>;

type DialogMode = 'add' | 'edit';

export default function CategoryListScreen({}: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
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
      setCategories(await fetchCategories());
    } catch (err) {
      Alert.alert('Load failed', apiError(err, 'Could not load categories'));
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = categories.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || (c.parent?.name || '').toLowerCase().includes(q);
  });

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setError('');
    setVisible(true);
  };

  const openEdit = (category: Category) => {
    setMode('edit');
    setEditingId(category.id);
    setName(category.name);
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
        await createCategory({ name: name.trim() });
      } else if (editingId) {
        await updateCategory(editingId, { name: name.trim() });
      }
      setVisible(false);
      await load();
    } catch (err) {
      setError(apiError(err, mode === 'add' ? 'Could not add category' : 'Could not update category'));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = (category: Category) => {
    Alert.alert(
      'Delete category?',
      `Remove "${category.name}"? Products must be reassigned first.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(category.id);
              await load();
            } catch (err) {
              Alert.alert('Delete failed', apiError(err, 'Could not delete category'));
            }
          },
        },
      ],
    );
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search categories..." />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[colors.primary]} />}
        ListEmptyComponent={
          <EmptyState
            icon="folder-outline"
            title={search.trim() ? 'No matching categories' : 'No categories yet'}
            subtitle={search.trim() ? 'Try a different search' : 'Organize products into categories'}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.parent?.name ? `Parent: ${item.parent.name}` : undefined}
            icon="folder"
            iconColor={colors.accent}
            iconBg={colors.accentLight}
            onPress={() => openEdit(item)}
            onLongPress={() => confirmDelete(item)}
          />
        )}
      />
      <FAB icon="plus" style={common.fab} color={colors.textOnPrimary} onPress={openAdd} />
      <Portal>
        <Dialog visible={visible} onDismiss={() => !loading && setVisible(false)} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? 'Add Category' : 'Edit Category'}</Dialog.Title>
          <Dialog.Content>
            <TextInput label="Name" value={name} onChangeText={setName} mode="outlined" />
            {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            {mode === 'edit' && editingId ? (
              <Button textColor={colors.error} onPress={() => {
                const category = categories.find((c) => c.id === editingId);
                if (category) confirmDelete(category);
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
