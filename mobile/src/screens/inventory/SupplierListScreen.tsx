import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { createSupplier, deleteSupplier, fetchSuppliers, updateSupplier } from '../../services/inventoryService';
import type { Supplier } from '../../services/inventoryService';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'SupplierList'>;

type DialogMode = 'add' | 'edit';

function apiError(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || fallback;
}

export default function SupplierListScreen({ navigation }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DialogMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSuppliers(await fetchSuppliers());
    } catch (err) {
      setSuppliers([]);
      Alert.alert('Load failed', apiError(err, 'Could not load suppliers'));
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const filtered = suppliers.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      s.name.toLowerCase().includes(q) ||
      (s.phone || '').includes(q) ||
      (s.email || '').toLowerCase().includes(q)
    );
  });

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setPhone('');
    setEmail('');
    setError('');
    setVisible(true);
  };

  const openEdit = (supplier: Supplier) => {
    setMode('edit');
    setEditingId(supplier.id);
    setName(supplier.name);
    setPhone(supplier.phone || '');
    setEmail(supplier.email || '');
    setError('');
    setVisible(true);
  };

  const closeDialog = () => {
    if (loading) return;
    setVisible(false);
    setError('');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      };
      if (mode === 'add') {
        await createSupplier(payload);
      } else if (editingId) {
        await updateSupplier(editingId, payload);
      }
      setVisible(false);
      await load();
    } catch (err) {
      setError(apiError(err, mode === 'add' ? 'Could not add supplier' : 'Could not update supplier'));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = () => {
    if (!editingId) return;
    const supplier = suppliers.find((s) => s.id === editingId);
    if (!supplier) return;

    Alert.alert(
      'Delete supplier?',
      `Remove "${supplier.name}" from your supplier list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await deleteSupplier(editingId);
              setVisible(false);
              await load();
            } catch (err) {
              setError(apiError(err, 'Could not delete supplier'));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleNewPurchase = () => {
    if (!editingId) return;
    setVisible(false);
    navigation.navigate('PurchaseBillForm', { supplierId: editingId });
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search suppliers..." />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <EmptyState icon="truck-outline" title="No suppliers yet" subtitle="Tap + to add your first supplier" />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={[item.phone, item.email].filter(Boolean).join(' · ') || 'No contact'}
            icon="truck"
            iconColor={colors.secondary}
            iconBg={colors.secondaryLight}
            onPress={() => openEdit(item)}
            onLongPress={() => navigation.navigate('PurchaseBillForm', { supplierId: item.id })}
          />
        )}
      />

      <FAB icon="plus" style={common.fab} color={colors.textOnPrimary} onPress={openAdd} />

      <Portal>
        <Dialog visible={visible} onDismiss={closeDialog} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? 'Add Supplier' : 'Edit Supplier'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Name *"
              value={name}
              onChangeText={setName}
              mode="outlined"
              style={styles.input}
              autoFocus={mode === 'add'}
            />
            <TextInput
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              mode="outlined"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <TextInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              mode="outlined"
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
            {error ? <HelperText type="error">{error}</HelperText> : null}
            {mode === 'edit' ? (
              <Button
                mode="outlined"
                icon="file-document-plus-outline"
                onPress={handleNewPurchase}
                style={styles.purchaseBtn}
                textColor={colors.secondary}>
                New purchase entry
              </Button>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            {mode === 'edit' ? (
              <Button textColor={colors.error} onPress={confirmDelete} disabled={loading}>
                Delete
              </Button>
            ) : (
              <View />
            )}
            <View style={styles.dialogRight}>
              <Button onPress={closeDialog} disabled={loading}>Cancel</Button>
              <Button onPress={handleSave} loading={loading} disabled={!name.trim()}>
                {mode === 'add' ? 'Add' : 'Save'}
              </Button>
            </View>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  dialog: { borderRadius: radius.lg },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  purchaseBtn: { marginTop: spacing.sm, borderColor: colors.secondary },
  dialogActions: { justifyContent: 'space-between', paddingHorizontal: spacing.md },
  dialogRight: { flexDirection: 'row', alignItems: 'center' },
});
