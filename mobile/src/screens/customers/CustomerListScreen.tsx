import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal, TextInput } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { createCustomer, deleteCustomer, fetchCustomers, updateCustomer } from '../../services/businessService';
import { useCartStore } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'CustomerList'>;

type Customer = {
  id: string;
  name: string;
  phone?: string;
  loyalty_points: number;
  store_credit_balance: number;
};

type DialogMode = 'add' | 'edit';

function apiError(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || fallback;
}

export default function CustomerListScreen({ navigation, route }: Props) {
  const pickForBill = !!route.params?.pickForBill;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DialogMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const customerId = useCartStore((s) => s.customerId);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const [listLoading, setListLoading] = useState(true);
  const skipNextFocus = React.useRef(true);

  const load = useCallback(async (query = '') => {
    try {
      const result = await fetchCustomers(query.trim() || undefined);
      setCustomers(result?.items || []);
    } catch (err) {
      setCustomers([]);
      Alert.alert('Load failed', apiError(err, 'Could not load customers'));
    }
  }, []);

  React.useEffect(() => {
    setListLoading(true);
    const run = () => load(search).finally(() => setListLoading(false));
    if (!search.trim()) {
      run();
      return;
    }
    const t = setTimeout(run, 280);
    return () => clearTimeout(t);
  }, [load, search]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load(search);
    }, [load, search]),
  );

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setPhone('');
    setError('');
    setVisible(true);
  };

  const openEdit = (customer: Customer) => {
    setMode('edit');
    setEditingId(customer.id);
    setName(customer.name);
    setPhone(customer.phone || '');
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
      const payload = { name: name.trim(), phone: phone.trim() || undefined };
      if (mode === 'add') {
        await createCustomer(payload);
      } else if (editingId) {
        await updateCustomer(editingId, payload);
        if (customerId === editingId) {
          setCustomer(editingId, name.trim());
        }
      }
      setVisible(false);
      await load(search);
    } catch (err) {
      setError(apiError(err, mode === 'add' ? 'Could not add customer' : 'Could not update customer'));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = () => {
    if (!editingId) return;
    const customer = customers.find((c) => c.id === editingId);
    if (!customer) return;

    Alert.alert(
      'Delete customer?',
      `Remove "${customer.name}" from your customer list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await deleteCustomer(editingId);
              if (customerId === editingId) {
                setCustomer(null);
              }
              setVisible(false);
              await load(search);
            } catch (err) {
              setError(apiError(err, 'Could not delete customer'));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleUseForBilling = () => {
    if (!editingId) return;
    setCustomer(editingId, name.trim());
    setVisible(false);
    Alert.alert('Customer selected', `${name.trim()} is set for the current bill.`);
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder="Search customers..." />
      <FlatList
        data={customers}
        keyExtractor={(i) => i.id}
        contentContainerStyle={customers.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(search); setRefreshing(false); }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          listLoading ? null : (
          <EmptyState icon="account-group-outline" title={search.trim() ? 'No matching customers' : 'No customers'} subtitle={search.trim() ? 'Try a different search' : 'Tap + to add your first customer'} />
          )
        }
        renderItem={({ item }) => {
          const isSelected = customerId === item.id;
          return (
            <ListRow
              title={item.name}
              subtitle={[item.phone, `Pts ${item.loyalty_points}`, `Credit ₹${parseFloat(String(item.store_credit_balance)).toFixed(0)}`].filter(Boolean).join(' · ')}
              icon={isSelected ? 'account-check' : 'account-circle'}
              iconColor={isSelected ? colors.secondary : colors.primary}
              iconBg={isSelected ? colors.secondaryLight : colors.primaryLight}
              badge={isSelected ? { label: 'On bill', color: colors.secondary, bg: colors.secondaryLight } : undefined}
              onPress={() => {
                if (pickForBill) {
                  setCustomer(item.id, item.name);
                  navigation.goBack();
                  return;
                }
                openEdit(item);
              }}
              onLongPress={() => {
                setCustomer(item.id, item.name);
                if (pickForBill) {
                  navigation.goBack();
                  return;
                }
                Alert.alert('Customer selected', `${item.name} is set for the current bill.`);
              }}
            />
          );
        }}
      />

      <FAB icon="plus" style={common.fab} color={colors.textOnPrimary} onPress={openAdd} />

      <Portal>
        <Dialog visible={visible} onDismiss={closeDialog} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? 'Add Customer' : 'Edit Customer'}</Dialog.Title>
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
            {error ? <HelperText type="error">{error}</HelperText> : null}
            {mode === 'edit' ? (
              <Button mode="outlined" icon="cart-check" onPress={handleUseForBilling} style={styles.useBtn} textColor={colors.secondary}>
                Use for current bill
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
  useBtn: { marginTop: spacing.sm, borderColor: colors.secondary },
  dialogActions: { justifyContent: 'space-between', paddingHorizontal: spacing.md },
  dialogRight: { flexDirection: 'row', alignItems: 'center' },
});
