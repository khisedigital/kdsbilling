import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import BulkImportDialog from '../../components/ui/BulkImportDialog';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import {
  bulkImportSuppliers,
  createSupplier,
  deleteSupplier,
  fetchSuppliers,
  updateSupplier,
  type Supplier,
} from '../../services/inventoryService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common, dialogCard, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'SupplierList'>;

type DialogMode = 'add' | 'edit';

export default function SupplierListScreen({ navigation }: Props) {
  const t = useT();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
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
      Alert.alert(t('Load failed'), apiError(err, 'Could not load suppliers'));
    }
  }, [t]);

  React.useEffect(() => {
    load();
  }, [load]);

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
    setFabOpen(false);
    setMode('add');
    setEditingId(null);
    setName('');
    setPhone('');
    setEmail('');
    setError('');
    setVisible(true);
  };

  const openImport = () => {
    setFabOpen(false);
    setImportOpen(true);
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
      setError(t('Name is required'));
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

    Alert.alert(t('Delete supplier?'), t('Remove "{{name}}" from your supplier list?', { name: supplier.name }), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
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
    ]);
  };

  const handleNewPurchase = () => {
    if (!editingId) return;
    setVisible(false);
    navigation.navigate('PurchaseBillForm', { supplierId: editingId });
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search suppliers...')} />
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
            icon="truck-outline"
            title={t('No suppliers yet')}
            subtitle={t('Add one supplier or import many at once')}
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={[item.phone, item.email].filter(Boolean).join(' · ') || t('No contact')}
            icon="truck"
            iconColor={colors.secondary}
            iconBg={colors.secondaryLight}
            onPress={() => openEdit(item)}
            onLongPress={() => navigation.navigate('PurchaseBillForm', { supplierId: item.id })}
          />
        )}
      />

      <FAB.Group
        open={fabOpen}
        visible
        icon={fabOpen ? 'close' : 'plus'}
        fabStyle={styles.fabMain}
        color={colors.textOnPrimary}
        onStateChange={({ open }) => setFabOpen(open)}
        actions={[
          {
            icon: 'plus',
            label: t('Add one'),
            onPress: openAdd,
          },
          {
            icon: 'file-upload-outline',
            label: t('Import multiple'),
            onPress: openImport,
          },
        ]}
      />

      <Portal>
        <Dialog visible={visible} onDismiss={closeDialog} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? t('Add Supplier') : t('Edit Supplier')}</Dialog.Title>
          <Dialog.Content>
            <AppTextInput
              label={t('Name *')}
              value={name}
              onChangeText={setName}
              mode="outlined"
              style={styles.input}
              autoFocus={mode === 'add'}
            />
            <AppTextInput
              label={t('Phone')}
              value={phone}
              onChangeText={setPhone}
              mode="outlined"
              keyboardType="phone-pad"
              style={styles.input}
            />
            <AppTextInput
              label={t('Email')}
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
                {t('New purchase entry')}
              </Button>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            {mode === 'edit' ? (
              <Button textColor={colors.error} onPress={confirmDelete} disabled={loading}>
                {t('Delete')}
              </Button>
            ) : (
              <View />
            )}
            <View style={styles.dialogRight}>
              <Button onPress={closeDialog} disabled={loading}>
                {t('Cancel')}
              </Button>
              <Button onPress={handleSave} loading={loading} disabled={!name.trim()}>
                {mode === 'add' ? t('Add') : t('Save')}
              </Button>
            </View>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <BulkImportDialog
        visible={importOpen}
        title={t('Import suppliers')}
        entityLabel={t('Supplier')}
        mode="supplier"
        onDismiss={async () => {
          setImportOpen(false);
          await load();
        }}
        onImport={async (rows) =>
          bulkImportSuppliers(
            rows.map((row) => ({
              name: row.name,
              phone: row.phone || undefined,
              email: row.email || undefined,
            })),
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  dialog: { ...dialogCard },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  purchaseBtn: { marginTop: spacing.sm, borderColor: colors.secondary },
  dialogActions: { justifyContent: 'space-between', paddingHorizontal: spacing.md },
  dialogRight: { flexDirection: 'row', alignItems: 'center' },
  fabMain: { backgroundColor: colors.primary },
});
